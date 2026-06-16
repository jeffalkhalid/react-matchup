# Profil direct + menu burger — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'onglet Profil ouvre directement le profil complet de l'utilisateur ; tout l'ancien menu est rangé dans un burger ☰ dans le header (vue « moi »).

**Architecture:** On scinde `player/[id].tsx` en un wrapper de route (`default`, lit l'`id` de l'URL) + un export nommé `PlayerProfile({ id, asTab })` réutilisable. `profile.tsx` devient un onglet mince qui rend `<PlayerProfile id={monId} asTab />`. Le header gagne un burger (vue self) qui ouvre une feuille `ProfileMenuSheet` ; les modals « Qui peut commenter » et « Supprimer le compte » sont extraits dans `AccountModals.tsx`. Changement sur `main`, sans commit.

**Tech Stack:** React Native, expo-router, react-native-svg, TypeScript.

**Vérification :** pas de tests unitaires de rendu → chaque tâche se vérifie par `npx tsc --noEmit` depuis `c:\Users\jeffa\Bureau\Native\react-matchup`. **Aucun commit, aucune commande git** (consigne utilisateur ; changements non commités en cours à ne pas toucher).

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `components/profile/AccountModals.tsx` | **Nouveau** — `CommentsPolicyModal` + `DeleteAccountModal` (extraits de `profile.tsx`) |
| `components/profile/ProfileMenuSheet.tsx` | **Nouveau** — la feuille (overlay bas) du menu burger |
| `components/profile/components.tsx` | `ProfileHeader` : self → ↗ + ☰ ; prop `hideBack` |
| `app/(tabs)/player/[id].tsx` | Scinder en wrapper `default` + `PlayerProfile({id,asTab})` ; brancher le burger + monter les modals |
| `app/(tabs)/profile.tsx` | Remplacer tout par le wrapper d'onglet mince |

Ordre des tâches : 1 (modals extraits) → 2 (header) → 3 (sheet) → 4 (split + câblage) → 5 (profile.tsx) → 6 (vérif). Les tâches 1-3 sont indépendantes ; 4 dépend de 1+2+3 ; 5 dépend de 4.

---

## Task 1 : Extraire les modals de compte

**Files:**
- Create: `components/profile/AccountModals.tsx`

- [ ] **Step 1 : Créer `components/profile/AccountModals.tsx`**

Copie verbatim des deux modals depuis `app/(tabs)/profile.tsx` (fonctions `DeleteAccountModal` et `CommentsPolicyModal`), avec les imports nécessaires. Le composant vit sous `components/profile/`, donc `Colors`/`Fonts` viennent de `../../lib/theme` et `supabase` de `../../lib/supabase`.

