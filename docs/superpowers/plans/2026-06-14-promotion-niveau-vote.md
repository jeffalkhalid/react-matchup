# Promotion par niveau + vote des présents — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La promotion depuis la liste d'attente ne promeut automatiquement que les joueurs dans-le-niveau ; les hors-niveau n'entrent que par vote unanime des joueurs présents.

**Architecture:** Cœur = modifier la fonction SQL `free_spot_and_promote` (filtre niveau sur le candidat promu + conversion des hors-niveau restants en `pending`). Une nouvelle edge function `notify-vote-requested` (calquée sur `notify-promotion`) prévient les présents qu'un vote est requis. Côté client, un garde-fou de capacité à l'acceptation d'un `pending`. Le mécanisme d'approbation unanime (`approvals`) existe déjà et n'est pas modifié.

**Tech Stack:** PostgreSQL (plpgsql, Supabase), Deno edge functions, React Native (Expo), TypeScript.

**Spec :** [docs/superpowers/specs/2026-06-14-promotion-niveau-vote-design.md](../specs/2026-06-14-promotion-niveau-vote-design.md)

---

## File Structure

- `supabase/migrations/free_spot_and_promote.sql` — **modifié** : filtre niveau + conversion waitlist→pending. (Cœur testable.)
- `sql/tests/test_free_spot_and_promote.sql` — **créé** : test transactionnel (pattern `test_join_game.sql`).
- `supabase/functions/notify-vote-requested/index.ts` — **créé** : webhook handler waitlist→pending → push aux présents.
- `app/(tabs)/lobby.tsx` — **modifié** (`handleApprovePending`) : garde-fou « place encore libre ? » avant acceptation.
- `docs/DEPLOIEMENT_MAROC.md` — **modifié** : runbook du nouveau webhook.

---

## Task 1 : Filtre niveau + conversion dans `free_spot_and_promote`

**Files:**
- Test: `sql/tests/test_free_spot_and_promote.sql` (créer)
- Modify: `supabase/migrations/free_spot_and_promote.sql`

> Les tests SQL de ce repo s'exécutent à la main dans une transaction (cf. `sql/tests/test_join_game.sql`) : on lance le fichier, il `RAISE EXCEPTION` au premier échec, sinon `RAISE NOTICE '... OK'`, puis `ROLLBACK`. `free_spot_and_promote` ne dépend pas de l'auth (pas de `current_player_id`), donc pas d'impersonation JWT nécessaire.

