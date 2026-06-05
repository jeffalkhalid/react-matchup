# Spec — Commentaires d'activité (fil Communauté)

**Date** : 2026-06-05
**Statut** : validé, prêt pour plan d'implémentation

## Contexte & objectif

Le fil d'activité de la Communauté (`app/community/friends.tsx`) permet aujourd'hui de
**réagir** (🔥) à une activité mais pas de **commenter**. L'infrastructure des commentaires
est déjà posée à ~80 % :

- Table `activity_comments` créée (`supabase/migrations/community_social.sql:190`).
- Le compteur 💬 est déjà affiché dans `ActivityCard` (mais non cliquable).
- La couche modération existe (`lib/moderation.ts`) : blocage bidirectionnel filtrant déjà
  le fil, signalement, avec `'comment'` déjà prévu comme `ReportTargetType`.

Objectif : activer les commentaires pour permettre aux joueurs de **se hyper** mutuellement,
**tout en donnant à l'auteur le contrôle** sur qui peut commenter, et avec une **modération
proactive légère** pour éviter que ça dégénère (point chaud identifié : les défaites
`match_loss`, où un fil de commentaires peut servir à enfoncer le perdant).

## Décisions de cadrage (validées)

| Sujet | Décision |
|---|---|
| Restriction | **Réglage de profil global** : qui peut commenter MES activités → `everyone` / `friends` / `nobody`. S'applique à tout le fil. |
| Définition « ami » (politique `friends`) | **Lien de suivi dans au moins un sens** : l'auteur suit le commentateur OU le commentateur suit l'auteur. |
| Modération proactive | **Légère** : filtre de mots FR+AR + rate-limit + cap longueur (déjà 500) + réactif existant (signaler / bloquer / supprimer). |
| Comportement du filtre | **Refus + message** : le commentaire n'est pas publié, message « Ton commentaire enfreint les règles de la communauté ». |
| Notifications | **Auteur seulement** : push à l'auteur du post quand quelqu'un commente (sauf si on commente sa propre activité). |

## Conventions du repo respectées

- `players.id` = uuid ; `players.user_id` = text (= `auth.uid()::text`).
- Écritures sensibles via RPC `SECURITY DEFINER` (cf. `toggle_activity_reaction`,
  `toggle_message_reaction`). RLS SELECT ouverte ; pas de policy INSERT directe pour les
  écritures sensibles.
- Migrations = fichiers SQL appliqués à la main (SQL editor Supabase).
- Le filtrage par blocage se fait **côté client** dans le fil (`visibleFeed`,
  `friends.tsx:102`), pas en RLS.

## 1. Modèle de données

### Migration SQL (nouveau fichier `supabase/migrations/activity_comments_rpc.sql`)

- **`activity_comments`** : inchangée (existe déjà).
- **Nouveau champ sur `players`** :
  ```sql
  ALTER TABLE public.players
    ADD COLUMN IF NOT EXISTS comments_policy text NOT NULL DEFAULT 'friends';
  ALTER TABLE public.players
    ADD CONSTRAINT players_comments_policy_chk
    CHECK (comments_policy IN ('everyone','friends','nobody'));
  ```
  Défaut `'friends'` = safe-by-default.
- **Correction RLS (bouche le trou de sécurité)** : la policy actuelle
  `activity_comments_insert` (`WITH CHECK (player_id = current_player_id())`) est **trop
  permissive** (n'importe quel authentifié peut commenter n'importe quel post). On la
  **supprime** ; toute insertion passe désormais par l'RPC (comme `activity_events`).
  ```sql
  DROP POLICY IF EXISTS activity_comments_insert ON public.activity_comments;
  ```
  Les policies SELECT (ouverte) et DELETE (auteur du commentaire) restent.

## 2. Écriture via RPC `add_activity_comment`

Fonction `SECURITY DEFINER`, miroir de `toggle_activity_reaction`.

```
add_activity_comment(p_event_id uuid, p_content text) RETURNS activity_comments
```

Logique, dans l'ordre (lève une exception explicite à chaque échec) :

1. `v_me := current_player_id()` ; si NULL → `RAISE EXCEPTION 'not a registered player'`.
2. Longueur : `char_length(trim(p_content))` doit être dans `[1, 500]`, sinon exception.
3. Récupère l'auteur du post (`activity_events.player_id` → `v_author`) et son
   `comments_policy` :
   - `nobody` → exception `comments disabled`.
   - `friends` → exige un lien de suivi dans au moins un sens :
     ```sql
     EXISTS(SELECT 1 FROM follows
            WHERE (follower_id = v_me AND following_id = v_author)
               OR (follower_id = v_author AND following_id = v_me))
     ```
     sinon exception `not allowed to comment`.
     - Exception : l'auteur peut toujours commenter sa propre activité (`v_me = v_author`).
   - `everyone` → OK.
4. **Blocage bidirectionnel** : rejet si
   `EXISTS user_blocks (blocker=v_me,blocked=v_author) OR (blocker=v_author,blocked=v_me)`.