```tsx
import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator } from 'react-native';
import { Alert } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Colors, Fonts } from '../../lib/theme';

// ─── Delete account modal ─────────────────────────────────────
export function DeleteAccountModal({ visible, onClose, playerName, onConfirm }: {
  visible: boolean; onClose: () => void; playerName: string; onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try { await onConfirm(); } catch { Alert.alert('Erreur', 'La suppression a échoué. Contacte le support.'); }
    setDeleting(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: Colors.bgCard, borderRadius: 24, padding: 24, width: '100%', maxWidth: 360 }}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 24 }}>🗑️</Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '900', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8, fontFamily: Fonts.uiBlack }}>Supprimer mon compte</Text>
          <Text style={{ fontSize: 13, color: Colors.textSecondary, fontWeight: '500', textAlign: 'center', marginBottom: 20 }}>
            Cette action est <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>irréversible</Text>. Ton profil, tes matchs et tes badges seront définitivement supprimés.
          </Text>
          <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Tape ton pseudo pour confirmer
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={playerName}
            placeholderTextColor="#cbd5e1"
            style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, padding: 12, fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 20 }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, backgroundColor: Colors.bgCardAlt, borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: Colors.textSecondary }}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} disabled={confirmText !== playerName || deleting}
              style={{ flex: 2, backgroundColor: Colors.danger, borderRadius: 12, padding: 14, alignItems: 'center', opacity: confirmText !== playerName || deleting ? 0.4 : 1 }}>
              {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>Supprimer définitivement</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Comments policy modal ────────────────────────────────────
export function CommentsPolicyModal({ visible, onClose, player, onSaved }: {
  visible: boolean; onClose: () => void; player: any; onSaved: () => void;
}) {
  const options: { key: 'everyone' | 'friends' | 'nobody'; label: string; sub: string }[] = [
    { key: 'everyone', label: 'Tout le monde', sub: 'Tous les joueurs peuvent commenter.' },
    { key: 'friends', label: 'Amis', sub: 'Seuls tes amis (suivis dans un sens) peuvent commenter.' },
    { key: 'nobody', label: 'Personne', sub: 'Personne ne peut commenter tes activités.' },
  ];
  const current = (player?.comments_policy ?? 'friends') as 'everyone' | 'friends' | 'nobody';

  const choose = async (key: 'everyone' | 'friends' | 'nobody') => {
    const { error } = await supabase.from('players').update({ comments_policy: key }).eq('id', player.id);
    if (error) { Alert.alert('Erreur', "Le réglage n'a pas pu être enregistré."); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}
          style={{ backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary, marginBottom: 4 }}>
            Qui peut commenter mes activités
          </Text>
          <View style={{ marginTop: 10, gap: 8 }}>
            {options.map(o => {
              const on = o.key === current;
              return (
                <TouchableOpacity key={o.key} onPress={() => choose(o.key)} activeOpacity={0.8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: on ? Colors.primary : Colors.border, backgroundColor: on ? Colors.primary + '12' : Colors.bgCard }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>{o.label}</Text>
                    <Text style={{ fontFamily: Fonts.ui, fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>{o.sub}</Text>
                  </View>
                  {on && <Text style={{ fontSize: 16, color: Colors.primary }}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
```

- [ ] **Step 2 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur (le fichier est autonome).

---

## Task 2 : `ProfileHeader` — burger ☰ (self) + `hideBack`

**Files:**
- Modify: `components/profile/components.tsx`

- [ ] **Step 1 : Ajouter la prop `hideBack`**

Dans la signature de `ProfileHeader` (ligne ~443), ajouter `hideBack?: boolean;` au type props :

```tsx
  onToggleFollow: () => void; onBack: () => void; onMenu: () => void; onEdit: () => void;
  onShareProfile: () => void; onDefier: () => void;
  hideBack?: boolean;
  tab: TabName; setTab: (t: TabName) => void; topInset: number;
```

- [ ] **Step 2 : Masquer la flèche retour quand `hideBack`**

Remplacer le bloc du bouton retour (ligne ~454-456) :

```tsx
          <TouchableOpacity onPress={props.onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M15 18l-6-6 6-6" /></Svg>
          </TouchableOpacity>
```

par :

```tsx
          {!props.hideBack && (
            <TouchableOpacity onPress={props.onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M15 18l-6-6 6-6" /></Svg>
            </TouchableOpacity>
          )}
```