- [ ] **Step 1 : Écrire le test (échouera sur l'ancienne fonction)**

Créer `sql/tests/test_free_spot_and_promote.sql` :

```sql
BEGIN;
-- free_spot_and_promote(p_game_id) ne dépend pas de l'auth. On teste les 4 règles.
-- IDs en hexa valide uniquement (uuid).

INSERT INTO players (id, name, elo_score) VALUES
  ('00000000-0000-0000-0000-0000000000e0','TEST_FSP_CREATOR',1500),
  ('00000000-0000-0000-0000-0000000000e1','TEST_FSP_UNFIT1', 900),
  ('00000000-0000-0000-0000-0000000000e2','TEST_FSP_FIT1',  1500),
  ('00000000-0000-0000-0000-0000000000e3','TEST_FSP_FIT2',  1600),
  ('00000000-0000-0000-0000-0000000000e4','TEST_FSP_UNFIT2', 950)
  ON CONFLICT (id) DO NOTHING;

-- CAS 1 — la promotion SAUTE un hors-niveau (créé avant) pour prendre un
-- dans-le-niveau (créé après).
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000fa01','00000000-0000-0000-0000-0000000000e0',
          now() + interval '2 days','open',0,'A_GAU',1200,1800,'TEST');
INSERT INTO game_participants (game_id, player_id, status, created_at) VALUES
  ('00000000-0000-0000-0000-00000000fa01','00000000-0000-0000-0000-0000000000e1','waitlist', now() - interval '2 min'),
  ('00000000-0000-0000-0000-00000000fa01','00000000-0000-0000-0000-0000000000e2','waitlist', now() - interval '1 min');
SELECT public.free_spot_and_promote('00000000-0000-0000-0000-00000000fa01');
DO $$
DECLARE s_fit text; s_unfit text;
BEGIN
  SELECT status INTO s_fit   FROM game_participants WHERE game_id='00000000-0000-0000-0000-00000000fa01' AND player_id='00000000-0000-0000-0000-0000000000e2';
  SELECT status INTO s_unfit FROM game_participants WHERE game_id='00000000-0000-0000-0000-00000000fa01' AND player_id='00000000-0000-0000-0000-0000000000e1';
  IF s_fit   <> 'accepted' THEN RAISE EXCEPTION 'cas1 fit devait être promu accepted, obtenu %', s_fit; END IF;
  IF s_unfit <> 'waitlist' THEN RAISE EXCEPTION 'cas1 unfit devait rester waitlist, obtenu %', s_unfit; END IF;
END $$;

-- CAS 2 — file 100% hors-niveau → place rouvre + tous passent pending.
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000fa02','00000000-0000-0000-0000-0000000000e0',
          now() + interval '2 days','open',0,'A_GAU',1200,1800,'TEST');
INSERT INTO game_participants (game_id, player_id, status, created_at) VALUES
  ('00000000-0000-0000-0000-00000000fa02','00000000-0000-0000-0000-0000000000e1','waitlist', now() - interval '2 min'),
  ('00000000-0000-0000-0000-00000000fa02','00000000-0000-0000-0000-0000000000e4','waitlist', now() - interval '1 min');
SELECT public.free_spot_and_promote('00000000-0000-0000-0000-00000000fa02');
DO $$
DECLARE sp int; n_pending int; n_accepted int; g_status text;
BEGIN
  SELECT spots_available, status INTO sp, g_status FROM open_games WHERE id='00000000-0000-0000-0000-00000000fa02';
  SELECT count(*) FILTER (WHERE status='pending'), count(*) FILTER (WHERE status='accepted')
    INTO n_pending, n_accepted FROM game_participants WHERE game_id='00000000-0000-0000-0000-00000000fa02';
  IF n_accepted <> 0 THEN RAISE EXCEPTION 'cas2 aucun accepted attendu, obtenu %', n_accepted; END IF;
  IF n_pending  <> 2 THEN RAISE EXCEPTION 'cas2 2 pending attendus, obtenu %', n_pending; END IF;
  IF sp <> 1 THEN RAISE EXCEPTION 'cas2 spots_available devait passer à 1, obtenu %', sp; END IF;
  IF g_status <> 'open' THEN RAISE EXCEPTION 'cas2 status devait rester open, obtenu %', g_status; END IF;
END $$;

-- CAS 3 — file 100% dans-le-niveau → FIFO : le 1er créé est promu, l'autre reste waitlist.
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000fa03','00000000-0000-0000-0000-0000000000e0',
          now() + interval '2 days','open',0,'A_GAU',1200,1800,'TEST');
INSERT INTO game_participants (game_id, player_id, status, created_at) VALUES
  ('00000000-0000-0000-0000-00000000fa03','00000000-0000-0000-0000-0000000000e2','waitlist', now() - interval '2 min'),
  ('00000000-0000-0000-0000-00000000fa03','00000000-0000-0000-0000-0000000000e3','waitlist', now() - interval '1 min');
SELECT public.free_spot_and_promote('00000000-0000-0000-0000-00000000fa03');
DO $$
DECLARE s_first text; s_second text;
BEGIN
  SELECT status INTO s_first  FROM game_participants WHERE game_id='00000000-0000-0000-0000-00000000fa03' AND player_id='00000000-0000-0000-0000-0000000000e2';
  SELECT status INTO s_second FROM game_participants WHERE game_id='00000000-0000-0000-0000-00000000fa03' AND player_id='00000000-0000-0000-0000-0000000000e3';
  IF s_first  <> 'accepted' THEN RAISE EXCEPTION 'cas3 1er FIFO devait être accepted, obtenu %', s_first; END IF;
  IF s_second <> 'waitlist' THEN RAISE EXCEPTION 'cas3 2e devait rester waitlist, obtenu %', s_second; END IF;
END $$;

-- CAS 4 — file vide → place rouvre, aucun pending créé.
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000fa04','00000000-0000-0000-0000-0000000000e0',
          now() + interval '2 days','open',0,'A_GAU',1200,1800,'TEST');
SELECT public.free_spot_and_promote('00000000-0000-0000-0000-00000000fa04');
DO $$
DECLARE sp int; n int;
BEGIN
  SELECT spots_available INTO sp FROM open_games WHERE id='00000000-0000-0000-0000-00000000fa04';
  SELECT count(*) INTO n FROM game_participants WHERE game_id='00000000-0000-0000-0000-00000000fa04';
  IF sp <> 1 THEN RAISE EXCEPTION 'cas4 spots_available devait passer à 1, obtenu %', sp; END IF;
  IF n  <> 0 THEN RAISE EXCEPTION 'cas4 aucun participant attendu, obtenu %', n; END IF;
END $$;

RAISE NOTICE 'test_free_spot_and_promote: OK';
ROLLBACK;
```

- [ ] **Step 2 : Lancer le test sur la fonction ACTUELLE → doit échouer**

Run : coller le contenu de `sql/tests/test_free_spot_and_promote.sql` dans le SQL Editor Supabase (ou `psql`) et exécuter.
Expected : **ÉCHEC** au CAS 1 — `cas1 fit devait être promu accepted, obtenu waitlist` (l'ancienne fonction promeut le hors-niveau créé en premier, pas le fit).

- [ ] **Step 3 : Modifier `free_spot_and_promote.sql`**

Remplacer **tout** le contenu de `supabase/migrations/free_spot_and_promote.sql` par :

```sql
-- ============================================================
-- Libération d'une place. Promotion AUTOMATIQUE réservée aux
-- joueurs DANS-LE-NIVEAU (elo ∈ [min_elo,max_elo]), en FIFO.
-- Si aucun fit en file : la place rouvre ET les hors-niveau
-- restants passent en 'pending' (vote unanime des présents via
-- le mécanisme `approvals`). Un 'pending' n'occupe pas de place,
-- donc un joueur fit qui arrive ensuite garde la priorité.
-- Appelée par CHAQUE chemin de libération (expiration cron,
-- retrait manuel, départ d'un accepté). La notif de promotion
-- (waitlist→accepted) part du webhook notify-promotion ; celle de
-- vote (waitlist→pending) part du webhook notify-vote-requested.
-- ============================================================
CREATE OR REPLACE FUNCTION public.free_spot_and_promote(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_creator_side text;
  v_min          int;
  v_max          int;
  v_next_id      uuid;
  v_taken        text[];
  v_side         text;
BEGIN
  SELECT creator_side, min_elo, max_elo
    INTO v_creator_side, v_min, v_max
    FROM open_games WHERE id = p_game_id;

  -- Prochain promu = 1er waitlist DANS-LE-NIVEAU (FIFO).
  SELECT gp.id INTO v_next_id
  FROM game_participants gp
  JOIN players p ON p.id = gp.player_id
  WHERE gp.game_id = p_game_id
    AND gp.status = 'waitlist'
    AND p.elo_score >= coalesce(v_min, 0)
    AND p.elo_score <= coalesce(v_max, 9999)
  ORDER BY gp.created_at ASC
  LIMIT 1;

  IF v_next_id IS NOT NULL THEN
    SELECT array_agg(team_side) INTO v_taken
      FROM game_participants
      WHERE game_id = p_game_id AND status = 'accepted' AND team_side IS NOT NULL;
    v_taken := coalesce(v_taken, '{}'::text[]) || coalesce(v_creator_side, 'A_GAU');

    SELECT s INTO v_side
      FROM unnest(ARRAY['A_GAU','A_DRO','B_GAU','B_DRO']) AS s
      WHERE s <> ALL (v_taken)
      LIMIT 1;

    UPDATE game_participants
      SET status = 'accepted',
          team_side = coalesce(v_side, team_side)
      WHERE id = v_next_id;
  ELSE
    -- Aucun fit en file : rouvrir la place ET convertir les hors-niveau
    -- restants en 'pending' (soumis au vote unanime des présents).
    UPDATE open_games
      SET spots_available = least(3, coalesce(spots_available, 0) + 1),
          status = 'open'
      WHERE id = p_game_id;

    UPDATE game_participants
      SET status = 'pending'
      WHERE game_id = p_game_id AND status = 'waitlist';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.free_spot_and_promote(uuid) TO authenticated, service_role;
```

- [ ] **Step 4 : Appliquer la fonction puis relancer le test → doit passer**

Run : exécuter `supabase/migrations/free_spot_and_promote.sql` (SQL Editor / `psql`) pour remplacer la fonction, **puis** ré-exécuter le fichier de test.
Expected : `NOTICE: test_free_spot_and_promote: OK` (aucune exception), transaction rollback.

- [ ] **Step 5 : Commit**

```bash
git add supabase/migrations/free_spot_and_promote.sql sql/tests/test_free_spot_and_promote.sql
git commit -m "feat(waitlist): promotion réservée aux joueurs dans-le-niveau, hors-niveau→pending"
```

---

## Task 2 : Edge function `notify-vote-requested`

**Files:**
- Create: `supabase/functions/notify-vote-requested/index.ts`

> Pas de harness de test unitaire pour les edge functions ici (comme `notify-promotion`). Vérification = déploiement + déclenchement réel. Le webhook se crée dans le dashboard.

- [ ] **Step 1 : Créer la fonction (calquée sur `notify-promotion`)**

Créer `supabase/functions/notify-vote-requested/index.ts` :

```ts
// Database Webhook handler : un joueur hors-niveau a été converti
// waitlist→pending par free_spot_and_promote. Prévient les joueurs PRÉSENTS
// (créateur + accepted) qu'un vote d'approbation est requis.
// Webhook sur game_participants — events: UPDATE.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

interface DbWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  record: { game_id: string; player_id: string; status: string } | null;
  old_record: { status: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' },
    });
  }
  try {
    const { type, record, old_record } = (await req.json()) as DbWebhookPayload;
    if (type !== 'UPDATE' || !record) return new Response('skip');
    if (record.status !== 'pending' || old_record?.status !== 'waitlist') return new Response('skip');

    // Présents = créateur + accepted (hors le candidat lui-même).
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` };
    const gameRes = await fetch(
      `${SUPABASE_URL}/rest/v1/open_games?id=eq.${record.game_id}&select=creator_id,location`,
      { headers: { ...headers, apikey: SERVICE_ROLE } },
    );
    const [game] = (await gameRes.json()) as { creator_id: string; location: string | null }[];

    const partRes = await fetch(
      `${SUPABASE_URL}/rest/v1/game_participants?game_id=eq.${record.game_id}&status=eq.accepted&select=player_id`,
      { headers: { ...headers, apikey: SERVICE_ROLE } },
    );
    const accepted = (await partRes.json()) as { player_id: string }[];

    const present = new Set<string>([game?.creator_id, ...accepted.map(a => a.player_id)].filter(Boolean) as string[]);
    present.delete(record.player_id);
    const playerIds = [...present];
    if (playerIds.length === 0) return new Response('no-recipients');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        playerIds,
        title: '🗳️ Un joueur souhaite rejoindre',
        body: 'Un joueur hors de la fourchette de niveau attend votre validation.',
        data: { type: 'lobby', gameId: record.game_id },
      }),
    });
    return new Response(JSON.stringify({ ok: res.ok, recipients: playerIds.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 2 : Déployer la fonction**

Run : `npx supabase functions deploy notify-vote-requested --project-ref icshhobxeppttgayxmba`
Expected : `Deployed Function notify-vote-requested`.

- [ ] **Step 3 : Créer le Database Webhook (dashboard, manuel)**

Dashboard Supabase → Database → Webhooks → Create :
- Table : `game_participants`, Events : `UPDATE`.
- Type : HTTP Request → `POST {SUPABASE_URL}/functions/v1/notify-vote-requested`.
- Header : `Authorization: Bearer <SERVICE_ROLE_KEY>`.

(Le filtrage waitlist→pending est fait dans la fonction, pas besoin de condition côté webhook. Vérifier que ça ne double pas avec `notify-promotion` : ce dernier ne réagit qu'à `accepted`, donc pas de conflit.)

- [ ] **Step 4 : Vérifier le déclenchement réel**

Run : sur une partie de test pleine de hors-niveau en file, libérer une place (ex. retrait d'un accepté ou `SELECT free_spot_and_promote('<game>')`), puis vérifier qu'un push « 🗳️ Un joueur souhaite rejoindre » arrive sur l'appareil d'un présent.
Expected : push reçu ; statuts en base = `pending` pour les ex-waitlist.

- [ ] **Step 5 : Commit**

```bash
git add supabase/functions/notify-vote-requested/index.ts
git commit -m "feat(notif): notify-vote-requested (waitlist->pending push aux présents)"
```

---

## Task 3 : Garde-fou capacité à l'acceptation d'un `pending`

**Files:**
- Modify: `app/(tabs)/lobby.tsx` (`handleApprovePending`, ~lignes 2054-2130)

> Cas limite #2 du spec : un joueur fit peut prendre la place pendant le vote (un `pending` ne réserve rien). Avant d'accepter, re-vérifier qu'une place vivante est libre. `occupiesSpot` est déjà importé (`lib/games`). Pas de test unitaire client dans ce repo → vérification manuelle.

- [ ] **Step 1 : Ajouter le calcul de place libre et conditionner l'acceptation**

Dans `handleApprovePending`, repérer la ligne :

```ts
    const allApproved = requiredApprovers.every(id => newApprovals.includes(id));
```

L'AJOUTER juste après :

```ts
    // Cas limite : un joueur dans-le-niveau a pu prendre la place pendant le
    // vote (un `pending` ne réserve aucune place). Re-vérifier qu'une place
    // vivante est libre avant d'accepter ; sinon on enregistre l'approbation
    // mais on n'accepte pas (le vote reste en attente d'une place).
    const liveOccupants = 1 + (game?.participants ?? [])
      .filter((p: any) => p.id !== participantId && occupiesSpot(p)).length;
    const spotFree = liveOccupants < 4;
    const willAccept = allApproved && spotFree;
    if (allApproved && !spotFree) {
      Alert.alert(
        'Partie complète',
        "Une place a été prise entre-temps — le vote reste en attente d'une place libre.",
      );
    }
```

- [ ] **Step 2 : Remplacer les usages de `allApproved` par `willAccept` dans la suite**

Dans le même handler, remplacer les 3 occurrences qui DÉCLENCHENT l'acceptation (PAS celle de `requiredApprovers`/`newApprovals`) :

1. `if (allApproved && game) {` (bloc d'assignation du côté) → `if (willAccept && game) {`
2. `...(allApproved ? { status: 'accepted', team_side: assignedSide } : {}),` → `...(willAccept ? { status: 'accepted', team_side: assignedSide } : {}),`
3. `if (allApproved) {` (bloc décrément place + notif) → `if (willAccept) {`

> L'approbation est toujours enregistrée (`approvals: newApprovals`) même si la place est pleine : le vote « tient » et l'acceptation se fera quand une place se libère et que le dernier votant ré-appuie. (Comportement simple, conforme au spec.)

- [ ] **Step 3 : Typecheck**

Run : `npx tsc --noEmit`
Expected : exit 0, aucune erreur.

- [ ] **Step 4 : Vérification manuelle (Expo)**

Scénario : partie pleine (4 vivants) + 1 `pending` ayant déjà toutes les approbations sauf une. Le dernier présent approuve → l'alerte « Partie complète » s'affiche, le `pending` n'est PAS accepté, l'approbation est bien enregistrée. Puis libérer une place et ré-approuver → acceptation effective.
Expected : conforme ci-dessus.

- [ ] **Step 5 : Commit**

```bash
git add app/(tabs)/lobby.tsx
git commit -m "fix(lobby): ne pas accepter un pending si la place a été reprise pendant le vote"
```

---

## Task 4 : Runbook du nouveau webhook

**Files:**
- Modify: `docs/DEPLOIEMENT_MAROC.md`

- [ ] **Step 1 : Documenter le webhook dans le runbook**

Ajouter dans la section déploiement/webhooks de `docs/DEPLOIEMENT_MAROC.md` une entrée :

```markdown
- **notify-vote-requested** : Database Webhook sur `game_participants` (UPDATE) →
  `POST {SUPABASE_URL}/functions/v1/notify-vote-requested`, header
  `Authorization: Bearer <SERVICE_ROLE_KEY>`. Prévient les joueurs présents
  qu'un hors-niveau (converti waitlist→pending par `free_spot_and_promote`)
  attend leur vote unanime. À créer à la main (hors migrations).
```

- [ ] **Step 2 : Commit**

```bash
git add docs/DEPLOIEMENT_MAROC.md
git commit -m "docs(deploiement): webhook notify-vote-requested"
```

---

## Notes d'exécution

- **Ordre :** Task 1 d'abord (cœur + test), puis 2, 3, 4 (indépendantes entre elles).
- **Migrations non timestampées :** `free_spot_and_promote.sql` est rejoué à la main en prod. S'assurer qu'il est bien la **dernière** version appliquée de cette fonction (cf. drift connu). Pas de nouveau fichier de migration — on modifie l'existant en place (CREATE OR REPLACE).
- **Pas de changement de schéma** : aucun nouvel index, colonne ou enum. Les statuts `waitlist`/`pending`/`accepted` et `approvals` existent déjà.
