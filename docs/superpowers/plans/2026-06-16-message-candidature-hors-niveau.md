# Message de motivation pour candidature hors-niveau — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettre à un candidat hors-niveau de joindre, optionnellement, un petit mot (~140 car.) à sa candidature, affiché aux votants tant que la candidature est `pending`.

**Architecture:** Colonne `application_note` sur `game_participants`, renseignée par `join_game` uniquement quand le statut est `pending`. Le client (lobby) ouvre une feuille de saisie quand le joueur est hors-niveau, filtre la profanité, puis transmet la note au RPC. La carte d'approbation existante (GameDetailsSheet) affiche le mot ; le push « Nouvelle demande » en inclut un aperçu.

**Tech Stack:** Postgres (Supabase RPC plpgsql, tests psql en transaction), React Native / Expo (TypeScript, tsc comme garde-fou), Supabase JS client.

---

## Référence spec

`docs/superpowers/specs/2026-06-16-message-candidature-hors-niveau-design.md`

## File Structure

- **Create** `supabase/migrations/application_note.sql` — migration additive de la colonne.
- **Modify** `supabase/migrations/join_game_rpc.sql` — drop ancienne signature + nouvelle avec `p_note`.
- **Modify** `sql/tests/test_join_game.sql` — ajout des cas note.
- **Modify** `lib/games.ts` — 4e arg `note?` sur `joinGame()`.
- **Create** `components/ApplicationNoteSheet.tsx` — feuille de saisie du mot.
- **Modify** `app/(tabs)/lobby.tsx` — `handleApply` intercepte le hors-niveau, ouvre la feuille, filtre profanité, étend `GAME_SELECT`, push avec aperçu.
- **Modify** `app/(tabs)/GameDetailsSheet.tsx` — bulle du mot sur la carte `pending`.

> ⚠️ Migrations PAG MATCH non timestampées, appliquées **à la main** sur la prod
> (cf. mémoire `project_supabase_staging_env`). Les tâches SQL produisent les
> fichiers ; leur application en base reste une action manuelle de l'utilisateur,
> signalée en fin de plan.

---

## Task 1 : Migration colonne `application_note`

**Files:**
- Create: `react-matchup/supabase/migrations/application_note.sql`

- [ ] **Step 1 : Écrire la migration**

```sql
-- Mot de motivation optionnel joint à une candidature hors-niveau (pending).
-- Additive, nullable, réversible. Renseignée par join_game UNIQUEMENT quand le
-- statut attribué est 'pending' ; NULL partout ailleurs.
ALTER TABLE game_participants
  ADD COLUMN IF NOT EXISTS application_note text;
```

- [ ] **Step 2 : Commit**

```bash
git add react-matchup/supabase/migrations/application_note.sql
git commit -m "feat(db): add game_participants.application_note column"
```

---

## Task 2 : RPC `join_game` avec `p_note`

**Files:**
- Modify: `react-matchup/supabase/migrations/join_game_rpc.sql`

- [ ] **Step 1 : Écrire le test SQL d'abord (cas note)**

Dans `react-matchup/sql/tests/test_join_game.sql`, **avant** la ligne finale
`DO $$ BEGIN RAISE NOTICE 'test_join_game: OK'; END $$;` (ligne 88), insérer :

