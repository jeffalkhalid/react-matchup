# Commentaires d'activité — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activer les commentaires sur le fil d'activité de la Communauté, avec un réglage de profil global (qui peut commenter), une modération proactive légère (filtre de mots, rate-limit) et une notif à l'auteur.

**Architecture:** Écriture via RPC `SECURITY DEFINER` `add_activity_comment` (politique + blocage + rate-limit, miroir de `toggle_activity_reaction`). Réglage stocké dans `players.comments_policy`. Filtre de mots côté client (`lib/profanity.ts`) pour un refus instantané. UI : feuille de commentaires en route modale + réglage dans l'écran profil. Pas de runner de test → vérification manuelle (app + SQL editor Supabase), convention du repo.

**Tech Stack:** React Native / Expo Router, Supabase (Postgres + RPC plpgsql), TypeScript.

**Référence spec:** `docs/superpowers/specs/2026-06-05-commentaires-activite-design.md`

**Préalable git:** Tu es sur `main`. Crée la branche de travail avant la première tâche :
```bash
cd react-matchup
git checkout -b feat/activity-comments
```

---

### Task 1: Migration SQL — colonne `comments_policy`, RLS, RPC `add_activity_comment`

**Files:**
- Create: `react-matchup/supabase/migrations/activity_comments_rpc.sql`

- [ ] **Step 1: Écrire la migration**

Crée le fichier `react-matchup/supabase/migrations/activity_comments_rpc.sql` avec ce contenu exact :

```sql
-- Commentaires d'activité : réglage de politique + RPC d'écriture sécurisée.
-- S'appuie sur community_social.sql (activity_comments, current_player_id, follows)
-- et moderation.sql (user_blocks).
-- Migration appliquée à la main dans le SQL editor Supabase.

-- 1) Réglage global "qui peut commenter mes activités"
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS comments_policy text NOT NULL DEFAULT 'friends';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'players_comments_policy_chk'
  ) THEN
    ALTER TABLE public.players
      ADD CONSTRAINT players_comments_policy_chk
      CHECK (comments_policy IN ('everyone','friends','nobody'));
  END IF;
END $$;

-- 2) Fermer l'insertion directe : tout passe par l'RPC ci-dessous.
DROP POLICY IF EXISTS activity_comments_insert ON public.activity_comments;

-- 3) RPC d'écriture (miroir de toggle_activity_reaction).
CREATE OR REPLACE FUNCTION public.add_activity_comment(
  p_event_id uuid,
  p_content  text
)
RETURNS public.activity_comments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid;
  v_author  uuid;
  v_policy  text;
  v_text    text;
  v_count   int;
  v_result  public.activity_comments;
BEGIN
  v_me := public.current_player_id();
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not a registered player';
  END IF;

  v_text := btrim(p_content);
  IF char_length(v_text) < 1 OR char_length(v_text) > 500 THEN
    RAISE EXCEPTION 'invalid length';
  END IF;

  SELECT e.player_id, p.comments_policy
    INTO v_author, v_policy
  FROM public.activity_events e
  JOIN public.players p ON p.id = e.player_id
  WHERE e.id = p_event_id;

  IF v_author IS NULL THEN
    RAISE EXCEPTION 'event not found';
  END IF;

  -- Politique de l'auteur (l'auteur peut toujours commenter sa propre activité)
  IF v_me <> v_author THEN
    IF v_policy = 'nobody' THEN
      RAISE EXCEPTION 'comments disabled';
    ELSIF v_policy = 'friends' THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.follows
        WHERE (follower_id = v_me AND following_id = v_author)
           OR (follower_id = v_author AND following_id = v_me)
      ) THEN
        RAISE EXCEPTION 'not allowed to comment';
      END IF;
    END IF;
    -- 'everyone' : pas de contrôle

    -- Blocage bidirectionnel
    IF EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = v_me AND blocked_id = v_author)
         OR (blocker_id = v_author AND blocked_id = v_me)
    ) THEN
      RAISE EXCEPTION 'blocked';
    END IF;
  END IF;

  -- Rate-limit : 5 commentaires / 60 s par joueur
  SELECT count(*) INTO v_count
  FROM public.activity_comments
  WHERE player_id = v_me AND created_at > now() - interval '60 seconds';
  IF v_count >= 5 THEN
    RAISE EXCEPTION 'rate limited';
  END IF;

  INSERT INTO public.activity_comments (event_id, player_id, content)
  VALUES (p_event_id, v_me, v_text)
  RETURNING * INTO v_result;

  RETURN v_result;
END;
$$;
```

