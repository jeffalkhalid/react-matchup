# Plan de déploiement — PAG MATCH (Maroc)

> Fichier de suivi inter-sessions. Cocher au fur et à mesure.
> Cible : publication App Store + Google Play pour des utilisateurs au Maroc.
> App concernée : **react-matchup** (Expo / React Native). Slug `matchup-padel`, bundle `com.pagmatch.app`.
> Dernière mise à jour : 2026-06-04.

## Légende
- [ ] à faire · [~] en cours · [x] fait
- 🔴 bloquant pour la soumission · 🟠 important · 🟢 confort/post-launch

---

## Phase 1 — Sécurité des données (PRIORITÉ, à faire avant tout le reste)

### 1.1 🔴 RLS Supabase sur toutes les tables
**Constat :** aucune migration `react-matchup/supabase/migrations/*` n'active `ROW LEVEL SECURITY`. Avec la clé `anon`, n'importe qui peut lire/modifier tous les profils, scores, messages. Faille réelle au regard de la loi 09-08.

Tables à protéger (source : `schema.sql`) :
`badges`, `challenges`, `clubs`, `elo_history`, `frmt_rankings`, `game_chat_reads`, `game_participants`, `matches`, `messages`, `open_games`, `player_favorites`, `players`, `push_subscriptions`, `reputation_votes`, `seasons`.

- [x] 🔴 Migration écrite → `react-matchup/supabase/migrations/enable_rls_phase1.sql` (DRAFT, **non testée**).
  - Réutilise le helper existant `current_player_id()` (community_social.sql). Ajoute `is_app_admin()` + `is_game_member(game_id)`.
  - TIER 1 (strict) : `players` (write owner/admin), `messages` (read = membres de la partie), `game_chat_reads`, `player_favorites`, `push_subscriptions`, `gender_change_requests`.
  - TIER 2 (jeux) : `matches`, `open_games`, `game_participants`, `challenges`, `reputation_votes` — lecture publique, écriture authentifiée (à resserrer en phase 2).
  - TIER 3 (référence) : `clubs`, `badges`, `seasons`, `frmt_rankings`, `elo_history` — lecture publique, write admin.
  - Vérifié : ELO via trigger `fn_distribute_elo_on_validate` (DEFINER) → owner-only sur `players` OK ; réactions via RPC `toggle_message_reaction` + `toggle_activity_reaction` (DEFINER) → OK.
  - Cast `auth.uid()::text` (user_id est TEXT). Carve-out admin pour les écritures admin (`admin.tsx`).
- [x] 🔴 **Réconcilié avec le schéma mis à jour (2026-06-04)** : 5 tables déjà protégées par des migrations antérieures et **exclues** de cette migration → `follows`, `activity_events`, `activity_comments`, `game_alerts` (community_social.sql), `dismissed_notifications` (sa migration). `gender_change_requests` était sans RLS → **ajoutée**. (Correction : un 1er grep avec glob cassé avait faussement conclu « aucune RLS » ; en réalité le code communautaire l'activait déjà.)
- [x] 🟠 ELO atomique : déjà couvert par le trigger serveur `fn_distribute_elo_on_validate`. ⚠️ Reste à confirmer que `admin.tsx` (handleForceValidate) n'écrit plus l'ELO à la main (sinon double comptage — cf. avertissement dans elo_on_validate.sql).
- [x] 🔴 **`enable_rls_phase1.sql` APPLIQUÉE EN PROD le 2026-06-08** (staging sauté ; appliquée directement, régression reproduite sur device → cf. correctif signup ci-dessous). Tourne en prod depuis. Rollback dispo si besoin : `ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;`.
- [x] 🔴 **Audit code de compatibilité (2026-06-10)** : toutes les écritures de l'app RN respectent les policies (envoi message `player_id=moi`+membre, édition profil `isSelf`, push_token owner, ELO=trigger DEFINER, pas d'écriture client `elo_history`). **Seule dépendance** : les actions admin (link FRMT `admin.tsx:705`, édition fiches) exigent `is_admin = true` sur le compte admin — à confirmer.
- [~] 🟠 **Smoke-test de non-régression** (hygiène — la prod tourne déjà sous RLS, pas une urgence ; compte A + B, device réel) :
  1. Signup d'un nouveau compte → la ligne `players` se crée (policy `players_insert`).
  2. Login → voir son profil + le profil d'un autre joueur (lecture publique OK).
  3. Éditer SON profil → OK ; tenter d'éditer le profil de B → doit échouer.
  4. Créer une partie (`open_games`) → rejoindre avec B (`game_participants`) → OK.
  5. Chat dans la partie : A et B voient les messages ; un compte C non-membre **ne doit pas** lire les messages (`messages_select`).
  6. Réagir à un message d'autrui → OK (RPC DEFINER).
  7. Saisir + valider un score → ELO distribué aux 2 équipes (trigger), `elo_history` alimenté.
  8. Favoris / notifications push token → seul le owner lit/écrit.
  9. Action admin (link FRMT, change gender) avec un compte admin → OK ; avec un non-admin → échoue.