```sql
-- CAS 5 — UNFIT + note → 'pending' et application_note stockée (tronquée 140).
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000f034','00000000-0000-0000-0000-0000000000c4',
          now() + interval '20 days','open',2,'A_GAU', 1200, 1800,'TEST');
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b4"}';
DO $$
DECLARE st text; note text;
BEGIN
  SELECT public.join_game('00000000-0000-0000-0000-00000000f034', 'B_GAU', false,
    repeat('x', 200)) INTO st;
  IF st <> 'pending' THEN RAISE EXCEPTION 'cas5 attendu pending, obtenu %', st; END IF;
  SELECT application_note INTO note FROM game_participants
    WHERE game_id='00000000-0000-0000-0000-00000000f034' AND player_id='00000000-0000-0000-0000-0000000000b4';
  IF length(note) <> 140 THEN RAISE EXCEPTION 'cas5 note devait être tronquée à 140, obtenu %', length(note); END IF;
END $$;

-- CAS 6 — FIT + note fournie → 'accepted' et application_note NULL (CASE neutralise).
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000f035','00000000-0000-0000-0000-0000000000c4',
          now() + interval '30 days','open',2,'A_GAU', 1200, 1800,'TEST');
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000a4"}';
DO $$
DECLARE st text; note text;
BEGIN
  SELECT public.join_game('00000000-0000-0000-0000-00000000f035', 'B_GAU', false,
    'je joue souvent à ce niveau') INTO st;
  IF st <> 'accepted' THEN RAISE EXCEPTION 'cas6 attendu accepted, obtenu %', st; END IF;
  SELECT application_note INTO note FROM game_participants
    WHERE game_id='00000000-0000-0000-0000-00000000f035' AND player_id='00000000-0000-0000-0000-0000000000a4';
  IF note IS NOT NULL THEN RAISE EXCEPTION 'cas6 note devait être NULL pour un fit, obtenu %', note; END IF;
END $$;

-- CAS 7 — UNFIT + note vide/espaces → 'pending' et application_note NULL (nullif/trim).
INSERT INTO open_games (id, creator_id, match_date, status, spots_available, creator_side, min_elo, max_elo, location)
  VALUES ('00000000-0000-0000-0000-00000000f036','00000000-0000-0000-0000-0000000000c4',
          now() + interval '40 days','open',2,'A_GAU', 1200, 1800,'TEST');
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b4"}';
DO $$
DECLARE st text; note text;
BEGIN
  SELECT public.join_game('00000000-0000-0000-0000-00000000f036', 'B_GAU', false, '   ') INTO st;
  IF st <> 'pending' THEN RAISE EXCEPTION 'cas7 attendu pending, obtenu %', st; END IF;
  SELECT application_note INTO note FROM game_participants
    WHERE game_id='00000000-0000-0000-0000-00000000f036' AND player_id='00000000-0000-0000-0000-0000000000b4';
  IF note IS NOT NULL THEN RAISE EXCEPTION 'cas7 note espaces devait être NULL, obtenu %', note; END IF;
END $$;
```

- [ ] **Step 2 : Lancer les tests → doivent ÉCHOUER**

