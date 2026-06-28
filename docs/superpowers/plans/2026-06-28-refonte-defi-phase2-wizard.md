# Refonte Défi 2v2 — Phase 2 : Création dans le CreateWizard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre un défi 2v2 *créable* depuis le `CreateWizard` existant : choix du binôme, curseurs de mise et de plafond, publication différée (`draft` tant que le partenaire n'a pas accepté), et arrêt de l'écriture dans l'ancienne table `challenges`.

**Architecture:** Le wizard garde son type « Défi » existant mais, quand ce type est choisi, il déroule un sous-parcours à **4 étapes** (`Quand & Où → La partie → Mon binôme → Mise & plafond`) au lieu de 3. Les parties normales (Compétitif/Amical) sont **inchangées** (3 étapes). Le défi est inséré en `open_games(status='draft', is_challenge=true, stake_multiplier, min_elo=plancher, max_elo=plafond)` avec seulement le partenaire créateur invité côté A ; un trigger DB publie (`draft→open`) dès que ce partenaire accepte. La Phase 1 (colonnes, RPC, ELO) est supposée appliquée.

**Tech Stack:** React Native / Expo (TypeScript), Supabase Postgres. Vérif = `npx tsc --noEmit` + (manuel) application SQL + test device.

## Global Constraints

- **Parties normales inchangées** : Compétitif/Amical gardent `Quand & Où → La partie → L'équipe` (3 étapes), level range, slots A/B éditables. Aucune régression visible ni logique.
- **Défi = 4 étapes**, type choisi à l'étape « La partie » (ou pré-fixé via `initialGameType='Défi'`). L'étape « Mon binôme » vient **AVANT** « Mise & plafond » (le plancher = moyenne du binôme borne le plafond).
- **Plancher** `minLevel = moyenne(niveau créateur, niveau partenaire)` ; **plafond** `maxLevel = curseur ∈ [plancher, 8.0]` ; **mise** `stakeMultiplier ∈ [1.5, 3.0]`. Contrainte DB Phase 1 : `is_challenge ⇒ stake ∈ [1.5,3.0] ET max_elo ≥ min_elo` → toujours respecter à l'insert.
- **Niveau→ELO** : `padelLevelToElo()` / `eloToLevel()` (déjà importés dans le wizard). `min_elo = padelLevelToElo(minLevel)`, `max_elo = padelLevelToElo(maxLevel)`.
- **Statut `draft`** : `open_games.status` n'a PAS de contrainte CHECK → `'draft'` est libre. Un défi `draft` doit être EXCLU des listes publiques (Explorer/Lobby) jusqu'à publication.
- **Ne plus écrire dans `challenges`** : retirer le bloc `supabase.from('challenges').insert(...)` du publish (lobby.tsx ~2109-2120). Table laissée dormante (Phase 5).
- **Sides défi** : créateur = `A_GAU` (ou son `mySlot`), partenaire = `A_DRO`. Team B (`B_GAU/B_DRO`) reste vide (remplie par la course Phase 1/3).

---

### Task 1 : Statut `draft` — exclusion des listes + trigger de publication

**Files:**
- Create: `react-matchup/supabase/migrations/defi_draft_publish.sql`
- Modify: `react-matchup/app/(tabs)/lobby.tsx` (requêtes de listing des parties publiques — voir Step 3)

**Interfaces:**
- Produces: trigger `fn_publish_defi_on_partner_accept` (game_participants AFTER UPDATE) qui fait `open_games.status: draft→open` quand un participant Team-A passe `accepted` sur un défi `draft`.

- [ ] **Step 1 : Écrire la migration du trigger de publication**

