# Refonte Défi 2v2 — Phase 3a : Hub Défi (couche données + coquille 4 sections) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer `matchmaking.tsx` (2 onglets 1v1 : Suggestions / Défis reçus) en **hub Défi 2v2** à 4 sections branchées sur le modèle Phase 1/2 (`open_games is_challenge` + `defi_applications` + RPC `defi_apply`/`defi_accept`), et isoler toute la logique Supabase dans une couche `lib/defis.ts`.

**Architecture:** Une **couche données unique `lib/defis.ts`** expose les requêtes et les appels RPC ; l'écran `matchmaking.tsx` devient un hub à 4 onglets (**À relever · Mes défis · Candidatures · Invitations binôme**) qui consomme cette couche. L'ancien flux 1v1 (`challenges`, SuggestionCard « Défier », IncomingCard) est retiré. Le raffinement UX (sélecteur de partenaire riche, classement par compatibilité, surfaçage dans le lobby « À venir ») est la **Phase 3b**.

**Tech Stack:** React Native / Expo (TS), Supabase. Vérif = `npx tsc --noEmit` (pas de tests auto ; vérif device ensuite).

## Global Constraints

- **Modèle OUVERT uniquement** (Phase 1/2) : un défi = `open_games(is_challenge=true)`, `status ∈ {draft, open, confirmed}`. La relève = `defi_apply(p_game_id, p_partner_id)` (candidature `pending`) puis le partenaire fait `defi_accept(p_app_id)` (course atomique). On NE touche PAS à `defi_apply`/`defi_accept` (Phase 1, en prod).
- **`current_player_id()`** côté SQL ; côté client on filtre par `player.id`.
- **Éligibilité** = moyenne ELO du binôme candidat ∈ `[min_elo, max_elo]`. Au LISTING (« À relever ») le partenaire n'est pas encore choisi → on **n'applique pas** de filtre dur d'éligibilité ; on AFFICHE la bande (plancher→plafond) et on laisse `defi_apply` rejeter côté serveur si hors bande (erreur `binome out of level band`). (Le filtre fin par binôme = Phase 3b.)
- **Pas de régression** : le hub reste l'écran de l'onglet « Défi » de la navbar ; garder le header sombre, `HeaderActions`, le toast, le `RefreshControl`.
- **`challenges` (ancienne table)** : on **arrête de la lire** ici. La table reste en base (nettoyage `lib/challenges.ts` = Phase 5).
- **Sides** : Team A = `A_GAU`/`A_DRO` (créateur + partenaire), Team B = `B_GAU`/`B_DRO` (binôme qui relève).

---

### Task 1 : Couche données `lib/defis.ts`

**Files:**
- Create: `react-matchup/lib/defis.ts`

**Interfaces:**
- Produces (types + fonctions) :
  - `DefiGame` (open_game enrichie : creator, participants Team A/B, min_elo/max_elo, stake_multiplier, status).
  - `DefiApplication` (candidature : id, game, initiator, partner, status).
  - `fetchOpenDefis(playerId): Promise<DefiGame[]>` — défis `open` à relever (pas les miens, où je ne suis pas déjà engagé).
  - `fetchMyDefis(playerId): Promise<DefiGame[]>` — mes défis créés (`draft|open|confirmed`).
  - `fetchCandidaturesOnMyDefis(playerId): Promise<DefiApplication[]>` — candidatures `pending|locked` sur mes défis.
  - `fetchBinomeInvitations(playerId): Promise<DefiApplication[]>` — candidatures où je suis le partenaire invité, `pending`.
  - `applyToDefi(gameId, partnerId): Promise<string>` — RPC `defi_apply` → id de candidature.
  - `acceptBinomeInvitation(appId): Promise<string>` — RPC `defi_accept` → `'locked'`|`'too_late'`.
  - `binomeAvg(eloA, eloB): number` et `isBinomeEligible(eloA, eloB, minElo, maxElo): boolean`.