Run (sur la base de dev/staging avec psql ou SQL editor) :
```bash
psql "$DATABASE_URL" -f react-matchup/sql/tests/test_join_game.sql
```
Expected: ERREUR — `function public.join_game(uuid, text, boolean, text) does not exist` (le 4e param n'existe pas encore).

- [ ] **Step 3 : Réécrire le RPC avec `p_note`**

Remplacer **intégralement** le contenu de `react-matchup/supabase/migrations/join_game_rpc.sql` par :

```sql
-- ============================================================
-- Candidature atomique. Gate sur l'OCCUPATION VIVANTE
-- (créateur + accepted + invited NON expiré), pas sur le compteur
-- stocké. SELECT ... FOR UPDATE sérialise les candidatures
-- concurrentes (pas de surbooking). Renvoie le statut attribué ;
-- le client envoie ensuite la notif adéquate (confirmé / demande).
-- Règle ELO identique à getEloFit (lobby.tsx) : fit = elo ∈ [min,max].
-- p_note : mot de motivation optionnel, stocké UNIQUEMENT si pending (hors-niveau).
-- ============================================================

-- Ajouter p_note CHANGE la signature → Postgres créerait une SURCHARGE au lieu
-- de remplacer. On drop explicitement l'ancienne signature à 3 args.
DROP FUNCTION IF EXISTS public.join_game(uuid, text, boolean);

CREATE OR REPLACE FUNCTION public.join_game(
  p_game_id uuid,
  p_side text DEFAULT NULL,
  p_join_waitlist boolean DEFAULT false,
  p_note text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        uuid := public.current_player_id();
  v_elo       numeric;
  v_min       int;
  v_max       int;
  v_occupied  int;
  v_free      int;
  v_fit       boolean;
  v_status    text;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT min_elo, max_elo INTO v_min, v_max
    FROM open_games WHERE id = p_game_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'game not found'; END IF;

  SELECT elo_score INTO v_elo FROM players WHERE id = v_me;

  SELECT count(*) INTO v_occupied
    FROM game_participants
    WHERE game_id = p_game_id
      AND (status = 'accepted'
           OR (status = 'invited'
               AND (invite_expires_at IS NULL OR invite_expires_at > now())));

  v_free := 4 - 1 - v_occupied;   -- 4 joueurs - le créateur - occupants vivants

  v_fit := (v_elo >= coalesce(v_min, 0)) AND (v_elo <= coalesce(v_max, 9999));

  IF p_join_waitlist OR v_free <= 0 THEN
    v_status := 'waitlist';
  ELSIF v_fit THEN
    v_status := 'accepted';
  ELSE
    v_status := 'pending';
  END IF;

  -- Réinscription : efface une éventuelle ligne terminale (declined/expired) —
  -- ou une invitation 'invited' DÉJÀ EXPIRÉE (horloge dépassée mais cron
  -- expire_stale_invitations pas encore passée) — pour ce joueur, puis insère
  -- (UNIQUE game_id,player_id). Sans le cas 'invited' expiré, le re-join
  -- plantait sur la contrainte d'unicité tant que le cron n'avait pas tourné.
  DELETE FROM game_participants
    WHERE game_id = p_game_id AND player_id = v_me
      AND (status IN ('declined','expired')
           OR (status = 'invited'
               AND invite_expires_at IS NOT NULL
               AND invite_expires_at <= now()));

  INSERT INTO game_participants (game_id, player_id, status, team_side, application_note)
    VALUES (p_game_id, v_me, v_status, p_side,
            CASE WHEN v_status = 'pending'
                 THEN nullif(left(trim(p_note), 140), '')
                 ELSE NULL END);

  IF v_status = 'accepted' THEN
    UPDATE open_games
      SET spots_available = greatest(0, coalesce(spots_available, 1) - 1)
      WHERE id = p_game_id;
  END IF;

  RETURN v_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_game(uuid, text, boolean, text) TO authenticated;
```

- [ ] **Step 4 : Appliquer le RPC puis relancer les tests → doivent PASSER**

Run :
```bash
psql "$DATABASE_URL" -f react-matchup/supabase/migrations/application_note.sql
psql "$DATABASE_URL" -f react-matchup/supabase/migrations/join_game_rpc.sql
psql "$DATABASE_URL" -f react-matchup/sql/tests/test_join_game.sql
```
Expected: `test_join_game: OK` puis `ROLLBACK` (les 7 cas passent, dont les 4 existants — non-régression).

- [ ] **Step 5 : Commit**

```bash
git add react-matchup/supabase/migrations/join_game_rpc.sql react-matchup/sql/tests/test_join_game.sql
git commit -m "feat(db): join_game accepte p_note, stocké si pending"
```

---

## Task 3 : Wrapper `joinGame()` — 4e argument `note`

**Files:**
- Modify: `react-matchup/lib/games.ts:15-21`

- [ ] **Step 1 : Étendre le wrapper**

Remplacer la fonction `joinGame` actuelle (`lib/games.ts:15-21`) par :

```ts
export async function joinGame(
  gameId: string,
  side?: string,
  joinWaitlist = false,
  note?: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('join_game', {
    p_game_id: gameId,
    p_side: side ?? null,
    p_join_waitlist: joinWaitlist,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as string; // 'accepted' | 'pending' | 'waitlist'
}
```

- [ ] **Step 2 : Vérifier la compilation**

Run :
```bash
cd react-matchup && npx tsc --noEmit
```
Expected: pas de nouvelle erreur (les appels existants à 3 args restent valides, `note` est optionnel).

- [ ] **Step 3 : Commit**

```bash
git add react-matchup/lib/games.ts
git commit -m "feat: joinGame() transmet une note optionnelle au RPC"
```

---

## Task 4 : Composant `ApplicationNoteSheet`

**Files:**
- Create: `react-matchup/components/ApplicationNoteSheet.tsx`

- [ ] **Step 1 : Créer la feuille de saisie**

```tsx
import React, { useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { Colors, Fonts } from '../constants/theme';

const MAX_LEN = 140;

type Props = {
  visible: boolean;
  /** Envoi avec (ou sans) message. note = '' → candidature sans message. */
  onSubmit: (note: string) => void;
  onCancel: () => void;
};

/**
 * Feuille de saisie d'un mot de motivation, montrée UNIQUEMENT à un candidat
 * hors-niveau (cf. handleApply). Le filtrage profanité est fait par l'appelant
 * avant l'appel RPC ; ici on se contente de la saisie + limite de longueur.
 */
export default function ApplicationNoteSheet({ visible, onSubmit, onCancel }: Props) {
  const [note, setNote] = useState('');

  const close = (submitted: boolean, value: string) => {
    setNote('');
    if (submitted) onSubmit(value);
    else onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => close(false, '')}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <View style={{ backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 }}>
          <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
            Tu es hors de la zone de niveau
          </Text>
          <Text style={{ fontSize: 13, color: Colors.textSecondary }}>
            Un mot pour convaincre les joueurs de t'accepter ? (optionnel)
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Ex. je joue souvent à ce niveau, dispo ce créneau…"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={MAX_LEN}
            style={{
              minHeight: 72, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
              padding: 12, fontSize: 14, color: Colors.textPrimary, textAlignVertical: 'top',
            }}
          />
          <Text style={{ fontSize: 11, color: Colors.textMuted, textAlign: 'right' }}>
            {note.length}/{MAX_LEN}
          </Text>
          <TouchableOpacity
            onPress={() => close(true, note.trim())}
            style={{ backgroundColor: Colors.success, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 15 }}>Envoyer ma demande</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => close(true, '')} style={{ paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ color: Colors.textSecondary, fontWeight: '700', fontSize: 13 }}>Envoyer sans message</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => close(false, '')} style={{ paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ color: Colors.textMuted, fontSize: 13 }}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
```

> Note : vérifier les noms exacts exportés par `constants/theme` (`Colors`,
> `Fonts`, et les clés `bgCard`, `border`, `success`, `textOnDark`, `textMuted`,
> `textSecondary`, `textPrimary`) — ils sont utilisés tels quels dans
> GameDetailsSheet.tsx, donc présents. Ajuster l'import si le chemin diffère.

- [ ] **Step 2 : Vérifier la compilation**

Run :
```bash
cd react-matchup && npx tsc --noEmit
```
Expected: pas d'erreur sur le nouveau fichier.

- [ ] **Step 3 : Commit**

```bash
git add react-matchup/components/ApplicationNoteSheet.tsx
git commit -m "feat: ApplicationNoteSheet — saisie du mot de candidature"
```

---

## Task 5 : Intégration `handleApply` (interception hors-niveau + profanité)

**Files:**
- Modify: `react-matchup/app/(tabs)/lobby.tsx` (imports, état, `handleApply` ~1829, `GAME_SELECT` :1623, push pending ~1872, rendu de la feuille)

- [ ] **Step 1 : Importer la feuille et le filtre profanité**

En haut de `lobby.tsx`, ajouter aux imports existants :

```tsx
import ApplicationNoteSheet from '../../components/ApplicationNoteSheet';
import { containsProfanity } from '../../lib/profanity';
```

> Vérifier la profondeur relative : `lobby.tsx` est dans `app/(tabs)/`, donc
> `../../components/...` et `../../lib/...` (cohérent avec les imports déjà
> présents dans ce fichier).

- [ ] **Step 2 : Ajouter l'état de la feuille**

Près des autres `useState` du composant `LobbyScreen` (ex. à côté de `openGameId`),
ajouter :

```tsx
const [noteSheet, setNoteSheet] = useState<{ gameId: string; side?: string } | null>(null);
```

- [ ] **Step 3 : Étendre `GAME_SELECT` pour ramener `application_note`**

Dans `lobby.tsx:1623`, ajouter `application_note` à la liste des champs participants.
Remplacer :

```tsx
    const GAME_SELECT = '*, creator:creator_id(id, name, elo_score, win_count, loss_count), participants:game_participants(id, player_id, status, team_side, approvals, created_at, invite_expires_at, player:player_id(id, name, elo_score, win_count, loss_count))';
```

par :

```tsx
    const GAME_SELECT = '*, creator:creator_id(id, name, elo_score, win_count, loss_count), participants:game_participants(id, player_id, status, team_side, approvals, application_note, created_at, invite_expires_at, player:player_id(id, name, elo_score, win_count, loss_count))';
```

- [ ] **Step 4 : Intercepter le hors-niveau dans `handleApply`**

Au tout début de `handleApply` (`lobby.tsx:1829`), juste après
`if (!player) return;` et la résolution de `const game = …`, insérer
l'interception. Remplacer le début actuel :

```tsx
  const handleApply = async (gameId: string, joinWaitlist: boolean, teamSide?: string) => {
    if (!player) return;
    const game = games.find(g => g.id === gameId) ?? upcomingGames.find(g => g.id === gameId);
```

par :

```tsx
  const handleApply = async (gameId: string, joinWaitlist: boolean, teamSide?: string) => {
    if (!player) return;
    const game = games.find(g => g.id === gameId) ?? upcomingGames.find(g => g.id === gameId);

    // Hors-niveau (candidature normale, pas waitlist) → demander un mot optionnel
    // AVANT d'envoyer. Les joueurs dans-le-niveau (acceptés direct) ou la waitlist
    // gardent le chemin direct sans feuille.
    if (!joinWaitlist && game && getEloFit(game, player.elo_score ?? 0) !== 'fit') {
      setNoteSheet({ gameId, side: teamSide });
      return;
    }
    return submitApplication(gameId, joinWaitlist, teamSide);
  };

  // Envoi effectif de la candidature (avec note optionnelle). Séparé de
  // handleApply pour que la feuille hors-niveau puisse le rappeler après saisie.
  const submitApplication = async (gameId: string, joinWaitlist: boolean, teamSide?: string, note?: string) => {
    if (!player) return;
    const game = games.find(g => g.id === gameId) ?? upcomingGames.find(g => g.id === gameId);
```

> Cela transforme le corps existant de `handleApply` (à partir de
> `// Candidature atomique côté serveur…`) en corps de `submitApplication`. Le
> reste du corps reste **inchangé** SAUF l'appel à `joinGame` (step 5) et le push
> pending (step 6). Vérifier que `myElo`/`player.elo_score` est le bon champ :
> `getEloFit` attend l'ELO du joueur — `player.elo_score` (fallback `myElo` déjà
> calculé dans ce composant si disponible).