- [ ] **Step 2: Appliquer la migration dans Supabase**

Ouvre le SQL editor Supabase du projet et exécute le contenu du fichier.
Expected: exécution sans erreur ; `players` a une colonne `comments_policy` (défaut `'friends'`), la policy `activity_comments_insert` n'existe plus, la fonction `add_activity_comment` existe.

- [ ] **Step 3: Vérification manuelle (SQL editor)**

Exécute, en remplaçant par des ids réels (un event d'un joueur dont la politique est `friends`, en étant connecté comme un non-ami) :
```sql
SELECT public.add_activity_comment('<event_id>', 'GG bien joué !');
```
Expected:
- En tant qu'ami (ou auteur) : insère et renvoie la ligne.
- En tant que non-ami sur politique `friends` : `ERROR: not allowed to comment`.
- Politique `nobody` : `ERROR: comments disabled`.
- 6e appel en < 60 s : `ERROR: rate limited`.
- Contenu vide ou > 500 car. : `ERROR: invalid length`.

- [ ] **Step 4: Commit**

```bash
git add react-matchup/supabase/migrations/activity_comments_rpc.sql
git commit -m "feat(db): RPC add_activity_comment + comments_policy + RLS"
```

---

### Task 2: Type `ActivityComment`

**Files:**
- Modify: `react-matchup/types/index.ts` (après le bloc `ActivityEvent`, vers la ligne 202)

- [ ] **Step 1: Ajouter le type**

Dans `react-matchup/types/index.ts`, juste après la fermeture de l'interface `ActivityEvent` (ligne 202, après `}`), ajoute :

```ts
export type CommentsPolicy = 'everyone' | 'friends' | 'nobody';

export interface ActivityComment {
  id: string;
  event_id: string;
  player_id: string;
  content: string;
  created_at: string;
  // Hydraté côté client :
  actor?: Pick<Player, 'id' | 'name' | 'elo_score'>;
  league?: League;
}
```

- [ ] **Step 2: Vérifier la compilation des types**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur liée à `ActivityComment` / `CommentsPolicy`.

- [ ] **Step 3: Commit**

```bash
git add react-matchup/types/index.ts
git commit -m "feat(types): ActivityComment + CommentsPolicy"
```

---

### Task 3: Filtre de mots `lib/profanity.ts`

**Files:**
- Create: `react-matchup/lib/profanity.ts`

- [ ] **Step 1: Créer le filtre**

Crée `react-matchup/lib/profanity.ts` avec ce contenu (liste de base FR + darija translittérée — à enrichir plus tard) :

```ts
// Filtre de gros mots/insultes — base FR + darija (translittérée).
// Volontairement court : c'est une base de lancement, à enrichir selon le terrain.
// Côté client uniquement : sert au refus instantané avant l'appel RPC.

const BANNED = [
  // FR
  'connard', 'connasse', 'salope', 'pute', 'putain', 'enculé', 'enculer',
  'pd', 'pédé', 'tapette', 'batard', 'batarde', 'ntm', 'fdp', 'merde',
  'bouffon', 'abruti', 'debile', 'cretin',
  // darija / arabe translittéré
  'zamel', 'qahba', 'kahba', '9ahba', 'khra', '5ra', 'nik', 'niquer',
  'tabon', 'hmar', '7mar', 'mok', 'kelb',
];

// Normalise : minuscules, sans accents, leetspeak basique, lettres répétées compactées.
export function normalize(text: string): string {
  return text
    .toLowerCase()
    // accents -> base (caractères précomposés, sûrs sur Hermes)
    .replace(/[áàâäã]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
    .replace(/[óòôöõ]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c')
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 'h')
    .replace(/9/g, 'q')
    .replace(/\$/g, 's')
    .replace(/(.)\1{2,}/g, '$1$1') // "puuuute" -> "puute"
    .replace(/[^a-z\s]/g, ' ')     // ponctuation -> espace
    .replace(/\s+/g, ' ')
    .trim();
}

// true si le texte contient un terme banni (match sur mots normalisés).
export function containsProfanity(text: string): boolean {
  const norm = normalize(text);
  if (!norm) return false;
  const words = new Set(norm.split(' '));
  return BANNED.some((bad) => {
    const nb = normalize(bad);
    // mot isolé OU sous-chaîne accolée (ex: "vasympute")
    return words.has(nb) || norm.includes(nb);
  });
}
```

- [ ] **Step 2: Vérification manuelle (REPL rapide)**

Run: `cd react-matchup && node -e "const p=require('./lib/profanity.ts')" 2>/dev/null || true`
> Note : le fichier est en TS ; teste plutôt dans l'app au Task 6. Vérifie ici par lecture que `containsProfanity('GG bien joué')` retournerait `false` et `containsProfanity('connard')` / `containsProfanity('c0nnard')` / `containsProfanity('9ahba')` retourneraient `true`.

- [ ] **Step 3: Commit**

```bash
git add react-matchup/lib/profanity.ts
git commit -m "feat(moderation): base profanity filter (FR + darija)"
```

---

### Task 4: Couche données commentaires dans `lib/community.ts`

**Files:**
- Modify: `react-matchup/lib/community.ts` (imports en tête + ajout d'un bloc après `toggleReaction`, vers la ligne 203)

- [ ] **Step 1: Compléter les imports**

En tête de `react-matchup/lib/community.ts`, étends l'import de types pour inclure `ActivityComment` :

```ts
import type {
  Player, SocialPlayer, ActivityEvent, GameAlert, ReferralStats, League, ActivityComment,
} from '../types';
```

- [ ] **Step 2: Ajouter les fonctions de commentaires**

Juste après la fonction `toggleReaction` (après sa fermeture, vers la ligne 203), ajoute :

```ts
// ─── Commentaires d'activité ─────────────────────────────────

export type AddCommentResult =
  | { ok: true; comment: ActivityComment }
  | { ok: false; reason: 'policy' | 'blocked' | 'rate' | 'length' | 'unknown' };

function mapCommentError(message: string): AddCommentResult {
  const m = (message || '').toLowerCase();
  if (m.includes('disabled') || m.includes('not allowed')) return { ok: false, reason: 'policy' };
  if (m.includes('blocked')) return { ok: false, reason: 'blocked' };
  if (m.includes('rate')) return { ok: false, reason: 'rate' };
  if (m.includes('length')) return { ok: false, reason: 'length' };
  return { ok: false, reason: 'unknown' };
}

// Commentaires d'un événement (triés du plus ancien au plus récent), acteur hydraté.
export async function getComments(eventId: string): Promise<ActivityComment[]> {
  const { data: rows } = await supabase
    .from('activity_comments')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  const list = (rows ?? []) as ActivityComment[];
  if (list.length === 0) return [];

  const actorIds = [...new Set(list.map(c => c.player_id))];
  const { data: actors } = await supabase
    .from('players').select('id, name, elo_score').in('id', actorIds);
  const actorById = new Map((actors ?? []).map((a: any) => [a.id, a]));

  return list.map(c => {
    const actor: any = actorById.get(c.player_id);
    return {
      ...c,
      actor,
      league: actor ? (getLeague(actor.elo_score) as League) : 'discovery',
    };
  });
}

// Ajoute un commentaire via l'RPC sécurisée. Notifie l'auteur du post (sauf soi-même).
export async function addComment(eventId: string, content: string, me: Player): Promise<AddCommentResult> {
  const { data, error } = await supabase.rpc('add_activity_comment', {
    p_event_id: eventId, p_content: content,
  });
  if (error) { console.log('[addComment]', error.message); return mapCommentError(error.message); }

  const row = data as ActivityComment;
  const comment: ActivityComment = {
    ...row,
    actor: { id: me.id, name: me.name, elo_score: me.elo_score },
    league: getLeague(me.elo_score) as League,
  };

  // Notif auteur (fire-and-forget)
  const { data: ev } = await supabase
    .from('activity_events').select('player_id').eq('id', eventId).single();
  const authorId = (ev as any)?.player_id as string | undefined;
  if (authorId && authorId !== me.id) {
    notifyPlayers({
      playerIds: [authorId],
      title: `${me.name} a commenté ton activité`,
      body: content.slice(0, 80),
      data: { type: 'activity', eventId },
    });
  }

  return { ok: true, comment };
}

export async function deleteComment(id: string): Promise<void> {
  await supabase.from('activity_comments').delete().eq('id', id);
}
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 4: Commit**

```bash
git add react-matchup/lib/community.ts
git commit -m "feat(community): getComments / addComment / deleteComment"
```

---

### Task 5: Rendre le compteur 💬 cliquable dans `ActivityCard`

**Files:**
- Modify: `react-matchup/components/community/ActivityCard.tsx` (signature lignes 19-25 ; bloc commentaires lignes 126-131)

- [ ] **Step 1: Ajouter la prop `onPressComments`**

Dans `react-matchup/components/community/ActivityCard.tsx`, remplace la signature du composant (lignes 19-25) par :

```tsx
export function ActivityCard({ e, myId, onReact, onPressActor, onReport, onPressComments }: {
  e: ActivityEvent;
  myId: string;
  onReact: () => void;
  onPressActor?: () => void;   // ouvre le profil de l'acteur
  onReport?: () => void;       // signaler l'activité (absent si c'est la mienne)
  onPressComments?: () => void; // ouvre la feuille de commentaires
}) {
```

- [ ] **Step 2: Rendre le bloc 💬 tappable**

Remplace le bloc commentaires actuel (lignes 126-131, le `<View>` contenant l'`Icon name="message"`) par :

```tsx
        <TouchableOpacity onPress={onPressComments} disabled={!onPressComments} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="message" size={16} color={Colors.textMuted} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textMuted }}>
            {e.comment_count ?? 0}
          </Text>
        </TouchableOpacity>
```

- [ ] **Step 3: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 4: Commit**

```bash
git add react-matchup/components/community/ActivityCard.tsx
git commit -m "feat(community): make comment counter tappable in ActivityCard"
```

---

### Task 6: Écran feuille de commentaires + route

**Files:**
- Create: `react-matchup/app/community/comments/[eventId].tsx`
- Modify: `react-matchup/app/community/_layout.tsx`

- [ ] **Step 1: Enregistrer la route**

Dans `react-matchup/app/community/_layout.tsx`, ajoute la ligne `<Stack.Screen name="comments/[eventId]" />` après `<Stack.Screen name="invite" />` :

```tsx
      <Stack.Screen name="invite" />
      <Stack.Screen name="comments/[eventId]" />
```

- [ ] **Step 2: Créer l'écran**

Crée `react-matchup/app/community/comments/[eventId].tsx` :

```tsx
import { useCallback, useState } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../../hooks/usePlayer';
import { Colors, Fonts } from '../../../lib/theme';
import { getComments, addComment, deleteComment } from '../../../lib/community';
import { getHiddenPlayerIds, reportContent } from '../../../lib/moderation';
import { containsProfanity } from '../../../lib/profanity';
import { Avatar } from '../../../components/community/Avatar';
import { Icon } from '../../../components/community/icons';
import type { ActivityComment } from '../../../types';

const ERR: Record<string, string> = {
  policy: "L'auteur n'autorise pas ce commentaire.",
  blocked: 'Action impossible (blocage).',
  rate: 'Tu commentes trop vite, réessaie dans un instant.',
  length: 'Commentaire vide ou trop long (500 max).',
  unknown: "Le commentaire n'a pas pu être envoyé.",
};

export default function CommentsScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const myId = player?.id ?? '';

  const [comments, setComments] = useState<ActivityComment[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    if (!eventId || !myId) return;
    setLoading(true);
    Promise.all([getComments(String(eventId)), getHiddenPlayerIds(myId)]).then(([cs, hidden]) => {
      setComments(cs); setHiddenIds(hidden); setLoading(false);
    });
  }, [eventId, myId]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const send = async () => {
    const content = text.trim();
    if (!content || !player) return;
    if (containsProfanity(content)) {
      Alert.alert('Commentaire refusé', 'Ton commentaire enfreint les règles de la communauté.');
      return;
    }
    setSending(true);
    const res = await addComment(String(eventId), content, player);
    setSending(false);
    if (!res.ok) { Alert.alert('Oups', ERR[res.reason]); return; }
    setText('');
    setComments(prev => [...prev, res.comment]);
  };

  const removeMine = (c: ActivityComment) => {
    Alert.alert('Supprimer', 'Supprimer ton commentaire ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => { await deleteComment(c.id); setComments(prev => prev.filter(x => x.id !== c.id)); },
      },
    ]);
  };

  const report = (c: ActivityComment) => {
    Alert.alert('Ce commentaire', undefined, [
      {
        text: 'Signaler', style: 'destructive',
        onPress: async () => {
          try {
            await reportContent({ reporterId: myId, targetType: 'comment', targetId: c.id, reportedPlayerId: c.player_id });
            Alert.alert('Merci', 'Commentaire signalé à la modération.');
          } catch { Alert.alert('Erreur', "Le signalement n'a pas pu être envoyé."); }
        },
      },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const visible = comments.filter(c => !hiddenIds.has(c.player_id));

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
      <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
        {/* En-tête */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10 }}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85}
            style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronLeft" size={20} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 20, color: Colors.textPrimary, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            Commentaires
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
            {visible.length === 0 ? (
              <Text style={{ fontFamily: Fonts.ui, fontSize: 14, color: Colors.textSecondary, textAlign: 'center', marginTop: 30 }}>
                Sois le premier à commenter 🔥
              </Text>
            ) : visible.map(c => (
              <View key={c.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Avatar name={c.actor?.name} size={36} radius={11} league={c.league ?? 'discovery'} />
                <View style={{ flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, padding: 12 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textPrimary }}>
                      {c.actor?.name ?? 'Joueur'}
                    </Text>
                    <TouchableOpacity onPress={() => (c.player_id === myId ? removeMine(c) : report(c))} hitSlop={8}>
                      <Text style={{ fontSize: 16, color: Colors.textMuted, marginTop: -4 }}>⋯</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary, marginTop: 3 }}>
                    {c.content}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {/* Saisie */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg }}>
          <TextInput
            value={text} onChangeText={setText} placeholder="Écris un commentaire…"
            placeholderTextColor={Colors.textMuted} maxLength={500} multiline
            style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 110 }}
          />
          <TouchableOpacity onPress={send} disabled={sending || !text.trim()} activeOpacity={0.85}
            style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: text.trim() ? Colors.primary : Colors.bgCard, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            {sending
              ? <ActivityIndicator color={Colors.brand} />
              : <Icon name="arrowRight" size={18} color={text.trim() ? Colors.brand : Colors.textMuted} stroke={2.4} rotate={-45} />}
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
```

> Note : vérifie que l'icône `chevronLeft`, `message` et `arrowRight` existent dans `components/community/icons.tsx` (utilisées déjà ailleurs). Si `Avatar` n'accepte pas `league='discovery'`, c'est la valeur par défaut déjà utilisée dans `ActivityCard` — OK.

- [ ] **Step 3: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 4: Commit**

```bash
git add react-matchup/app/community/comments/[eventId].tsx react-matchup/app/community/_layout.tsx
git commit -m "feat(community): comments sheet screen + route"
```

---

### Task 7: Câbler l'ouverture des commentaires depuis le fil

**Files:**
- Modify: `react-matchup/app/community/friends.tsx` (rendu de `ActivityCard`, ligne 154)

- [ ] **Step 1: Passer `onPressComments`**

Dans `react-matchup/app/community/friends.tsx`, remplace la ligne 154 (le rendu `shown.map(...)`) par :

```tsx
          shown.map(e => <ActivityCard key={e.id} e={e} myId={myId} onReact={() => react(e.id)} onPressActor={() => router.push(`/player/${e.player_id}` as any)} onPressComments={() => router.push(`/community/comments/${e.id}` as any)} onReport={e.player_id === myId ? undefined : () => reportActivity(e)} />)
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 3: Vérification manuelle (app)**

