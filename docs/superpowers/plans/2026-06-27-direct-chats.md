# Chats 1-à-1 (messages directs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter des conversations privées 1-à-1 entre deux joueurs, indépendantes d'une partie, avec demande d'acceptation, confidentialité 3 niveaux et blocage.

**Architecture:** Tables Postgres dédiées (`direct_conversations`, `direct_messages`) + colonne `players.dm_privacy`, totalement séparées du chat de partie (`messages`) — additif, zéro régression. Les règles sensibles vivent dans des RPC `SECURITY DEFINER`. Le client RN ajoute un hook `useDirectChats`, un écran `app/dm/[conversationId].tsx`, des sous-sections dans l'onglet Chats, et un bouton « Message » sur le profil. Les notifications sont déclenchées côté client (fire-and-forget, comme le chat de partie via `notifyPlayers`).

**Tech Stack:** Expo / React Native + expo-router, Supabase (Postgres + RLS + Edge Function `send-push`), TypeScript.

## Global Constraints

- `players.id` = uuid ; `players.user_id` = text (= `auth.uid()::text`). Helper `public.current_player_id()` existe déjà.
- Écritures sensibles **toujours** via RPC `SECURITY DEFINER SET search_path = public` (cf. `toggle_message_reaction`).
- Migrations = fichiers SQL appliqués **à la main** dans le SQL editor Supabase (non timestampés). Wrapper en `BEGIN; … COMMIT;` + bloc `ROLLBACK` en commentaire.
- Format des réactions : `jsonb` `Record<emoji, player_ids[]>`, identique à `messages.reactions` — ne pas diverger.
- Vérification projet : `npx tsc --noEmit` (pas de jest), smoke queries SQL, puis vérif device Expo. Pas de commit auto — l'utilisateur commite lui-même ; les étapes « Commit » ci-dessous sont optionnelles et à exécuter seulement s'il le demande.
- Travailler sur `main`, changements additifs et réversibles. Ne PAS modifier la table `messages` ni l'écran `app/chat/[gameId].tsx`.
- Dépendance : `moderation.sql` (table `user_blocks`) doit être appliquée en prod avant livraison.

---

### Task 1: Migration backend `direct_chats.sql` (tables + RLS + RPC)

Crée tout le schéma et les règles serveur en une migration cohérente.

**Files:**
- Create: `supabase/migrations/direct_chats.sql`

**Interfaces:**
- Produces (consommés par le client en Task 2) :
  - Table `direct_conversations(id, requester_id, addressee_id, status, created_at, last_message_at, requester_last_read, addressee_last_read)`
  - Table `direct_messages(id, conversation_id, sender_id, content, created_at, reactions)`
  - Colonne `players.dm_privacy text` (`everyone` | `played` | `none`)
  - RPC `start_direct_conversation(p_addressee uuid, p_content text) → direct_conversations`
  - RPC `send_direct_message(p_conversation uuid, p_content text) → direct_messages`
  - RPC `respond_direct_request(p_conversation uuid, p_accept boolean) → direct_conversations`
  - RPC `toggle_direct_message_reaction(p_message_id uuid, p_emoji text) → direct_messages`

- [ ] **Step 1: Écrire la migration complète**

Create `supabase/migrations/direct_chats.sql` :