- [ ] **Step 3 : Coin self = Partager + Burger (retirer l'icône Modifier)**

Remplacer le bloc des actions self (ligne ~463-471, la branche `isSelf ? (...)` du coin haut-droit, càd le fragment contenant `onShareProfile` puis `onEdit`) :

```tsx
          {isSelf ? (
            <>
              <TouchableOpacity onPress={props.onShareProfile} style={iconBtn}>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" /><Circle cx={12} cy={13} r={3.6} /></Svg>
              </TouchableOpacity>
              <TouchableOpacity onPress={props.onEdit} style={iconBtn}>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Svg>
              </TouchableOpacity>
            </>
          ) : (
```

par (Partager conservé, Modifier remplacé par le burger ☰ qui appelle `onMenu`) :

```tsx
          {isSelf ? (
            <>
              <TouchableOpacity onPress={props.onShareProfile} style={iconBtn}>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" /><Circle cx={12} cy={13} r={3.6} /></Svg>
              </TouchableOpacity>
              <TouchableOpacity onPress={props.onMenu} style={iconBtn}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Line x1={3} y1={6} x2={21} y2={6} /><Line x1={3} y1={12} x2={21} y2={12} /><Line x1={3} y1={18} x2={21} y2={18} /></Svg>
              </TouchableOpacity>
            </>
          ) : (
```

(Le gros bouton « Modifier le profil » sous l'identité — branche `isSelf` ligne ~511 — reste inchangé, il continue d'utiliser `props.onEdit`. `Line` est déjà importé de `react-native-svg` dans ce fichier ; si l'éditeur signale `Line` manquant, l'ajouter à l'import `react-native-svg` existant.)

- [ ] **Step 4 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur.

---

## Task 3 : `ProfileMenuSheet` (feuille du burger)

**Files:**
- Create: `components/profile/ProfileMenuSheet.tsx`

- [ ] **Step 1 : Créer `components/profile/ProfileMenuSheet.tsx`**

Overlay positionné en bas (PAS un `Modal` RN, pour éviter le conflit modal-sur-modal quand on ouvre ensuite Edit/Comments/Delete). Monté comme frère du `ScrollView` dans `PlayerProfile`. Les navigations (Classement, Notifications, Admin, Légal) se font en interne via `useRouter` ; les actions qui ouvrent un modal (Modifier, Commenter, Supprimer) et la déconnexion sont des callbacks du parent.

```tsx
import { View, Text, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';

function Group({ title }: { title: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginHorizontal: 18, marginTop: 16, marginBottom: 4, fontFamily: Fonts.uiBlack }}>
      {title}
    </Text>
  );
}

function Row({ emoji, label, onPress, danger }: { emoji: string; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 18 }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: danger ? '#fef2f2' : '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 15 }}>{emoji}</Text>
      </View>
      <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '700', color: danger ? '#ef4444' : Colors.textPrimary, fontFamily: Fonts.uiBold }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ProfileMenuSheet({ visible, onClose, isAdmin, onEdit, onComments, onLogout, onDelete }: {
  visible: boolean; onClose: () => void; isAdmin: boolean;
  onEdit: () => void; onComments: () => void; onLogout: () => void; onDelete: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  if (!visible) return null;

  // Navigation interne : on ferme la feuille puis on pousse l'écran.
  const nav = (path: string) => { onClose(); router.push(path as any); };
  // Action ouvrant un modal du parent : fermer la feuille d'abord (évite modal-sur-overlay résiduel).
  const act = (fn: () => void) => { onClose(); fn(); };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: insets.bottom + 12, maxHeight: '80%' }}>
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
        </View>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary, paddingHorizontal: 18, paddingTop: 8 }}>Menu</Text>

        <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
          <Group title="Compte" />
          <Row emoji="✏️" label="Modifier le profil" onPress={() => act(onEdit)} />
          <Row emoji="💬" label="Qui peut commenter" onPress={() => act(onComments)} />

          <Group title="Raccourcis" />
          <Row emoji="🏆" label="Classement" onPress={() => nav('/(tabs)/ranking')} />
          <Row emoji="🔔" label="Notifications" onPress={() => nav('/notifications')} />

          {isAdmin && (
            <>
              <Group title="Admin" />
              <Row emoji="🛡️" label="Panel Arbitre" onPress={() => nav('/admin')} />
            </>
          )}

          <Group title="Légal" />
          <Row emoji="🔒" label="Politique de confidentialité" onPress={() => nav('/legal/confidentialite')} />
          <Row emoji="📄" label="Conditions d'utilisation" onPress={() => nav('/legal/cgu')} />

          <View style={{ height: 1, backgroundColor: Colors.bgCardAlt, marginVertical: 10, marginHorizontal: 18 }} />
          <Row emoji="🚪" label="Se déconnecter" danger onPress={() => act(onLogout)} />
          <Row emoji="🗑️" label="Supprimer mon compte" danger onPress={() => act(onDelete)} />
        </ScrollView>
      </View>
    </View>
  );
}
```

- [ ] **Step 2 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur.

---

## Task 4 : Scinder `player/[id].tsx` + brancher le burger

**Files:**
- Modify: `app/(tabs)/player/[id].tsx`

- [ ] **Step 1 : Ajouter les imports**

Après la ligne 22 (`import { StatsTab, ... } from '../../../components/profile/tabs';`), ajouter :

```tsx
import { ProfileMenuSheet } from '../../../components/profile/ProfileMenuSheet';
import { CommentsPolicyModal, DeleteAccountModal } from '../../../components/profile/AccountModals';
```

- [ ] **Step 2 : Scinder le composant (wrapper de route + export nommé)**

Remplacer les lignes 585-589 :

```tsx
export default function PlayerProfileScreen() {
  const { id }           = useLocalSearchParams<{ id: string }>();
  const { player: self } = usePlayer();
  const router           = useRouter();
  const insets           = useSafeAreaInsets();
```

par :

```tsx
export default function PlayerProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PlayerProfile id={id} />;
}

export function PlayerProfile({ id, asTab }: { id: string; asTab?: boolean }) {
  const { player: self, signOut } = usePlayer();
  const router           = useRouter();
  const insets           = useSafeAreaInsets();
```

(Tout le corps existant suit, inchangé. `id` est désormais une prop ; `useLocalSearchParams` reste importé car utilisé par le wrapper.)

- [ ] **Step 3 : Ajouter les états du menu**

Juste après la ligne `const isSelf = self?.id === id;` (ligne ~624), ajouter :

```tsx
  const [menuOpen,     setMenuOpen]     = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [deleteOpen,   setDeleteOpen]   = useState(false);
```

- [ ] **Step 4 : Brancher le header (burger + hideBack)**

Dans le rendu de `<ProfileHeader .../>` (lignes ~1174-1193), modifier deux props :
- `onMenu={openModerationMenu}` → `onMenu={isSelf ? () => setMenuOpen(true) : openModerationMenu}`
- ajouter `hideBack={asTab}` (par ex. juste après `onBack={() => router.back()}`)

Résultat attendu pour ces lignes :

```tsx
        onBack={() => router.back()}
        hideBack={asTab}
        onMenu={isSelf ? () => setMenuOpen(true) : openModerationMenu}
        onEdit={openEdit}
```

- [ ] **Step 5 : Monter la feuille + les modals (vue self)**

Dans le bloc `{isSelf && ( <> ... </> )}` du « Story flow » (lignes ~1467-1486), ajouter À L'INTÉRIEUR du fragment, après `</StoryComposerV2>` et avant `</>`, les composants suivants :

```tsx
        <ProfileMenuSheet
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          isAdmin={!!self?.is_admin}
          onEdit={openEdit}
          onComments={() => setCommentsOpen(true)}
          onLogout={() => Alert.alert('Déconnexion', 'Tu vas être déconnecté.', [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Se déconnecter', style: 'destructive', onPress: signOut },
          ])}
          onDelete={() => setDeleteOpen(true)}
        />
        <CommentsPolicyModal
          visible={commentsOpen}
          onClose={() => setCommentsOpen(false)}
          player={profile}
          onSaved={onRefresh}
        />
        <DeleteAccountModal
          visible={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          playerName={profile.name}
          onConfirm={async () => {
            const { error } = await supabase.rpc('delete_my_account');
            if (error) { Alert.alert('Suppression impossible', error.message); return; }
            signOut();
          }}
        />
```

(`Alert`, `supabase`, `onRefresh`, `profile`, `signOut` sont tous déjà dans le scope du composant. `self.is_admin` : le type `Player` porte ce champ — utilisé tel quel ailleurs dans l'app.)

- [ ] **Step 6 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur. Vérifier en particulier que `signOut` existe bien sur le retour de `usePlayer` (il est utilisé dans `profile.tsx` via `const { player, refresh, signOut } = usePlayer()`).

---

## Task 5 : Amincir `app/(tabs)/profile.tsx`

**Files:**
- Modify: `app/(tabs)/profile.tsx`

- [ ] **Step 1 : Remplacer TOUT le fichier** par le wrapper d'onglet mince :

```tsx
import { usePlayer } from '../../hooks/usePlayer';
import { PlayerProfile } from './player/[id]';

// L'onglet Profil ouvre directement le profil complet de l'utilisateur courant.
// Tout l'ancien menu (réglages, légal, déconnexion…) vit désormais dans le burger
// du header de PlayerProfile (vue « moi »). Les modals Commentaires/Suppression ont
// été déplacés dans components/profile/AccountModals.tsx.
export default function ProfileTab() {
  const { player } = usePlayer();
  if (!player) return null;
  return <PlayerProfile id={player.id} asTab />;
}
```

- [ ] **Step 2 : Vérifier** — `npx tsc --noEmit`. Attendu : aucune nouvelle erreur. (Les anciens helpers `NavRow`/`NotifRow`/`EditProfileModal`/etc. disparaissent avec le remplacement du fichier ; s'assurer qu'aucun autre fichier ne les importait — ils étaient tous locaux à `profile.tsx`.)

---

## Task 6 : Vérification visuelle (Expo)

**Files:** aucun (contrôle manuel)

- [ ] **Step 1 : Lancer** — `npx expo start`, ouvrir l'app.

- [ ] **Step 2 : Checklist Profil = profil complet**
  - [ ] Taper l'onglet **Profil** ouvre directement le profil complet (header sombre + onglets Stats/Matchs/Palmarès/Badges), sans l'ancien hub.
  - [ ] L'icône **Profil** de la navbar reste **surlignée** quand on y est.
  - [ ] En vue « moi » : **pas** de flèche retour ; coin haut-droit = **↗ Partager + ☰ Burger**.

- [ ] **Step 3 : Checklist burger**
  - [ ] ☰ ouvre la feuille avec : Compte (Modifier, Qui peut commenter) · Raccourcis (Classement, Notifications) · Admin (si admin) · Légal (Confidentialité, CGU) · Se déconnecter · Supprimer mon compte.
  - [ ] Modifier le profil → ouvre le modal d'édition existant (et enregistre).
  - [ ] Qui peut commenter → ouvre le sélecteur et enregistre le choix.
  - [ ] Classement / Notifications / Panel Arbitre / Confidentialité / CGU → naviguent vers le bon écran.
  - [ ] Se déconnecter → confirmation puis déconnexion. Supprimer mon compte → modal de confirmation (saisie du pseudo) puis suppression.
  - [ ] Pas de bug d'empilement de modals (la feuille se ferme avant l'ouverture d'un modal).

- [ ] **Step 4 : Checklist non-régression (autre joueur)**
  - [ ] Ouvrir le profil d'un AUTRE joueur (tap sur un avatar) : flèche **retour** présente, kebab « … » de modération présent, boutons **Suivre/Défier** présents, **pas** de burger.
  - [ ] Les cartes de notifications n'apparaissent plus sur le profil.

---

## Critères de réussite (rappel spec)

1. Profil → profil complet direct, onglet surligné. ✔ Tasks 4-5
2. Self : ↗ + ☰, pas de retour ; autre joueur inchangé. ✔ Tasks 2,4
3. Burger avec les entrées validées + actions. ✔ Tasks 3-4
4. Cartes de notif retirées. ✔ Task 5 (ancien hub supprimé)
5. `profile.tsx` réduit ; pas de régression `player/[id]` autre joueur. ✔ Tasks 4-5,6
6. `tsc` passe. ✔ Steps de vérif