```sql
-- react-matchup/supabase/migrations/defi_draft_publish.sql
-- ============================================================
-- Défi 2v2 — publication différée.
-- Un défi est créé en status='draft' (invisible). Dès que le
-- partenaire du créateur (invité côté Team A) ACCEPTE son invitation
-- (game_participants.status → 'accepted'), le défi passe 'open' et
-- devient visible / candidatable. Aucune autre transition n'est
-- touchée. open_games.status n'a pas de CHECK → 'draft' est libre.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_publish_defi_on_partner_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' THEN
    UPDATE public.open_games
      SET status = 'open'
      WHERE id = NEW.game_id
        AND is_challenge IS TRUE
        AND status = 'draft';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_publish_defi_on_partner_accept ON public.game_participants;
CREATE TRIGGER trg_publish_defi_on_partner_accept
  AFTER UPDATE ON public.game_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_publish_defi_on_partner_accept();

COMMIT;
```

- [ ] **Step 2 : (manuel, différé) appliquer la migration** — noté dans le runbook, NON fait par le sous-agent (pas d'outil Supabase).

- [ ] **Step 3 : Exclure les défis `draft` des listes publiques (lobby.tsx)**

Dans `react-matchup/app/(tabs)/lobby.tsx`, repérer les requêtes `supabase.from('open_games').select(...)` qui alimentent l'Explorer / la liste publique des parties à venir (lignes ~1703, ~1710, ~1767, ~1992, ~2235, ~2310 — identifier celles qui listent les parties OUVERTES visibles par tous, pas celles filtrées par `creator_id`/participant). Pour chacune de ces requêtes de listing public, ajouter un filtre excluant `draft` :

```ts
.neq('status', 'draft')
```

NB : ne PAS l'ajouter aux requêtes qui chargent « mes parties » par `creator_id` (le créateur doit voir son propre brouillon). Vérifier le sens de chaque requête avant d'éditer ; commenter chaque ajout `// défi non publié tant que le partenaire n'a pas accepté`.

- [ ] **Step 4 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur.

- [ ] **Step 5 : Commit**

```bash
git add -f react-matchup/supabase/migrations/defi_draft_publish.sql
git add react-matchup/app/(tabs)/lobby.tsx
git commit -m "feat(defi): statut draft (publication différée) + exclusion des listes publiques"
```

---

### Task 2 : `WizardResult` + `handlePublish` — insérer un défi en `draft`, sans `challenges`

**Files:**
- Modify: `react-matchup/app/(tabs)/CreateWizard.tsx` (interface `WizardResult` ~ligne 23 ; appel `onPublish` ~ligne 480)
- Modify: `react-matchup/app/(tabs)/lobby.tsx` (`handlePublish` ~ligne 2069-2128)

**Interfaces:**
- Consumes: colonnes Phase 1 `open_games.stake_multiplier` ; statut `draft` (Task 1).
- Produces: `WizardResult.stakeMultiplier: number` ; `handlePublish` insère `is_challenge`, `stake_multiplier`, `status` (`draft` si défi sinon `open`), sans écrire dans `challenges`.

- [ ] **Step 1 : Ajouter `stakeMultiplier` à `WizardResult`**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, interface `WizardResult` (~ligne 23), ajouter le champ :

```ts
export interface WizardResult {
  gameType: GameType; genre: Genre;
  matchDate: string; matchTime: string;
  location: string; hasReservation: boolean;
  minLevel: number; maxLevel: number;
  stakeMultiplier: number;
  creatorSide: string;
  confirmedPlayers: Array<{ id: string; name: string; elo_score: number; team_side?: string }>;
}
```

- [ ] **Step 2 : Passer `stakeMultiplier` dans l'appel `onPublish`**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, `handlePublish` (~ligne 480), ajouter au payload `onPublish({...})` :

```ts
        minLevel:       form.minLevel,
        maxLevel:       form.maxLevel,
        stakeMultiplier: form.gameType === 'Défi' ? form.stakeMultiplier : 1.0,
        creatorSide:    form.mySlot ? SLOT_TO_SIDE[form.mySlot] : 'A_GAU',
```

(`form.stakeMultiplier` est ajouté à l'état du formulaire en Task 3.)

- [ ] **Step 3 : `handlePublish` (lobby.tsx) — statut draft + stake + retrait challenges**

Dans `react-matchup/app/(tabs)/lobby.tsx`, dans l'`insert` `open_games` (~ligne 2071), remplacer le bloc `.insert({...})` par (ajouts : `stake_multiplier`, `status` conditionnel) :

```ts
      .insert({
        creator_id: player.id,
        creator_side: data.creatorSide,
        game_format: data.gameType === 'Amical' ? 'friendly' : 'competitive',
        is_challenge: data.gameType === 'Défi',
        stake_multiplier: data.gameType === 'Défi' ? data.stakeMultiplier : 1.0,
        gender_pref: data.genre,
        match_date: matchDateIso,
        location: data.location,
        has_reservation: data.hasReservation,
        min_elo: padelLevelToElo(data.minLevel),
        max_elo: padelLevelToElo(data.maxLevel),
        status: data.gameType === 'Défi' ? 'draft' : 'open',
        spots_available: 3 - data.confirmedPlayers.length,
      })
```

- [ ] **Step 4 : Retirer l'écriture dans `challenges`**

Dans `react-matchup/app/(tabs)/lobby.tsx`, supprimer entièrement le bloc (~ligne 2109-2120) :

```ts
      // Option B2 : tracer le défi dans `challenges` ...
      if (isChallenge) {
        await supabase.from('challenges').insert(
          invites.map(i => ({
            challenger_id: player.id,
            challenged_id: i.player_id,
            game_id: game.id,
            status: 'pending' as const,
          })),
        );
      }
```

Conserver la notif d'invitation au partenaire (le `notifyPlayers` juste au-dessus reste). La variable `isChallenge` reste utilisée par ce `notifyPlayers` ; ne pas la supprimer.

- [ ] **Step 5 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur (le champ `stakeMultiplier` est requis dans `WizardResult` ; tous les appelants passent par le wizard).

- [ ] **Step 6 : Commit**

```bash
git add react-matchup/app/(tabs)/CreateWizard.tsx react-matchup/app/(tabs)/lobby.tsx
git commit -m "feat(defi): publish en draft + stake_multiplier, fin de l'écriture dans challenges"
```

---

### Task 3 : Wizard — état du formulaire + étapes dynamiques selon le type

**Files:**
- Modify: `react-matchup/app/(tabs)/CreateWizard.tsx`

**Interfaces:**
- Consumes: `form.gameType`, `eloToLevel`, `player`.
- Produces: `form.stakeMultiplier` (numérique, défaut 2.0) ; `STEPS` dynamique (`stepLabels`, `lastStep`) ; navigation/dots basés sur `STEPS` au lieu de `[0,1,2]` codés en dur.

- [ ] **Step 1 : Ajouter `stakeMultiplier` à l'état du formulaire**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, l'objet `useState` du formulaire (~ligne 257) et le reset à l'ouverture (~ligne 314) : ajouter `stakeMultiplier: 2.0` dans les deux initialisations (état initial ET `setFormState` du `useEffect` d'ouverture), pour garder les deux chemins iso.

- [ ] **Step 2 : Définir les étapes dynamiques selon le type**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, remplacer la constante figée `SCREEN_LABELS` (~ligne 46) par une fonction dérivant les libellés du type, et calculer la liste d'étapes courante près du composant (après `const t = getTheme(form.gameType)`, ~ligne 280) :

```ts
// Étapes selon le type : le Défi insère « Mon binôme » avant « Mise & plafond ».
function screenLabels(gameType: GameType): string[] {
  if (gameType === 'Défi') return ['Quand & Où', 'La partie', 'Mon binôme', 'Mise & plafond'];
  return ['Quand & Où', 'La partie', "L'équipe"];
}
```

puis dans le composant :

```ts
  const STEP_LABELS = screenLabels(form.gameType);
  const LAST_STEP = STEP_LABELS.length - 1;
```

- [ ] **Step 3 : Brancher l'en-tête/dots/CTA sur `STEP_LABELS` au lieu de `[0,1,2]`**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx` :
- En-tête (~ligne 1147) : `{SCREEN_LABELS[step]}` → `{STEP_LABELS[step]}`.
- Step dots (~ligne 1151) et progress bar (~ligne 1162) : remplacer `[0, 1, 2].map(...)` par `STEP_LABELS.map((_, i) => ...)`.
- CTA (~ligne 1185) : remplacer `step < 2 ?` par `step < LAST_STEP ?` (bouton « Continuer » vs « Publier »).
- Au changement de type (renderStep1 onPress, ~ligne 749) : si le `step` courant dépasse le nouveau `LAST_STEP` (passage Défi→non-Défi en arrière improbable, mais sécuriser), clamp `setStep(s => Math.min(s, screenLabels(opt.val).length - 1))`.

- [ ] **Step 4 : Adapter `canNext` aux nouvelles étapes**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, `canNext` (~ligne 421) est un tableau indexé par `step`. Le remplacer par une dérivation tenant compte du type (les indices 2 et 3 du Défi ont leurs propres règles) :

```ts
  const isDefi = form.gameType === 'Défi';
  // partenaire créateur choisi = exactement 1 invité sur Team A (slot A0/A1)
  const defiPartnerChosen = isDefi && Object.keys(form.invites).some(k => k.startsWith('A')) ;
  const canNext = (() => {
    if (step === 0) return !!form.day && !!form.time && !!form.location && !isPastSlot(form.day, form.time);
    if (step === 1) return !!form.gameType && (isDefi || form.minLevel <= form.maxLevel);
    if (isDefi && step === 2) return defiPartnerChosen;          // Mon binôme
    if (isDefi && step === 3) return form.maxLevel >= form.minLevel && form.stakeMultiplier >= 1.5 && form.stakeMultiplier <= 3.0;
    return true; // L'équipe (non-défi) : publication libre comme aujourd'hui
  })();
```

- [ ] **Step 5 : Router le rendu des étapes selon le type**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, le bloc de rendu (~ligne 1170) :

```tsx
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 18 }}>
          {step === 0 && renderStep0()}
          {step === 1 && renderStep1()}
          {step === 2 && (isDefi ? renderDefiBinome() : renderStep2())}
          {step === 3 && isDefi && renderDefiSettings()}
        </View>
```

(`renderDefiBinome` et `renderDefiSettings` sont créés en Tasks 4 et 5. `renderStep1` est adapté en Task 4 pour masquer le level range en Défi.)

- [ ] **Step 6 : Typecheck** — `npx tsc --noEmit`. À ce stade `renderDefiBinome`/`renderDefiSettings` n'existent pas encore → garder cette tâche comme prépa et NE PAS committer seule si le typecheck casse. **Committer Tasks 3+4+5 ensemble** (voir Note ci-dessous), ou stubber temporairement les deux fonctions avec `return null;` pour un commit intermédiaire vert.

> **Note de découpage** : Tasks 3, 4, 5 modifient toutes `CreateWizard.tsx` et se complètent (l'une référence les fonctions des autres). L'implémenteur peut les traiter comme **un seul commit cohérent** « écran de création du défi », en gardant la granularité de revue par tâche. Si commits séparés souhaités, stubber `renderDefiBinome`/`renderDefiSettings` avec `return null;` en Task 3 puis les remplir en 4/5.

---

### Task 4 : Wizard — étape « Mon binôme » + masquage du level range en Défi

**Files:**
- Modify: `react-matchup/app/(tabs)/CreateWizard.tsx`

**Interfaces:**
- Consumes: `form.invites`, `form.mySlot`, `player`, `eloToLevel`, `assignPlayer`/`openInvite`/`inviteTarget` (helpers existants), `freqAvail`/`searchAvail`.
- Produces: `renderDefiBinome()` ; `defiFloorLevel` (moyenne créateur+partenaire) ; `renderStep1` masque le level range quand `gameType==='Défi'`.

- [ ] **Step 1 : Dériver le plancher (moyenne du binôme)**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, près des dérivés d'équipe (~ligne 450), ajouter :

```ts
  // Plancher de niveau du défi = moyenne (créateur, partenaire choisi).
  // Le partenaire est l'unique invité sur un slot Team A (A0/A1).
  const defiPartner = Object.entries(form.invites).find(([k]) => k.startsWith('A'))?.[1] ?? null;
  const defiFloorLevel = (() => {
    const meLv = player ? eloToLevel(player.elo_score) : 4.0;
    if (!defiPartner) return meLv;
    return +(((meLv + eloToLevel(defiPartner.elo_score)) / 2)).toFixed(2);
  })();
```

- [ ] **Step 2 : Masquer le level range de « La partie » en Défi**

Dans `renderStep1` (~ligne 797, le bloc « Niveau (Padel) »), envelopper l'affichage du level range pour qu'il ne s'affiche QUE hors Défi :

```tsx
        {form.gameType !== 'Défi' && (
          <>
            <Text style={sty.sectionLabel}>Niveau (Padel)</Text>
            {/* … bloc existant du level range inchangé … */}
          </>
        )}
```

(En Défi, le niveau est dérivé à l'étape « Mise & plafond », pas saisi ici.)

- [ ] **Step 3 : Écrire `renderDefiBinome()`**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, ajouter une fonction de rendu (à côté de `renderStep2`, ~ligne 868). Elle réutilise le panneau d'invitation existant (`inviteTarget`, `openInvite`, `assignPlayer`, `freqAvail`, `searchAvail`) en ciblant le slot `A1` (le créateur occupe `A0`). Code :

```tsx
  // ── Étape Défi : choisir mon binôme (Team A = moi + 1 partenaire) ──
  function renderDefiBinome() {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <Text style={sty.sectionLabel}>Mon binôme</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          {/* Moi (A0) */}
          <View style={{ flex: 1, backgroundColor: t.teamABg, borderWidth: 1.5, borderColor: t.teamABorder, borderRadius: 14, padding: 12, alignItems: 'center', gap: 6 }}>
            <Avatar name={player?.name ?? '?'} size={44} />
            <Text style={{ fontSize: 12.5, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>Vous</Text>
            <Text style={{ fontSize: 10, color: Colors.textMuted }}>Niv. {player ? formatPadelLevel(player.elo_score) : '—'}</Text>
          </View>
          {/* Partenaire (A1) */}
          <TouchableOpacity activeOpacity={0.8}
            onPress={() => defiPartner ? (() => { const ni = { ...form.invites }; Object.keys(ni).filter(k => k.startsWith('A')).forEach(k => delete ni[k]); set('invites', ni); })() : openInvite('A1')}
            style={{ flex: 1, backgroundColor: defiPartner ? t.teamABg : t.libreBg, borderWidth: 1.5, borderStyle: defiPartner ? 'solid' : 'dashed', borderColor: defiPartner ? t.teamABorder : t.libreBorder, borderRadius: 14, padding: 12, alignItems: 'center', gap: 6 }}>
            {defiPartner ? (
              <>
                <Avatar name={defiPartner.name} size={44} />
                <Text style={{ fontSize: 12.5, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>{defiPartner.name.split(' ')[0]}</Text>
                <Text style={{ fontSize: 10, color: Colors.textMuted }}>Niv. {formatPadelLevel(defiPartner.elo_score)}</Text>
              </>
            ) : (
              <>
                <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderStyle: 'dashed', borderColor: t.libreBorder, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 22, color: t.libreColor, fontWeight: '300' }}>+</Text>
                </View>
                <Text style={{ fontSize: 12, fontWeight: '700', color: t.libreColor }}>Choisir</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {defiPartner && (
          <View style={{ backgroundColor: t.eloBg, borderWidth: 1, borderColor: t.eloBorder, borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <Text style={{ fontSize: 12, fontWeight: '900', color: t.eloColor, textAlign: 'center' }}>
              Plancher d'éligibilité : niveau {defiFloorLevel.toFixed(2)} (moyenne du binôme)
            </Text>
          </View>
        )}

        {/* Panneau d'invitation (réutilise le rendu existant : recherche + habituels) */}
        {inviteTarget && (
          /* COPIER ICI le même JSX que le « Invite panel » de renderStep2 (lignes ~967-1025) */
          null
        )}
      </ScrollView>
    );
  }
```

⚠️ Pour le panneau d'invitation : ne pas dupliquer le JSX. Extraire le bloc « Invite panel » de `renderStep2` (lignes ~967-1025) en une fonction `renderInvitePanel()` appelée par `renderStep2` ET `renderDefiBinome`. Faire cette extraction d'abord (DRY), puis l'appeler aux deux endroits.

- [ ] **Step 4 : Typecheck** — `npx tsc --noEmit` → zéro erreur (avec `renderDefiSettings` au moins stubbé `return null;` si pas encore fait en Task 5).

- [ ] **Step 5 : Commit** (ou commit groupé 3+4+5 — voir note Task 3)

```bash
git add react-matchup/app/(tabs)/CreateWizard.tsx
git commit -m "feat(defi): étape « Mon binôme » (plancher = moyenne du binôme) + level range masqué en Défi"
```

---

### Task 5 : Wizard — étape « Mise & plafond » (curseurs)

**Files:**
- Modify: `react-matchup/app/(tabs)/CreateWizard.tsx`

**Interfaces:**
- Consumes: `defiFloorLevel` (Task 4), `form.stakeMultiplier`, `form.maxLevel`, `set`.
- Produces: `renderDefiSettings()` ; à l'entrée de l'étape, `form.minLevel` est figé au plancher et `form.maxLevel` borné `≥ plancher`.

- [ ] **Step 1 : Synchroniser minLevel = plancher quand on atteint l'étape**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, ajouter un `useEffect` qui, en Défi, fige `minLevel` au plancher dès que le binôme/plancher change, et remonte `maxLevel` s'il est sous le plancher :

```ts
  useEffect(() => {
    if (form.gameType !== 'Défi') return;
    setFormState(f => ({
      ...f,
      minLevel: defiFloorLevel,
      maxLevel: Math.max(f.maxLevel, defiFloorLevel),
    }));
  }, [form.gameType, defiFloorLevel]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 2 : Écrire `renderDefiSettings()`**

Dans `react-matchup/app/(tabs)/CreateWizard.tsx`, ajouter (réutilise les boutons ± du level range existant comme modèle visuel) :

```tsx
  // ── Étape Défi : mise (×1.5→×3) + plafond de niveau adverse ──
  function renderDefiSettings() {
    const setStake = (v: number) => set('stakeMultiplier', +Math.min(3.0, Math.max(1.5, v)).toFixed(1));
    const setCap   = (v: number) => set('maxLevel', +Math.min(8.0, Math.max(defiFloorLevel, v)).toFixed(2));
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Mise */}
        <Text style={sty.sectionLabel}>Mise — points en jeu</Text>
        <View style={{ backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1.5, borderColor: Colors.border, padding: 16, marginBottom: 16, alignItems: 'center', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={() => setStake(form.stakeMultiplier - 0.1)} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 20, color: Colors.textPrimary }}>−</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 30, fontFamily: Fonts.uiBlack, fontWeight: '900', color: t.eloColor, minWidth: 70, textAlign: 'center' }}>×{form.stakeMultiplier.toFixed(1)}</Text>
            <TouchableOpacity onPress={() => setStake(form.stakeMultiplier + 0.1)} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 20, color: Colors.textPrimary }}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 11, color: Colors.textMuted, textAlign: 'center' }}>Le delta ELO du match est multiplié par {form.stakeMultiplier.toFixed(1)} pour les 4 joueurs. Plus la mise est haute, plus on gagne… ou perd.</Text>
        </View>

        {/* Plafond de niveau adverse */}
        <Text style={sty.sectionLabel}>Plafond de niveau adverse</Text>
        <View style={{ backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1.5, borderColor: Colors.border, padding: 16, marginBottom: 12, alignItems: 'center', gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <TouchableOpacity onPress={() => setCap(form.maxLevel - 0.1)} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 20, color: Colors.textPrimary }}>−</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 30, fontFamily: Fonts.uiBlack, fontWeight: '900', color: t.eloColor, minWidth: 70, textAlign: 'center' }}>{form.maxLevel.toFixed(2)}</Text>
            <TouchableOpacity onPress={() => setCap(form.maxLevel + 0.1)} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 20, color: Colors.textPrimary }}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 12, fontWeight: '700', color: t.eloColor, textAlign: 'center' }}>
            Éligibles : binômes de moyenne {defiFloorLevel.toFixed(2)} → {form.maxLevel.toFixed(2)}
          </Text>
        </View>

        <View style={{ backgroundColor: t.eloBg, borderWidth: 1, borderColor: t.eloBorder, borderRadius: 10, padding: 10 }}>
          <Text style={{ fontSize: 11, color: Colors.textSecondary, textAlign: 'center', lineHeight: 16 }}>
            À la publication, le défi reste invisible tant que {defiPartner?.name?.split(' ')[0] ?? 'ton partenaire'} n'a pas accepté.
          </Text>
        </View>
      </ScrollView>
    );
  }