Lance l'app (`npm run start`), ouvre Communauté → Mes amis. Tape le compteur 💬 d'une carte.
Expected: la feuille de commentaires s'ouvre ; un commentaire envoyé apparaît ; un gros mot (ex « connard ») est refusé avec le message communauté ; le compteur 💬 de la carte se met à jour au retour (focus).

- [ ] **Step 4: Commit**

```bash
git add react-matchup/app/community/friends.tsx
git commit -m "feat(community): open comments sheet from feed card"
```

---

### Task 8: Réglage de profil « Qui peut commenter mes activités »

**Files:**
- Modify: `react-matchup/app/(tabs)/profile.tsx` (section « Compte » vers ligne 244 ; état + modal)

- [ ] **Step 1: Ajouter l'état et la modale**

Dans `react-matchup/app/(tabs)/profile.tsx`, repère le composant principal (celui qui rend les `SectionHeader`/`NavRow` et possède `showEdit`/`showDelete`). Ajoute un état près des autres `useState` du composant :

```tsx
  const [showComments, setShowComments] = useState(false);
```

Puis, dans la section « Compte » (après le `<NavRow icon="✏️" label="Modifier le profil" … />`, ligne 246), ajoute une ligne :

```tsx
            <NavRow icon="💬" label="Qui peut commenter mes activités" onPress={() => setShowComments(true)} />
```