```sql
-- ============================================================
-- CHATS 1-À-1 (messages directs) — PagMatch
--
-- Canal de discussion privé entre DEUX joueurs, indépendant d'une partie.
-- Style "demande" (Instagram) : le 1er contact arrive en attente d'acceptation.
-- Confidentialité par joueur (players.dm_privacy) + blocage (user_blocks existant).
--
-- Conventions : players.id uuid ; current_player_id() (community_social.sql) ;
-- écritures sensibles via RPC SECURITY DEFINER ; réactions jsonb même forme que
-- messages.reactions. N'impacte PAS la table messages ni le chat de partie.
-- ============================================================
BEGIN;

-- 1) Confidentialité « qui peut m'envoyer une demande » -------------------
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS dm_privacy text NOT NULL DEFAULT 'everyone'
  CHECK (dm_privacy IN ('everyone','played','none'));

-- 2) Conversations --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.direct_conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id        uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  addressee_id        uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','accepted','declined')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_message_at     timestamptz,
  requester_last_read timestamptz,
  addressee_last_read timestamptz,
  CONSTRAINT direct_conv_no_self CHECK (requester_id <> addressee_id)
);

-- Une seule conversation par binôme, à vie (peu importe qui a initié).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_direct_conv_pair
  ON public.direct_conversations (least(requester_id, addressee_id),
                                  greatest(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS idx_direct_conv_requester ON public.direct_conversations (requester_id);
CREATE INDEX IF NOT EXISTS idx_direct_conv_addressee ON public.direct_conversations (addressee_id);

-- 3) Messages -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  content         text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  reactions       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_direct_messages_conv_created
  ON public.direct_messages (conversation_id, created_at DESC);

-- 4) Helper : suis-je membre de cette conversation ? ----------------------
CREATE OR REPLACE FUNCTION public.is_direct_member(p_conversation uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.direct_conversations c
    WHERE c.id = p_conversation
      AND public.current_player_id() IN (c.requester_id, c.addressee_id)
  )
$$;

-- 5) RLS ------------------------------------------------------------------
ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS direct_conv_select ON public.direct_conversations;
CREATE POLICY direct_conv_select ON public.direct_conversations
  FOR SELECT TO authenticated
  USING (requester_id = public.current_player_id()
      OR addressee_id = public.current_player_id());
-- last_read mis à jour par le membre (accusé de lecture) ; statut via RPC.
DROP POLICY IF EXISTS direct_conv_update ON public.direct_conversations;
CREATE POLICY direct_conv_update ON public.direct_conversations
  FOR UPDATE TO authenticated
  USING (requester_id = public.current_player_id()
      OR addressee_id = public.current_player_id())
  WITH CHECK (requester_id = public.current_player_id()
           OR addressee_id = public.current_player_id());
-- Pas d'INSERT direct : passe par start_direct_conversation().

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS direct_msg_select ON public.direct_messages;
CREATE POLICY direct_msg_select ON public.direct_messages
  FOR SELECT TO authenticated
  USING (public.is_direct_member(conversation_id));
-- Pas d'INSERT/UPDATE direct : passe par send_direct_message() /
-- toggle_direct_message_reaction() (SECURITY DEFINER).

-- 6) RPC : démarrer une conversation (1er contact = demande) ---------------
CREATE OR REPLACE FUNCTION public.start_direct_conversation(
  p_addressee uuid,
  p_content   text
)
RETURNS public.direct_conversations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_privacy text;
  v_conv    public.direct_conversations;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF v_me = p_addressee THEN RAISE EXCEPTION 'cannot DM yourself'; END IF;
  IF coalesce(btrim(p_content),'') = '' THEN RAISE EXCEPTION 'empty message'; END IF;

  -- Blocage dans un sens ou l'autre.
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = v_me AND b.blocked_id = p_addressee)
       OR (b.blocker_id = p_addressee AND b.blocked_id = v_me)
  ) THEN RAISE EXCEPTION 'blocked'; END IF;

  -- Confidentialité du destinataire.
  SELECT dm_privacy INTO v_privacy FROM public.players WHERE id = p_addressee;
  IF v_privacy = 'none' THEN RAISE EXCEPTION 'recipient does not accept messages'; END IF;
  IF v_privacy = 'played' AND NOT EXISTS (
    SELECT 1
    FROM public.game_participants a
    JOIN public.game_participants b ON a.game_id = b.game_id
    WHERE a.player_id = v_me AND b.player_id = p_addressee
  ) THEN RAISE EXCEPTION 'recipient only accepts messages from past partners'; END IF;

  -- Conversation déjà existante (dans un sens ou l'autre) → on la renvoie.
  SELECT * INTO v_conv FROM public.direct_conversations
  WHERE least(requester_id,addressee_id)    = least(v_me,p_addressee)
    AND greatest(requester_id,addressee_id) = greatest(v_me,p_addressee);
  IF FOUND THEN RAISE EXCEPTION 'conversation already exists'; END IF;

  INSERT INTO public.direct_conversations (requester_id, addressee_id, status, last_message_at)
  VALUES (v_me, p_addressee, 'pending', now())
  RETURNING * INTO v_conv;

  INSERT INTO public.direct_messages (conversation_id, sender_id, content)
  VALUES (v_conv.id, v_me, btrim(p_content));

  RETURN v_conv;
END;
$$;

-- 7) RPC : envoyer un message ---------------------------------------------
CREATE OR REPLACE FUNCTION public.send_direct_message(
  p_conversation uuid,
  p_content      text
)
RETURNS public.direct_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   uuid := public.current_player_id();
  v_conv public.direct_conversations;
  v_msg  public.direct_messages;
  v_count integer;
BEGIN
  IF v_me IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF coalesce(btrim(p_content),'') = '' THEN RAISE EXCEPTION 'empty message'; END IF;

  SELECT * INTO v_conv FROM public.direct_conversations WHERE id = p_conversation;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found'; END IF;
  IF v_me NOT IN (v_conv.requester_id, v_conv.addressee_id) THEN RAISE EXCEPTION 'not a member'; END IF;
  IF v_conv.status = 'declined' THEN RAISE EXCEPTION 'conversation declined'; END IF;

  -- Blocage (gel d'une conversation existante).
  IF EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = v_conv.requester_id AND b.blocked_id = v_conv.addressee_id)
       OR (b.blocker_id = v_conv.addressee_id AND b.blocked_id = v_conv.requester_id)
  ) THEN RAISE EXCEPTION 'blocked'; END IF;

  -- Tant que pending : seul le requester écrit, et UN seul message au total.
  IF v_conv.status = 'pending' THEN
    IF v_me <> v_conv.requester_id THEN
      RAISE EXCEPTION 'await acceptance';  -- le destinataire doit accepter d'abord
    END IF;
    SELECT count(*) INTO v_count FROM public.direct_messages WHERE conversation_id = p_conversation;
    IF v_count >= 1 THEN RAISE EXCEPTION 'request limited to one message'; END IF;
  END IF;

  INSERT INTO public.direct_messages (conversation_id, sender_id, content)
  VALUES (p_conversation, v_me, btrim(p_content))
  RETURNING * INTO v_msg;

  UPDATE public.direct_conversations SET last_message_at = now() WHERE id = p_conversation;
  RETURN v_msg;
END;
$$;

-- 8) RPC : accepter / refuser une demande ---------------------------------
CREATE OR REPLACE FUNCTION public.respond_direct_request(
  p_conversation uuid,
  p_accept       boolean
)
RETURNS public.direct_conversations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me   uuid := public.current_player_id();
  v_conv public.direct_conversations;
BEGIN
  SELECT * INTO v_conv FROM public.direct_conversations WHERE id = p_conversation;
  IF NOT FOUND THEN RAISE EXCEPTION 'conversation not found'; END IF;
  IF v_me <> v_conv.addressee_id THEN RAISE EXCEPTION 'only the addressee can respond'; END IF;
  IF v_conv.status <> 'pending' THEN RETURN v_conv; END IF;  -- idempotent

  UPDATE public.direct_conversations
  SET status = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END
  WHERE id = p_conversation
  RETURNING * INTO v_conv;
  RETURN v_conv;
END;
$$;

-- 9) RPC : toggle réaction (miroir toggle_message_reaction) ---------------
CREATE OR REPLACE FUNCTION public.toggle_direct_message_reaction(
  p_message_id uuid,
  p_emoji      text
)
RETURNS public.direct_messages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me    uuid := public.current_player_id();
  v_msg   public.direct_messages;
  v_ids   jsonb;
  v_has   boolean;
BEGIN
  SELECT * INTO v_msg FROM public.direct_messages WHERE id = p_message_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'message not found'; END IF;
  IF NOT public.is_direct_member(v_msg.conversation_id) THEN RAISE EXCEPTION 'not a member'; END IF;

  v_ids := coalesce(v_msg.reactions -> p_emoji, '[]'::jsonb);
  v_has := v_ids ? v_me::text;

  IF v_has THEN
    v_ids := (SELECT coalesce(jsonb_agg(e), '[]'::jsonb)
              FROM jsonb_array_elements_text(v_ids) e WHERE e <> v_me::text);
  ELSE
    v_ids := v_ids || to_jsonb(v_me::text);
  END IF;

  IF jsonb_array_length(v_ids) = 0 THEN
    v_msg.reactions := v_msg.reactions - p_emoji;
  ELSE
    v_msg.reactions := jsonb_set(v_msg.reactions, ARRAY[p_emoji], v_ids);
  END IF;

  UPDATE public.direct_messages SET reactions = v_msg.reactions WHERE id = p_message_id
  RETURNING * INTO v_msg;
  RETURN v_msg;
END;
$$;

COMMIT;

-- ROLLBACK :
--   DROP FUNCTION IF EXISTS public.toggle_direct_message_reaction(uuid,text);
--   DROP FUNCTION IF EXISTS public.respond_direct_request(uuid,boolean);
--   DROP FUNCTION IF EXISTS public.send_direct_message(uuid,text);
--   DROP FUNCTION IF EXISTS public.start_direct_conversation(uuid,text);
--   DROP FUNCTION IF EXISTS public.is_direct_member(uuid);
--   DROP TABLE IF EXISTS public.direct_messages;
--   DROP TABLE IF EXISTS public.direct_conversations;
--   ALTER TABLE public.players DROP COLUMN IF EXISTS dm_privacy;
```