- [ ] **Step 5 : Passer la note au RPC dans `submitApplication`**

Dans le corps de `submitApplication`, remplacer l'appel actuel :

```tsx
      newStatus = await joinGame(gameId, teamSide, joinWaitlist);
```

par :

```tsx
      newStatus = await joinGame(gameId, teamSide, joinWaitlist, note);
```

- [ ] **Step 6 : Aperçu du mot dans le push « Nouvelle demande »**

Dans la branche `newStatus === 'pending'` (~`lobby.tsx:1865-1879`), remplacer le
corps de la notif par une version qui inclut un aperçu du mot s'il existe :

```tsx
    } else if (newStatus === 'pending') {
      const approverIds = [
        game?.creator_id,
        ...(game?.participants?.filter((p: any) => p.status === 'accepted').map((p: any) => p.player_id) ?? []),
      ].filter((id: string | undefined): id is string => !!id && id !== player.id);
      if (approverIds.length > 0) {
        const loc = game?.location ? ` à ${game.location}` : '';
        const preview = note && note.trim()
          ? ` — « ${note.trim().slice(0, 60)}${note.trim().length > 60 ? '…' : ''} »`
          : '';
        notifyPlayers({
          playerIds: approverIds,
          title: '📋 Nouvelle demande',
          body: `${player.name} veut rejoindre la partie${loc}${preview}`,
          data: { type: 'lobby', gameId },
        });
      }
      Alert.alert('Demande envoyée !', 'Les participants doivent accepter ta demande.');
      setOpenGameId(null);
    }
```