- [ ] 🔴 Vérifier l'app **web** `matchup_padel` (partage la même base ?) : ranking public, pages anon → lecture toujours OK grâce aux SELECT publics.
- [x] 🔴 Appliqué en **PROD** (Supabase Dashboard) le 2026-06-08, reconfirmé 2026-06-10. Staging sauté ; la prod tourne sous RLS depuis (signup déjà corrigé via trigger). Smoke-test ci-dessus = hygiène, pas blocage.

**Critère de sortie :** un compte B ne peut ni lire les chats privés ni modifier les données d'un compte A ; le parcours nominal (les 9 étapes) fonctionne toujours en staging.

### 1.2 🔴 Captcha — migration hCaptcha → Cloudflare Turnstile
**État actuel :** captcha **désactivé** pour les tests (`const CAPTCHA_ENABLED = false;` dans `login.tsx` ET `signup.tsx`). Doit être réactivé et migré vers Turnstile avant le launch (hCaptcha gratuit = mauvaise UX, Pro = 99 $/mois).

Pré-requis côté dashboard (à faire par l'utilisateur) :
- [ ] Créer un site Turnstile sur dash.cloudflare.com, mode **Invisible** → récupérer Site Key + Secret Key.
- [ ] Supabase → Auth → Settings → Captcha Provider = **Turnstile**, coller les clés, activer « Enable Captcha protection ».

Côté code (FAIT — typecheck `tsc --noEmit` = 0 erreur, inerte tant que `CAPTCHA_ENABLED=false`) :
- [x] 🔴 Composant `components/TurnstileCaptcha.tsx` créé : WebView (déjà dépendance) rendant Turnstile en mode `execution:'execute'`. API drop-in compatible hCaptcha : `ref.show()` / `ref.reset()` + `onMessage(event)` où `event.nativeEvent.data` = token (>35) ou `error`/`expired`/`cancel`.
- [x] 🔴 `app/(auth)/login.tsx` : import + `<TurnstileCaptcha>` + `EXPO_PUBLIC_TURNSTILE_SITE_KEY`. Pattern `captchaRef.show()` / `handleCaptchaMessage` conservé.
- [x] 🔴 `app/(auth)/signup.tsx` : idem (ref `useRef<any>`, label "Turnstile").
- [x] 🔴 `.env` : `EXPO_PUBLIC_TURNSTILE_SITE_KEY=` ajouté (vide), ancienne clé hCaptcha commentée.
- [x] 🔴 Site Turnstile créé + Site Key dans `.env` (`0x4AAAAAADhYS0T21hIO5gjg`) + Supabase Auth configuré (Provider Turnstile + Secret Key + protection activée) — fait par l'utilisateur le 2026-06-09.
- [x] 🔴 `CAPTCHA_ENABLED = true` dans `login.tsx` ET `signup.tsx`. Vérifié : `captchaToken` cohabite avec `options.data` (trigger signup) dans le même `signUp`. Typecheck OK.
- [x] 🔴 **Testé sur device (2026-06-09) : OK.** Le blocage initial (« je ne peux pas cocher ») venait de la config Cloudflare (widget en mode Invisible + hostname `icshhobxeppttgayxmba.supabase.co` autorisé) — corrigé côté dashboard, pas de changement code.
- [x] 🟢 Dépendance `@hcaptcha/react-native-hcaptcha` retirée du `package.json` + référence d'erreur `'hcaptcha'` nettoyée dans `login.tsx`. ⚠️ Lancer `npm install` pour purger `node_modules`.

**Critère de sortie :** login/signup protégés par Turnstile invisible sur device, plus aucune référence hCaptcha fonctionnelle.

---

## Phase 2 — Conformité légale (loi 09-08 / CNDP + stores)

### 2.1 🔴 Politique de confidentialité
**Choix retenu : écran in-app dans l'app React Native** (pas le projet Next.js). Décision utilisateur : tout le travail légal se fait dans `react-matchup`.

Sous-traitants / transfert hors Maroc couverts dans le texte :
- **Supabase** (auth, DB, stockage médias) — région à confirmer (projet `icshhobxeppttgayxmba`).
- **Expo Push Service** (relais notifications).
- **Google / Firebase Cloud Messaging** (transport Android — `google-services.json`).
- **Apple / APNs** (transport iOS).
- **Cloudflare Turnstile** (captcha).

Données décrites : e-mail, profil (nom/sexe/niveau ELO/historique/stats/FRMT), contenus (Stories photos/vidéos, chat + réactions, activités), token de notification, données techniques.

- [x] 🔴 Rédiger la politique (FR) → écran `app/legal/confidentialite.tsx` (sections : données, finalités, base légale, sous-traitants, transfert hors Maroc, conservation, droits, sécurité/RLS, mineurs, CNDP). Typecheck OK.
- [x] 🔴 Route enregistrée hors guard (`_layout.tsx`) → accessible **avant connexion**.
- [x] 🔴 Liens in-app : écran d'inscription (`signup.tsx`, ligne de consentement) + réglages (`profile.tsx`, section « Légal »).
- [x] 🔴 Placeholders **centralisés** dans `lib/legal.ts` (un seul fichier). `minAge` fixé à **18**.
- [ ] 🔴 **Action utilisateur — renseigner `lib/legal.ts`** : `responsable`, `editor`, `contactEmail`, `supabaseRegion` (Dashboard → Project Settings → General). (`minAge`/`lastUpdate` déjà remplis.)
- [x] 🔴 **URL publique pour les stores** : site vitrine **PAG MATCH — Padel Active Game** (Next.js) dans `Native/activegame-landing/` (dossier inchangé) → pages `/confidentialite` + `/cgu` + landing. `npm run build` OK. Reste : déployer (Vercel/Cloudflare Pages) + brancher **padelactivegame.com** → URLs finales `https://padelactivegame.com/confidentialite` et `/cgu` à reporter dans App Store Connect + Play Console.
- [x] 🟠 Version **arabe** : abandonnée (décision utilisateur).

### 2.2 🟠 CGU / Conditions d'utilisation
- [x] 🟠 Rédiger les CGU → écran `app/legal/cgu.tsx` (objet, éligibilité/âge, conduite, contenus utilisateurs + licence, **tolérance zéro contenus abusifs**, signalement/blocage, scores/ELO, PI, responsabilité, résiliation, droit marocain). Typecheck OK.
- [x] 🟠 Route enregistrée hors guard (`_layout.tsx`) + liens : `profile.tsx` (section Légal) + consentement `signup.tsx` (CGU + confidentialité).
- [x] 🔴 Placeholders CGU branchés sur `lib/legal.ts` (voir §2.1) — plus rien à éditer dans `cgu.tsx`.
- [x] 🟠 Dépendance produit signalement/blocage des CGU **satisfaite** : implémentée dans l'app (cf. §3.3 — modération MVP).

### 2.3 🟠 CNDP
- [ ] 🟠 Se renseigner sur l'obligation de **déclaration CNDP** (cndp.ma) pour un traitement de données de résidents marocains.
- [ ] 🟢 Faire valider politique + CGU + seuil d'âge par un **juriste marocain**.

### 2.4 🟠 Mineurs
- [x] 🟠 Seuil d'âge fixé à **18 ans**. Case **obligatoire** « Je certifie avoir au moins 18 ans » à l'inscription (`signup.tsx`, étape 5, bloque le bouton) + clause CGU/confidentialité via `lib/legal.ts`. Typecheck OK.

---

## Phase 3 — Exigences stores

### 3.1 🔴 Suppression de compte in-app
Exigée par Apple **et** Google Play (et droit à l'effacement 09-08).
- [x] 🔴 **Constat** : l'ancien code (`players.delete()`) échouait (FK matchs non-CASCADE) et ne supprimait jamais le compte auth (e-mail).
- [x] 🔴 RPC `delete_my_account()` → `supabase/migrations/account_deletion.sql` (SECURITY DEFINER) : purge des données perso (favoris, blocages, alertes, suivis, chat_reads, notifs, demandes genre, push), **anonymisation** des contenus partagés (profil → « Compte supprimé », messages), puis `DELETE FROM auth.users` (libère l'e-mail). Typecheck OK.
- [x] 🔴 Client câblé : `profile.tsx` appelle `supabase.rpc('delete_my_account')` puis `signOut()`.
- [ ] 🔴 **À APPLIQUER** : `account_deletion.sql` en staging puis prod, et **tester** (créer un compte jetable avec matchs → supprimer → vérifier purge perso + impossibilité de reconnexion + ELO des adversaires intact).
- [x] 🟠 **Choix produit confirmé (2026-06-05) : ANONYMISATION** (pas de hard-delete) — préserve l'ELO/historique des adversaires, conforme stores + 09-08. Décision actée, ne pas régresser.
- [x] 🟠 **Marqueur `deleted_at` (2026-06-10)** : `soft_delete_deleted_at.sql` ajoute `players.deleted_at`, backfille les fantômes existants (`name = 'Compte supprimé'`), et la RPC le pose à l'anonymisation. **NE PAS filtrer sur `user_id IS NULL`** (les profils FRMT scrapés l'ont aussi). 9 requêtes de découverte filtrées `.is('deleted_at', null)` (classement, matchmaking, joueurs à inviter du CreateWizard, suggestions/recherche communauté, calcul de rang fiche joueur, liste FRMT admin) ; lookups par `id` laissés tels quels (un vieux match doit afficher « Compte supprimé »). Choix produit liés : réinscription repart de zéro, pseudo redevient libre. Typecheck OK.
- [ ] 🟠 **À APPLIQUER** : `soft_delete_deleted_at.sql` en staging puis prod **AVANT** de livrer le build (sinon les requêtes `.is('deleted_at', null)` lèvent une erreur PostgREST : colonne inexistante). Vérifier ensuite qu'un compte supprimé ne ressort plus du classement ni des joueurs à inviter.
- [ ] 🟢 Stockage médias : pas de table `stories` ni bucket utilisateur identifié (Stories = export image, cf. §3.3) → rien à purger côté storage pour l'instant ; revérifier si un bucket est ajouté.
- [x] 🟢 **Durcissement inscription (2026-06-09)** : (a) `ageConfirmed` re-vérifié dans `handleCreateAccount` (plus seulement le bouton). (c) Migration `cleanup_unconfirmed_accounts.sql` : fonction DEFINER + job pg_cron quotidien (03:00 UTC) qui supprime les comptes email non confirmés > 7 j + leurs fiches `players` orphelines (0 match). (b unicité pseudo atomique = non fait, noté post-lancement.)
- [ ] 🟢 **À APPLIQUER** : `cleanup_unconfirmed_accounts.sql` (+ activer l'extension **pg_cron** dans Supabase → Database → Extensions, sinon le job n'est pas planifié — la fonction reste appelable à la main).

### 3.2 🔴 Déclarations de confidentialité des stores
- [ ] 🔴 Google Play : formulaire **Data Safety** cohérent avec la politique.
- [ ] 🔴 Apple : **Privacy Nutrition Labels** dans App Store Connect.
- [ ] 🔴 Renseigner l'**URL de politique de confidentialité** dans les deux fiches (obligatoire, sinon rejet) → `https://padelactivegame.com/confidentialite` une fois le site déployé (cf. §2.1, `Native/activegame-landing/`).

### 3.3 🔴 Modération de contenu (UGC : chat + Stories + activités communautaires)
**Constat (vérifié 2026-06-05) : AUCUNE modération n'existe.** Recherche code + schéma → aucune table `user_blocks`/`content_reports`, aucun bouton signaler/bloquer (le seul « signaler/bloquer » est dans le texte des CGU que je viens d'écrire). L'app a pourtant du UGC : chat de partie, Stories (photos/vidéos), activités + commentaires communautaires. **→ Exigence Apple 1.2 non remplie = rejet quasi certain.** Devient 🔴 bloquant.

MVP implémenté (typecheck `tsc --noEmit` = 0 erreur) :
- [x] 🔴 DB : migration `supabase/migrations/moderation.sql` → tables `user_blocks` + `content_reports` + RLS (owner pour blocks ; insert reporter + lecture/maj admin pour reports). Helper `is_app_admin()` redéfini en idempotent.
- [x] 🔴 Helper `lib/moderation.ts` : `blockUser`/`unblockUser`/`isBlocked`/`getHiddenPlayerIds` (bidirectionnel) + `reportContent`.
- [x] 🔴 **Bloquer** : menu « ⋯ » sur le profil joueur (`player/[id].tsx`) + filtrage des bloqués dans le chat, le feed communautaire (`friends.tsx`), le matchmaking (suggestions + défis reçus) et le lobby (parties).
- [x] 🔴 **Signaler** : long-press message dans le chat, bouton « ⋯ » sur les activités (`ActivityCard`), menu profil joueur → insert `content_reports`.
- [x] 🟠 Admin : onglet « 🚩 Signalements » dans `admin.tsx` (liste + Traité/Rejeter + ouverture du profil visé).
- [ ] 🔴 **À APPLIQUER** : `moderation.sql` en staging puis prod (dépend de `current_player_id()` déjà en base ; `is_app_admin()` créé par la migration elle-même).
- [x] 🟢 Signalement des **Stories** : **non nécessaire** — vérifié qu'il n'existe ni table `stories` ni viewer in-app ; les Stories sont seulement exportées/partagées en image 9:16. Ce n'est donc pas de l'UGC consultable dans l'app → hors périmètre Apple 1.2. (`target_type:'story'` reste prévu en base, inoffensif, si un feed Stories est ajouté un jour.)
- [ ] 🟢 Process : suppression sous 24h des contenus signalés (engagement CGU §5) — traiter via l'onglet admin.
- [ ] 🟠 Champ **contact de modération** publié (e-mail) — via `[EMAIL_CONTACT]`.

### 3.4 🟠 Build & soumission
- [ ] 🟠 `eas build` iOS + Android (voir `project_ios_deployment` : compte Apple, APNs, eas submit).
- [x] 🟠 **Audit permissions Android** (`app.json`) : les 3 sont liées aux notifications, aucune sensible. `POST_NOTIFICATIONS` (requise Android 13+) et `VIBRATE` ✅ justifiées. `RECEIVE_BOOT_COMPLETED` = inutile (aucune notification locale planifiée, que du push distant) mais inoffensive et ajoutée par expo-notifications → peut être retirée, sans urgence.

---

## Phase 4 — Localisation / UX Maroc (post-MVP)

- [ ] 🟢 Interface en français garantie ; envisager l'arabe.
- [x] 🟢 **Liens de partage centralisés (2026-06-09)** : toutes les URLs passent par `SHARE_BASE` / helpers (`lobbyGameLink`, `playerStoryLink`, `referralLink`) dans `lib/community.ts` ; libellés watermark via `SHARE_LABEL = 'pagmatch.com'`. Plus aucune URL/libellé en dur (typecheck OK).
- [ ] 🟠 **Bascule domaine partages** : brancher **pagmatch.com** comme **domaine custom Vercel** sur `matchup_padel` (DNS, 0 code), puis `SHARE_BASE = 'https://pagmatch.com'` (**1 ligne** dans `lib/community.ts`). Architecture retenue : **padelactivegame.com** = vitrine/légal/email, **pagmatch.com** = web app de partage (routes /u, /lobby, /player) + futurs Universal Links (cohérent avec scheme `pagmatch://`).
- [ ] 🟢 Tester les notifications push avec **2 devices / 2 comptes** (piège token par-appareil — voir `project_push_notifications`).

---

## Ordre d'exécution recommandé
1. **Phase 1** (RLS + Turnstile) — sécurité, prioritaire, demandé explicitement.
2. **Phase 2.1 / 2.2** (politique + CGU + liens in-app).
3. **Phase 3.1 / 3.2** (suppression compte + déclarations stores).
4. Reste de la Phase 2 (CNDP, mineurs) + Phase 3.3/3.4.
5. **Phase 4** (post-launch).

## Références mémoire liées
`project_captcha_migration`, `feedback_hcaptcha_rn_pitfalls`, `project_ios_deployment`,
`project_password_reset`, `project_share_links`, `project_push_notifications`.