- [ ] **Step 2: Appliquer la migration**

Coller le contenu dans Supabase → SQL Editor → Run. Attendu : `Success. No rows returned`.

- [ ] **Step 3: Smoke test SQL (vérifier les règles)**

Dans le SQL editor, avec deux `players` de test (remplacer les uuid) :

```sql
-- doit créer une conversation pending + 1 message
SELECT public.start_direct_conversation('<ADDRESSEE_UUID>', 'Salut, on joue ?');
-- 2e appel sur le même binôme → doit échouer "conversation already exists"
-- envoyer un 2e message en pending depuis le requester → "request limited to one message"
```
Attendu : 1er appel OK (1 ligne conv), `direct_messages` contient 1 ligne, doublon refusé.

- [ ] **Step 4: Commit (optionnel, sur demande)**

```bash
git add supabase/migrations/direct_chats.sql
git commit -m "feat(dm): schema + RLS + RPC pour les chats 1-a-1"
```

---

### Task 2: Couche données client `lib/directChats.ts`

Source unique des types + appels RPC + notifications (fire-and-forget), pour éviter les divergences d'état (cf. feedback_audit_state_divergences).

**Files:**
- Create: `react-matchup/lib/directChats.ts`
- Reference: `react-matchup/lib/notify.ts` (notifyPlayers), `react-matchup/lib/supabase.ts`

**Interfaces:**
- Consumes (Task 1) : RPC `start_direct_conversation`, `send_direct_message`, `respond_direct_request`, `toggle_direct_message_reaction`.
- Produces (Tasks 3-8) :
  - types `DirectConversation`, `DirectMessage`, `DmPrivacy`
  - `startDirectConversation(addresseeId, content, addresseeName, myName) → Promise<DirectConversation>`
  - `sendDirectMessage(conv, content, myName) → Promise<DirectMessage>`
  - `respondDirectRequest(conversationId, accept) → Promise<DirectConversation>`
  - `toggleDirectReaction(messageId, emoji) → Promise<DirectMessage>`
  - `fetchConversations() → Promise<DirectConversation[]>`
  - `fetchMessages(conversationId) → Promise<DirectMessage[]>`
  - `markConversationRead(conv) → Promise<void>`
  - `unreadFor(conv, myId) → number` (0/1 indicatif), `otherId(conv, myId)`, `isRequestFor(conv, myId)`