> `note` est désormais un paramètre de `submitApplication` — disponible dans cette
> branche. Le reste de la branche (`Alert`, `setOpenGameId`) est conservé.

- [ ] **Step 7 : Rendre la feuille + brancher la profanité**

Dans le JSX rendu par `LobbyScreen` (près du rendu de `GameDetailsSheet`, ex.
après le composant principal), ajouter :

```tsx
        <ApplicationNoteSheet
          visible={noteSheet !== null}
          onCancel={() => setNoteSheet(null)}
          onSubmit={(note) => {
            if (note && containsProfanity(note)) {
              Alert.alert('Message non autorisé', 'Ton message contient des termes interdits — reformule.');
              return; // la feuille reste ouverte
            }
            const target = noteSheet;
            setNoteSheet(null);
            if (target) submitApplication(target.gameId, false, target.side, note || undefined);
          }}
        />
```

- [ ] **Step 8 : Vérifier la compilation**

Run :
```bash
cd react-matchup && npx tsc --noEmit
```
Expected: pas d'erreur. Si `getEloFit` ou `myElo` n'est pas dans la portée de
`handleApply`, ajuster (les deux sont définis au niveau module / composant —
`getEloFit` ligne 44, `myElo` calculé dans le composant).

- [ ] **Step 9 : Commit**

