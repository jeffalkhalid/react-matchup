# Chats 1-à-1 (messages directs) — Design

Date : 2026-06-27
App : PagMatch (react-matchup)
Statut : design validé, prêt pour le plan d'implémentation

## Objectif

Ajouter des conversations privées **1-à-1** entre deux joueurs, indépendantes
d'une partie. Aujourd'hui, **tout** chat est lié à une partie (`messages.game_id`,
RLS « membre de la partie », onglet Chats = `useGameChats`). On ajoute un canal
direct, avec des règles anti-harcèlement appliquées côté serveur.

Contrainte projet : changements **additifs et réversibles**, le chat de partie
existant n'est **pas** modifié (zéro régression). Travail sur `main`, sans
commit auto.

## Décisions validées

1. **Ouverture** : style Instagram. N'importe qui peut initier, mais le premier
   contact arrive comme une **demande** que le destinataire accepte/refuse.
2. **Confidentialité** (réglage par joueur, `players.dm_privacy`, 3 niveaux) :
   - `everyone` (défaut) — tout le monde peut envoyer une demande.
   - `played` — seulement les joueurs avec qui j'ai partagé au moins une partie.
   - `none` — personne ne peut m'envoyer de demande.
3. **Blocage** : réutilise la table existante `user_blocks` (moderation.sql).
   Blocage bidirectionnel : impossible d'ouvrir/écrire dans les deux sens,
   conversation existante masquée et gelée, silencieux pour le bloqué.
4. **Placement UI** : onglet **Chats** unique, avec sous-sections
   **Parties / Directs** + une zone **Demandes** en tête.