- [ ] **Step 1 : Écrire `lib/defis.ts`**

```ts
// react-matchup/lib/defis.ts
// Couche données UNIQUE du hub Défi 2v2 (modèle ouvert : open_games is_challenge
// + defi_applications + RPC defi_apply/defi_accept). Tout accès Supabase lié aux
// défis passe par ici — les écrans ne font pas de requête défi en direct.
import { supabase } from './supabase';

export interface DefiPlayer { id: string; name: string; elo_score: number; }
export interface DefiParticipant {
  id: string; player_id: string; status: string; team_side: string | null;
  player?: DefiPlayer | null;
}
export interface DefiGame {
  id: string; creator_id: string; status: string;
  is_challenge: boolean; stake_multiplier: number | null;
  min_elo: number | null; max_elo: number | null;
  match_date: string | null; location: string | null;
  creator?: DefiPlayer | null;
  participants?: DefiParticipant[] | null;
}
export interface DefiApplication {
  id: string; game_id: string; initiator_id: string; partner_id: string;
  status: string; created_at: string;
  initiator?: DefiPlayer | null; partner?: DefiPlayer | null;
  game?: DefiGame | null;
}

const GAME_COLS =
  'id, creator_id, status, is_challenge, stake_multiplier, min_elo, max_elo, match_date, location, ' +
  'creator:creator_id(id, name, elo_score), ' +
  'participants:game_participants(id, player_id, status, team_side, player:player_id(id, name, elo_score))';

// ── Helpers d'éligibilité (moyenne du binôme dans la bande du défi) ──
export function binomeAvg(eloA: number, eloB: number): number {
  return (eloA + eloB) / 2;
}
export function isBinomeEligible(eloA: number, eloB: number, minElo: number | null, maxElo: number | null): boolean {
  const avg = binomeAvg(eloA, eloB);
  return avg >= (minElo ?? 0) && avg <= (maxElo ?? 999999);
}

// ── À relever : défis OUVERTS d'autres joueurs où je ne suis pas déjà engagé ──
export async function fetchOpenDefis(playerId: string): Promise<DefiGame[]> {
  const { data, error } = await supabase
    .from('open_games')
    .select(GAME_COLS)
    .eq('is_challenge', true)
    .eq('status', 'open')
    .neq('creator_id', playerId)
    .order('match_date', { ascending: true });
  if (error) { console.warn('[defis] fetchOpenDefis', error); return []; }
  const rows = (data ?? []) as unknown as DefiGame[];
  // Exclure ceux où je suis déjà participant (créateur exclu par la requête).
  return rows.filter(g => !(g.participants ?? []).some(p => p.player_id === playerId));
}

// ── Mes défis : ceux que J'AI créés (draft/open/confirmed) ──
export async function fetchMyDefis(playerId: string): Promise<DefiGame[]> {
  const { data, error } = await supabase
    .from('open_games')
    .select(GAME_COLS)
    .eq('is_challenge', true)
    .eq('creator_id', playerId)
    .in('status', ['draft', 'open', 'confirmed'])
    .order('match_date', { ascending: true });
  if (error) { console.warn('[defis] fetchMyDefis', error); return []; }
  return (data ?? []) as unknown as DefiGame[];
}

const APP_COLS =
  'id, game_id, initiator_id, partner_id, status, created_at, ' +
  'initiator:initiator_id(id, name, elo_score), ' +
  'partner:partner_id(id, name, elo_score), ' +
  `game:game_id(${GAME_COLS})`;

// ── Candidatures sur MES défis (binômes qui postulent) ──
export async function fetchCandidaturesOnMyDefis(playerId: string): Promise<DefiApplication[]> {
  // 1) mes défis (ids) ; 2) candidatures liées. Deux étapes pour éviter un embed
  // filtré complexe côté PostgREST.
  const mine = await fetchMyDefis(playerId);
  const ids = mine.map(g => g.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('defi_applications')
    .select(APP_COLS)
    .in('game_id', ids)
    .in('status', ['pending', 'locked'])
    .order('created_at', { ascending: true });
  if (error) { console.warn('[defis] fetchCandidaturesOnMyDefis', error); return []; }
  return (data ?? []) as unknown as DefiApplication[];
}

// ── Invitations binôme : on m'a invité comme PARTENAIRE pour relever ──
export async function fetchBinomeInvitations(playerId: string): Promise<DefiApplication[]> {
  const { data, error } = await supabase
    .from('defi_applications')
    .select(APP_COLS)
    .eq('partner_id', playerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) { console.warn('[defis] fetchBinomeInvitations', error); return []; }
  return (data ?? []) as unknown as DefiApplication[];
}

// ── Mutations (RPC Phase 1) ──
export async function applyToDefi(gameId: string, partnerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('defi_apply', { p_game_id: gameId, p_partner_id: partnerId });
  if (error) throw error;
  return data as string; // id de la candidature
}
export async function acceptBinomeInvitation(appId: string): Promise<string> {
  const { data, error } = await supabase.rpc('defi_accept', { p_app_id: appId });
  if (error) throw error;
  return data as string; // 'locked' | 'too_late'
}
```

