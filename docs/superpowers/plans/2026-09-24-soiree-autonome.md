# Soirée de tournoi autonome — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une soirée de tournoi qui se conduit au rythme des matchs — chaque terrain démarre son chrono, l'app sonne à la fin, la rotation suivante part toute seule, et l'admin n'intervient que pour débloquer.

**Architecture:** Le serveur garde une seule nouvelle donnée, l'heure de départ d'un terrain (`tournament_matches.started_at`), et deux nouvelles portes (`tournament_start_match`, `tournament_reset_match_start`). Le temps qui passe est affiché et sonné par chaque téléphone (notifications locales programmées, annulées dès qu'un score arrive) ; les événements qui concernent les autres (rotation tirée, terrain muet, forfait, classement validé) partent du serveur par le chemin de push existant (déclencheur → `pg_net` → `send-push`). Les gestes de soirée s'ouvrent aux joueurs : le forfait au binôme concerné, et l'arbitrage s'élargit au terrain muet pour que l'admin puisse taper un score que personne ne rendra.

**Tech Stack:** PostgreSQL / Supabase (plpgsql, `pg_cron`, `pg_net`), React Native + Expo SDK 57 (`expo-notifications`), TypeScript, Vitest, banc PostgreSQL local `pagmatch-db-tests` (embedded-postgres).

**Spec:** `docs/superpowers/specs/2026-09-24-soiree-autonome-design.md`

## Global Constraints

- **Ordre des migrations, non négociable** (spec §11) : `tournament_score_effective.sql`, puis `tournament_auto_advance.sql`, puis celles de ce plan. `tournament_auto_advance.sql` appliquée seule aggrave (mesuré : `tournament_ladder_corrupt` à la 4ᵉ rotation, saisie du joueur annulée).
- **Un corps de fonction serveur ne se réécrit jamais de mémoire** : il s'EXTRAIT du fichier qui fait autorité puis se patche. Sur ce dépôt, une réécriture a déjà fait disparaître six refus nommés.
- **Les fonctions redéfinies par `tournament_auto_advance.sql` font autorité** pour `tournament_resolve_dispute` (lignes 607-701), `tournament_forfeit` (703-803) et `fn_tournament_try_advance` (347-376) — PAS les versions de `tournaments_rpcs.sql`.
- **Droits Supabase** : tout `CREATE FUNCTION` est suivi de `REVOKE ALL ... FROM PUBLIC, anon, authenticated;` puis, si la fonction est appelée par un écran, `GRANT EXECUTE ... TO authenticated;`. Un `REVOKE FROM PUBLIC` ne retire pas les droits directs d'`anon` et `authenticated` : il faut les nommer.
- **Jamais de push depuis le client.** Tout passe par déclencheur SQL → `net.http_post` → fonction `send-push`, et l'envoi est enveloppé dans `EXCEPTION WHEN OTHERS THEN NULL` : une notification ratée ne doit jamais annuler le geste métier.
- **`confirmed_at` garde son sens** (« les deux camps sont d'accord »). Aucune tâche ne change sa signification.
- **Aucun chemin local** (`C:\Users\...`) dans un fichier versionné : le dépôt est public.
- **`supabase/migrations/` n'est pas suivi par git** sur ce dépôt : les fichiers SQL de ce plan existent en local et s'appliquent à la main dans l'éditeur SQL Supabase.
- **Travail direct sur `main`**, changements additifs et réversibles. **Les commits ne partent que sur demande du user** : chaque tâche donne son message de commit, l'exécutant le propose et attend le feu vert.
- **Libellés** : jamais « en attente » pour un score provisoire — il compte déjà.

## Review Focus

1. **Deux joueurs appuient « On commence » dans la même seconde** — une seule heure de départ doit être retenue, et le second reçoit celle du premier, pas un refus (Tâche 1).
2. **Le score arrive avant la fin des 15 minutes** — les deux sonneries programmées doivent être annulées, sinon le téléphone sonne pendant la rotation suivante (Tâche 6).
3. **L'app est fermée puis rouverte entre le départ et la sonnerie** — au retour, l'écran ne doit ni reprogrammer une sonnerie en double ni en perdre une (Tâche 6).
4. **Les notifications sont refusées par le système** — le compte à rebours reste affiché et tout continue de marcher ; aucun geste bloqué, aucune erreur à l'écran (Tâche 6).
5. **Le score arrive entre-temps, ou la minute suivante passe** — l'alerte « terrain muet » ne part pas, et elle ne se répète jamais pour un même match (Tâche 4).

---

## File Structure

**Serveur (local, non versionné)**
- `supabase/migrations/tournament_court_clock.sql` — colonne `started_at`, `tournament_start_match`, `tournament_reset_match_start` (Tâche 1)
- `supabase/migrations/tournament_soiree_gestes.sql` — forfait ouvert au binôme, arbitrage élargi au terrain muet (Tâche 2)
- `supabase/migrations/tournament_soiree_ouverture_cloture.sql` — tour 1 tiré au lancement, clôture automatique (Tâche 3)
- `supabase/migrations/tournament_soiree_notifs.sql` — colonne `silent_notified_at`, 4 notifications, travail planifié (Tâche 4)

**Banc d'essai (hors dépôt, dossier `pagmatch-db-tests`)**
- `test-soiree-chrono.mjs` (Tâche 1), `test-soiree-gestes.mjs` (Tâche 2), `test-soiree-cloture.mjs` (Tâche 3), `test-soiree-notifs.mjs` (Tâche 4), `recette-soiree.mjs` (Tâche 9)

**App**
- `lib/tournaments.ts` — type `TournamentMatch` + `started_at`, wrappers des deux nouvelles RPC (Tâche 5)
- `lib/tournamentEvening.ts` — trois nouveaux états de terrain, temps restant (Tâche 5)
- `lib/courtAlarm.ts` — **nouveau** : programmation et annulation des sonneries, adaptateur injecté (Tâche 6)
- `app/tournaments/soiree/[id].tsx` — « On commence », compte à rebours, « Nous abandonnons » (Tâche 7)
- `hooks/usePushNotifications.ts` — routage des notifications de tournoi (Tâche 7)
- `app/(tabs)/admin.tsx` — retrait des boutons de rotation, « Lancer la soirée » (Tâche 8)

**Tests app**
- `lib/__tests__/tournamentEvening.test.ts` (existant, étendu — Tâche 5)
- `lib/__tests__/courtAlarm.test.ts` — **nouveau** (Tâche 6)

---

## Tâche 0 : les deux migrations en attente (geste humain, prérequis)

**Files:** aucun — application manuelle dans l'éditeur SQL Supabase.

**Interfaces:**
- Produces: une base où `fn_tournament_score_acquis` et `fn_tournament_try_advance` existent. Toutes les tâches suivantes en dépendent.

- [ ] **Step 1 : appliquer `tournament_score_effective.sql`** (déjà écrite, recette 9/9), puis **`tournament_auto_advance.sql`**, dans cet ordre, entre deux soirées — jamais pendant une soirée en cours (l'échelle se recalcule sur tout le passé).

- [ ] **Step 2 : vérifier**

```sql
select proname from pg_proc where proname in
  ('fn_tournament_score_acquis','fn_tournament_try_advance');
-- attendu : les DEUX lignes

select count(*) from pg_publication_tables
 where pubname='supabase_realtime' and tablename='tournament_matches';
-- attendu : 1
```

Si l'une des deux manque, **arrêter le plan ici** : rien de ce qui suit n'a de sens sans elles.

---

## Tâche 1 : le chrono d'un terrain (serveur)

**Files:**
- Create: `supabase/migrations/tournament_court_clock.sql`
- Create (hors dépôt): `pagmatch-db-tests/test-soiree-chrono.mjs`

**Interfaces:**
- Consumes: `public.current_player_id()`, `public.fn_tournaments_enabled()`, `tournaments.round_minutes`, `tournament_matches`, `tournament_teams`.
- Produces:
  - colonne `public.tournament_matches.started_at timestamptz NULL`
  - `public.tournament_start_match(p_match uuid) → jsonb` : `{ok:true, started_at:timestamptz, already:boolean, round_minutes:int}` ou `{ok:false, reason:text}` parmi `feature_disabled`, `not_authenticated`, `match_not_found`, `bye_match`, `tournament_not_started`, `round_closed`, `not_a_player`, `already_scored`
  - `public.tournament_reset_match_start(p_match uuid) → jsonb` : `{ok:true}` ou les mêmes refus
  - les deux accordées à `authenticated`

- [ ] **Step 1 : écrire le test qui échoue**

Créer `pagmatch-db-tests/test-soiree-chrono.mjs`. Il monte une soirée réelle (8 binômes, tournoi lancé, rotation 1 tirée) puis vérifie le chrono.

```js
// Banc : le VRAI moteur SQL sur un PostgreSQL local éphémère. Jamais la prod.
import { startPg, asRole } from './harness.mjs';
import { readFile } from 'node:fs/promises';

const MIG = '../react-matchup/supabase/migrations/';
const ORDRE = [
  './fixture.sql', './fixture-tournois.sql', MIG + 'elo_level_helpers.sql',
  MIG + 'tournaments.sql', MIG + 'tournaments_flag.sql', MIG + 'tournaments_rpcs.sql',
  MIG + 'tournament_round_minutes.sql', MIG + 'tournament_partner_invite.sql',
  MIG + 'tournament_partner_consent.sql', MIG + 'tournament_pairs_only_seats.sql',
  MIG + 'tournament_pairs_only_backfill.sql', MIG + 'tournament_free_places_pairs.sql',
  MIG + 'tournament_pending_pairs.sql', MIG + 'tournament_score_no_wait.sql',
  MIG + 'tournament_score_effective.sql', MIG + 'tournament_auto_advance.sql',
  MIG + 'tournament_court_clock.sql',
];
const cas = [];
const verifie = (nom, ok, detail = '') => cas.push({ nom, ok: !!ok, detail });

async function applyFile(client, path) {
  let sql = await readFile(path, 'utf8');
  sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS (pg_net|supabase_vault);/gi, '-- [banc] $&');
  await client.query(sql);
}

const pg = await startPg();
const admin = pg.client;
let app;
try {
  for (const f of ORDRE) await applyFile(admin, f);
  await admin.query(`update public.app_config set value='true' where key='tournaments_enabled'`);
  app = await pg.appConnect();
  const rpc = async (uid, sql, params = []) => {
    await asRole(app, 'authenticated', uid);
    try {
      const r = await app.query(sql, params);
      return r.rows[0] ? Object.values(r.rows[0])[0] : null;
    } catch (e) { return { ok: false, EXCEPTION: e.message }; }
  };

  const s = await monterUneSoiree(admin, rpc);   // cf. fixture-tournois.sql, Step 1bis
  const m = (await s.matchs(1))[0];
  const joueurA1 = s.joueurDe(m.team_a), joueurB1 = s.joueurDe(m.team_b);
  const etranger = s.orga;                        // n'est dans aucun binôme

  const r1 = await rpc(joueurA1.user_id, `select public.tournament_start_match($1)`, [m.id]);
  verifie('un joueur du match démarre le chrono', r1?.ok === true && !!r1.started_at, JSON.stringify(r1));
  verifie('la durée de rotation est rendue avec', r1?.round_minutes === 20, JSON.stringify(r1));

  const r2 = await rpc(joueurB1.user_id, `select public.tournament_start_match($1)`, [m.id]);
  verifie('le second appui rend la MÊME heure, sans refus',
    r2?.ok === true && r2.already === true && r2.started_at === r1.started_at, JSON.stringify(r2));

  const r3 = await rpc(etranger.user_id, `select public.tournament_start_match($1)`, [m.id]);
  verifie('un non-joueur est refusé', r3?.ok === false && r3.reason === 'not_a_player', JSON.stringify(r3));

  const reset = await rpc(joueurA1.user_id, `select public.tournament_reset_match_start($1)`, [m.id]);
  const apres = (await admin.query('select started_at from public.tournament_matches where id=$1', [m.id])).rows[0];
  verifie('la remise à zéro efface l\'heure de départ',
    reset?.ok === true && apres.started_at === null, JSON.stringify(reset));

  await rpc(joueurA1.user_id, `select public.tournament_start_match($1)`, [m.id]);
  await rpc(joueurA1.user_id, `select public.tournament_enter_score($1,6,3)`, [m.id]);
  const r4 = await rpc(joueurA1.user_id, `select public.tournament_reset_match_start($1)`, [m.id]);
  verifie('un match déjà scoré ne se remet pas à zéro',
    r4?.ok === false && r4.reason === 'already_scored', JSON.stringify(r4));

  const bye = (await admin.query(
    `select id from public.tournament_matches where tournament_id=$1 and team_b is null limit 1`, [s.tid])).rows[0];
  if (bye) {
    const r5 = await rpc(joueurA1.user_id, `select public.tournament_start_match($1)`, [bye.id]);
    verifie('un repos ne se démarre pas', r5?.ok === false && r5.reason === 'bye_match', JSON.stringify(r5));
  }

  for (const c of cas) console.log(`${c.ok ? '  ✔' : '  ✘'} ${c.nom}${c.ok ? '' : '\n      ' + c.detail}`);
  process.exitCode = cas.some(c => !c.ok) ? 1 : 0;
} finally {
  try { await app?.end(); } catch {}
  await pg.stop();
}
```

- [ ] **Step 1bis : extraire le montage d'une soirée dans un module partagé**

Les quatre tests de ce plan montent la même soirée. Créer `pagmatch-db-tests/soiree-fixture.mjs` qui exporte `monterUneSoiree(admin, rpc)` : crée 17 joueurs (1 organisateur + 16), un tournoi `tournament_create(nom, now()+1h, 4 terrains, 6 rotations, …, 20 minutes)`, inscrit 8 binômes (`tournament_register` avec partenaire puis `tournament_respond_join`), ouvre le pointage, pointe les 16, lance, et tire la rotation 1. Il rend `{ tid, orga, joueurs, teams, joueurDe(teamId), matchs(round), etat(), rpcOrga(sql) }`. Créer aussi `pagmatch-db-tests/fixture-tournois.sql` : `app_config(key,value)`, `clubs(id,name,city,lat,lng)`, schéma `vault` avec `decrypted_secrets(name,decrypted_secret)` vide, `net.http_post(url,headers,body)` qui rend `1::bigint`, et la publication `supabase_realtime` si absente.

- [ ] **Step 2 : lancer le test pour le voir échouer**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node test-soiree-chrono.mjs`
Expected: FAIL — `ERREUR ... tournament_court_clock.sql` introuvable (le fichier de migration n'existe pas encore).

- [ ] **Step 3 : écrire la migration**

Créer `supabase/migrations/tournament_court_clock.sql` :

```sql
-- ============================================================
-- LE CHRONO D'UN TERRAIN.
--
-- ORDRE D'APPLICATION - a appliquer APRES tournament_auto_advance.sql.
--
-- POURQUOI UNE HEURE EN BASE plutot qu'un compteur dans chaque telephone :
-- les quatre joueurs doivent voir LE MEME temps restant, celui qui arrive en
-- retard comme celui qui rouvre l'app. Un compteur local derive, se remet a
-- zero a chaque ouverture d'ecran, et fait sonner quatre telephones a quatre
-- moments differents.
--
-- ROLLBACK : DROP FUNCTION public.tournament_start_match(uuid),
--            DROP FUNCTION public.tournament_reset_match_start(uuid).
--            La colonne peut rester, elle n'est lue par personne d'autre.
-- ============================================================
BEGIN;

ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- ----------------------------------------------------------------------------
-- « ON COMMENCE » -- appele par l'un des quatre joueurs du terrain.
--
-- IDEMPOTENTE, ET C'EST LE POINT : deux joueurs qui appuient dans la meme
-- seconde, c'est le cas NORMAL, pas une erreur. Le second recoit l'heure du
-- premier. Un refus l'aurait fait rappuyer, et douter du chrono affiche.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tournament_start_match(p_match uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me   uuid := public.current_player_id();
  v_t    public.tournaments%ROWTYPE;
  v_m    public.tournament_matches%ROWTYPE;
  v_rows int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- ORDRE DES VERROUS : la ligne `tournaments` D'ABORD, comme
  -- `tournament_enter_score`. Prendre le match d'abord croiserait l'ordre de
  -- verrouillage de la saisie de score et ouvrirait un interblocage.
  SELECT t.* INTO v_t
    FROM public.tournaments t
    JOIN public.tournament_matches m ON m.tournament_id = t.id
   WHERE m.id = p_match
   FOR UPDATE OF t;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;

  SELECT * INTO v_m FROM public.tournament_matches WHERE id = p_match FOR UPDATE;
  IF v_m.team_b IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bye_match');
  END IF;
  IF v_t.status <> 'EN_COURS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_started');
  END IF;
  IF v_m.round_no <> v_t.current_round THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'round_closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_teams tt
                  WHERE tt.id IN (v_m.team_a, v_m.team_b)
                    AND v_me IN (tt.player1_id, tt.player2_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_player');
  END IF;
  IF v_m.games_a IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_scored');
  END IF;

  IF v_m.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'started_at', v_m.started_at,
                              'already', true, 'round_minutes', v_t.round_minutes);
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURE -- la seule de cette fonction.
  ---------------------------------------------------------------------------
  UPDATE public.tournament_matches
     SET started_at = now()
   WHERE id = p_match AND started_at IS NULL
  RETURNING * INTO v_m;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    SELECT * INTO v_m FROM public.tournament_matches WHERE id = p_match;
    RETURN jsonb_build_object('ok', true, 'started_at', v_m.started_at,
                              'already', true, 'round_minutes', v_t.round_minutes);
  END IF;

  RETURN jsonb_build_object('ok', true, 'started_at', v_m.started_at,
                            'already', false, 'round_minutes', v_t.round_minutes);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_start_match(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_start_match(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- « ON N'AVAIT PAS COMMENCE » -- quelqu'un a appuye trop tot.
--
-- Reserve aux quatre joueurs du terrain, et REFUSEE des qu'un score existe :
-- remettre le chrono a zero apres coup ferait sonner un match deja joue.
-- Sans cette porte, un appui malencontreux obligeait a appeler l'organisateur.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tournament_reset_match_start(p_match uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := public.current_player_id();
  v_t  public.tournaments%ROWTYPE;
  v_m  public.tournament_matches%ROWTYPE;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT t.* INTO v_t
    FROM public.tournaments t
    JOIN public.tournament_matches m ON m.tournament_id = t.id
   WHERE m.id = p_match
   FOR UPDATE OF t;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'match_not_found');
  END IF;

  SELECT * INTO v_m FROM public.tournament_matches WHERE id = p_match FOR UPDATE;
  IF v_m.team_b IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bye_match');
  END IF;
  IF v_t.status <> 'EN_COURS' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_started');
  END IF;
  IF v_m.round_no <> v_t.current_round THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'round_closed');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tournament_teams tt
                  WHERE tt.id IN (v_m.team_a, v_m.team_b)
                    AND v_me IN (tt.player1_id, tt.player2_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_player');
  END IF;
  IF v_m.games_a IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_scored');
  END IF;

  UPDATE public.tournament_matches SET started_at = NULL WHERE id = p_match;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.tournament_reset_match_start(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_reset_match_start(uuid) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 4 : relancer le test**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node test-soiree-chrono.mjs`
Expected: toutes les lignes en ✔ (6 cas), code de sortie 0.

- [ ] **Step 5 : commit** (à proposer au user)

```bash
git add docs/superpowers/plans/2026-09-24-soiree-autonome.md
git commit -m "feat(tournois): le chrono d un terrain, cote serveur"
```

---

## Tâche 2 : le forfait au binôme, l'arbitrage au terrain muet (serveur)

**Files:**
- Create: `supabase/migrations/tournament_soiree_gestes.sql`
- Create (hors dépôt): `pagmatch-db-tests/test-soiree-gestes.mjs`

**Interfaces:**
- Consumes: `tournament_forfeit` et `tournament_resolve_dispute` dans leurs versions de `tournament_auto_advance.sql`.
- Produces: `tournament_forfeit(p_tournament uuid, p_team uuid)` accepte désormais un membre du binôme visé ; `tournament_resolve_dispute(p_match uuid, p_games_a int, p_games_b int)` ne rend plus `no_dispute`. Mêmes signatures, mêmes autres refus.

- [ ] **Step 1 : écrire le test qui échoue**

`pagmatch-db-tests/test-soiree-gestes.mjs`, même ossature que la Tâche 1 (ajouter `tournament_soiree_gestes.sql` en fin d'ORDRE) :

```js
  const s = await monterUneSoiree(admin, rpc);
  const ms = await s.matchs(1);
  const m = ms[0];
  const joueurA = s.joueurDe(m.team_a), joueurB = s.joueurDe(m.team_b);
  const tiers = s.joueurDe(ms[1].team_a);

  const f1 = await rpc(tiers.user_id, `select public.tournament_forfeit($1,$2)`, [s.tid, m.team_a]);
  verifie('un joueur étranger au binôme ne peut pas le faire abandonner',
    f1?.ok === false && f1.reason === 'not_the_organizer', JSON.stringify(f1));

  const f2 = await rpc(joueurA.user_id, `select public.tournament_forfeit($1,$2)`, [s.tid, m.team_a]);
  verifie('un membre du binôme déclare l\'abandon', f2?.ok === true, JSON.stringify(f2));
  const eq = (await admin.query('select withdrawn from public.tournament_teams where id=$1', [m.team_a])).rows[0];
  verifie('le binôme est bien sorti', eq.withdrawn === true, JSON.stringify(eq));

  // Arbitrage sur un terrain MUET (aucune saisie) : impossible aujourd'hui.
  const muet = ms[1];
  const a1 = await rpc(s.orga.user_id, `select public.tournament_resolve_dispute($1,6,2)`, [muet.id]);
  verifie('l\'organisateur pose un score là où personne n\'a rien saisi',
    a1?.ok === true, JSON.stringify(a1));
  const apres = (await admin.query(
    'select games_a, games_b, confirmed_at from public.tournament_matches where id=$1', [muet.id])).rows[0];
  verifie('le score posé est acquis',
    apres.games_a === 6 && apres.games_b === 2 && apres.confirmed_at !== null, JSON.stringify(apres));

  const a2 = await rpc(s.orga.user_id, `select public.tournament_resolve_dispute($1,6,1)`, [muet.id]);
  verifie('un match déjà acquis ne se réécrit pas',
    a2?.ok === false && a2.reason === 'already_confirmed', JSON.stringify(a2));

  const a3 = await rpc(joueurB.user_id, `select public.tournament_resolve_dispute($1,6,2)`, [ms[2].id]);
  verifie('un joueur ordinaire ne peut pas arbitrer',
    a3?.ok === false && a3.reason === 'not_the_organizer', JSON.stringify(a3));
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node test-soiree-gestes.mjs`
Expected: FAIL — « un membre du binôme déclare l'abandon » rend `not_the_organizer`, et « l'organisateur pose un score là où personne n'a rien saisi » rend `no_dispute`.

- [ ] **Step 3 : écrire la migration par EXTRACTION**

Créer `supabase/migrations/tournament_soiree_gestes.sql`. Les deux corps sont **copiés depuis `tournament_auto_advance.sql`** — `tournament_resolve_dispute` (lignes 607 à 701, `CREATE` jusqu'au `REVOKE`/`GRANT` compris) et `tournament_forfeit` (lignes 703 à 803) — puis patchés comme suit, et rien d'autre :

**Patch 1 — dans `tournament_forfeit`**, remplacer :

```sql
  IF v_t.created_by <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
```

par :

```sql
  -- LE BINOME DECLARE SON PROPRE ABANDON (2026-09-24). Un seul des deux
  -- suffit : le plus souvent on abandonne PARCE QUE l'autre est deja parti,
  -- et exiger sa confirmation bloquerait le bin ome dans la soiree jusqu'a ce
  -- qu'un organisateur intervienne -- exactement ce qu'on supprime.
  -- L'organisateur garde le geste, pour les cas ou plus personne n'est la.
  -- Le refus garde son nom `not_the_organizer` : il est deja traduit cote
  -- client, et le renommer casserait le libelle sans rien apprendre.
  IF v_t.created_by <> v_me
     AND NOT EXISTS (SELECT 1 FROM public.tournament_teams tt
                      WHERE tt.id = p_team
                        AND tt.tournament_id = p_tournament
                        AND v_me IN (tt.player1_id, tt.player2_id)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
```

**Patch 2 — dans `tournament_resolve_dispute`**, remplacer :

```sql
  IF NOT public.fn_tournament_match_dispute(p_match) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_dispute');
  END IF;
```

par :

```sql
  -- LE TERRAIN MUET (2026-09-24). Ce garde exigeait un DESACCORD : sur un
  -- terrain ou personne n'avait rien saisi -- le cas le plus frequent quand
  -- quatre joueurs sont partis -- l'organisateur ne pouvait donc RIEN faire,
  -- et la rotation restait bloquee pour toute la soiree. Il peut desormais
  -- poser un score sur tout match non confirme, avec zero, une ou deux
  -- saisies. `already_confirmed`, teste juste au-dessus, reste la seule
  -- barriere : un match acquis se ROUVRE (tournament_reopen_match), il ne se
  -- reecrit pas.
```

En tête du fichier, l'en-tête habituel : le pourquoi, l'ordre d'application (après `tournament_auto_advance.sql`), et le rollback (ré-appliquer `tournament_auto_advance.sql`).

- [ ] **Step 4 : relancer le test**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node test-soiree-gestes.mjs`
Expected: 6 cas en ✔.

- [ ] **Step 5 : vérifier qu'on n'a rien cassé ailleurs**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && FIX=1 node recette.mjs`
Expected: 9/9 vert (la recette du correctif de score ne doit pas bouger).

- [ ] **Step 6 : commit** (à proposer au user)

```bash
git commit --allow-empty -m "feat(tournois): le binome declare son abandon, l organisateur debloque un terrain muet"
```

---

## Tâche 3 : la soirée s'ouvre et se ferme toute seule (serveur)

**Files:**
- Create: `supabase/migrations/tournament_soiree_ouverture_cloture.sql`
- Create (hors dépôt): `pagmatch-db-tests/test-soiree-cloture.mjs`

**Interfaces:**
- Consumes: `tournament_start` (`tournaments_rpcs.sql` 2824-2940), `fn_tournament_try_advance` (`tournament_auto_advance.sql` 347-376), `fn_tournament_generate_round`, `tournament_close`.
- Produces: `tournament_start` tire la rotation 1 dans la même transaction et rend en plus `{round:1, matches:int}` ; `fn_tournament_try_advance` clôture le tournoi quand la dernière rotation est complète.

- [ ] **Step 1 : écrire le test qui échoue**

`pagmatch-db-tests/test-soiree-cloture.mjs` — attention : `monterUneSoiree` tire la rotation 1 explicitement ; ici on monte la soirée SANS ce dernier geste (`monterUneSoiree(admin, rpc, { tirerTour1: false })`).

```js
  const s = await monterUneSoiree(admin, rpc, { tirerTour1: false });
  const t = await s.etat();
  const r1 = await s.matchs(1);
  verifie('le lancement tire la rotation 1', t.current_round === 1 && r1.length === 4,
    JSON.stringify({ t, matchs: r1.length }));

  // Une soirée entière, une saisie par terrain : la rotation suivante part
  // toute seule (auto_advance), et la dernière doit CLOTURER sans personne.
  for (let round = 1; round <= 6; round++) {
    const ms = await s.matchs(round);
    if (ms.length === 0) { verifie(`la rotation ${round} existe`, false, 'aucun match'); break; }
    for (const m of ms) if (m.team_b) await s.saisit(m, 'a', 6, 3);
  }
  const fin = await s.etat();
  verifie('la soirée se clôture toute seule', fin.status === 'TERMINE', JSON.stringify(fin));
  const res = (await admin.query(
    'select count(*)::int n from public.tournament_results where tournament_id=$1', [s.tid])).rows[0];
  verifie('le classement est figé', res.n === 16, JSON.stringify(res));
  const v = await s.rpcOrga(`select public.tournament_validate($1)`);
  verifie('la validation reste un geste de l\'organisateur', v?.ok === true, JSON.stringify(v));
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node test-soiree-cloture.mjs`
Expected: FAIL — « le lancement tire la rotation 1 » (`current_round` vaut 0) et « la soirée se clôture toute seule » (statut `EN_COURS`).

- [ ] **Step 3 : écrire la migration par EXTRACTION**

Créer `supabase/migrations/tournament_soiree_ouverture_cloture.sql`, deux corps extraits puis patchés.

**Patch 1 — `tournament_start`** (extrait de `tournaments_rpcs.sql` 2824-2940) : juste avant le `RETURN jsonb_build_object('ok', true, 'teams', v_teams, ...)` final, insérer

```sql
  -- LA ROTATION 1 PART AVEC LE LANCEMENT (2026-09-24). Elle se tirait par un
  -- second bouton : entre les deux, le tournoi etait « EN_COURS » sans aucun
  -- match, et seize personnes attendaient devant des terrains vides. Le moteur
  -- refuse deja tout ce qu'il faut (pas assez d'equipes, tour deja tire) ; son
  -- refus n'annule pas le lancement, il est seulement rapporte.
  v_round := public.fn_tournament_generate_round(p_tournament, false);
```

et ajouter `v_round jsonb;` au bloc `DECLARE`, puis inclure `'round', v_round` dans l'objet rendu.

**Patch 2 — `fn_tournament_try_advance`** (extrait de `tournament_auto_advance.sql` 347-376) : remplacer

```sql
  IF NOT FOUND
     OR v_t.status <> 'EN_COURS'
     OR v_t.current_round < 1
     OR v_t.current_round >= v_t.round_count THEN
    RETURN jsonb_build_object('ok', false);
  END IF;
```

par

```sql
  IF NOT FOUND OR v_t.status <> 'EN_COURS' OR v_t.current_round < 1 THEN
    RETURN jsonb_build_object('ok', false);
  END IF;

  -- LA DERNIERE ROTATION NE MENE PLUS A UN BOUTON (2026-09-24). Quand elle est
  -- complete, il n'y a plus rien a calculer : la cloture FIGE le classement,
  -- elle ne le decide pas. La validation, elle, reste un geste d'organisateur
  -- -- c'est elle qui credite les points, et elle merite un dernier regard.
  -- `tournament_close` porte ses propres controles (`no_complete_round`) : son
  -- refus est ignore ici, comme celui du moteur.
  IF v_t.current_round >= v_t.round_count THEN
    RETURN public.tournament_close(p_tournament);
  END IF;
```

⚠️ `tournament_close` vérifie `created_by = current_player_id()` : appelée depuis la saisie d'un JOUEUR, elle refuserait `not_the_organizer`. Extraire aussi `tournament_close` (`tournaments_rpcs.sql` 4831-5050) et remplacer son garde d'organisateur par une variante qui l'accepte quand l'appelant est un participant du tournoi :

```sql
  -- Appelee soit par l'organisateur (bouton), soit par le serveur a la fin de
  -- la derniere rotation, dans la transaction du dernier score -- donc au nom
  -- d'un JOUEUR. Le geste reste reserve a ces deux-la.
  IF v_t.created_by <> v_me
     AND NOT EXISTS (SELECT 1 FROM public.tournament_participants tp
                      WHERE tp.tournament_id = p_tournament AND tp.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_the_organizer');
  END IF;
```

- [ ] **Step 4 : relancer le test**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node test-soiree-cloture.mjs`
Expected: 4 cas en ✔.

- [ ] **Step 5 : non-régression**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && FIX=1 AUTO=1 node recette.mjs`
Expected: 9/9 vert.

- [ ] **Step 6 : commit** (à proposer au user)

```bash
git commit --allow-empty -m "feat(tournois): la soiree s ouvre et se ferme sans bouton"
```

---

## Tâche 4 : les notifications de la soirée (serveur)

**Files:**
- Create: `supabase/migrations/tournament_soiree_notifs.sql`
- Create (hors dépôt): `pagmatch-db-tests/test-soiree-notifs.mjs`

**Interfaces:**
- Consumes: `net.http_post`, `vault.decrypted_secrets`, `tournament_matches`, `tournament_teams`, `tournament_results`, `pg_cron`.
- Produces: colonne `tournament_matches.silent_notified_at timestamptz` ; déclencheurs `trg_tournament_round_notify` (rotation tirée), `trg_tournament_forfeit_notify` (abandon), `trg_tournament_validated_notify` (classement validé) ; fonction `public.send_tournament_silent_courts() → int` planifiée à la minute.

- [ ] **Step 1 : écrire le test qui échoue**

Le banc ne fait pas de réseau : `net.http_post` du fixture est remplacé, pour ce test, par une version qui **journalise** dans une table. Ajouter au début du test :

```js
  await admin.query(`
    create table if not exists public.pushs_envoyes (
      id bigserial primary key, body jsonb, at timestamptz default now());
    create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}')
    returns bigint language plpgsql as $$
    begin insert into public.pushs_envoyes(body) values (body); return 1::bigint; end $$;`);
  await admin.query(`insert into vault.decrypted_secrets values ('service_role_key','test')`);
```

puis :

```js
  const pushs = async (type) => (await admin.query(
    `select body from public.pushs_envoyes where body->'data'->>'type' = $1 order by id`, [type])).rows;

  const s = await monterUneSoiree(admin, rpc);   // le tirage du tour 1 notifie
  const rot = await pushs('tournament');
  verifie('chaque joueur est averti de son terrain à la rotation 1',
    rot.filter(p => (p.body.data?.kind ?? '') === 'round').length === 1 &&
    rot.find(p => p.body.data?.kind === 'round').body.playerIds.length === 16,
    JSON.stringify(rot.map(p => p.body.title)));

  // Terrain muet : le chrono a démarré, la durée est dépassée, aucun score.
  const m = (await s.matchs(1))[0];
  await rpc(s.joueurDe(m.team_a).user_id, `select public.tournament_start_match($1)`, [m.id]);
  await admin.query(
    `update public.tournament_matches set started_at = now() - interval '40 minutes' where id=$1`, [m.id]);
  const n1 = (await admin.query('select public.send_tournament_silent_courts() n')).rows[0].n;
  verifie('l\'organisateur est alerté du terrain muet', n1 === 1, `n=${n1}`);

  const n2 = (await admin.query('select public.send_tournament_silent_courts() n')).rows[0].n;
  verifie('l\'alerte ne se répète pas la minute suivante', n2 === 0, `n=${n2}`);

  // Un terrain qui a un score ne déclenche rien.
  const m2 = (await s.matchs(1))[1];
  await admin.query(
    `update public.tournament_matches set started_at = now() - interval '40 minutes' where id=$1`, [m2.id]);
  await s.saisit(m2, 'a', 6, 3);
  const n3 = (await admin.query('select public.send_tournament_silent_courts() n')).rows[0].n;
  verifie('un terrain qui a rendu son score n\'alerte personne', n3 === 0, `n=${n3}`);

  await rpc(s.joueurDe(m.team_a).user_id, `select public.tournament_forfeit($1,$2)`, [s.tid, m.team_a]);
  verifie('l\'abandon est signalé au partenaire et aux adversaires',
    (await pushs('tournament')).some(p => p.body.data?.kind === 'forfeit'), '');
```

- [ ] **Step 2 : lancer le test pour le voir échouer**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node test-soiree-notifs.mjs`
Expected: FAIL — `send_tournament_silent_courts` n'existe pas, et aucun push `round`.

- [ ] **Step 3 : écrire la migration**

Créer `supabase/migrations/tournament_soiree_notifs.sql` :

```sql
BEGIN;

ALTER TABLE public.tournament_matches
  ADD COLUMN IF NOT EXISTS silent_notified_at timestamptz;

-- ----------------------------------------------------------------------------
-- 1) « ROTATION N -- TERRAIN X » : un declencheur AU NIVEAU DE L'INSTRUCTION.
--
-- Le moteur insere les matchs d'une rotation en UNE instruction. Un declencheur
-- par ligne enverrait quatre notifications a quatre moments, et obligerait a
-- patcher `fn_tournament_generate_round` -- un corps qu'on ne veut pas toucher
-- de plus. La table de transition donne la rotation entiere d'un coup.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_round_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key text;
  v_tid uuid;
  v_round int;
  v_nom text;
  r record;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_key IS NULL THEN RETURN NULL; END IF;
    SELECT n.tournament_id, n.round_no INTO v_tid, v_round FROM nouveaux n LIMIT 1;
    SELECT name INTO v_nom FROM public.tournaments WHERE id = v_tid;

    FOR r IN
      SELECT n.court_no,
             n.team_b IS NULL AS repos,
             nullif(concat_ws(' & ', b1.name, b2.name), '') AS adversaires_b,
             nullif(concat_ws(' & ', a1.name, a2.name), '') AS adversaires_a,
             ta.player1_id AS a1, ta.player2_id AS a2,
             tb.player1_id AS b1, tb.player2_id AS b2
        FROM nouveaux n
        JOIN public.tournament_teams ta ON ta.id = n.team_a
        LEFT JOIN public.tournament_teams tb ON tb.id = n.team_b
        LEFT JOIN public.players a1 ON a1.id = ta.player1_id
        LEFT JOIN public.players a2 ON a2.id = ta.player2_id
        LEFT JOIN public.players b1 ON b1.id = tb.player1_id
        LEFT JOIN public.players b2 ON b2.id = tb.player2_id
    LOOP
      IF r.repos THEN
        PERFORM net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
          body := jsonb_build_object(
            'playerIds', to_jsonb(ARRAY[r.a1, r.a2]),
            'title', 'Rotation ' || v_round,
            'body',  'Tu es au repos cette rotation.',
            'data',  jsonb_build_object('type','tournament','kind','round',
                                        'tournamentId', v_tid, 'round', v_round)));
      ELSE
        PERFORM net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
          body := jsonb_build_object(
            'playerIds', to_jsonb(ARRAY[r.a1, r.a2]),
            'title', 'Rotation ' || v_round || ' — Terrain ' || r.court_no,
            'body',  'Contre ' || coalesce(r.adversaires_b, 'tes adversaires') || '.',
            'data',  jsonb_build_object('type','tournament','kind','round',
                                        'tournamentId', v_tid, 'round', v_round)));
        PERFORM net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
          body := jsonb_build_object(
            'playerIds', to_jsonb(ARRAY[r.b1, r.b2]),
            'title', 'Rotation ' || v_round || ' — Terrain ' || r.court_no,
            'body',  'Contre ' || coalesce(r.adversaires_a, 'tes adversaires') || '.',
            'data',  jsonb_build_object('type','tournament','kind','round',
                                        'tournamentId', v_tid, 'round', v_round)));
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;   -- une notification ratee n'annule jamais une rotation
  END;
  RETURN NULL;
END; $$;

REVOKE ALL ON FUNCTION public.fn_tournament_round_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tournament_round_notify ON public.tournament_matches;
CREATE TRIGGER trg_tournament_round_notify
  AFTER INSERT ON public.tournament_matches
  REFERENCING NEW TABLE AS nouveaux
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.fn_tournament_round_notify();

-- ----------------------------------------------------------------------------
-- 2) LE TERRAIN MUET -- a l'organisateur, UNE SEULE FOIS.
--
-- `silent_notified_at` n'est pas un confort : sans lui, le travail planifie
-- renvoie la meme alerte CHAQUE MINUTE jusqu'a la fin de la soiree.
-- Cinq minutes apres la fin theorique : la premiere sonnerie a deja sonne sur
-- les quatre telephones, la seconde aussi. Si rien n'est venu, c'est que
-- personne ne viendra.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_tournament_silent_courts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key text;
  n int := 0;
  r record;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_key IS NULL THEN RETURN 0; END IF;

  FOR r IN
    SELECT m.id, m.court_no, t.id AS tid, t.name, t.created_by
      FROM public.tournament_matches m
      JOIN public.tournaments t ON t.id = m.tournament_id
     WHERE t.status            = 'EN_COURS'
       AND m.round_no          = t.current_round
       AND m.team_b           IS NOT NULL
       AND m.games_a          IS NULL
       AND m.started_at       IS NOT NULL
       AND m.silent_notified_at IS NULL
       AND m.started_at + (t.round_minutes || ' minutes')::interval
                        + interval '5 minutes' < now()
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body := jsonb_build_object(
        'playerIds', to_jsonb(ARRAY[r.created_by]),
        'title', 'Terrain ' || r.court_no || ' sans score',
        'body',  'Le terrain ' || r.court_no || ' n''a pas rendu son score. La rotation attend.',
        'data',  jsonb_build_object('type','tournament','kind','silent',
                                    'tournamentId', r.tid)));
    UPDATE public.tournament_matches SET silent_notified_at = now() WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.send_tournament_silent_courts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_tournament_silent_courts() TO service_role;

SELECT cron.unschedule('send-tournament-silent-courts')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-tournament-silent-courts');
SELECT cron.schedule('send-tournament-silent-courts', '* * * * *',
                     $$ SELECT public.send_tournament_silent_courts(); $$);

-- ----------------------------------------------------------------------------
-- 3) L'ABANDON -- au partenaire et aux adversaires du moment.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_forfeit_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key text;
  v_dest uuid[];
  v_nom  text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;
    SELECT name INTO v_nom FROM public.tournaments WHERE id = NEW.tournament_id;

    SELECT ARRAY(
      SELECT unnest(ARRAY[NEW.player1_id, NEW.player2_id])
      UNION
      SELECT unnest(ARRAY[tt.player1_id, tt.player2_id])
        FROM public.tournament_matches m
        JOIN public.tournaments t ON t.id = m.tournament_id
        JOIN public.tournament_teams tt
          ON tt.id = CASE WHEN m.team_a = NEW.id THEN m.team_b ELSE m.team_a END
       WHERE m.tournament_id = NEW.tournament_id
         AND m.round_no      = t.current_round
         AND NEW.id IN (m.team_a, m.team_b)
    ) INTO v_dest;

    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body := jsonb_build_object(
        'playerIds', to_jsonb(v_dest),
        'title', 'Abandon',
        'body',  'Un binome a quitte ' || coalesce(v_nom, 'le tournoi') || '.',
        'data',  jsonb_build_object('type','tournament','kind','forfeit',
                                    'tournamentId', NEW.tournament_id)));
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.fn_tournament_forfeit_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tournament_forfeit_notify ON public.tournament_teams;
CREATE TRIGGER trg_tournament_forfeit_notify
  AFTER UPDATE ON public.tournament_teams
  FOR EACH ROW
  WHEN (OLD.withdrawn = false AND NEW.withdrawn = true)
  EXECUTE FUNCTION public.fn_tournament_forfeit_notify();

-- ----------------------------------------------------------------------------
-- 4) LE CLASSEMENT VALIDE -- son rang et ses points, a chacun.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_tournament_validated_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key text;
  r record;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;
    FOR r IN SELECT player_id, final_rank, points
               FROM public.tournament_results WHERE tournament_id = NEW.id
    LOOP
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
        body := jsonb_build_object(
          'playerIds', to_jsonb(ARRAY[r.player_id]),
          'title', 'Classement valide',
          'body',  'Tu finis ' || r.final_rank || 'e — ' || r.points || ' points.',
          'data',  jsonb_build_object('type','tournament','kind','validated',
                                      'tournamentId', NEW.id)));
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.fn_tournament_validated_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tournament_validated_notify ON public.tournaments;
CREATE TRIGGER trg_tournament_validated_notify
  AFTER UPDATE ON public.tournaments
  FOR EACH ROW
  WHEN (OLD.status <> 'CLASSEMENT_VALIDE' AND NEW.status = 'CLASSEMENT_VALIDE')
  EXECUTE FUNCTION public.fn_tournament_validated_notify();

COMMIT;

NOTIFY pgrst, 'reload schema';
```

Les colonnes lues par le quatrième déclencheur sont bien celles de la table : `tournament_results(tournament_id, team_id, player_id, final_rank, played, wins, games_won, games_lost, points)` — vérifié dans `tournaments.sql`, une ligne PAR JOUEUR (clé primaire `(tournament_id, player_id)`), donc une notification par joueur sans jointure supplémentaire.

- [ ] **Step 4 : relancer le test**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node test-soiree-notifs.mjs`
Expected: 5 cas en ✔.

- [ ] **Step 5 : commit** (à proposer au user)

```bash
git commit --allow-empty -m "feat(tournois): les notifications de la soiree"
```

---

## Tâche 5 : le temps restant et les états de terrain (app, calcul pur)

**Files:**
- Modify: `lib/tournaments.ts` (type `TournamentMatch`, `TOURNAMENT_MATCH_COLS`, deux wrappers)
- Modify: `lib/tournamentEvening.ts` (états, `courtState`, `secondsLeft`)
- Test: `lib/__tests__/tournamentEvening.test.ts` (existant, étendu)

**Interfaces:**
- Consumes: `tournament_start_match`, `tournament_reset_match_start` (Tâche 1).
- Produces:
  - `TournamentMatch.started_at: string | null`
  - `startCourtMatch(matchId: string): Promise<TournamentResult>`
  - `resetCourtStart(matchId: string): Promise<TournamentResult>`
  - `type CourtState = 'a_demarrer' | 'en_cours' | 'temps_ecoule' | 'provisoire' | 'litige' | 'acquis' | 'forfait' | 'exempt'`
  - `secondsLeft(startedAt: string | null, roundMinutes: number, now: number): number | null`
  - `CourtView.secondsLeft: number | null`

- [ ] **Step 1 : écrire les tests qui échouent**

Ajouter à `lib/__tests__/tournamentEvening.test.ts` :

```ts
describe('le chrono d un terrain', () => {
  const DEBUT = '2026-09-24T20:00:00.000Z';
  const t = (iso: string) => new Date(iso).getTime();

  it('rend le temps restant en secondes', () => {
    expect(secondsLeft(DEBUT, 15, t('2026-09-24T20:05:00.000Z'))).toBe(600);
  });

  it('rend un nombre negatif quand le temps est depasse', () => {
    expect(secondsLeft(DEBUT, 15, t('2026-09-24T20:17:00.000Z'))).toBe(-120);
  });

  it('rend null tant que le terrain n a pas demarre', () => {
    expect(secondsLeft(null, 15, t(DEBUT))).toBeNull();
  });

  it('dit « a demarrer » tant que personne n a lance le chrono', () => {
    const c = eveningCourts([M({ started_at: null })], EQUIPES, [], 'mina', 2, 15, t(DEBUT));
    expect(c[0].state).toBe('a_demarrer');
  });

  it('dit « en cours » pendant les quinze minutes', () => {
    const c = eveningCourts([M({ started_at: DEBUT })], EQUIPES, [], 'mina', 2, 15,
      t('2026-09-24T20:05:00.000Z'));
    expect(c[0].state).toBe('en_cours');
  });

  it('dit « temps ecoule » apres la fin, tant qu aucun score n est saisi', () => {
    const c = eveningCourts([M({ started_at: DEBUT })], EQUIPES, [], 'mina', 2, 15,
      t('2026-09-24T20:16:00.000Z'));
    expect(c[0].state).toBe('temps_ecoule');
  });

  it('un score saisi l emporte sur le chrono', () => {
    const c = eveningCourts([M({ started_at: DEBUT, games_a: 6, games_b: 3 })], EQUIPES,
      [E('m1', 'mina', 6, 3)], 'mina', 2, 15, t('2026-09-24T20:05:00.000Z'));
    expect(c[0].state).toBe('provisoire');
  });

  it('les trois etats sans score bloquent la rotation suivante', () => {
    expect(blocks('a_demarrer')).toBe(true);
    expect(blocks('en_cours')).toBe(true);
    expect(blocks('temps_ecoule')).toBe(true);
    expect(blocks('provisoire')).toBe(false);
  });
});
```

- [ ] **Step 2 : lancer pour voir échouer**

Run: `npx vitest run lib/__tests__/tournamentEvening.test.ts`
Expected: FAIL — `secondsLeft is not a function`, et `eveningCourts` ignore ses deux nouveaux paramètres.

- [ ] **Step 3 : implémenter**

Dans `lib/tournaments.ts` : ajouter `started_at: string | null;` à `TournamentMatch`, ajouter `started_at` à `TOURNAMENT_MATCH_COLS`, et les deux wrappers, à côté des autres :

```ts
/** « On commence » — le chrono de CE terrain part. N'importe lequel des quatre
 *  joueurs, et deux appuis simultanés rendent la même heure (`already:true`),
 *  jamais un refus : c'est le cas normal, pas une erreur. */
export function startCourtMatch(matchId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_start_match', { p_match: matchId });
}

/** Quelqu'un a appuyé trop tôt. Refusé dès qu'un score existe. */
export function resetCourtStart(matchId: string): Promise<TournamentResult> {
  return callTournamentRpc('tournament_reset_match_start', { p_match: matchId });
}
```

Dans `lib/tournamentEvening.ts` : remplacer l'état `'vide'` par les trois nouveaux dans `CourtState`, ajouter

```ts
/** Le temps restant sur un terrain, en secondes — négatif une fois dépassé.
 *  `null` tant que personne n'a lancé le chrono. Dérivé de l'heure SERVEUR :
 *  aucun compteur local, donc aucune dérive entre les quatre téléphones. */
export function secondsLeft(
  startedAt: string | null, roundMinutes: number, now: number,
): number | null {
  if (!startedAt) return null;
  const fin = new Date(startedAt).getTime() + roundMinutes * 60_000;
  return Math.round((fin - now) / 1000);
}
```

`blocks` devient `state === 'a_demarrer' || state === 'en_cours' || state === 'temps_ecoule' || state === 'litige'`, `courtState` prend `started_at`, `roundMinutes` et `now` et rend, quand `matchLiveStatus` dit `awaiting` et qu'aucun score n'est écrit : `a_demarrer` si pas de départ, `en_cours` si le temps restant est positif, `temps_ecoule` sinon. `eveningCourts` gagne les paramètres `roundMinutes: number` et `now: number` et pose `secondsLeft` sur chaque `CourtView`. `courtsDone` compte inchangé (il s'appuie sur `blocks`). `blockingLabel` : « pas encore commencé », « en cours », « temps écoulé — score attendu » remplacent la phrase unique « pas de score rentré », avec la même construction de liste.

- [ ] **Step 4 : relancer**

Run: `npx vitest run lib && npx tsc --noEmit`
Expected: tous les tests passent (les appelants de `eveningCourts` compilent — l'écran est mis à jour en Tâche 7 ; si `tsc` se plaint ici, corriger l'appel de l'écran avec les deux nouveaux arguments dès maintenant).

- [ ] **Step 5 : commit** (à proposer au user)

```bash
git add lib/tournaments.ts lib/tournamentEvening.ts lib/__tests__/tournamentEvening.test.ts
git commit -m "feat(tournois): temps restant et etats de terrain"
```

---

## Tâche 6 : les sonneries locales (app)

**Files:**
- Create: `lib/courtAlarm.ts`
- Test: `lib/__tests__/courtAlarm.test.ts`

**Interfaces:**
- Consumes: `secondsLeft` (Tâche 5).
- Produces:
  - `interface AlarmPort { schedule(o: {title: string; body: string; seconds: number}): Promise<string>; cancel(id: string): Promise<void>; }`
  - `syncCourtAlarms(etat: {matchId: string | null; courtNo: number; secondsLeft: number | null; hasScore: boolean}, port: AlarmPort, memoire: Map<string, string[]>): Promise<void>`

- [ ] **Step 1 : écrire les tests qui échouent**

`lib/__tests__/courtAlarm.test.ts` :

```ts
import { describe, it, expect, vi } from 'vitest';
import { syncCourtAlarms, type AlarmPort } from '../courtAlarm';

const faussePorte = () => {
  const programmees: { seconds: number; title: string; id: string }[] = [];
  const annulees: string[] = [];
  let n = 0;
  const port: AlarmPort = {
    schedule: async (o) => { const id = `n${++n}`; programmees.push({ ...o, id }); return id; },
    cancel: async (id) => { annulees.push(id); },
  };
  return { port, programmees, annulees };
};

describe('les sonneries d un terrain', () => {
  it('programme la fin et la relance quand le chrono part', async () => {
    const { port, programmees } = faussePorte();
    await syncCourtAlarms({ matchId: 'm1', courtNo: 3, secondsLeft: 900, hasScore: false }, port, new Map());
    expect(programmees.map(p => p.seconds)).toEqual([900, 1080]);
  });

  it('ne reprogramme rien si les sonneries du match sont deja posees', async () => {
    const { port, programmees } = faussePorte();
    const memoire = new Map([['m1', ['deja1', 'deja2']]]);
    await syncCourtAlarms({ matchId: 'm1', courtNo: 3, secondsLeft: 600, hasScore: false }, port, memoire);
    expect(programmees).toEqual([]);
  });

  it('annule tout des qu un score est saisi', async () => {
    const { port, annulees } = faussePorte();
    const memoire = new Map([['m1', ['a', 'b']]]);
    await syncCourtAlarms({ matchId: 'm1', courtNo: 3, secondsLeft: 300, hasScore: true }, port, memoire);
    expect(annulees).toEqual(['a', 'b']);
    expect(memoire.has('m1')).toBe(false);
  });

  it('annule les sonneries de la rotation precedente quand on change de terrain', async () => {
    const { port, annulees } = faussePorte();
    const memoire = new Map([['ancien', ['x']]]);
    await syncCourtAlarms({ matchId: 'm2', courtNo: 1, secondsLeft: 900, hasScore: false }, port, memoire);
    expect(annulees).toEqual(['x']);
    expect(memoire.has('m2')).toBe(true);
  });

  it('ne programme rien pour un temps deja depasse', async () => {
    const { port, programmees } = faussePorte();
    await syncCourtAlarms({ matchId: 'm1', courtNo: 2, secondsLeft: -30, hasScore: false }, port, new Map());
    expect(programmees.map(p => p.seconds)).toEqual([150]);
  });

  it('ne fait rien, et ne leve pas, quand la porte refuse (notifications coupees)', async () => {
    const port: AlarmPort = {
      schedule: async () => { throw new Error('permission refusée'); },
      cancel: async () => { throw new Error('permission refusée'); },
    };
    const memoire = new Map<string, string[]>();
    await expect(
      syncCourtAlarms({ matchId: 'm1', courtNo: 2, secondsLeft: 900, hasScore: false }, port, memoire),
    ).resolves.toBeUndefined();
    expect(memoire.size).toBe(0);
  });

  it('ne programme rien quand je ne joue pas cette rotation', async () => {
    const { port, programmees } = faussePorte();
    await syncCourtAlarms({ matchId: null, courtNo: 0, secondsLeft: null, hasScore: false }, port, new Map());
    expect(programmees).toEqual([]);
  });
});
```

- [ ] **Step 2 : lancer pour voir échouer**

Run: `npx vitest run lib/__tests__/courtAlarm.test.ts`
Expected: FAIL — `Cannot find module '../courtAlarm'`.

- [ ] **Step 3 : implémenter `lib/courtAlarm.ts`**

```ts
// lib/courtAlarm.ts — les deux sonneries d'un terrain, sur CE téléphone.
//
// POURQUOI SUR LE TÉLÉPHONE. Une notification programmée localement tombe à la
// seconde près et part même si le réseau du club est mauvais à cet instant. Le
// serveur, lui, ne s'occupe que de ce qui concerne les AUTRES (la rotation, le
// terrain muet) : quatre cents notifications par soirée pour un compte à
// rebours que chaque appareil sait tenir seul, c'est du bruit et de la latence.
//
// LA RÈGLE QUI COMPTE : une sonnerie qui ne s'annule pas est PIRE que pas de
// sonnerie — elle sonne pendant la rotation suivante, au milieu d'un point.
// D'où `hasScore` : dès qu'un score est saisi, tout est annulé.
//
// Rien d'Expo ici : la porte (`AlarmPort`) est injectée, donc ce module se
// teste sans appareil et sans permission système.

/** Ce que ce module demande au système, et rien de plus. */
export interface AlarmPort {
  schedule(o: { title: string; body: string; seconds: number }): Promise<string>;
  cancel(id: string): Promise<void>;
}

/** Minutes entre la fin du temps et la relance (spec §5). */
const RELANCE_MIN = 3;

/**
 * Met les sonneries de CE téléphone d'accord avec l'état du terrain.
 *
 * `memoire` associe un match aux identifiants de ses notifications posées.
 * Elle vit au-dessus (un `useRef` dans l'écran) : ce module ne garde aucun
 * état global, donc deux comptes sur un même appareil ne se marchent pas
 * dessus.
 */
export async function syncCourtAlarms(
  etat: { matchId: string | null; courtNo: number; secondsLeft: number | null; hasScore: boolean },
  port: AlarmPort,
  memoire: Map<string, string[]>,
): Promise<void> {
  // 1. Tout ce qui ne concerne plus le terrain courant s'annule — rotation
  //    passée, match rouvert, abandon.
  for (const [id, notifs] of [...memoire.entries()]) {
    const obsolete = id !== etat.matchId || etat.hasScore || etat.secondsLeft === null;
    if (!obsolete) continue;
    memoire.delete(id);
    for (const n of notifs) {
      try { await port.cancel(n); } catch { /* notifications coupées : rien à annuler */ }
    }
  }

  // 2. Rien à poser si je ne joue pas, si le score est déjà là, ou si les
  //    sonneries de ce match sont déjà posées (app rouverte : on ne double pas).
  if (!etat.matchId || etat.hasScore || etat.secondsLeft === null) return;
  if (memoire.has(etat.matchId)) return;

  const fin = Math.max(0, etat.secondsLeft);
  const relance = Math.max(0, etat.secondsLeft + RELANCE_MIN * 60);
  const poses: string[] = [];
  try {
    if (etat.secondsLeft > 0) {
      poses.push(await port.schedule({
        title: `Terrain ${etat.courtNo} — temps écoulé`,
        body: 'Entrez le score, la rotation suivante attend.',
        seconds: fin,
      }));
    }
    if (relance > 0) {
      poses.push(await port.schedule({
        title: `Terrain ${etat.courtNo} — score attendu`,
        body: 'Personne n’a encore rentré le score de votre match.',
        seconds: relance,
      }));
    }
  } catch {
    // Notifications refusées : le compte à rebours reste à l'écran, et rien
    // n'est bloqué. On ne mémorise pas : on retentera à la prochaine rotation.
    return;
  }
  if (poses.length > 0) memoire.set(etat.matchId, poses);
}

/** La porte réelle, branchée sur expo-notifications. Non testée en Vitest :
 *  elle n'a pas de logique, et l'essai qui compte est celui sur appareil. */
export async function expoAlarmPort(): Promise<AlarmPort> {
  const Notifications = await import('expo-notifications');
  return {
    schedule: (o) => Notifications.scheduleNotificationAsync({
      content: { title: o.title, body: o.body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(o.seconds)),
        repeats: false,
      },
    }),
    cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  };
}
```

- [ ] **Step 4 : relancer**

Run: `npx vitest run lib/__tests__/courtAlarm.test.ts && npx tsc --noEmit`
Expected: 7 tests verts, `tsc` code 0.

- [ ] **Step 5 : vérifier l'API Expo avant de croire au code**

Run: `grep -rn "SchedulableTriggerInputTypes\|will throw in runtime" node_modules/expo-notifications/build/Notifications.types.d.ts | head`
Expected: `SchedulableTriggerInputTypes.TIME_INTERVAL` existe dans la version installée. Sinon, corriger la forme du déclencheur — sur SDK 57, certaines API lèvent au lieu d'avertir.

- [ ] **Step 6 : commit** (à proposer au user)

```bash
git add lib/courtAlarm.ts lib/__tests__/courtAlarm.test.ts
git commit -m "feat(tournois): les sonneries de fin de rotation"
```

---

## Tâche 7 : l'écran de soirée et le routage des notifications (app)

**Files:**
- Modify: `app/tournaments/soiree/[id].tsx`
- Modify: `hooks/usePushNotifications.ts:136-166`

**Interfaces:**
- Consumes: `startCourtMatch`, `resetCourtStart`, `forfeitTournamentTeam` (existant), `secondsLeft`, `eveningCourts` (Tâche 5), `syncCourtAlarms`, `expoAlarmPort` (Tâche 6), `roundMinutesOf` (existant dans `lib/tournaments.ts`).
- Produces: rien pour les autres tâches.

- [ ] **Step 1 : brancher le chrono dans l'écran**

Dans `app/tournaments/soiree/[id].tsx` :
- un état `maintenant` rafraîchi chaque seconde par un `setInterval` monté dans un `useEffect` (nettoyé au démontage), utilisé seulement quand un terrain est `en_cours` ;
- `eveningCourts(matches, teams, entries, player.id, t.current_round, roundMinutesOf(t), maintenant)` ;
- dans la carte « TON TERRAIN », sous le numéro :
  - état `a_demarrer` → bouton **« ON COMMENCE »** (`startCourtMatch(matchMien.id)`, puis `load()`), et la phrase « Le chrono part pour {round_minutes} minutes, pour les quatre joueurs. » ;
  - état `en_cours` → le compte à rebours `mm:ss` en grand (police `Fonts.display`), et un lien discret **« Remettre le chrono à zéro »** (`resetCourtStart`) ;
  - état `temps_ecoule` → « TEMPS ÉCOULÉ » et la saisie du score déjà présente, mise en avant ;
- un bouton **« Nous abandonnons »** en pied de carte, avec `Alert.alert` de confirmation qui dit : définitif, l'adversaire gagne le match en cours, la soirée continue sans vous. Appelle `forfeitTournamentTeam(t.id, monEquipeId)`.

- [ ] **Step 2 : brancher les sonneries**

Dans le même écran : un `useRef<Map<string, string[]>>(new Map())` pour la mémoire, une porte obtenue une fois (`useRef<AlarmPort|null>`), et un `useEffect` qui appelle `syncCourtAlarms({ matchId: mien?.matchId ?? null, courtNo: mien?.courtNo ?? 0, secondsLeft: mien?.secondsLeft ?? null, hasScore: mien?.gamesA != null }, port, memoire.current)` à chaque changement de `mien?.matchId`, `mien?.secondsLeft === null` et `mien?.gamesA`. **Ne pas** le déclencher sur chaque tic d'horloge : la mémoire suffit à empêcher les doublons, mais un appel par seconde noierait le journal.

- [ ] **Step 3 : router les notifications de tournoi**

Dans `hooks/usePushNotifications.ts`, ajouter dans le `switch (data.type)` :

```ts
        case 'tournament':
          // Aujourd'hui un push de tournoi n'ouvrait RIEN : on restait où on
          // était, et « tu vas au Terrain 2 » ne menait nulle part.
          if (data.kind === 'round' && data.tournamentId) {
            router.push(`/tournaments/soiree/${data.tournamentId}` as any);
          } else if (data.tournamentId) {
            router.push(`/tournaments/${data.tournamentId}` as any);
          }
          break;
```

- [ ] **Step 4 : vérifier**

Run: `npx vitest run lib && npx tsc --noEmit`
Expected: 1369+ tests verts, `tsc` code 0.

- [ ] **Step 5 : voir l'écran tourner**

Lancer l'app (`npx expo start`), ouvrir une soirée de test, appuyer « On commence », vérifier que le compte à rebours part et que les trois états s'enchaînent. L'essai des sonneries app fermée est la Tâche 9.

- [ ] **Step 6 : commit** (à proposer au user)

```bash
git add app/tournaments/soiree/\[id\].tsx hooks/usePushNotifications.ts
git commit -m "feat(tournois): l ecran de soiree porte le chrono, l abandon et les sonneries"
```

---

## Tâche 8 : l'écran Admin devient un poste de secours (app)

**Files:**
- Modify: `app/(tabs)/admin.tsx` (autour de 3096-3120 et 3470-3490)

**Interfaces:**
- Consumes: `startTournament` (qui tire désormais la rotation 1, Tâche 3), `resolveTournamentDispute`, `forfeitTournamentTeam`, `closeTournament`, `validateTournament`.
- Produces: rien pour les autres tâches.

- [ ] **Step 1 : retirer les boutons de rotation**

Supprimer `handleGenerateRound` et le bouton « Générer la rotation suivante » / « Lancer la rotation de classement » (`admin.tsx:3476-3481`), ainsi que les imports devenus inutiles (`generateTournamentRound`, `generateFinalTournamentRound`, `nextRoundIsFinal` s'il n'est plus lu). **Garder** `nextTournamentAction` s'il sert ailleurs à l'affichage.

- [ ] **Step 2 : le lancement devient un seul geste**

Changer le texte de la confirmation de `handleStart` : « Cela fige les binômes, attribue les terrains **et lance la première rotation**. Le pointage n'est pas exigé : un binôme absent joue quand même. » Le message de succès dit le nombre de matchs tirés (`res.round?.matches`).

- [ ] **Step 3 : afficher ce que l'admin doit débloquer**

En tête de la carte du tournoi en cours, lister les terrains sans score de la rotation courante (données déjà chargées par `load()`), sous la forme « Terrain 3 — Amine & Youssef vs … : pas de score », avec le bouton existant d'arbitrage renommé **« Saisir le score à leur place »** (il fonctionne désormais même sans désaccord, Tâche 2).

- [ ] **Step 4 : vérifier**

Run: `npx tsc --noEmit && npx vitest run lib`
Expected: code 0, tests verts.

- [ ] **Step 5 : commit** (à proposer au user)

```bash
git add app/\(tabs\)/admin.tsx
git commit -m "feat(tournois): l admin ne rythme plus la soiree, il la debloque"
```

---

## Tâche 9 : la recette de bout en bout

**Files:**
- Create (hors dépôt): `pagmatch-db-tests/recette-soiree.mjs`

**Interfaces:**
- Consumes: tout ce qui précède.

- [ ] **Step 1 : écrire la recette**

`pagmatch-db-tests/recette-soiree.mjs` joue une soirée complète avec toutes les migrations du plan et vérifie, dans l'ordre :

1. le lancement tire la rotation 1 et notifie les 16 joueurs ;
2. un joueur démarre son terrain, un second appui rend la même heure ;
3. une seule saisie par terrain suffit, et quand les quatre ont saisi la rotation 2 existe sans qu'aucun organisateur n'intervienne ;
4. un désaccord bloque, et se règle entre joueurs ;
5. un binôme déclare son abandon lui-même, et l'adversaire monte ;
6. un terrain muet déclenche une alerte à l'organisateur, une seule fois ;
7. l'organisateur pose un score sur ce terrain muet et la rotation repart ;
8. après la dernière rotation, le tournoi est `TERMINE` sans geste humain, et `tournament_validate` crédite 16 joueurs.

- [ ] **Step 2 : lancer**

Run: `cd pagmatch-db-tests && rm -rf .pgdata && node recette-soiree.mjs`
Expected: 8 cas en ✔, code de sortie 0.

- [ ] **Step 3 : l'essai qui compte — deux téléphones, app fermée**

Sur un tournoi de test en preview :
1. deux comptes, un terrain, appuyer « On commence » sur l'un ;
2. **fermer l'app** sur les deux ;
3. vérifier que la sonnerie de fin tombe à l'heure sur les deux téléphones, puis la relance trois minutes plus tard ;
4. recommencer en saisissant le score avant la fin : **aucune** des deux sonneries ne doit tomber ;
5. vérifier qu'à la rotation suivante, chacun reçoit « Rotation 2 — Terrain X » et que le tap ouvre le Mode soirée.

Android d'abord (c'est là que les notifications programmées se comportent le plus mal).

- [ ] **Step 4 : consigner**

Noter dans la fiche mémoire du projet ce qui a été vérifié sur appareil et ce qui ne l'a pas été — une sonnerie jamais essayée au poignet ne compte pas comme livrée.
