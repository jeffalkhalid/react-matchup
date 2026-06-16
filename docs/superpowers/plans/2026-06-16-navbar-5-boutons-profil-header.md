# Navbar 5 boutons + Profil en avatar d'en-tête — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ramener la navbar à 5 boutons (`Accueil · Activité · ⊕Créer · Défis · Chats`) et sortir Profil de la barre en un avatar d'en-tête présent sur chaque page principale.

**Architecture:** Un nouveau composant `ProfileAvatarButton` (avatar initiale → pousse `/player/[monId]`) est intégré dans l'en-tête des 5 écrans principaux. On retire de `_layout.tsx` les onglets `alertes` et `profile` et on réordonne. `profile.tsx` et `alertes.tsx` sont supprimés ; `PlayerProfile`/burger et `AlertsList` restent. Sur `main`, sans commit.

**Tech Stack:** React Native, expo-router, react-native-svg, TypeScript.

**Vérification :** `npx tsc --noEmit` depuis `c:\Users\jeffa\Bureau\Native\react-matchup` à chaque tâche + contrôle visuel Expo final. **Aucun commit, aucune commande git** (l'utilisateur commitera lui-même ; changements non commités en cours à ne pas toucher).

---

## Structure des fichiers

| Fichier | Action |
|---|---|
| `components/ProfileAvatarButton.tsx` | **Nouveau** — avatar rond initiale → push `/player/[monId]` |
| `app/(tabs)/_layout.tsx` | Réordonner en 5 onglets ; retirer `alertes` + `profile` ; nettoyer `IconBell`/`AvatarTabIcon`/`totalBadge`/`playerName` devenus inutiles |
| `app/(tabs)/profile.tsx` | **Supprimer** |
| `app/(tabs)/alertes.tsx` | **Supprimer** |
| `app/(tabs)/player/[id].tsx` | Retirer la prop `asTab` de `PlayerProfile` + l'usage `hideBack={asTab}` |
| `app/(tabs)/index.tsx` · `activite.tsx` · `lobby.tsx` · `matchmaking.tsx` · `chats.tsx` | Ajouter l'avatar en haut à droite de l'en-tête |

Ordre : Task 1 (avatar) → 2 (navbar) → 3 (suppressions + nettoyage routage) → 4 (intégration avatar dans les 5 en-têtes) → 5 (vérif).

---

## Task 1 : Composant `ProfileAvatarButton`

**Files:**
- Create: `components/ProfileAvatarButton.tsx`

- [ ] **Step 1 : Créer `components/ProfileAvatarButton.tsx`**

```tsx
import { TouchableOpacity, Text, ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { usePlayer } from '../hooks/usePlayer';
import { Colors, getLeague } from '../lib/theme';

// Avatar Profil affiché en haut à droite des écrans principaux.
// Tap → ouvre le profil complet de l'utilisateur (écran poussé, avec retour + burger).
export function ProfileAvatarButton({ size = 36, style }: { size?: number; style?: ViewStyle }) {
  const router = useRouter();
  const { player } = usePlayer();
  if (!player) return null;
  const league = getLeague(player.elo_score);
  const color = Colors.league[league];
  return (
    <TouchableOpacity
      onPress={() => router.push(`/player/${player.id}` as any)}
      activeOpacity={0.85}
      style={[{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: color, alignItems: 'center', justifyContent: 'center',
        borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)',
      }, style]}
    >
      <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: Math.round(size * 0.4) }}>
        {player.name.charAt(0).toUpperCase()}
      </Text>
    </TouchableOpacity>
  );
}
```

(`getLeague` et `Colors.league[league]` sont déjà utilisés ainsi dans l'ex-`profile.tsx`. Le fichier vit dans `components/`, d'où `../hooks/usePlayer` et `../lib/theme`.)

- [ ] **Step 2 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur.

---

## Task 2 : Navbar à 5 onglets (`app/(tabs)/_layout.tsx`)

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1 : Réordonner les onglets visibles et retirer `alertes` + `profile`**

Dans le `<Tabs>…</Tabs>`, remplacer la séquence actuelle des `Tabs.Screen` **visibles** (aujourd'hui : `index`, `matchmaking`, `activite`, `lobby`, `alertes`, `chats`, puis `profile`) par EXACTEMENT cet ordre, en supprimant les blocs `alertes` et `profile` :

```tsx
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ color }) => <IconHome color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="activite"
        options={{
          title: 'Activité',
          tabBarIcon: ({ color }) => <IconActivity color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="lobby"
        options={{
          title: '',
          tabBarLabel: () => null,
          tabBarButton: (props) => <CreateTabButton {...props} />,
        }}
      />
      <Tabs.Screen
        name="matchmaking"
        options={{
          title: 'Défi',
          tabBarBadge: challengeCount > 0 ? challengeCount : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.warning, fontSize: 9, minWidth: 16, height: 16 },
          tabBarIcon: ({ color }) => <IconSwords color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarBadge: chatBadge > 0 ? chatBadge : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.danger, fontSize: 9, minWidth: 16, height: 16 },
          tabBarIcon: ({ color }) => <IconMessage color={color} size={22} />,
        }}
      />
```

Conserver INCHANGÉS les écrans cachés qui suivent (ceux en `options={{ href: null }}` : `ranking`, `GameDetailsSheet`, `CreateWizard`, `player/[id]`, `notifications`, `admin`). **Ne pas** ajouter `profile` ni `alertes` aux écrans cachés (leurs fichiers sont supprimés en Task 3).

- [ ] **Step 2 : Nettoyer le code devenu mort**

Dans `app/(tabs)/_layout.tsx`, supprimer :
- le composant `IconBell` (n'était utilisé que par l'onglet `alertes`) ;
- le composant `AvatarTabIcon` (n'était utilisé que par l'onglet `profile`) ;
- la ligne `const totalBadge = challengeCount + chatBadge;` (n'alimentait que l'avatar de l'onglet `profile`) ;
- la ligne `const playerName = player?.name ?? 'P';` (idem) si elle n'est plus référencée.

Garder le reste : `IconHome`, `IconSwords`, `IconActivity`, `IconMessage`, `IconPlus`, `CreateTabButton`, le `useEffect` du badge chat (alimente toujours `chatBadge`), `challengeCount`, `chatBadge`.

- [ ] **Step 3 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur (ni symbole inutilisé `IconBell`/`AvatarTabIcon`/`totalBadge`/`playerName` restant).

---

## Task 3 : Supprimer les onglets Profil & Alertes + nettoyer le routage

**Files:**
- Delete: `app/(tabs)/profile.tsx`, `app/(tabs)/alertes.tsx`
- Modify: `app/(tabs)/player/[id].tsx`

- [ ] **Step 1 : Retirer la prop `asTab` de `PlayerProfile`**

Dans `app/(tabs)/player/[id].tsx`, à la déclaration du composant nommé :

```tsx
export function PlayerProfile({ id, asTab }: { id: string; asTab?: boolean }) {
```
la remplacer par :
```tsx
export function PlayerProfile({ id }: { id: string }) {
```

Puis dans le rendu de `<ProfileHeader …/>`, supprimer la ligne `hideBack={asTab}` (le header affichera donc toujours la flèche retour — cohérent, le profil est désormais toujours poussé). Laisser le wrapper par défaut `PlayerProfileScreen` inchangé (il rend déjà `<PlayerProfile id={id} />`).

- [ ] **Step 2 : Supprimer les deux fichiers d'onglet**

Supprimer `app/(tabs)/profile.tsx` et `app/(tabs)/alertes.tsx`.

(Sous Git Bash : `rm "app/(tabs)/profile.tsx" "app/(tabs)/alertes.tsx"` — **PAS** de `git rm`, pas de git du tout. Sinon, suppression via l'outil d'édition de fichiers.)

- [ ] **Step 3 : Vérifier l'absence de liens morts**

Chercher dans tout le projet les références aux routes supprimées :
```
grep -rn "(tabs)/profile\|/community/.*alertes\|(tabs)/alertes\|'/profile'\|\"/profile\"" app components lib hooks
```
Pour chaque occurrence d'une navigation vers `/(tabs)/profile` → la repointer vers `` `/player/${<idDuJoueurCourant>}` `` (profil complet poussé). Pour `/(tabs)/alertes` → repointer vers `/community/alerts`. (Le `AlertsList` reste utilisé par `app/community/alerts.tsx`, lui-même atteint depuis le hub Communauté — ne rien changer là.) S'il n'y a aucune référence, ne rien faire.

- [ ] **Step 4 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur ; aucune route fantôme `profile`/`alertes`.

---

## Task 4 : Intégrer l'avatar dans les 5 en-têtes

**Files:**
- Modify: `app/(tabs)/index.tsx`, `app/(tabs)/activite.tsx`, `app/(tabs)/lobby.tsx`, `app/(tabs)/matchmaking.tsx`, `app/(tabs)/chats.tsx`

Pour CHAQUE écran : importer le composant puis poser l'avatar en haut à droite de l'en-tête, **sans recouvrir** le contenu existant. LIRE l'en-tête de chaque fichier avant d'éditer (les structures diffèrent).

Import à ajouter en tête de chaque fichier (ajuster `./` si déjà importé) :
```tsx
import { ProfileAvatarButton } from '../../components/ProfileAvatarButton';
```

- [ ] **Step 1 : `matchmaking.tsx` (Défis) — emplacement inline existant**

L'en-tête (≈ ligne 575) a une rangée avec un emplacement droit dédié : `<View style={{ flex: 1, alignItems: 'flex-end' }}>` (≈ ligne 600, à côté du titre « Les Défis »). Y placer l'avatar comme enfant :
```tsx
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <ProfileAvatarButton />
          </View>
```
(Si ce `View` contient déjà un élément, ajouter l'avatar à côté dans une rangée `flexDirection:'row'` avec un `gap`.)

- [ ] **Step 2 : `activite.tsx` (Activité) — transformer l'en-tête titre en rangée**

L'en-tête est un `View` (fond `Colors.bgCard`) contenant le `Text` « Activité ». Le passer en rangée avec l'avatar à droite :
```tsx
      <View style={{
        paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 16,
        backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.border,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 18, color: Colors.textPrimary }}>Activité</Text>
        <ProfileAvatarButton size={34} />
      </View>
```

- [ ] **Step 3 : `index.tsx` (Accueil) — coin haut-droit, sans gêner la cloche**

L'en-tête (≈ lignes 592-618) a un logo PAG MATCH centré, dans le `View` racine `paddingTop: insets.top + 8`. L'Accueil possède aussi une **cloche de notifications**. LIRE l'en-tête, repérer la cloche ; placer l'avatar en haut à droite **à côté** de la cloche (pas par-dessus). Approche robuste : poser l'avatar en absolu dans le `View` racine de l'en-tête :
```tsx
        <ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 6, right: 14, zIndex: 20 }} />
```
Si une cloche occupe déjà ce coin, décaler l'avatar à sa gauche (augmenter `right`, ex. `right: 58`) pour les aligner côte à côte. Vérifier visuellement qu'aucun chevauchement ne subsiste.

- [ ] **Step 4 : `lobby.tsx` (Créer) — en-tête héros centré**

L'en-tête (≈ ligne 2435) est un héros sombre (`Colors.heroBg`, `paddingTop: insets.top + 10`) avec un titre « Le Lobby » centré. Poser l'avatar en absolu en haut à droite de ce `View` d'en-tête :
```tsx
        <ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 20 }} />
```
(L'insérer comme premier enfant du `View` d'en-tête héros.)

- [ ] **Step 5 : `chats.tsx` (Chats) — en-tête héros centré**

L'en-tête (≈ ligne 93) est un héros sombre avec `paddingTop: 56` (valeur en dur, pas `insets.top`) et un lockup de marque centré. Poser l'avatar en absolu en haut à droite de ce `View` d'en-tête :
```tsx
        <ProfileAvatarButton style={{ position: 'absolute', top: 50, right: 20, zIndex: 20 }} />
```
(Premier enfant du `View` d'en-tête héros.)

- [ ] **Step 6 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur.

---

## Task 5 : Vérification visuelle (Expo)

**Files:** aucun (contrôle manuel)

- [ ] **Step 1 : Lancer** — `npx expo start`, ouvrir l'app.

- [ ] **Step 2 : Checklist navbar**
  - [ ] 5 boutons : `Accueil · Activité · ⊕Créer · Défis · Chats`, dans cet ordre.
  - [ ] Le bouton Créer est centré et surélevé (2 onglets de chaque côté).
  - [ ] Badges : Défi (défis reçus) et Chats (non-lus) présents ; plus d'avatar/badge Profil dans la barre.
  - [ ] Plus d'onglet Alertes.

- [ ] **Step 3 : Checklist avatar Profil**
  - [ ] Un avatar (initiale, couleur de ligue) est en haut à droite de : Accueil, Activité, Créer/lobby, Défis, Chats — sans recouvrir le contenu existant (logo, cloche…).
  - [ ] Tap sur l'avatar → ouvre le profil complet (header sombre + onglets) avec **flèche retour** et burger ☰.
  - [ ] Le profil d'un autre joueur (tap sur un avatar ailleurs) reste inchangé.

- [ ] **Step 4 : Checklist routage**
  - [ ] Aucun écran ne casse en tentant d'ouvrir `/(tabs)/profile` ou `/(tabs)/alertes`.
  - [ ] Les Alertes restent atteignables via Accueil → Communauté → Alertes.

---

## Critères de réussite (rappel spec)

1. Navbar 5 boutons, ordre exact, Créer centré surélevé. ✔ Task 2
2. Alertes & Profil hors barre ; Alertes via le hub Communauté. ✔ Tasks 2-3
3. Avatar Profil (initiale, sans badge) en haut à droite des 5 écrans ; tap → profil poussé + retour + burger. ✔ Tasks 1,4
4. Aucun lien mort vers `/(tabs)/profile` / `/(tabs)/alertes`. ✔ Task 3
5. Profil (moi & autre joueur) fonctionne comme avant. ✔ Task 3 + vérif Task 5
6. `tsc` passe. ✔ Steps de vérif
