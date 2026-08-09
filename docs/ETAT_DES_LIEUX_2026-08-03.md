# PAG MATCH — État des lieux technique

**Date :** 2026-08-03 · **Auditeur :** session Claude (lecture seule)
**Périmètre :** `react-matchup` (Expo SDK 54 + expo-router + Supabase), branche `feature/refonte-defi` (commit `8197a54`).
**Méthode :** lecture croisée code / migrations / `schema.sql` (photo prod du **2026-06-28**) / docs de suivi ; `npx tsc --noEmit` ; git read-only. Aucune modification hors ce fichier.

> ⚠️ Note de session : au démarrage de l'audit, ~38 fichiers modifiés + 5 non suivis étaient présents. **Pendant** l'audit, un commit `8197a54 « KJ/ajout-des-defis-amelioré »` (fait par l'utilisateur, pas par l'auditeur) les a intégrés à `feature/refonte-defi` et poussés. Le contenu analysé = le contenu commité.

---

## 1. Synthèse

L'app est **fonctionnellement riche et étonnamment cohérente** : typecheck à 0 erreur, prédicats métier centralisés et réellement respectés (places, invitations, scores, cloche), RLS en prod, légal complet. Le code n'est pas le problème — **l'ops et la vérification le sont**. Les 3 risques majeurs :
1. **Le backend n'est presque pas versionné** : `.gitignore` ignore tout le dossier `supabase/` — ~61 migrations et 6 Edge Functions sur 7 n'existent que sur ce disque et dans la prod.
2. **L'état réel de la prod est invérifiable depuis le code** : la seule photo du schéma date du 28/06 ; une dizaine de migrations (défis, badges skips, auto-validation, rappels…) sont dans un état « appliquée ? » inconnu alors que le client les suppose.
3. **Rien de la refonte défi (68 commits) n'a été testé sur device**, et le cahier de recette est quasi entièrement non déroulé ; s'y ajoutent les bloquants externes connus : SMTP custom absent (casse tests **et** launch), comptes stores / D-U-N-S non lancés.
Deux findings sécurité (RPC `free_spot_and_promote` et fonction `send-push` appelables par tout utilisateur authentifié) sont à corriger avant ouverture au public.

---

## 2. Tableau des bloquants (avant mise en production)

| # | Gravité | Bloquant | Référence | Effort |
|---|---|---|---|---|
| 1 | 🔴 | **Backend non versionné** : `supabase` entier dans `.gitignore` → seuls 15 fichiers de migrations + `send-push` sont suivis par git ; 69 fichiers (61 migrations, 6 fonctions, `sql/`) n'existent que sur ce PC. Perte disque = perte de la source RLS/ELO/RPC. | `.gitignore:44` (et `:46` pour `sql`) | **S** (retirer la ligne, `git add`, commit) |
| 2 | 🔴 | **SMTP custom Supabase absent** : emails Auth bridés ~2-4/h → inscriptions en série impossibles, launch cassé. Constat de juin toujours listé non fait. | `docs/DEPLOIEMENT_MAROC.md:67-80` | **S** (dashboard + DNS) |
| 3 | 🔴 | **État des migrations en prod inconnu** : le client lit `app_config`, `badge_prompt_skips`, `monthly_recap`, les tables défi… sans preuve que tout est appliqué (cf. §7.1). Un écran peut planter en prod sur une table absente. | §7.1 | **S** (requête `information_schema` fournie §8) |
| 4 | 🟠 | **`free_spot_and_promote(p_game_id)`** : `SECURITY DEFINER`, `GRANT … TO authenticated`, aucun `auth.uid()`, aucun contrôle qu'une place est libre → tout joueur connecté peut promouvoir la file d'attente ou rouvrir (`status='open'`, `spots_available+1`) n'importe quelle partie. | `supabase/migrations/block_accepted_overlaps.sql:122-210` ; appel client `app/(tabs)/lobby.tsx:2405` | **M** |
| 5 | 🟠 | **`send-push` sans contrôle métier** : tout utilisateur authentifié peut invoquer la fonction avec `playerIds`/titre/corps arbitraires → spam/phishing push vers toute la base. (Si `verify_jwt` est désactivé côté dashboard, c'est 🔴 : accessible sans compte — à confirmer.) | `supabase/functions/send-push/index.ts:15-67` ; `lib/notify.ts:17` | **M** |
| 6 | 🟠 | **Refonte défi entière non testée device + non mergée** : 68 commits sur `feature/refonte-defi` absents de `main` ; le merge supprime l'ancien matchmaking 1v1 (`lib/challenges.ts` n'existe plus que sur `main`). | `git log main..HEAD` = 68 | **L** (recette + merge) |
| 7 | 🟠 | **Recette device jamais déroulée** (RLS smoke-test, suppression de compte — exigence revue Apple —, push 2 devices, reset PKCE…). | `CAHIER_RECETTE.md` (quasi tout ➖) ; `docs/DEPLOIEMENT_MAROC.md:33-44,129` | **L** |
| 8 | 🟠 | **Stores / D-U-N-S / Data Safety non lancés** (délai D-U-N-S Maroc ~30 j → chemin critique calendaire). | `docs/DEPLOIEMENT_MAROC.md:160-205` | externe |