- [ ] **Step 1: Écrire le module**

Create `react-matchup/lib/directChats.ts` :

```ts
import { supabase } from './supabase';
import { notifyPlayers } from './notify';

export type DmPrivacy = 'everyone' | 'played' | 'none';
export type DirectStatus = 'pending' | 'accepted' | 'declined';

export interface DirectConversation {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: DirectStatus;
  created_at: string;
  last_message_at: string | null;
  requester_last_read: string | null;
  addressee_last_read: string | null;
}

export interface DirectMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  reactions: Record<string, string[]>;
}

export function otherId(conv: DirectConversation, myId: string): string {
  return conv.requester_id === myId ? conv.addressee_id : conv.requester_id;
}

// Une demande reçue = pending dont je suis le destinataire.
export function isRequestFor(conv: DirectConversation, myId: string): boolean {
  return conv.status === 'pending' && conv.addressee_id === myId;
}

// Non-lu indicatif (0/1) : dernier message plus récent que mon dernier read.
export function unreadFor(conv: DirectConversation, myId: string): number {
  const lastRead = conv.requester_id === myId ? conv.requester_last_read : conv.addressee_last_read;
  if (!conv.last_message_at) return 0;
  if (!lastRead) return 1;
  return new Date(conv.last_message_at).getTime() > new Date(lastRead).getTime() ? 1 : 0;
}

export async function fetchConversations(): Promise<DirectConversation[]> {
  const { data, error } = await supabase
    .from('direct_conversations')
    .select('*')
    .neq('status', 'declined')
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as DirectConversation[];
}

export async function fetchMessages(conversationId: string): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as DirectMessage[];
}

export async function startDirectConversation(
  addresseeId: string, content: string, _addresseeName: string, myName: string,
): Promise<DirectConversation> {
  const { data, error } = await supabase.rpc('start_direct_conversation', {
    p_addressee: addresseeId, p_content: content.trim().slice(0, 500),
  });
  if (error) throw error;
  const conv = data as DirectConversation;
  // Notif unique « [Nom] veut t'envoyer un message » (sans le contenu).
  notifyPlayers({
    playerIds: [addresseeId],
    title: `${myName} veut t'envoyer un message`,
    body: 'Touche pour voir la demande',
    data: { type: 'dm_request', conversationId: conv.id },
  });
  return conv;
}

export async function sendDirectMessage(
  conv: DirectConversation, content: string, myName: string,
): Promise<DirectMessage> {
  const { data, error } = await supabase.rpc('send_direct_message', {
    p_conversation: conv.id, p_content: content.trim().slice(0, 500),
  });
  if (error) throw error;
  const msg = data as DirectMessage;
  // Push normal uniquement si la conversation est acceptée.
  if (conv.status === 'accepted') {
    notifyPlayers({
      playerIds: [otherId(conv, msg.sender_id)],
      title: `💬 ${myName}`,
      body: content.length > 60 ? content.slice(0, 57) + '…' : content,
      data: { type: 'dm', conversationId: conv.id },
    });
  }
  return msg;
}

export async function respondDirectRequest(
  conversationId: string, accept: boolean,
): Promise<DirectConversation> {
  const { data, error } = await supabase.rpc('respond_direct_request', {
    p_conversation: conversationId, p_accept: accept,
  });
  if (error) throw error;
  return data as DirectConversation;
}

export async function toggleDirectReaction(messageId: string, emoji: string): Promise<DirectMessage> {
  const { data, error } = await supabase.rpc('toggle_direct_message_reaction', {
    p_message_id: messageId, p_emoji: emoji,
  });
  if (error) throw error;
  return data as DirectMessage;
}