- [ ] **Step 2 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur.

- [ ] **Step 3 : Commit**

```bash
git add react-matchup/lib/defis.ts
git commit -m "feat(defi): couche données lib/defis.ts (hub : open défis, mes défis, candidatures, invitations binôme + RPC)"
```

---

### Task 2 : Hub — coquille 4 sections branchée sur `lib/defis.ts`

**Files:**
- Modify: `react-matchup/app/(tabs)/matchmaking.tsx`

**Interfaces:**
- Consumes: tout `lib/defis.ts` (Task 1).
- Produces: un écran à 4 onglets (`relever | mes | candidatures | invitations`) ; états `openDefis`, `myDefis`, `candidatures`, `binomeInvites` ; un `fetchData` qui peuple les 4 via `Promise.all` ; badges (nb candidatures, nb invitations).

- [ ] **Step 1 : Remplacer le type d'onglet + les états de fetch**

Dans `react-matchup/app/(tabs)/matchmaking.tsx` :
- ligne 24 : `type Tab = 'relever' | 'mes' | 'candidatures' | 'invitations';`
- Remplacer les états liés au 1v1 (`suggestions`, `incoming`, `challengedIds`, `compatMap`, `incomingCompatMap`) par :

```ts
  const [openDefis, setOpenDefis] = useState<DefiGame[]>([]);
  const [myDefis, setMyDefis] = useState<DefiGame[]>([]);
  const [candidatures, setCandidatures] = useState<DefiApplication[]>([]);
  const [binomeInvites, setBinomeInvites] = useState<DefiApplication[]>([]);
```
- `const [tab, setTab] = useState<Tab>('relever');`
- Ajouter l'import : `import { fetchOpenDefis, fetchMyDefis, fetchCandidaturesOnMyDefis, fetchBinomeInvitations, acceptBinomeInvitation, applyToDefi, type DefiGame, type DefiApplication } from '../../lib/defis';`

- [ ] **Step 2 : Réécrire `fetchData`**

Remplacer tout le corps de `fetchData` (lignes ~449-515) par :

```ts
  const fetchData = useCallback(async () => {
    if (!player) return;
    setLoading(true);
    const [open, mine, cands, invites] = await Promise.all([
      fetchOpenDefis(player.id),
      fetchMyDefis(player.id),
      fetchCandidaturesOnMyDefis(player.id),
      fetchBinomeInvitations(player.id),
    ]);
    setOpenDefis(open);
    setMyDefis(mine);
    setCandidatures(cands);
    setBinomeInvites(invites);
    setLoading(false);
  }, [player]);
```