Et, à côté des autres modales rendues en bas du composant (près de `<EditProfileModal … />`), ajoute :

```tsx
      <CommentsPolicyModal visible={showComments} onClose={() => setShowComments(false)} player={player} onSaved={refresh} />
```

- [ ] **Step 2: Implémenter `CommentsPolicyModal`**

À la fin du fichier `react-matchup/app/(tabs)/profile.tsx` (avec les autres composants modaux comme `DeleteAccountModal`), ajoute :

```tsx
function CommentsPolicyModal({ visible, onClose, player, onSaved }: {
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

> Note : `Modal`, `Alert`, `supabase`, `Colors`, `Fonts` sont déjà importés dans ce fichier. `refresh` est la fonction de rechargement du joueur déjà utilisée par `EditProfileModal` (`onSaved={refresh}`). Vérifie que `usePlayer()` expose bien `comments_policy` sur l'objet `player` (il vient de `select('*')`) ; sinon, le défaut `'friends'` s'applique à l'affichage.

- [ ] **Step 3: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: pas de nouvelle erreur.

- [ ] **Step 4: Vérification manuelle (app)**

Profil → « Qui peut commenter mes activités » → choisis « Personne ». Depuis un autre compte (ou en SQL), tente un commentaire sur ton activité.
Expected: rejet `policy` (« L'auteur n'autorise pas ce commentaire »). Repasse à « Amis » → un ami peut commenter, un non-ami est refusé.

- [ ] **Step 5: Commit**

```bash
git add "react-matchup/app/(tabs)/profile.tsx"
git commit -m "feat(profile): comments_policy setting (everyone/friends/nobody)"
```

---

## Vérification finale (parcours manuel complet)

- [ ] Migration appliquée en prod Supabase (Task 1 step 2).
- [ ] Réglage `nobody` / `friends` / `everyone` respecté à l'envoi.
- [ ] Blocage : un joueur bloqué ne peut pas commenter ; ses commentaires existants sont masqués dans la feuille.
- [ ] Filtre de mots : refus + message communauté.
- [ ] Rate-limit : 6e commentaire en < 60 s refusé.
- [ ] Suppression de son propre commentaire ; signalement d'un commentaire d'autrui.
- [ ] Notif push reçue par l'auteur quand un autre joueur commente (tester avec 2 appareils — piège connu : token push par appareil).
- [ ] Compteur 💬 de la carte à jour au retour sur le fil.

## Hors périmètre (rappel spec)

File de modération admin, filtre de mots dupliqué côté SQL, notifs « thread », réponses imbriquées — différés.
