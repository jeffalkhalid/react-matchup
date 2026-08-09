# Refonte Défi 2v2 — Phase 6 : Cycle de vie (annulation + expiration) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fermer les trous de cycle de vie : permettre au **créateur d'annuler son défi** (draft/open) et **expirer automatiquement les candidatures `pending` orphelines** (défi plus ouvert, ou candidature abandonnée > 48 h) pour éviter les notifications fantômes.

**Architecture:** Une RPC `cancel_defi` (SECURITY DEFINER) passe le défi en `cancelled` et annule ses candidatures `pending`. Une fonction `expire_stale_defi_applications` + cron pg_cron (toutes les 15 min, même pattern que `expire_stale_invitations`) annule les candidatures `pending` dont le défi n'est plus `open` ou créées il y a > 48 h. Côté client, un bouton « Annuler » sur les cartes « Mes défis » du hub appelle `cancelDefi`.

**Tech Stack:** Supabase Postgres (PL/pgSQL, pg_cron), React Native / Expo (TS). Vérif = `npx tsc --noEmit` + (manuel) application SQL.

## Global Constraints

- **Migration** dans `react-matchup/supabase/migrations/`, idempotente (`CREATE OR REPLACE`, bloc `DO` cron gardé par `pg_extension`), appliquée à la main.
- **`cancel_defi`** : autorisé seulement au **créateur**, seulement si `is_challenge` ET `status ∈ {draft, open}` (jamais `confirmed` — un défi confirmé est un vrai match, hors périmètre).
- **Statuts `defi_applications`** : `pending → cancelled` (annulation/expiration). Ne jamais toucher `locked`/`rejected`.
- **`current_player_id()`** (helper SQL existant). **Pattern cron** : copier le bloc `DO $$ … pg_extension 'pg_cron' … cron.schedule(...) $$` de `invite_expiry.sql`.
- **Client** : la carte « Mes défis » (hub) propose « Annuler » seulement pour `draft`/`open` (pas `confirmed`). Confirmation `Alert` avant d'annuler.

---

### Task 1 : SQL — `cancel_defi` + `expire_stale_defi_applications` + cron

**Files:**
- Create: `react-matchup/supabase/migrations/defi_lifecycle.sql`

**Interfaces:**
- Produces: `cancel_defi(p_game_id uuid) RETURNS void` ; `expire_stale_defi_applications() RETURNS void` ; cron `expire-stale-defi-applications` (*/15).

- [ ] **Step 1 : Écrire la migration**

```sql
-- react-matchup/supabase/migrations/defi_lifecycle.sql
-- ============================================================
-- Défi 2v2 — cycle de vie : annulation par le créateur + expiration
-- des candidatures pending orphelines (anti-ghost).
-- Idempotent. Le bloc cron suit le pattern de invite_expiry.sql.
-- ============================================================
BEGIN;

-- ---------- Annulation par le créateur ----------
-- Passe le défi (draft|open) en 'cancelled' et annule ses candidatures pending.
-- Refusé si pas créateur / pas un défi / déjà confirmé.
CREATE OR REPLACE FUNCTION public.cancel_defi(p_game_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := public.current_player_id();
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  UPDATE open_games
    SET status = 'cancelled'
    WHERE id = p_game_id
      AND creator_id = v_me
      AND is_challenge IS TRUE
      AND status IN ('draft', 'open');
  IF NOT FOUND THEN RAISE EXCEPTION 'defi not cancellable'; END IF;

  UPDATE defi_applications
    SET status = 'cancelled', resolved_at = now()
    WHERE game_id = p_game_id AND status = 'pending';
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_defi(uuid) TO authenticated;

-- ---------- Expiration des candidatures pending orphelines ----------
-- Annule une candidature pending si : son défi n'est plus 'open'
-- (annulé/confirmé/fermé) OU elle a été créée il y a plus de 48 h.
CREATE OR REPLACE FUNCTION public.expire_stale_defi_applications()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE defi_applications a
    SET status = 'cancelled', resolved_at = now()
    WHERE a.status = 'pending'
      AND (
        a.created_at < now() - interval '48 hours'
        OR NOT EXISTS (
          SELECT 1 FROM open_games g
          WHERE g.id = a.game_id AND g.status = 'open'
        )
      );
$$;

GRANT EXECUTE ON FUNCTION public.expire_stale_defi_applications() TO service_role;

-- ---------- Planification (pg_cron, toutes les 15 min) ----------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'expire-stale-defi-applications',
      '*/15 * * * *',
      $cron$ SELECT public.expire_stale_defi_applications(); $cron$
    );
  ELSE
    RAISE NOTICE 'pg_cron non activé : active l''extension puis ré-exécute ce bloc DO.';
  END IF;
END $$;

COMMIT;
```