5. **Rate-limit** : max **5 commentaires / 60 s** par joueur :
   ```sql
   (SELECT count(*) FROM activity_comments
    WHERE player_id = v_me AND created_at > now() - interval '60 seconds') < 5
   ```
   sinon exception `rate limited`.
6. `INSERT` et retourne la ligne.

> Note : le filtre de gros mots reste **côté client** pour le lancement « léger » (voir §3).
> L'RPC est la défense serveur pour longueur, politique, blocage et rate-limit. Doubler le
> filtre de mots côté SQL est un ajout futur sans impact UI.

## 3. Filtre de mots (`lib/profanity.ts`)

- Liste de termes FR + arabe/darija (y compris translittérations courantes).
- `normalize(text)` : minuscules, suppression des accents, leetspeak basique
  (`0→o`, `1→i`, `@→a`, `$→s`…), compactage des espaces/répétitions.
- `containsProfanity(text): boolean` : match sur tokens normalisés.
- **Côté client** : appelé avant l'envoi. Si positif → on n'appelle pas l'RPC, on affiche
  « Ton commentaire enfreint les règles de la communauté ».

## 4. Couche données (`lib/community.ts`)

Nouvelles fonctions, alignées sur le style existant (hydratation acteur comme
`getActivityFeed`) :

- `getComments(eventId): Promise<ActivityComment[]>` — liste triée par `created_at` asc,
  hydrate l'acteur (id, name, elo_score → ligue).
- `addComment(eventId, content): Promise<ActivityComment | null>` — appelle
  `supabase.rpc('add_activity_comment', …)` ; en cas d'erreur, mappe le message d'exception
  vers un retour exploitable par l'UI (politique/rate-limit/blocage).
- `deleteComment(id): Promise<void>`.
- Après un `addComment` réussi, déclenche la notif auteur (voir §5).

Nouveau type `ActivityComment` dans `types/index.ts` (id, event_id, player_id, content,
created_at, actor?, league?).

## 5. UI

### Écran feuille `app/community/comments/[eventId].tsx`
- Route modale (expo-router), ouverte en tapant le compteur 💬.
- Liste des commentaires (avatar + nom + ligue + texte + `timeAgo`).
- Champ de saisie en bas (cap 500, bouton envoyer).
- Filtrage côté client : retire les commentaires des joueurs masqués
  (`getHiddenPlayerIds`), comme `visibleFeed`.
- Suppression de son propre commentaire (geste long ou menu ⋯).
- Signalement d'un commentaire via `reportContent({ targetType: 'comment', targetId, … })`.

### `components/community/ActivityCard.tsx`
- Le bloc 💬 (actuellement un `View`) devient un `TouchableOpacity` avec prop
  `onPressComments`.
- `friends.tsx` câble `onPressComments={() => router.push('/community/comments/' + e.id)}`
  et rafraîchit le `comment_count` au retour de focus.

### Réglage de profil `app/(tabs)/profile.tsx`
- Une ligne « Qui peut commenter mes activités » → sélecteur Amis / Tout le monde /
  Personne, persisté dans `players.comments_policy`.

## 6. Notifications (auteur seulement)

Après `addComment` réussi et si `commenter !== auteur` :
```
notifyPlayers({
  playerIds: [authorId],
  title: '<nom> a commenté ton activité',
  body: <extrait du commentaire>,
  data: { type: 'activity', eventId },
})
```
Fire-and-forget via le pipeline `send-push` existant (`lib/notify.ts`).

## 7. Tests — vérification manuelle (convention du repo)

Le projet n'a pas de runner de test ; on suit la convention existante (vérification à la main
via l'app). Chaque tâche du plan se termine par un scénario de vérification manuelle. Points
à couvrir :

- **RPC `add_activity_comment`** : tester chaque politique `nobody` / `friends` (lien
  présent/absent, les deux sens, auto-commentaire) / `everyone` ; blocage bidirectionnel ;
  rate-limit ; longueur — via le SQL editor Supabase et l'app.
- **`lib/profanity.ts`** : vérifier manuellement quelques termes FR + darija, contournements
  (accents, leet) et l'absence de faux positifs évidents, en commentant dans l'app.
- **UI** : ouverture de la feuille, envoi, suppression, signalement, filtrage des bloqués,
  réglage de profil, notif auteur — parcours manuel dans l'app.

## Hors périmètre (différé)

- File de modération admin (revue des `content_reports`) — réactif déjà en place, revue manuelle pour l'instant.
- Filtre de mots dupliqué côté SQL (défense en profondeur) — côté client suffit au lancement.
- Notifs « thread » (participants au fil) — auteur seulement pour le lancement.
- Réponses imbriquées / threads de commentaires — liste plate uniquement.

## Notes de déploiement

- Ce travail est dans l'app React Native (`react-matchup`), pas dans le projet Next.js.
- L'ajout de contenu texte libre relève la barre légale (modération, suppression de contenu)
  ; à articuler avec le travail de confidentialité du plan de déploiement Maroc.