5. **Mécanique d'une demande** tant qu'elle n'est pas acceptée : l'expéditeur
   n'envoie **qu'UN seul message** d'intro et ne peut plus écrire avant
   acceptation. Le destinataire le voit dans « Demandes » et reçoit **une seule
   notification push** « [Nom de l'expéditeur] veut t'envoyer un message »
   (le nom du profil, mais **sans le contenu** du message).
6. **Notifications après acceptation** : les messages d'une conversation
   `accepted` poussent normalement, comme le chat de partie (`send-push`).

## Architecture des données

Tables dédiées (séparées de `messages`) — additif, RLS propre, aucun impact sur
le chat de partie.

### `direct_conversations`
| colonne | type | note |
|---|---|---|
| `id` | uuid PK | |
| `requester_id` | uuid FK players | initiateur |
| `addressee_id` | uuid FK players | destinataire de la demande |
| `status` | text | `pending` \| `accepted` \| `declined` |
| `created_at` | timestamptz | défaut now() |
| `last_message_at` | timestamptz | tri liste |
| `requester_last_read` | timestamptz | non-lus côté initiateur |
| `addressee_last_read` | timestamptz | non-lus côté destinataire |

Contraintes :
- `CHECK (requester_id <> addressee_id)`.
- **Index unique** sur `(least(requester_id,addressee_id), greatest(...))` →
  une seule conversation par binôme, à vie (peu importe qui a initié).

### `direct_messages`
| colonne | type | note |
|---|---|---|
| `id` | uuid PK | |
| `conversation_id` | uuid FK direct_conversations ON DELETE CASCADE | |
| `sender_id` | uuid FK players | |
| `content` | text | |
| `created_at` | timestamptz | défaut now() |
| `reactions` | jsonb | défaut `{}`, format `Record<emoji, player_ids[]>` (même que `messages`) |

Index : `(conversation_id, created_at DESC)` (historique + dernier message).

### `players.dm_privacy`
`text NOT NULL DEFAULT 'everyone' CHECK (dm_privacy IN ('everyone','played','none'))`.

## Règles côté serveur (RPC `SECURITY DEFINER`)

Les règles sensibles vivent dans des fonctions Postgres, pas dans le client.

### `start_direct_conversation(p_addressee uuid, p_content text)`
En une transaction, refuse (raise) si :
- le destinataire a `dm_privacy = 'none'` ;
- `dm_privacy = 'played'` et aucune partie partagée (via `game_participants`) ;
- l'un des deux a bloqué l'autre (`user_blocks`, deux sens) ;
- une conversation existe déjà pour ce binôme.

Sinon : crée la conversation (`status='pending'`, `requester=current`) + insère
le **message d'intro unique**, met `last_message_at`. Déclenche **une** notif
push « [Nom de l'expéditeur] veut t'envoyer un message » (nom du profil, sans
le contenu) vers le destinataire.

### `send_direct_message(p_conversation uuid, p_content text)`
Autorise l'écriture si je suis membre **et** :
- la conversation est `accepted` ; **ou**
- elle est `pending`, je suis le `requester`, et il y a **0 message** déjà
  (règle « 1 seul message tant que pas accepté »).

Sinon refus. Met à jour `last_message_at`. Si `accepted`, déclenche le push
normal (pipeline `send-push`, comme le chat de partie).

### `respond_direct_request(p_conversation uuid, p_accept boolean)`
Réservé au `addressee`. `accept=true` → `status='accepted'` (la conv rejoint
Directs). `accept=false` → `status='declined'` (masquée). Idempotent.

## RLS

- `direct_conversations` : `SELECT`/`UPDATE` réservés aux deux membres
  (`requester_id = current_player_id() OR addressee_id = current_player_id()`).
  Pas d'`INSERT` direct (passe par la RPC).
- `direct_messages` : `SELECT` réservé aux membres de la conversation. Pas
  d'`INSERT`/`UPDATE` direct hors RPC (sauf réactions via une RPC dédiée
  `toggle_direct_message_reaction`, calquée sur `toggle_message_reaction`).
- `user_blocks` : déjà en place (moderation.sql).

## Client (React Native)

### Hooks / lib
- `useDirectChats()` (nouveau, calqué sur `useGameChats`) : charge les
  conversations `accepted` (→ Directs) et `pending` reçues (→ Demandes), avec
  non-lus dérivés de `*_last_read` vs `last_message_at`, et live (realtime sur
  `direct_messages` / `direct_conversations`).
- `lib/directChats.ts` : prédicats partagés (visibilité, non-lus, statut), pour
  rester source unique (cf. feedback_audit_state_divergences).

### Écrans / composants
- Onglet **Chats** ([app/(tabs)/chats.tsx](../../../app/(tabs)/chats.tsx)) :
  ajout des sous-sections Parties / Directs + zone « Demandes » en tête
  (style « Archivées »). Le badge d'onglet
  ([app/(tabs)/_layout.tsx](../../../app/(tabs)/_layout.tsx)) additionne les
  non-lus parties + directs.
- Écran conversation 1-à-1 : nouveau `app/dm/[conversationId].tsx`, réutilise
  les bulles + réactions extraites de
  [app/chat/[gameId].tsx](../../../app/chat/%5BgameId%5D.tsx) (composant
  partagé `MessageBubble` / liste). Bandeau « Demande » avec
  Accepter / Refuser / Bloquer tant que `pending`.
- **Point d'entrée** : bouton « Message » sur le profil public
  ([app/(tabs)/player/[id].tsx](../../../app/(tabs)/player/%5Bid%5D.tsx)), à
  côté de « Suivre » ([components/profile/components.tsx](../../../components/profile/components.tsx)).
- **Réglages** : « Qui peut m'envoyer un message » (3 niveaux) + gestion de la
  liste de blocage, depuis le menu burger profil
  ([components/profile/ProfileMenuSheet.tsx](../../../components/profile/ProfileMenuSheet.tsx)).

## Notifications

- Demande créée → **1** push « [Nom de l'expéditeur] veut t'envoyer un
  message » (nom du profil, sans le contenu).
- Conversation `accepted`, message suivant → push normal (réutilise
  `send-push` + le webhook/pipeline existant, à câbler sur `direct_messages`).

## Hors périmètre v1

- DM depuis un chat de partie (taper un participant) → v2.
- Le blocage n'affecte que les DM (pas la visibilité matchmaking/communauté).
- Pas de pièces jointes / images dans les DM (texte seul, comme le chat de
  partie actuel).

## Dépendances / risques

- **`moderation.sql`** (table `user_blocks`) doit être appliquée en prod —
  à vérifier avant de livrer.
- Migrations non timestampées (drift connu) — suivre la convention du repo.
- Réutiliser le format `reactions` jsonb existant pour ne pas diverger
  (cf. project_chat_reactions_persistence).
```