- [ ] **Step 2 : (manuel, différé) appliquer** dans le SQL editor — NON fait par le sous-agent (pas d'outil Supabase). Vérif manuelle :
```sql
SELECT proname FROM pg_proc WHERE proname IN ('cancel_defi','expire_stale_defi_applications'); -- 2 lignes
SELECT jobname FROM cron.job WHERE jobname = 'expire-stale-defi-applications';                 -- 1 ligne (si pg_cron actif)
```

- [ ] **Step 3 : Commit**
```bash
git add -f react-matchup/supabase/migrations/defi_lifecycle.sql
git commit -m "feat(defi): cycle de vie — RPC cancel_defi + expiration des candidatures pending (cron)"
```

---

### Task 2 : Client — annuler un défi depuis « Mes défis »

**Files:**
- Modify: `react-matchup/lib/defis.ts`
- Modify: `react-matchup/app/(tabs)/matchmaking.tsx`

**Interfaces:**
- Consumes: RPC `cancel_defi` (Task 1).
- Produces: `cancelDefi(gameId): Promise<void>` (lib/defis) ; bouton « Annuler » sur `MyDefiCard` (draft/open) appelant un handler `handleCancelDefi`.

- [ ] **Step 1 : `cancelDefi` dans `lib/defis.ts`**

Ajouter à `react-matchup/lib/defis.ts` (à côté de `applyToDefi`/`acceptBinomeInvitation`) :
```ts
export async function cancelDefi(gameId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_defi', { p_game_id: gameId });
  if (error) throw error;
}
```

- [ ] **Step 2 : Handler dans le hub**

Dans `react-matchup/app/(tabs)/matchmaking.tsx`, importer `cancelDefi` depuis `lib/defis`, et ajouter dans `MatchmakingScreen` :
```ts
  const handleCancelDefi = (game: DefiGame) => {
    Alert.alert(
      'Annuler ce défi ?',
      game.status === 'draft'
        ? 'Ton brouillon sera supprimé.'
        : 'Le défi sera retiré et les candidatures en cours annulées.',
      [
        { text: 'Retour', style: 'cancel' },
        {
          text: 'Annuler le défi', style: 'destructive',
          onPress: async () => {
            try {
              await cancelDefi(game.id);
              showToast('Défi annulé.');
              fetchData();
            } catch (e: any) {
              Alert.alert('Erreur', e?.message ?? 'Annulation impossible.');
            }
          },
        },
      ],
    );
  };
```

- [ ] **Step 3 : Bouton « Annuler » sur `MyDefiCard`**

Dans `react-matchup/app/(tabs)/matchmaking.tsx`, ajouter à `MyDefiCard` une prop optionnelle `onCancel?: () => void` et, **seulement si `game.status !== 'confirmed'`**, rendre un petit bouton « Annuler » (style discret : texte `Colors.danger`, fond `Colors.bgCardAlt`, bord léger). Dans la section « Mes défis », passer `onCancel={() => handleCancelDefi(g)}` à chaque `MyDefiCard`.

```tsx
// dans MyDefiCard, après le bloc lieu/date :
{onCancel && game.status !== 'confirmed' && (
  <TouchableOpacity onPress={onCancel}
    style={{ marginTop: 10, alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCardAlt }}>
    <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.danger }}>Annuler le défi</Text>
  </TouchableOpacity>
)}
```

- [ ] **Step 4 : Typecheck + Commit**
```bash
cd react-matchup && npx tsc --noEmit
git add react-matchup/lib/defis.ts react-matchup/app/(tabs)/matchmaking.tsx
git commit -m "feat(defi): annuler un défi depuis « Mes défis » (cancel_defi)"
```

---

## Self-review (Phase 6)

- **Couverture** : annulation créateur (draft/open) via RPC sécurisée (Task 1+2) ✓ ; candidatures pending annulées à l'annulation ✓ ; expiration auto des candidatures orphelines/abandonnées (cron) ✓ ; bouton client réservé à draft/open ✓.
- **Hors périmètre** : notif « défi annulé » aux binômes candidats (push à l'annulation → webhook serveur, futur) ; annulation d'un défi **confirmé** (= flux d'annulation de partie classique, déjà existant ailleurs) ; feature « binômes ouverts aux défis ».
- **Risque** : `cancel_defi` revérifie créateur + statut côté serveur (pas de confiance au client). Le cron exige pg_cron actif (déjà utilisé par `expire_stale_invitations`). `NOT FOUND` après l'UPDATE = garde-fou si on tente d'annuler un défi non éligible.

## Runbook Phase 6

Appliquer `defi_lifecycle.sql` (après les migrations précédentes). pg_cron doit être actif (déjà le cas). Rebuild app.