```

- [ ] **Step 3 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur.

- [ ] **Step 4 : Commit** (ou commit groupé 3+4+5)

```bash
git add react-matchup/app/(tabs)/CreateWizard.tsx
git commit -m "feat(defi): étape « Mise & plafond » (curseurs ×1.5→×3 et plafond borné au plancher)"
```

---

## Self-review (Phase 2)

- **Couverture spec** : type Défi → 4 étapes (Task 3) ✓ ; « Mon binôme » avant mise/plafond (Tasks 3-4) ✓ ; plancher = moyenne du binôme (Task 4) ✓ ; mise ×1.5→×3 → `stake_multiplier` (Tasks 2,5) ✓ ; plafond → `max_elo`, plancher → `min_elo` (Tasks 2,5) ✓ ; Team B non éditable par le créateur (le créateur ne pose qu'un partenaire A) ✓ ; publication différée `draft`→`open` (Task 1) ✓ ; retrait écriture `challenges` (Task 2) ✓ ; parties normales inchangées (rendus non-Défi intacts) ✓.
- **Contrainte DB Phase 1** : à l'insert défi, `stake ∈ [1.5,3.0]` (clampé par les curseurs) et `max_elo ≥ min_elo` (`maxLevel ≥ defiFloorLevel` garanti par `setCap`/le useEffect) → la contrainte `open_games_defi_stake_chk` ne peut pas être violée.
- **Risque identifié** : la liste des requêtes de listing public à filtrer `draft` (Task 1 Step 3) doit être vérifiée une à une (ne pas filtrer « mes parties »). L'implémenteur DOIT lire chaque requête avant d'éditer.
- **Hors Phase 2** : surface de relève (hub, `defi_apply`/`defi_accept` côté client), notifications défi, retrait `lib/challenges.ts` → Phases 3-5.

---

## Runbook SQL Phase 2 (à appliquer après la Phase 1, dans l'ordre)

6. `supabase/migrations/defi_draft_publish.sql`  *(après les 5 migrations Phase 1)*

Puis rebuild de l'app (TS) pour le wizard.