export async function markConversationRead(conv: DirectConversation, myId: string): Promise<void> {
  const col = conv.requester_id === myId ? 'requester_last_read' : 'addressee_last_read';
  await supabase.from('direct_conversations')
    .update({ [col]: new Date().toISOString() })
    .eq('id', conv.id);
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS (aucune erreur dans `lib/directChats.ts`).

- [ ] **Step 3: Commit (optionnel)**

```bash
git add react-matchup/lib/directChats.ts
git commit -m "feat(dm): couche donnees client + notifications"
```

---

### Task 3: Hook `useDirectChats`

Charge les conversations (acceptées + demandes reçues), calcule les non-lus, et reste live via realtime.

**Files:**
- Create: `react-matchup/hooks/useDirectChats.ts`
- Reference: `react-matchup/hooks/useGameChats.ts` (modèle), `react-matchup/hooks/usePlayer.ts`

**Interfaces:**
- Consumes (Task 2) : `fetchConversations`, `unreadFor`, `isRequestFor`, types.
- Produces (Tasks 5-6) :
  - `useDirectChats()` → `{ conversations, requests, loading, totalUnread, requestsCount, load }`
  - où `conversations` = acceptées triées par `last_message_at` desc, `requests` = demandes reçues `pending`.

- [ ] **Step 1: Écrire le hook**

Create `react-matchup/hooks/useDirectChats.ts` :

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { usePlayer } from './usePlayer';
import {
  DirectConversation, fetchConversations, unreadFor, isRequestFor,
} from '../lib/directChats';

export function useDirectChats() {
  const { player } = usePlayer();
  const [all, setAll] = useState<DirectConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!player) return;
    if (!loadedRef.current) setLoading(true);
    try {
      setAll(await fetchConversations());
    } catch (e) {
      console.log('[useDirectChats] load failed', String(e));
    } finally {
      loadedRef.current = true;
      setLoading(false);
    }
  }, [player]);

  useEffect(() => { load(); }, [load]);

  // Realtime : tout changement de conversation/message → recharge (léger).
  useEffect(() => {
    if (!player) return;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase
      .channel(`direct-chats:${player.id}:${suffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'direct_conversations' }, () => load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [player, load]);

  const myId = player?.id ?? '';
  const requests = all.filter(c => isRequestFor(c, myId));
  const conversations = all.filter(c => c.status === 'accepted');
  const totalUnread = conversations.reduce((s, c) => s + unreadFor(c, myId), 0);

  return {
    conversations, requests, loading,
    totalUnread, requestsCount: requests.length, load,
  };
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit (optionnel)**

```bash
git add react-matchup/hooks/useDirectChats.ts
git commit -m "feat(dm): hook useDirectChats (live + non-lus)"
```

---

### Task 4: Écran de conversation 1-à-1 `app/dm/[conversationId].tsx`

Affiche l'historique, le bandeau « Demande » (Accepter / Refuser / Bloquer) tant que pending, et l'envoi de message (avec la règle « 1 seul message » appliquée serveur — le client désactive juste l'input quand il ne peut pas écrire).

**Files:**
- Create: `react-matchup/app/dm/[conversationId].tsx`
- Reference: `react-matchup/app/chat/[gameId].tsx` (styles bulles/réactions), `react-matchup/lib/theme.ts`, `react-matchup/lib/directChats.ts`

**Interfaces:**
- Consumes (Task 2) : `fetchMessages`, `sendDirectMessage`, `respondDirectRequest`, `markConversationRead`, types.
- Produces : route `/dm/[conversationId]` ouverte par Tasks 5 & 7.

- [ ] **Step 1: Écrire l'écran (minimal mais complet)**

Create `react-matchup/app/dm/[conversationId].tsx` :

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Spacing, FontSize, Radius, Fonts } from '../../lib/theme';
import {
  DirectConversation, DirectMessage, fetchMessages, sendDirectMessage,
  respondDirectRequest, markConversationRead, otherId, isRequestFor,
} from '../../lib/directChats';

export default function DirectChatScreen() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { player } = usePlayer();
  const router = useRouter();
  const [conv, setConv] = useState<DirectConversation | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const reload = useCallback(async () => {
    if (!conversationId || !player) return;
    const { data: c } = await supabase.from('direct_conversations').select('*').eq('id', conversationId).single();
    setConv((c as DirectConversation) ?? null);
    setMessages(await fetchMessages(conversationId));
    setLoading(false);
    if (c) markConversationRead(c as DirectConversation, player.id);
  }, [conversationId, player]);

  useEffect(() => { reload(); }, [reload]);

  // Realtime sur les messages de cette conversation.
  useEffect(() => {
    if (!conversationId || !player) return;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase
      .channel(`dm:${conversationId}:${suffix}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'direct_messages', filter: `conversation_id=eq.${conversationId}` },
        () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId, player, reload]);

  const myId = player?.id ?? '';
  const isIncomingRequest = conv ? isRequestFor(conv, myId) : false;
  // Le requester peut écrire 1 message en pending ; sinon il faut accepted.
  const canWrite = !!conv && (conv.status === 'accepted' ||
    (conv.status === 'pending' && conv.requester_id === myId && messages.length === 0));

  const onSend = async () => {
    if (!text.trim() || !player || !conv || sending || !canWrite) return;
    setSending(true);
    const content = text.trim();
    setText('');
    try {
      await sendDirectMessage(conv, content, player.name);
      await reload();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      console.log('[dm] send failed', String(e));
    } finally {
      setSending(false);
    }
  };

  const onRespond = async (accept: boolean) => {
    if (!conv) return;
    await respondDirectRequest(conv.id, accept);
    if (accept) reload(); else router.back();
  };

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={Colors.primary} /></View>;
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: Colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        contentContainerStyle={{ padding: Spacing.md, gap: 8 }}
        renderItem={({ item }) => {
          const mine = item.sender_id === myId;
          return (
            <View style={{
              alignSelf: mine ? 'flex-end' : 'flex-start',
              backgroundColor: mine ? Colors.primary : Colors.bgCard,
              borderRadius: Radius.lg, paddingHorizontal: 12, paddingVertical: 8, maxWidth: '80%',
            }}>
              <Text style={{ color: mine ? '#fff' : Colors.textPrimary, fontSize: FontSize.sm }}>{item.content}</Text>
            </View>
          );
        }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
      />

      {isIncomingRequest && (
        <View style={{ flexDirection: 'row', gap: 8, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border }}>
          <TouchableOpacity onPress={() => onRespond(true)} style={{ flex: 1, backgroundColor: Colors.primary, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Accepter</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onRespond(false)} style={{ flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: Colors.textPrimary, fontWeight: '800' }}>Refuser</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isIncomingRequest && (
        <View style={{ flexDirection: 'row', gap: 8, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border, alignItems: 'flex-end' }}>
          <TextInput
            value={text} onChangeText={setText}
            editable={canWrite}
            placeholder={canWrite ? 'Message…' : 'En attente d\'acceptation…'}
            placeholderTextColor={Colors.textMuted}
            multiline
            style={{ flex: 1, color: Colors.textPrimary, backgroundColor: Colors.bgCard, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 10, maxHeight: 120 }}
          />
          <TouchableOpacity onPress={onSend} disabled={!canWrite || sending || !text.trim()}
            style={{ backgroundColor: canWrite && text.trim() ? Colors.primary : Colors.bgCardAlt, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ color: '#fff', fontWeight: '800' }}>Envoyer</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 2: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS. (Si `Colors.bgCardAlt`/`Radius.lg` n'existent pas, remplacer par une valeur existante de `lib/theme.ts` — vérifier les exports avant.)

- [ ] **Step 3: Commit (optionnel)**

```bash
git add react-matchup/app/dm/[conversationId].tsx
git commit -m "feat(dm): ecran de conversation 1-a-1"
```

---

### Task 5: Onglet Chats — sous-sections Parties / Directs + zone Demandes

Ajoute un sélecteur Parties/Directs et une rangée « Demandes » en tête (style « Archivées »), sans casser la liste des chats de partie existante.

**Files:**
- Modify: `react-matchup/app/(tabs)/chats.tsx`
- Reference: `react-matchup/hooks/useDirectChats.ts`, structure existante de l'écran (ChatRow, filtres)

**Interfaces:**
- Consumes (Task 3) : `useDirectChats()` → `{ conversations, requests, requestsCount, load }`.
- Produces : navigation vers `/dm/[conversationId]`.

- [ ] **Step 1: Brancher le hook + l'état de section**

Dans `react-matchup/app/(tabs)/chats.tsx`, après `const { games, loading, loadGames } = useGameChats();` ajouter :

```tsx
import { useDirectChats } from '../../hooks/useDirectChats';
import { otherId } from '../../lib/directChats';
// …
const { conversations: dms, requests, requestsCount, load: loadDms } = useDirectChats();
const [section, setSection] = useState<'parties' | 'directs'>('parties');
```

Et dans le `useFocusEffect` existant, appeler aussi `loadDms()` :

```tsx
useFocusEffect(useCallback(() => {
  if (player) { loadGames(); loadDms(); }
}, [player, loadGames, loadDms]));
```

- [ ] **Step 2: Ajouter le sélecteur de section (au-dessus de la liste)**

Insérer juste avant la `FlatList` des parties un sélecteur 2 onglets :

```tsx
<View style={{ flexDirection: 'row', paddingHorizontal: Spacing.lg, gap: 8, marginBottom: 8 }}>
  {(['parties', 'directs'] as const).map(s => (
    <TouchableOpacity key={s} onPress={() => setSection(s)} style={{
      paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999,
      backgroundColor: section === s ? Colors.primary : Colors.bgCard,
    }}>
      <Text style={{ color: section === s ? '#fff' : Colors.textPrimary, fontWeight: '800', fontSize: FontSize.sm }}>
        {s === 'parties' ? 'Parties' : `Directs${requestsCount > 0 ? ` · ${requestsCount}` : ''}`}
      </Text>
    </TouchableOpacity>
  ))}
</View>
```

- [ ] **Step 3: Rendre la section Directs (demandes + conversations)**

Quand `section === 'directs'`, afficher (au lieu de la liste parties) la zone Demandes puis les conversations :

```tsx
{section === 'directs' && (
  <FlatList
    data={dms}
    keyExtractor={c => c.id}
    ListHeaderComponent={requestsCount > 0 ? (
      <TouchableOpacity
        onPress={() => router.push(`/dm/${requests[0].id}` as any)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.bgCardAlt }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 22 }}>✉️</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: Colors.textPrimary, fontSize: FontSize.sm, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Demandes</Text>
          <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 }}>{requestsCount} en attente</Text>
        </View>
      </TouchableOpacity>
    ) : null}
    renderItem={({ item }) => (
      <TouchableOpacity onPress={() => router.push(`/dm/${item.id}` as any)}
        style={{ paddingHorizontal: Spacing.lg, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border }}>
        <Text style={{ color: Colors.textPrimary, fontWeight: '800' }}>
          {/* le nom de l'autre joueur sera résolu via un select join en amont ; à défaut afficher l'id court */}
          Conversation
        </Text>
      </TouchableOpacity>
    )}
    ListEmptyComponent={<Text style={{ color: Colors.textMuted, textAlign: 'center', marginTop: 40 }}>Aucune conversation directe</Text>}
  />
)}
```

> Note d'implémentation : pour afficher le **nom** de l'autre joueur, enrichir `fetchConversations` (Task 2) avec un join `requester:requester_id(name,photo_url)` / `addressee:addressee_id(name,photo_url)` et dériver le nom via `otherId`. Reproduire le composant `ChatRow` si possible pour l'uniformité visuelle.

- [ ] **Step 4: Garder la liste Parties sous `section === 'parties'`**

Envelopper la `FlatList` existante des parties dans `{section === 'parties' && ( … )}` sans en changer le contenu.

- [ ] **Step 5: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit (optionnel)**

```bash
git add "react-matchup/app/(tabs)/chats.tsx"
git commit -m "feat(dm): sous-sections Parties/Directs + zone Demandes"
```

---

### Task 6: Badge d'onglet Chats — inclure les non-lus directs

Le badge de l'onglet doit additionner non-lus parties + directs.

**Files:**
- Modify: `react-matchup/app/(tabs)/_layout.tsx` (bloc badge chat, ~ lignes 150-185)
- Reference: `react-matchup/lib/directChats.ts`

**Interfaces:**
- Consumes (Task 2) : `fetchConversations`, `unreadFor`.

- [ ] **Step 1: Ajouter le comptage direct au total du badge**

Dans `app/(tabs)/_layout.tsx`, après le calcul `recomputeTotal()` des non-lus parties, ajouter le chargement des conversations directes et inclure leur non-lus :

```tsx
import { fetchConversations, unreadFor } from '../../lib/directChats';
// … dans load(), après recomputeTotal():
try {
  const convs = await fetchConversations();
  const directUnread = convs
    .filter(c => c.status === 'accepted')
    .reduce((s, c) => s + unreadFor(c, player.id), 0);
  setDirectUnread(directUnread); // état local additionné au badge total
} catch {}
```

Déclarer `const [directUnread, setDirectUnread] = useState(0);` et faire en sorte que la valeur affichée du badge = `total parties + directUnread`. S'abonner aussi à `direct_messages` (INSERT) sur le même pattern que `messages` pour rester live.

- [ ] **Step 2: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit (optionnel)**

```bash
git add "react-matchup/app/(tabs)/_layout.tsx"
git commit -m "feat(dm): badge onglet Chats inclut les non-lus directs"
```

---

### Task 7: Bouton « Message » sur le profil public

Ajoute l'action « Message » à côté de « Suivre » / « Défier », qui ouvre (ou crée via demande) une conversation.

**Files:**
- Modify: `react-matchup/components/profile/components.tsx` (bloc actions ~ lignes 515-545)
- Modify: `react-matchup/app/(tabs)/player/[id].tsx` (câblage du handler)
- Reference: `react-matchup/lib/directChats.ts`

**Interfaces:**
- Consumes (Task 2) : `startDirectConversation`, et un lookup d'une conversation existante.
- Produces : navigation vers `/dm/[conversationId]`.

- [ ] **Step 1: Ajouter une prop + un bouton « Message »**

Dans `components/profile/components.tsx`, ajouter `onMessage?: () => void` aux props du header et un 3e bouton dans le bloc actions (quand `!isSelf`) :

```tsx
<TouchableOpacity onPress={props.onMessage} activeOpacity={0.85} style={{
  flex: 1, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
  paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
}}>
  <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#fff' }}>Message</Text>
</TouchableOpacity>
```

- [ ] **Step 2: Câbler le handler dans `player/[id].tsx`**

Définir `onMessage` : chercher une conversation existante avec ce joueur ; si elle existe → naviguer dessus ; sinon ouvrir un petit prompt de 1er message puis `startDirectConversation`, et naviguer. Implémentation minimale (sans prompt custom, via `Alert.prompt` iOS / un modal simple) :

```tsx
const onMessage = async () => {
  if (!player || !profile) return;
  // conversation existante ?
  const { data } = await supabase.from('direct_conversations').select('id')
    .or(`and(requester_id.eq.${player.id},addressee_id.eq.${profile.id}),and(requester_id.eq.${profile.id},addressee_id.eq.${player.id})`)
    .maybeSingle();
  if (data?.id) { router.push(`/dm/${data.id}` as any); return; }
  // sinon : créer la demande avec un message d'intro (modal de saisie à ajouter)
  try {
    const conv = await startDirectConversation(profile.id, firstMessage, profile.name, player.name);
    router.push(`/dm/${conv.id}` as any);
  } catch (e: any) {
    Alert.alert('Impossible', mapDmError(String(e?.message)));
  }
};
```

Ajouter un helper `mapDmError` qui traduit les messages RPC (`recipient does not accept messages` → « Ce joueur n'accepte pas les messages », `blocked` → « Indisponible », etc.). Le `firstMessage` provient d'un petit modal de saisie (réutiliser un `Modal` + `TextInput` existant du projet).

- [ ] **Step 3: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit (optionnel)**

```bash
git add react-matchup/components/profile/components.tsx "react-matchup/app/(tabs)/player/[id].tsx"
git commit -m "feat(dm): bouton Message sur le profil public"
```

---

### Task 8: Réglages — confidentialité (3 niveaux) + liste de blocage

Permet de régler « Qui peut m'envoyer un message » et de gérer les blocages.

**Files:**
- Modify: `react-matchup/components/profile/ProfileMenuSheet.tsx` (entrée de menu)
- Create: `react-matchup/app/dm-settings.tsx` (écran réglages DM)
- Reference: `react-matchup/lib/directChats.ts` (type `DmPrivacy`), table `user_blocks`

**Interfaces:**
- Consumes (Task 2) : type `DmPrivacy`.

- [ ] **Step 1: Écran de réglages DM**

Create `react-matchup/app/dm-settings.tsx` : 3 options radio (`everyone` / `played` / `none`) qui écrivent `players.dm_privacy`, + liste des joueurs bloqués (lecture `user_blocks` where `blocker_id = me`, avec un bouton « Débloquer » = delete). Code :

```tsx
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { supabase } from '../lib/supabase';
import { usePlayer } from '../hooks/usePlayer';
import { Colors, Spacing, FontSize, Radius } from '../lib/theme';
import type { DmPrivacy } from '../lib/directChats';

const OPTIONS: { key: DmPrivacy; label: string; hint: string }[] = [
  { key: 'everyone', label: 'Tout le monde', hint: 'N\'importe qui peut envoyer une demande' },
  { key: 'played',   label: 'Joueurs croisés', hint: 'Seulement ceux avec qui j\'ai joué' },
  { key: 'none',     label: 'Personne', hint: 'Je n\'accepte aucune nouvelle demande' },
];

export default function DmSettingsScreen() {
  const { player } = usePlayer();
  const [privacy, setPrivacy] = useState<DmPrivacy>('everyone');
  const [blocked, setBlocked] = useState<{ blocked_id: string; name: string }[]>([]);

  useEffect(() => {
    if (!player) return;
    supabase.from('players').select('dm_privacy').eq('id', player.id).single()
      .then(({ data }) => { if (data?.dm_privacy) setPrivacy(data.dm_privacy as DmPrivacy); });
    supabase.from('user_blocks').select('blocked_id, player:blocked_id(name)').eq('blocker_id', player.id)
      .then(({ data }) => setBlocked((data ?? []).map((r: any) => ({ blocked_id: r.blocked_id, name: r.player?.name ?? '—' }))));
  }, [player]);

  const choose = async (p: DmPrivacy) => {
    if (!player) return;
    setPrivacy(p);
    await supabase.from('players').update({ dm_privacy: p }).eq('id', player.id);
  };

  const unblock = async (id: string) => {
    if (!player) return;
    await supabase.from('user_blocks').delete().eq('blocker_id', player.id).eq('blocked_id', id);
    setBlocked(prev => prev.filter(b => b.blocked_id !== id));
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, padding: Spacing.lg }}>
      <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900', marginBottom: 12 }}>Qui peut m'envoyer un message</Text>
      {OPTIONS.map(o => (
        <TouchableOpacity key={o.key} onPress={() => choose(o.key)} style={{
          padding: 14, borderRadius: Radius.md, marginBottom: 8,
          backgroundColor: privacy === o.key ? Colors.primary : Colors.bgCard,
        }}>
          <Text style={{ color: privacy === o.key ? '#fff' : Colors.textPrimary, fontWeight: '800' }}>{o.label}</Text>
          <Text style={{ color: privacy === o.key ? 'rgba(255,255,255,0.85)' : Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 }}>{o.hint}</Text>
        </TouchableOpacity>
      ))}
      <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900', marginTop: 20, marginBottom: 12 }}>Joueurs bloqués</Text>
      <FlatList
        data={blocked}
        keyExtractor={b => b.blocked_id}
        ListEmptyComponent={<Text style={{ color: Colors.textMuted }}>Aucun joueur bloqué</Text>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
            <Text style={{ color: Colors.textPrimary }}>{item.name}</Text>
            <TouchableOpacity onPress={() => unblock(item.blocked_id)}>
              <Text style={{ color: Colors.primary, fontWeight: '800' }}>Débloquer</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}
```

- [ ] **Step 2: Ajouter l'entrée dans le menu burger**

Dans `components/profile/ProfileMenuSheet.tsx`, ajouter une rangée « Confidentialité des messages » qui `router.push('/dm-settings')`. Suivre le style des entrées existantes du sheet.

- [ ] **Step 3: Vérifier la compilation**

Run: `cd react-matchup && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit (optionnel)**

```bash
git add react-matchup/app/dm-settings.tsx react-matchup/components/profile/ProfileMenuSheet.tsx
git commit -m "feat(dm): reglages confidentialite + liste de blocage"
```

---

## Vérification finale (device)

Après les 8 tasks, vérifier sur 2 appareils (comptes A et B) :

1. A ouvre le profil de B → « Message » → écrit un 1er message. B reçoit **1** notif « A veut t'envoyer un message » (sans contenu). A **ne peut pas** écrire de 2e message.
2. La demande apparaît chez B dans Chats → Directs → zone « Demandes ». B accepte → conversation passe en Directs des deux côtés, échange libre, push normal à chaque message.
3. B refuse une autre demande → disparaît, A ne peut pas relancer.
4. B met `dm_privacy = 'none'` → A ne peut plus créer de demande (message d'erreur clair).
5. B met `played` alors qu'ils n'ont jamais joué → demande refusée ; après une partie commune → autorisée.
6. A bloque B → conversation gelée/masquée, plus d'envoi possible ; débloquer depuis les réglages rétablit l'accès.
7. Badge de l'onglet Chats = non-lus parties + directs.

## Notes de cohérence

- Le nom de l'autre joueur dans la liste Directs (Task 5) suppose un enrichissement de `fetchConversations` (join `requester:requester_id(name,photo_url)` + `addressee:addressee_id(name,photo_url)`). Le faire dans Task 2 si on veut éviter un select supplémentaire — sinon ajouter un lookup dans Task 5.
- Vérifier les exports réels de `lib/theme.ts` (`Colors.bgCardAlt`, `Radius.lg`, `Fonts.uiBlack`) avant usage ; remplacer par les clés existantes si besoin.
- Ne pas réintroduire de lecture brute de `status` côté client sans passer par les prédicats de `lib/directChats.ts` (source unique).
```