---

## 3. Carte des features (Phase 1)

Légende état : ✅ codé & vérifié (prod ou test tracé) · 🟡 codé, **non vérifié sur device** · ⬜ pas codé / partiel · ☠️ mort.
« Backend » = migration(s) ; statut d'application : voir §7.1.

| Feature | Entrée (route) | Modules clés | Backend | État |
|---|---|---|---|---|
| Auth login/signup + captcha Turnstile | `app/(auth)/login.tsx`, `signup.tsx` | `components/TurnstileCaptcha.tsx`, `lib/supabase.ts` (PKCE, AsyncStorage) | `signup_player_trigger.sql`, config Supabase | ✅ (Turnstile testé device 2026-06-09, `DEPLOIEMENT_MAROC.md:62`) |
| Reset mot de passe (deep link PKCE) | `app/(auth)/forgot-password.tsx`, `reset-password.tsx` | `lib/supabase.ts:16` | toggles dashboard | 🟡 |
| Onboarding (carousel + checklist + centre d'aide) | `components/OnboardingCarousel.tsx`, `components/guide/*`, `components/activity/OnboardingChecklist.tsx` (`activite.tsx:184`) | `lib/guideTheme.ts` | — | 🟡 |
| Accueil (hero ELO, pending, badges à distribuer) | `app/(tabs)/index.tsx` | `lib/matches.ts`, `lib/elo.ts` | `badge_prompt_skips.sql` (lu `index.tsx:333,399`) | 🟡 (dépend d'une migration non confirmée) |
| Création de partie (wizard, conflits ±2h, invités) | `app/(tabs)/CreateWizard.tsx` | `OVERLAP_MS` (`CreateWizard.tsx:69`), `lib/venuePicker.ts` | triggers overlap | 🟡 |
| Lobby (Explorer / Mes matchs / Historique) | `app/(tabs)/lobby.tsx` (2 935 l.), `GameDetailsSheet.tsx` | `lib/games.ts` (`join_game`, `freeSpots`, `occupiesSpot`) | `join_game_rpc.sql`, `eject_overlapping_candidatures.sql`, `block_accepted_overlaps.sql` | ✅ backend (prod 17/06) / 🟡 UI récente |
| Candidatures + mot ≤140 car. + vote hors-niveau | `components/ApplicationNoteSheet.tsx`, `lobby.tsx:2280-2345` | `application_note.sql`, `free_spot_and_promote.sql` | ✅ (livré 16/06) ; ⚠️ approbation non atomique (§5.3) |
| Liste d'attente & promotion in-niveau | `lobby.tsx:2405` (RPC) | `free_spot_and_promote` (redéfini `block_accepted_overlaps.sql:122`) | ✅ prod 17/06 |
| Invitations & expiration TTL (48 h/−6 h/plancher 1 h) | notifs + lobby | `lib/games.ts:67` (`isInvitationVisible`), `withdraw_invitation_rpc.sql` | `invite_expiry.sql:28-31` + cron + webhooks | ✅ backend prod 12/06 / 🟡 client |
| **Défis 2v2** (hub 4 onglets : À relever / Mes défis / Invitations / À défier) | `app/(tabs)/matchmaking.tsx:28,712-716` | `lib/defis.ts` (couche données unique), RPC `defi_apply/accept/decline/cancel_defi` | ~20 fichiers `defi_*.sql` | 🟡 (**zéro test device**, suivi : 4 migrations appliquées 12/07, le reste à confirmer) |
| Binômes ouverts / vitrine + nominations | `components/profile/ShowcaseManager.tsx`, onglet profil | `lib/showcase.ts` (RPC `showcase_open/confirm/close`) | `showcase_binomes.sql`, `showcase_rpcs.sql`, `showcase_autoclose.sql` | 🟡 |
| Ancien matchmaking 1v1 (`challenges`) | — | supprimé sur cette branche (`lib/challenges.ts` n'existe que sur `main`) | table `challenges` en prod (`schema.sql:185-202`) | ☠️ sur la branche (aucun lecteur — vérifié grep) |
| Saisie de score + validation croisée + contestation | `app/score-entry.tsx`, `lobby.tsx:762-890` | `lib/matches.ts` (`matchNeedsMyAction`), `lib/games.ts:33` (`isGameReadyToScore`) | `counter_resolution.sql`, trigger ELO | ✅ boucle `pending→counter_proposed→validated/disputed` fermée (l'écran de résolution joueur EXISTE : `lobby.tsx:779-890`) |
| Auto-validation score +24 h + fenêtre badges 48 h | (backend) + `lib/notifications.ts:33` | `auto_validate_pending_scores.sql:30-94` (cron 5 min) | 🟡 migration **non appliquée** d'après suivi 07/07 — à confirmer |
| ELO (placement K=85 ×4 matchs, K par fiabilité 16-59, stake ×défi) | trigger DB + aperçu client | `lib/elo.ts:6-14,68-73` | `elo_on_validate.sql`, `elo_per_player_k.sql`, `elo_placement_phase.sql`, `defi_stake_elo.sql` | ✅ (constantes front=back vérifiées, §5.6) |
| Badges & réputation (Phosphor data-driven) | `app/(tabs)/index.tsx`, `score-entry.tsx:458` | `lib/badges.ts`, `components/profile/badgeIcons.tsx`, `BadgePill.tsx`, `BadgeDefsProvider` | `badge_defs.sql` (en prod : `schema.sql:364-373`) | ✅ table / 🟡 skips (`badge_prompt_skips.sql` non confirmée) |
| Classements (podium, ligues, Amis = `follows`) | `app/(tabs)/ranking.tsx` | `lib/community.ts:38-92` | — | 🟡 |
| Profil joueur (header sombre, 5 onglets, palmarès, binômes) | `app/(tabs)/player/[id].tsx` (1 635 l.) + `components/profile/*` | `lib/achievements.ts` (`get_player_achievements`) | `player_achievements.sql` (prod) | 🟡 |
| Communauté : hub, amis, invite/parrainage (`pagmatch.com/u/…`) | `app/community/*` | `lib/community.ts:17,383-403` | `community_social.sql` (prod) | 🟡 |
| Fil d'activité + commentaires + réactions + alertes de partie | `app/community/index.tsx`, `comments/[eventId].tsx`, `alerts.tsx` | RPC `add_activity_comment`, `toggle_*_reaction`, `find_matching_alerts` | `activity_comments_rpc.sql`, `comment_reactions.sql` (tables en prod : `schema.sql:270-295`) | ✅ tables / 🟡 device |
| Moments (partage in-app d'un match, 100 % sans média) | onglet Activité (`activite.tsx:203-218`), `components/activity/Moment*` | `lib/activityFeed.ts:117-137` (`share_match_moment`) | `activity_moments.sql` (`highlighted_at` en prod : `schema.sql:280`) | 🟡 |
| Stories (export image local, aucun média serveur) | `components/StoryComposerV2.tsx`, `story/*` | `lib/community.ts` (liens) | — (conforme confidentialité `app/legal/confidentialite.tsx:37`) | ✅ choix produit / 🟡 device |
| Bilan mensuel « wrapped » | `app/bilan/[month].tsx`, `components/bilan/*`, `BilanStory`/`BilanRecapFull` | `lib/bilan.ts:57-101` | `monthly_recap.sql` (**vue** `security_invoker`), `monthly_recap_notify.sql`, fonction `monthly-recap-push` | 🟡 (vue à confirmer en prod) |
| Chat de partie (realtime, réactions, archivés) | `app/chat/[gameId].tsx`, `app/(tabs)/chats.tsx`, `archived-chats.tsx` | `hooks/useGameChats.ts`, RPC `toggle_message_reaction` | `messages.reactions` (prod) | ✅ (feature ancienne) |
| Messages directs (demande, privacy 3 niveaux, blocage) | `app/dm/[conversationId].tsx`, `dm-settings.tsx` | `lib/directChats.ts`, `hooks/useDirectChats.ts` | `direct_chats.sql` (tables en prod : `schema.sql:374-397`) | 🟡 |
| Notifications in-app (source unique) + cloche | `app/(tabs)/notifications.tsx:35-39` | `lib/notifications.ts:30` (`buildNotificationItems`), `hooks/useNotificationCount.tsx:64` | `dismissed_notifications.sql` (prod) | ✅ architecture / 🟡 device |
| Push (Expo) + webhooks serveur | `hooks/usePushNotifications.ts:60-70` | `supabase/functions/send-push`, `notify-{eject,invite-expired,promotion,vote-requested}` | webhooks dashboard (vérifiés actifs 17/06) | ✅ pipeline / ⚠️ piège token par appareil non testé |
| Rappels de match T-1 h / T-30 min | (100 % backend) | `match_reminders.sql:27-192` (trigger + cron) | colonnes en prod (`schema.sql:100-102`) ; **fonctions/cron à confirmer** | 🟡 |
| Carte des clubs (WebView Leaflet local + OSM) | `app/clubs-map.tsx` | `lib/clubsMap.ts`, `lib/clubsMapHtml.ts`, `scripts/vendor-leaflet.mjs` | `clubs_geo_columns.sql` + géocodage (108 clubs, prod) | 🟡 |
| FRMT (vérif auto nom+prénom, bonus, scraper) | `app/(tabs)/admin.tsx:734-950` | `lib/frmt-match.ts`, fonction `trigger-frmt-scrape` (admin-only : `index.ts:38-50`) | `frmt_auto_match_bonus.sql` (colonnes en prod : `schema.sql:35-36`) | ✅ |
| Admin (litiges, joueurs, parties, genre, signalements, FRMT, config, badges) | `app/(tabs)/admin.tsx` (gate `is_admin` `:968`) | — | `app_config.sql` (lu `admin.tsx:1138` — **présence prod à confirmer**) | 🟡 |
| Légal + suppression de compte in-app | `app/legal/cgu.tsx`, `confidentialite.tsx` (hors guard : `app/_layout.tsx:41-42`) | `lib/legal.ts` (QUARTZTEC complet) | `account_deletion.sql` (RPC en prod 10/06), appel `player/[id].tsx:1609` | ✅ écrit / 🟡 **suppression jamais testée** (exigence Apple) |
| Modération (blocage, signalement, profanité) | menu profil, long-press chat, `ReportReasonSheet` | `lib/moderation.ts`, `lib/profanity.ts` (utilisé `lobby.tsx:2859`, `comments/[eventId].tsx:50`) | `moderation.sql` (prod 10/06) | ✅ |

Routes non déclarées dans le Stack racine mais routées par fichier : `clubs-map`, `dm-settings` — elles échappent au bloc `<Stack.Protected>` (`app/_layout.tsx:43-51`) ; données néanmoins protégées par RLS. À vérifier (comportement non connecté).

---

## 4. Design system (Phase 2)

**Verdict : un seul langage visuel de fait… mais pas celui configuré.**

- **Sources de vérité** : `lib/colors.js` (palette unique, lue par `lib/theme.ts` et `tailwind.config.js`) ; `lib/theme.ts:20-63` (Spacing 4-48, FontSize 11-36, Radius 8-24-full, Fonts) ; sous-thèmes `lib/auth-theme.ts` (flow auth) et `lib/guideTheme.ts` (guide/aide).
- **NativeWind est mort** : configuration complète (`babel.config.js:5-6`, `metro.config.js:2`, `tailwind.config.js`, `global.css`, deps `package.json:34,52`) mais **0 occurrence de `className=`** dans tout `app/`+`components/`+`lib/`. 100 % du style passe par `StyleSheet.create` (9 fichiers) et surtout **3 314 `style={{…}}` inline**. → Décider : adopter réellement NativeWind ou retirer l'outillage (build + dette mentale gratuits).
- **Couleurs en dur** : **684 littéraux hex** dans `app/`+`components/` court-circuitent `Colors` (ex. `#10B981` dans `app/legal/confidentialite.tsx:61`). La palette réelle reste néanmoins cohérente : noir `#0A0A0A` / jaune brand `#FFC11A` / surfaces `#F5F5F4`-blanc / ligues (`lib/colors.js:57-63`).
- **Typographie** (`lib/theme.ts:48-63`) : **Inter** = UI courante ; **Barlow Condensed 900 italic** = titres de bienvenue ; **Anton** = display legacy ; **Manrope** = legacy compat (et pourtant c'est *lui* que `tailwind.config.js` déclare en `font-sans` — incohérent, mais sans effet puisque Tailwind est inutilisé).
- **Icônes** : la cible (registre `badgeIcons.tsx` Phosphor + `BadgePill` + table `badge_defs`) est en place et data-driven (`lib/badges.ts:5`, `admin.tsx:1196-1251`). Émojis résiduels : `getCompatTier` (`lib/theme.ts:128-133`), titres/notifs (`lib/notifications.ts:233-330`), guide (`components/guide/help/data.ts`), `components/community/icons.tsx`, InAppBanner. Résiduel assumable (texte), pas des tables d'icônes dupliquées.

| Élément d'UI | Implémentations distinctes | Recommandation |
|---|---|---|
| Avatar (initiales/pastille) | **8** (`components/community/Avatar.tsx`, `ChatRow.tsx`, `profile/components.tsx`, `story/StoryPrimitives.tsx`, locaux dans `CreateWizard`, `GameDetailsSheet`, `lobby`, `dm/[conversationId]`) | unifier sur `community/Avatar.tsx` |
| Pill / badge-chip | ≥5 (`components/Pill.tsx`, `profile/BadgePill.tsx` + locaux `lobby.tsx`, `score-entry.tsx`, `StoryComposer.tsx`) | garder `Pill` + `BadgePill`, supprimer les locaux |
| Carte de match | 1 ✅ (`lib/matchView.ts` + `MatchScoreCard`, réutilisée partout, y compris défis depuis `d89fba6`) | RAS |
| Composer de story | 2 (`StoryComposer.tsx` **mort** — seul `StoryComposerV2` est importé : `lobby.tsx:18`, `player/[id].tsx:28`, `invite.tsx:13` ; `StoryCanvas.tsx` non importé) | supprimer V1 + `StoryCanvas` |
| Boutons / inputs | inline partout (constat `CAHIER_RECETTE.md:44` toujours vrai) | extraire `Button`/`Input` si refonte, sinon assumer |

---

## 5. Incohérences (Phase 3)

Les 8 prédicats « source unique » attendus sont **globalement respectés** — vérifié lecteur par lecteur :
rendu match = `matchToView` (lobby `:1124,1275`, `ActivityCard.tsx:77`, `MomentsRail.tsx:28`, `MomentOverlay.tsx:60`) ; places = `freeSpots()` dérivé (`lib/activityFeed.ts:78,101`, `lib/clubsMap.ts:21`, lobby `:508,543`) ; statut participant = `isInviteActive`/`occupiesSpot` (GameDetailsSheet `:89,256,306,318`, CreateWizard `:402`, lobby `:257,310,1870,2145,2284,2447`) ; à scorer = `isGameReadyToScore` (score-entry `:270`, notifications `:158`, lobby `:1944`) ; invitation = `isInvitationVisible` (notifications `:183`) ; cloche = `buildNotificationItems().length` (`useNotificationCount.tsx:64`, `notifications.tsx:39`). Divergences restantes :

1. **`freeSpots` dupliqué** — `app/(tabs)/lobby.tsx:68-73` redéfinit localement la fonction de `lib/games.ts:117-127` (logique identique aujourd'hui). Conséquence : une future évolution (ex. formats ≠ 4 joueurs) divergera silencieusement. → importer depuis `lib/games`.
2. **`OVERLAP_MS` défini 3 fois** — `CreateWizard.tsx:69` (90+30 min), `matchmaking.tsx:365`, `lobby.tsx:2118` (2 h littéral). Valeurs égales aux 4 migrations DB (`interval '2 hours'` dans `block_accepted_overlaps.sql`, `eject_overlapping_candidatures.sql`, `overlap_strict_2h.sql`, `defi_waitlist.sql`) — synchrones **aujourd'hui**, mais 7 points de modification. → constante exportée unique.
3. **Approbation de candidature non atomique** — `lobby.tsx:2280-2340` : lecture des `approvals`, décision `willAccept` côté client (place libre = TOCTOU), `update` direct de `game_participants` puis décrément client de `spots_available` (`:2336`, idem `:2216`, `:2617`). Deux approbateurs simultanés sur la dernière place peuvent produire 5 joueurs « accepted » (le trigger DB ne bloque que le chevauchement horaire, pas la sur-capacité). Conséquence utilisateur : partie à 5, compteur faux. → RPC d'approbation atomique, comme `join_game`.
4. **Ancien système `challenges` mort sur la branche, vivant sur `main`** — `lib/challenges.ts` + `isReceivedChallengeVisible` n'existent plus ici (aucun lecteur de la table `challenges` — grep vide) mais existent sur `main` (`main:lib/challenges.ts:32`). Le merge de `feature/refonte-defi` supprimera de fait le défi 1v1 : c'est le choix produit apparent, mais la table prod + `challenges_baseline.sql` + les mentions AUDIT.md resteront orphelines. → acter la dépréciation (et purger la table plus tard).
5. **`counter_proposed`** : contrairement au suivi historique, l'écran de résolution joueur **existe** (`lobby.tsx:762-890`, action `resolve` de `lib/matches.ts:23-27`, carte notif `notifications.ts:292-297`). Pas d'état impossible détecté ; la limite connue (inversion du vainqueur → passage admin) demeure (`AUDIT.md:79`).
6. **Front vs back — valeurs vérifiées égales** : ancres ELO→niveau `[700…2300]` (`lib/theme.ts:91-94` = `elo_level_helpers.sql:4,14,34`) ; K = 16+48·(1−fiab/100), clamp 10 (`lib/elo.ts:11-16` = `elo_per_player_k.sql:37`) ; placement K=85 / 4 matchs (`lib/elo.ts:6-7` = `elo_placement_phase.sql:11,28`) ; stake multiplier (`lib/elo.ts:73,154` = `defi_stake_elo.sql:34,85`) ; fenêtre score 48 h + délai 1 h 30 (`lib/games.ts:16-20`) cohérents avec `auto_validate_pending_scores.sql` (24 h auto) et `match_reminders.sql`. TTL invitation défini **uniquement** côté DB (`invite_expiry.sql:28-31`) — pas de duplication front ✅.
7. **Realtime** : tous les canaux relevés sont nommés avec suffixe unique et fermés au démontage (`chat/[gameId].tsx:374-400` ×3, `(tabs)/_layout.tsx:203-248` ×4, `useGameChats.ts:145-171` ×2, `useNotificationCount.tsx:143-174`, `dm/[conversationId].tsx:130-135`, `useDirectChats.ts:44-48`). Pas de fuite détectée. ⚠️ Dépend de publications realtime activées en prod (`realtime_game_participants.sql`, realtime DM dans `direct_chats.sql`) — à confirmer.
8. **`player_favorites` à moitié orphelin** — le classement « Amis » et l'étoile sont passés sur `follows`, mais `player/[id].tsx:702,791-815` lit/écrit encore `player_favorites` (`toggleFav` défini, aucun `onPress={toggleFav}` trouvé → code mort probable). → purger.

---

## 6. Sécurité (Phase 4)

### 🔴/🟠 Élevé
- **E1 — `free_spot_and_promote` ouvert à tous les connectés** (`block_accepted_overlaps.sql:122-210`, `GRANT … TO authenticated` `:210`). Pas d'`auth.uid()`, pas de vérification de place réellement libre ni de légitimité de l'appelant. **Scénario** : un joueur en waitlist appelle `rpc('free_spot_and_promote', {p_game_id})` sur une partie pleine → il est promu `accepted` (ou la partie repasse `open` avec `spots_available+1`). → exiger que l'appelant soit créateur/participant, et re-dériver l'occupation avant promotion.
- **E2 — `send-push` = canal de push arbitraire** (`send-push/index.ts:21-35` : lit `playerIds`, `title`, `body` du corps sans aucun contrôle d'appelant au-delà du JWT de plateforme). Tout compte peut notifier **n'importe qui** avec un contenu arbitraire (usurpation « PAG MATCH »). Les 4 webhooks + crons l'appellent avec la clé service (légitime) ; le client l'appelle aussi (`lib/notify.ts:17`) — c'est le design « notifs client » qui est intrinsèquement spoofable. **Si** `verify_jwt` est désactivé pour cette fonction (à confirmer au dashboard), n'importe qui sur Internet peut le faire → Critique. → à terme : notifs 100 % serveur (webhooks), ou contrôle en fonction (l'appelant doit être lié à l'événement).

### 🟡 Moyen
- **M1 — Écritures TIER 2 larges** : `enable_rls_phase1.sql` laisse `matches`, `open_games`, `game_participants`, `reputation_votes` en « écriture authentifiée » (resserrement phase 2 jamais fait — `DEPLOIEMENT_MAROC.md:25`). Un connecté peut ex. insérer des `reputation_votes` en se déclarant `giver_id` d'autrui ? — les policies exactes par table sont à re-vérifier en prod (« à vérifier », pas démontré ici).
- **M2 — Pas de rate-limiting applicatif** : aucun mécanisme (grep `rate|cooldown|throttle` vide côté client et migrations) sur candidatures, signalements, commentaires, réactions. Seule garde : DM limité à 1 message avant acceptation (`direct_chats.sql:173`). → abuse possible par volume.
- **M3 — Session dans AsyncStorage** (`lib/supabase.ts:9`) et non `expo-secure-store`. Acceptable dans le sandbox mobile, mais l'écart avec l'intention documentée (recette §*client*) est à acter.

### 🟢 Faible / points sains
- **Secrets** : aucune clé `service_role` côté client (uniquement `Deno.env` des fonctions). `.env` **est suivi par git** mais ne contient que l'URL, la clé `anon` (JWT décodé : `role=anon`) et la site key Turnstile — publiques par design. `google-services.json` suivi (clé API Firebase, non secrète par design ; restreindre côté console). `SENDING KEY.txt` (36 o, un token) est bien gitignoré (`.gitignore:51`) mais traîne à la racine — nature à confirmer, à déplacer hors du repo.
- **RPC SECURITY DEFINER** : sur ~40 fichiers, les flux sensibles contrôlent l'identité : DM complets (`direct_chats.sql:93-173,202,241` : auth, blocage, privacy, membership), `join_game`, `withdraw_invitation`, `delete_my_account`, RPC défi (`defi_apply/accept/decline`), commentaires/réactions. Les `SECURITY DEFINER` sans `auth.uid()` sont des **triggers/crons** (légitime) — **sauf E1 ci-dessus**.
- **Edge functions** : `trigger-frmt-scrape` = modèle correct (JWT validé + flag admin, `index.ts:38-50`). Les `notify-*` sont des cibles de webhooks (appelées avec Bearer service role) — mêmes réserves de `verify_jwt` que E2, impact moindre (contenu contraint par le payload DB).
- **WebViews** : contenu local injecté, mais `originWhitelist={['*']}` aux deux endroits (`TurnstileCaptcha.tsx:87`, `clubs-map.tsx:72`) — à restreindre.
- **Données perso** : politique alignée avec la réalité du code — pas de média serveur (`confidentialite.tsx:33-37` vs Stories/Moments sans upload), sous-traitants listés, éditeur nommé (`lib/legal.ts`). Suppression de compte in-app branchée (`player/[id].tsx:1609` → RPC anonymisation) — **jamais testée de bout en bout**.
- **Modération** : blocage bidirectionnel appliqué aux chats, feed, défis, DM, notifs (`getHiddenPlayerIds` utilisé dans `lib/defis.ts:58`, `notifications.ts:141`…) ; signalement 5 cibles ; profanité sur commentaires + mots de candidature.

---

## 7. Reste à faire (Phase 5)

### 7.1 Migrations — état d'application présumé
Référentiel : `schema.sql` = photo des **tables** prod au **2026-06-28**. Limites : (a) les fonctions/vues/triggers/crons n'y figurent pas ; (b) tout ce qui a été appliqué **après** le 28/06 est invisible. Seule preuve définitive = requête `information_schema`/`pg_proc`/`cron.job` en prod (§8).

**A. Corroborées appliquées** (objet visible dans `schema.sql`, ou suivi daté) — 45 fichiers, dont :
`align_players_schema`, `add_invited_status`, `add_push_token`, `team_side_accepted_only`, `normalize_player_sides`, `unique_player_name`, `signup_player_trigger`, `community_social`, `gender_change_requests`, `moderation` (10/06), `account_deletion` (10/06), `soft_delete_deleted_at` (10/06), `cleanup_unconfirmed_accounts` (10/06), `enable_rls_phase1` (08/06), `dismissed_notifications`, `player_achievements` (13/06), `badge_defs` (`schema.sql:364`), `analytics_events` (`:355`), `direct_chats` (`:374-397`), `invite_expiry` (`invite_expires_at` `:115`), `application_note` (`:116`), `add_dispute_reason` (`:65`), `match_reminders` — **colonnes** (`:100-102`), `frmt_auto_match_bonus` (`:35-36`), `activity_moments`/`activity_highlighted_at` (`:279-280`), `comment_reactions` (`:291`), `challenges_baseline`/`challenges_link_game` (`:185-202`), `clubs_geo_columns`/`update_clubs_geo`/`import_clubs_maroc` (`:159-162`), `join_game_rpc`, `free_spot_and_promote`, `block_accepted_overlaps`, `eject_*`, `overlap_strict_2h` (suivi 12-17/06), `elo_on_validate`, `elo_per_player_k`, `elo_level_helpers`, `counter_resolution`, `realtime_game_participants` (suivi 10/06), `backfill_spots_available`, `perf_indexes_chats_notifs`, `activity_comments_rpc`.

**B. Probablement appliquées, invérifiables depuis le code** (fonctions/vues seulement) : `monthly_recap` (vue — lue par `lib/bilan.ts:57,75` : si absente, l'écran Bilan est cassé), `monthly_recap_notify`, `activity_week_stats`, `suggested_open_game` (RPC lues par `lib/activityFeed.ts:12,33`), `elo_placement_phase`, `drop_dead_objects`, crons de `match_reminders` (`:192`) et `cleanup_unconfirmed_accounts`.

**C. NON appliquées ou statut inconnu — À VÉRIFIER EN PRIORITÉ** (le client les suppose) :
| Migration | Consommateur client | Signal |
|---|---|---|
| `badge_prompt_skips.sql` | `index.tsx:333,399`, `notifications.ts:133` | table absente de `schema.sql` (28/06) ; suivi 02/07 : « PAS appliquée » |
| `auto_validate_pending_scores.sql` | promesse produit « validé sous 24 h » | suivi 07/07 : « PAS appliquée » |
| `app_config.sql` | `admin.tsx:1138-1148` | table absente de `schema.sql` |
| Famille défi (`defi_applications`, `defi_apply/accept/decline`, `defi_stake_column/elo`, `defi_waitlist`, `defi_join_guard`, `defi_leave_atomic`, `defi_draft_publish`, `defi_targeted_decline`, `defi_fix_partner_side`, `defi_lifecycle`, `defi_apps_select_participants`) | tout `lib/defis.ts` + hub | suivi 12/07 : « 4 migrations appliquées » — **lesquelles ? les ~8 autres ?** |
| `defi_server_notifs.sql` | pushes refus/conversion | suivi : « PAS appliqué » (pushes retombent côté client) |
| Famille vitrine (`showcase_binomes`, `showcase_rpcs`, `showcase_autoclose`) | `lib/showcase.ts`, notifs `:127-131` | tables absentes de `schema.sql` (post-28/06 ?) |

### 7.2 Git
- **Branche courante** `feature/refonte-defi` : **68 commits** d'avance sur `main` (`main` = `2fd3936` du 28/06 = `fix/refoonte-activité`). Toute la refonte défi/vitrine + notifs serveur défi n'existe **que** sur cette branche.
- Branches restantes : `fix/frmt-scraper-selectors` absent en local (fix classement A8 — suivi : à merger), `feature/expiration-invitations` (8 commits **derrière** main, 0 devant → mergée de fait, supprimable), `build/*`, `fix/gemini/authentication`, `fix/saisir-un-score`, `fix/signup-and-other` (anciennes, commits « KJ »).
- **`.gitignore` ignore `supabase`, `sql`, `schema.sql`** (`.gitignore:44-46`) : 69 fichiers backend non suivis (61 migrations, 6 edge functions sur 7, tout `sql/`). Les 15 migrations défi/vitrine suivies l'ont été en forçant l'ajout. **Bloquant n°1** du §2.
- Fichiers suivis qui ne devraient sans doute pas l'être : `.env`, `google-services.json` (contenus non critiques, cf. §6, mais à acter).

### 7.3 Dette
- `npx tsc --noEmit` : **0 erreur** (exécuté ce jour) — les erreurs 5-6 du `CAHIER_RECETTE.md:21-22` sont résolues.
- `TODO`/`FIXME`/`@ts-ignore` : **0**. `console.*` : 44 occurrences / 13 fichiers (dont logs verbeux `usePushNotifications.ts`, `lib/notify.ts` — à réduire avant release). `as any` : **159** (dette de typage `types/index.ts` toujours réelle, cf. `AUDIT.md §4`).
- Code mort : `components/StoryComposer.tsx` + `StoryCanvas.tsx` (aucun import), `toggleFav`/`player_favorites` (`player/[id].tsx:788-815`), table `challenges` (sur cette branche), tout l'outillage NativeWind (§4).
- Non audité faute d'outillage : dépendances npm inutilisées (`@hcaptcha/react-native-hcaptcha` a bien disparu de `package.json` ✅).

### 7.4 Croisement docs ↔ code
- **`TASKS.md`** : totalement périmé (Phases 11-13 « 🔲 » alors que notifications, composants et builds APK existent ; « backend: no changes needed » contredit par 76 migrations). À archiver.
- **`AUDIT.md`** (31/05) : l'essentiel est résolu et re-vérifié ici (ELO trigger, counter_proposed, non-lus, normalisations). Restes vivants : dette typage §4, `status:'canceled'` vs `'cancelled'` (§8 mineurs), expiration douce des `challenges` — devenue sans objet si la table meurt avec le merge.
- **`CAHIER_RECETTE.md`** : la quasi-totalité des cases est non cochée — c'est le vrai reste à faire. Sections manquantes au cahier : défis 2v2/vitrine, DM, moments/bilan, carte clubs (écrites après la révision du 10/06).
- **`docs/DEPLOIEMENT_MAROC.md`** : restes exacts = SMTP (§1.3, 🔴), smoke-test RLS (§1.1), vérif app web partageant la base (§1.1), CNDP (§2.3), D-U-N-S/comptes stores (§3.5), Data Safety/Nutrition Labels (§3.2), test suppression de compte (§3.1), webhook `notify-vote-requested` (§3.6 — le suivi ultérieur le dit vérifié actif le 17/06 : cocher ou re-vérifier), bascule et re-déploiement landing (§4).
- **`docs/PROCESS_LANCEMENT_STORES.md`** : non contredit par le code ; dépend des mêmes préalables externes.

---

## 8. Angles morts — à vérifier hors code

1. **Migrations réellement appliquées** — exécuter en prod (SQL Editor, lecture seule) :
   ```sql
   select table_name from information_schema.tables where table_schema='public'
     and table_name in ('defi_applications','showcase_binomes','badge_prompt_skips','app_config');
   select viewname from pg_views where schemaname='public' and viewname='monthly_recap';
   select proname from pg_proc join pg_namespace n on n.oid=pronamespace and n.nspname='public'
     where proname in ('defi_apply','defi_accept','defi_decline','cancel_defi','showcase_open',
                       'auto_validate_pending_scores','send_match_reminders','activity_week_stats','suggested_open_game');
   select jobname, schedule from cron.job;
   ```
2. **Edge Functions** : quelles fonctions sont déployées, et `verify_jwt` est-il activé pour `send-push` et les `notify-*` ? (détermine la gravité de E2).
3. **Webhooks Database** : les 4 triggers `game_participants` sont-ils toujours actifs après les évolutions défi (payloads inchangés ?).
4. **Publications realtime** : `messages`, `game_chat_reads`, `game_participants`, `direct_messages`, `direct_conversations` sont-elles toutes dans `supabase_realtime` ?
5. **Auth dashboard** : SMTP custom, « Confirm email », rate limits, protection captcha toujours active côté serveur.
6. **Device** (rien de la branche n'a été vu à l'écran) : hub défi complet, vitrine/nominations, DM, moments/bilan, carte clubs, suppression de compte, push sur 2 devices (piège token par appareil), autofill Samsung, reset PKCE réel.
7. **`SENDING KEY.txt`** : de quel service est ce token (36 o) ? Doit-il être révoqué/rangé dans un gestionnaire de secrets ?
8. **App web `matchup_padel`** : partage-t-elle toujours la base ? Ses écritures respectent-elles la RLS posée depuis ?
9. **Landing `pagmatch.com`** : version déployée alignée avec `lib/legal.ts` du 10/06 (y compris retrait « photos/vidéos ») ?
10. **Play Console / App Store** : rien d'observable depuis le code — état des comptes, D-U-N-S, classification IARC à confirmer côté dashboards.

---

*Fin du rapport. Aucun correctif appliqué — les recommandations ci-dessus sont à arbitrer.*