Supprimer `handleAction` (1v1) et `sortedSuggestions` ; supprimer les imports devenus inutiles (`isReceivedChallengeVisible`, `Challenge`, `getPlayerGameData`/`computeCompatDetail` si plus utilisés — vérifier avant de retirer, certains servent à Phase 3b ; en cas de doute, garder l'import et laisser un TODO). Garder `getHiddenPlayerIds` si réutilisé, sinon retirer.

- [ ] **Step 3 : Remplacer la barre d'onglets (4 onglets + badges)**

Remplacer le tableau d'onglets (lignes ~636-638) par :

```tsx
          {([
            { id: 'relever' as Tab,      label: 'À relever',   badge: 0 },
            { id: 'mes' as Tab,          label: 'Mes défis',   badge: 0 },
            { id: 'candidatures' as Tab, label: 'Candidat.',   badge: candidatures.filter(c => c.status === 'pending').length },
            { id: 'invitations' as Tab,  label: 'Binôme',      badge: binomeInvites.length },
          ]).map(t => {
```

(le reste du `.map` — rendu d'un onglet actif/inactif + badge — est inchangé.)

- [ ] **Step 4 : Remplacer le contenu des sections**

Remplacer les deux blocs `{tab === 'suggestions' && ...}` / `{tab === 'defis' && ...}` (lignes ~667-693) par les 4 sections. Pour cette Phase 3a, des cartes simples (le raffinement = 3b) :

```tsx
            {tab === 'relever' && (
              openDefis.length === 0
                ? <EmptyCard icon="swords" title="Aucun défi à relever" sub="Reviens plus tard, ou lance le tien." />
                : <View style={{ gap: 10 }}>
                    {openDefis.map(g => (
                      <DefiReleverCard key={g.id} game={g} myElo={player.elo_score}
                        onRelever={() => handleRelever(g)} />
                    ))}
                  </View>
            )}
            {tab === 'mes' && (
              myDefis.length === 0
                ? <EmptyCard icon="swords" title="Aucun défi créé" sub="Lance un défi depuis le bouton Créer." />
                : <View style={{ gap: 10 }}>
                    {myDefis.map(g => <MyDefiCard key={g.id} game={g} />)}
                  </View>
            )}
            {tab === 'candidatures' && (
              candidatures.length === 0
                ? <EmptyCard icon="users" title="Aucune candidature" sub="Les binômes qui relèvent tes défis apparaîtront ici." />
                : <View style={{ gap: 10 }}>
                    {candidatures.map(c => <CandidatureCard key={c.id} app={c} />)}
                  </View>
            )}
            {tab === 'invitations' && (
              binomeInvites.length === 0
                ? <EmptyCard icon="users" title="Aucune invitation" sub="Quand un joueur t'invite comme binôme pour relever un défi, c'est ici." />
                : <View style={{ gap: 10 }}>
                    {binomeInvites.map(c => <BinomeInviteCard key={c.id} app={c} onAccept={() => handleAcceptBinome(c)} />)}
                  </View>
            )}
```

- [ ] **Step 5 : Ajouter les 4 composants de carte + 2 handlers**

Avant `export default function MatchmakingScreen()`, ajouter quatre composants de carte concis (réutiliser `PlayerAvatar`, `Pill`, `eloToLevel`, `sty.card`, `Colors`, `Fonts`, `Icon`). Squelette à compléter avec le style maison existant :

```tsx
function bandLabel(g: DefiGame): string {
  const lo = g.min_elo != null ? eloToLevel(g.min_elo).toFixed(1) : '?';
  const hi = g.max_elo != null ? eloToLevel(g.max_elo).toFixed(1) : '?';
  return `Moy. ${lo} → ${hi}`;
}

function DefiReleverCard({ game, myElo, onRelever }: { game: DefiGame; myElo: number; onRelever: () => void; }) {
  const teamA = (game.participants ?? []).filter(p => (p.team_side ?? '').startsWith('A') || p.player_id === game.creator_id);
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <PlayerAvatar name={game.creator?.name ?? '?'} size={34} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
              {game.creator?.name ?? '?'} & {teamA.find(p => p.player_id !== game.creator_id)?.player?.name ?? '—'}
            </Text>
            <Text style={{ fontSize: 10.5, color: Colors.textMuted }}>{bandLabel(game)}</Text>
          </View>
          <Pill variant="ink">⚡ ×{(game.stake_multiplier ?? 1).toFixed(1)}</Pill>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {game.location ? <Pill variant="info">{game.location}</Pill> : null}
          {game.match_date ? <Pill variant="brand">{new Date(game.match_date).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</Pill> : null}
        </View>
        <TouchableOpacity onPress={onRelever} style={[sty.actionBtn, { backgroundColor: Colors.primary }]}>
          <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Relever — choisir mon binôme</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MyDefiCard({ game }: { game: DefiGame }) {
  const label = game.status === 'draft' ? '⏳ Brouillon (partenaire pas encore OK)'
    : game.status === 'open' ? '🟢 Ouvert — en attente d\'un binôme'
    : '✅ Confirmé';
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 6 }}>
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{bandLabel(game)} · ⚡ ×{(game.stake_multiplier ?? 1).toFixed(1)}</Text>
        <Text style={{ fontSize: 11.5, color: Colors.textSecondary }}>{label}</Text>
        {game.location || game.match_date ? (
          <Text style={{ fontSize: 11, color: Colors.textMuted }}>
            {game.location ?? ''}{game.match_date ? ` · ${new Date(game.match_date).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function CandidatureCard({ app }: { app: DefiApplication }) {
  const locked = app.status === 'locked';
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <PlayerAvatar name={app.initiator?.name ?? '?'} size={32} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>
            {app.initiator?.name ?? '?'} & {app.partner?.name ?? '?'}
          </Text>
          <Text style={{ fontSize: 10.5, color: Colors.textMuted }}>{locked ? '🏁 Binôme retenu' : '⏳ En attente du partenaire'}</Text>
        </View>
        <Pill variant={locked ? 'success' : 'neutral'}>{locked ? 'Retenu' : 'Pending'}</Pill>
      </View>
    </View>
  );
}

function BinomeInviteCard({ app, onAccept }: { app: DefiApplication; onAccept: () => void; }) {
  return (
    <View style={sty.card}>
      <View style={{ padding: 14, gap: 8 }}>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textPrimary }}>
          {app.initiator?.name ?? '?'} t'invite comme binôme pour relever un défi
        </Text>
        {app.game ? <Text style={{ fontSize: 11, color: Colors.textMuted }}>{bandLabel(app.game)} · ⚡ ×{(app.game.stake_multiplier ?? 1).toFixed(1)}</Text> : null}
        <TouchableOpacity onPress={onAccept} style={[sty.actionBtn, { backgroundColor: Colors.brand }]}>
          <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>Accepter & verrouiller le binôme</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

Et dans le composant `MatchmakingScreen`, ajouter les deux handlers (le sélecteur de partenaire RICHE = Phase 3b ; ici un prompt minimal) :

```ts
  const handleRelever = (game: DefiGame) => {
    // Phase 3b : ouvrir un vrai sélecteur de partenaire (recherche + suggestions compat).
    // Phase 3a : on signale juste que l'action arrive.
    showToast('Choix du partenaire — bientôt (Phase 3b)');
  };

  const handleAcceptBinome = async (app: DefiApplication) => {
    try {
      const res = await acceptBinomeInvitation(app.id);
      showToast(res === 'locked' ? '✅ Binôme verrouillé — défi confirmé !' : '⏳ Trop tard : un autre binôme a pris la place');
      fetchData();
      reloadNotifs();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Action impossible.');
    }
  };
```

- [ ] **Step 6 : Sous-titre du header + badge `pendingCount`**

Mettre à jour `pendingCount` (ligne ~592) → `const pendingCount = binomeInvites.length + candidatures.filter(c => c.status === 'pending').length;` (sert au pastille du header). Garder le titre « Les Défis ».

- [ ] **Step 7 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur. Corriger tout import orphelin.

- [ ] **Step 8 : Commit**

```bash
git add react-matchup/app/(tabs)/matchmaking.tsx
git commit -m "feat(defi): hub Défi 4 sections (À relever / Mes défis / Candidatures / Binôme) sur lib/defis"
```

---

### Task 3 : Retrait du 1v1 mort (composants + helpers orphelins)

**Files:**
- Modify: `react-matchup/app/(tabs)/matchmaking.tsx`

**Interfaces:**
- Consumes: rien.
- Produces: fichier nettoyé — plus de `SuggestionCard`, `IncomingCard`, `SortToggle` (si inutilisé), ni des helpers de compat 1v1 devenus morts (les garder SEULEMENT s'ils servent au futur classement 3b — sinon retirer).

- [ ] **Step 1 : Retirer les composants 1v1 inutilisés**

Dans `react-matchup/app/(tabs)/matchmaking.tsx`, supprimer les fonctions désormais non référencées : `SuggestionCard` (~252), `IncomingCard` (~329). Vérifier qu'aucune référence ne subsiste (`grep`). Conserver `EmptyCard`, `PlayerAvatar`, `Pill`, `LeaguePill` (réutilisés).

- [ ] **Step 2 : Trancher sur le moteur de compat**

`scoreElo/scoreClubs/scoreDays/scoreSide`, `CompatRing`, `CompatBreakdown`, `SortToggle`, `compatTier` : ils servront au **classement de « À relever » + suggestions de partenaire en 3b**. **NE PAS les supprimer** ; mais s'ils provoquent un warning « unused » au typecheck, les marquer avec un commentaire `// réutilisé en Phase 3b (classement compat)` et, si nécessaire pour un build propre, les déplacer tels quels dans un fichier `lib/compat.ts` (extraction sans changement de logique). Décision déléguée à l'implémenteur selon ce que `tsc` exige ; documenter le choix dans le rapport.

- [ ] **Step 3 : Retirer les imports morts**

Retirer de `matchmaking.tsx` les imports devenus inutiles après le retrait (`isReceivedChallengeVisible`, `Challenge`, et tout helper de `lib/games`/`lib/community` qui n'est plus référencé). Lancer `tsc` pour les détecter.

- [ ] **Step 4 : Typecheck** — `cd react-matchup && npx tsc --noEmit` → zéro erreur, zéro import orphelin.

- [ ] **Step 5 : Commit**

```bash
git add react-matchup/app/(tabs)/matchmaking.tsx
git commit -m "refactor(defi): retrait du 1v1 mort du hub (SuggestionCard/IncomingCard), compat conservé pour 3b"
```

---

## Self-review (Phase 3a)

- **Couverture** : couche données isolée (Task 1) ✓ ; hub 4 sections branché (Task 2) ✓ ; flux accept binôme fonctionnel (`acceptBinomeInvitation`) ✓ ; retrait 1v1 (Task 3) ✓.
- **Reporté en 3b** : sélecteur de partenaire riche pour « Relever » (ici stub toast) ; classement par compatibilité de « À relever » + suggestions de partenaire ; surfaçage des invitations binôme dans le lobby « À venir » ; affichage du draft du créateur dans « Mes défis » est DÉJÀ couvert (fetchMyDefis inclut `draft`).
- **Risque** : `handleRelever` est un stub en 3a — « À relever » n'aboutit pas encore à une candidature tant que 3b n'est pas fait. C'est volontaire et borné ; à signaler à l'utilisateur. `defi_apply` reste appelable via `applyToDefi` (déjà exporté).
- **Pas de filtre d'éligibilité dur** au listing (assumé) ; `defi_apply` rejette hors bande côté serveur.

---

## Runbook Phase 3a

Aucune migration SQL (tout est client + RPC déjà en prod). Rebuild de l'app suffit. Dépend de : Phase 1 (RPC `defi_apply`/`defi_accept`) et Phase 2 (`draft`) appliquées.