```bash
git add react-matchup/app/(tabs)/lobby.tsx
git commit -m "feat: feuille de mot pour candidature hors-niveau + aperçu push"
```

---

## Task 6 : Affichage du mot sur la carte d'approbation

**Files:**
- Modify: `react-matchup/app/(tabs)/GameDetailsSheet.tsx:709-710`

- [ ] **Step 1 : Insérer la bulle du mot**

Dans `GameDetailsSheet.tsx`, dans le `map` des `pendingPlayers`, après la
fermeture de la `View` du bloc header (la ligne `</View>` à 709, juste avant le
commentaire `{/* Approval progress bar */}` à 710), insérer :

```tsx
                        {p.application_note ? (
                          <View style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 10, padding: 8, marginBottom: 8 }}>
                            <Text style={{ fontSize: 12, fontStyle: 'italic', color: Colors.textSecondary }}>
                              💬 « {p.application_note} »
                            </Text>
                          </View>
                        ) : null}
```

> La requête `GAME_SELECT` (Task 5 step 3) ramène déjà `application_note`, donc
> `p.application_note` est disponible ici. La carte n'existe que pour les
> `pending` → le mot disparaît dès l'acceptation (éphémère gratuit).

- [ ] **Step 2 : Vérifier la compilation**

Run :
```bash
cd react-matchup && npx tsc --noEmit
```
Expected: pas d'erreur.

- [ ] **Step 3 : Commit**

```bash
git add react-matchup/app/(tabs)/GameDetailsSheet.tsx
git commit -m "feat: affiche le mot de candidature sur la carte d'approbation"
```

---

## Task 7 : Vérification manuelle Expo

**Files:** aucun (validation device).

- [ ] **Step 1 : Lancer l'app et vérifier les 5 comportements**

1. Candidater à une partie **dans-le-niveau** → acceptation directe, **aucune feuille**.
2. Candidater à une partie **hors-niveau** → la feuille s'ouvre, compteur 0/140,
   `maxLength` bloque à 140.
3. Saisir un terme de `lib/profanity.ts` (ex. « merde ») + Envoyer → `Alert`
   « Message non autorisé », la feuille **reste ouverte**.
4. Envoyer un mot propre → candidature `pending` ; côté votant, la carte
   d'approbation affiche `💬 « … »` sous le nom.
5. « Envoyer sans message » → candidature `pending` **sans** bulle ; le push
   « Nouvelle demande » n'a pas d'aperçu.

- [ ] **Step 2 : (Si applicable) cocher la vérif device dans la mémoire projet**

---

## Application en base (action manuelle utilisateur)

⚠️ Les migrations ne sont **pas** auto-appliquées. Après merge, exécuter dans
l'ordre sur la prod (`icshhobxeppttgayxmba`) :
```
1. supabase/migrations/application_note.sql
2. supabase/migrations/join_game_rpc.sql   (drop ancienne signature + nouvelle)
```
Vérifier qu'aucune surcharge `join_game(uuid, text, boolean)` ne subsiste :
```sql
SELECT oid::regprocedure FROM pg_proc WHERE proname = 'join_game';
-- attendu : une seule ligne join_game(uuid, text, boolean, text)
```

---

## Self-Review (couverture spec)

- §1 Stockage `application_note` → Task 1. ✅
- §2 RPC `p_note` + `CASE WHEN pending` + drop signature → Task 2. ✅
- §3 Wrapper `joinGame()` 4e arg → Task 3. ✅
- §4 UX feuille hors-niveau (`getEloFit !== 'fit'`, profanité, deux actions) → Tasks 4 + 5. ✅
- §5 Affichage votants (`GAME_SELECT` + bulle) → Task 5 step 3 + Task 6. ✅
- §6 Push avec aperçu → Task 5 step 6. ✅
- Cas limites spec (note vide, profanité, fit, waitlist, re-candidature, ancien client) → tests SQL Task 2 (cas 5/6/7) + logique client + `DEFAULT NULL`. ✅
- Tests → Task 2 (SQL) + Task 7 (manuel Expo). ✅

Cohérence des noms : `submitApplication`, `noteSheet`, `application_note`,
`containsProfanity`, `getEloFit`, `ApplicationNoteSheet` employés de manière
identique d'une tâche à l'autre. ✅
