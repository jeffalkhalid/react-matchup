# Prompt — Audit / État des lieux PAG MATCH

> Copier-coller le bloc ci-dessous dans une nouvelle session d'agent (idéalement en mode plan / lecture seule).

---

## MISSION

Tu es auditeur technique sur **PAG MATCH**, une application React Native (Expo SDK 54, expo-router,
NativeWind, TypeScript) adossée à **Supabase** (Postgres + RLS + Edge Functions Deno + Realtime + pg_cron).
Racine du projet : `c:\Users\jeffa\Bureau\Native\react-matchup` (le dossier parent contient aussi
`activegame-landing`, `schema.sql`, `AUDIT.md`, `TASKS.md`).

Ta mission est **exclusivement de lire, comprendre et rapporter**. Tu produis un **état des lieux** :
ce que fait l'app, comment elle est construite, ce qui est incohérent, ce qui est risqué,
et ce qu'il reste à faire avant lancement.

### Règles absolues

1. **Aucune modification de code.** Pas d'`Edit`, pas de `Write` (sauf le fichier de rapport final),
   pas de `git commit`, `checkout`, `stash`, `merge` ni aucune commande qui touche l'arbre de travail.
   Il y a ~30 fichiers modifiés non commités : **ne pas y toucher, ne pas les « nettoyer »**.
2. **Aucune requête d'écriture en base**, aucune application de migration.
3. **Zéro affirmation non vérifiée.** Chaque constat cite `fichier:ligne`. Si tu n'as pas pu vérifier
   (ex. : état réel de la prod Supabase), tu l'écris explicitement en « à confirmer » plutôt que de deviner.
4. Tu peux lancer `npx tsc --noEmit` (lecture seule) et des commandes `git` **read-only**
   (`status`, `log`, `diff`, `branch`, `show`).
5. Distingue toujours trois états : **codé & vérifié** / **codé mais non vérifié sur device** /
   **pas codé**. Ne jamais confondre « le fichier existe » avec « la feature marche ».

---

## PHASE 1 — Cartographie fonctionnelle

Explore `app/`, `components/`, `lib/`, `hooks/` et dresse la liste des features réellement présentes.
Pour **chaque** feature :

- **Nom** et point d'entrée (écran / route expo-router).
- **Parcours utilisateur** reconstruit depuis le code (pas depuis les noms de fichiers).
- **Fichiers impliqués** : écran, composants, module `lib/`, hook, table(s) et RPC Supabase.
- **État** : complet / partiel / mort (code non atteignable, écran non routé, feature-flag off).
- **Dépendance backend** : migration SQL correspondante dans `supabase/migrations/`, et si elle
  semble appliquée (croiser avec `schema.sql` à la racine du repo parent).

Domaines à couvrir au minimum : authentification & captcha, onboarding, création de partie
(`CreateWizard`), matchmaking, lobby & candidatures, liste d'attente & promotion, invitations
& expiration, défis 2v2 / binômes / showcase, saisie et validation de score, ELO & niveaux,
badges & réputation, classements, profil joueur, communauté & fil d'activité, commentaires,
Stories / Moments, chats de partie et messages directs (DM), notifications push & in-app,
bilan mensuel, carte des clubs, admin, légal & suppression de compte.

## PHASE 2 — Design system & styles

Objectif : savoir si l'app a **un** langage visuel ou plusieurs empilés.

- Recense les sources de vérité de style : `lib/theme.ts`, `lib/colors.js`, `lib/auth-theme.ts`,
  `lib/guideTheme.ts`, `tailwind.config.js`, `global.css`.
- Détermine la **répartition réelle** entre classes NativeWind et `StyleSheet` / styles inline,
  écran par écran. Signale les écrans qui mélangent les deux.
- Extrais la palette effectivement utilisée, la typographie (Anton, Barlow Condensed, Inter, Manrope :
  qui sert à quoi ?), l'échelle d'espacement, les rayons, les ombres.
- Repère les **couleurs et tailles en dur** qui court-circuitent le thème, et les composants dupliqués
  (plusieurs implémentations d'une même carte / pill / bouton).
- Vérifie la cohérence des icônes : `lib/badges.ts` + `BadgePill` + registre `Icon` + `badge_defs`
  sont censés être la source unique. Liste tout emoji ou table d'icônes résiduel.
- Conclus par un tableau : élément d'UI → nombre d'implémentations distinctes → recommandation.

## PHASE 3 — Cohérence (le cœur de l'audit)

Le risque principal de ce projet, ce ne sont pas les bugs isolés mais les **divergences d'état** :
un même concept lu par plusieurs endroits avec des filtres différents. Traque-les activement.

Pour chaque concept ci-dessous, liste **tous** les lecteurs et vérifie qu'ils passent par le même
prédicat partagé :

| Concept | Source unique attendue |
|---|---|
| Rendu d'un match | `lib/matchView.ts` (`matchToView`) + `<MatchCard>` |
| Places libres | dérivé des participants (`freeSpots()`), **jamais** la colonne `spots_available` |
| Statut d'un participant | `isInviteActive` / `occupiesSpot`, jamais `status !== 'declined'` |
| Défi reçu visible | `isReceivedChallengeVisible` |
| Invitation visible | `isInvitationVisible` |
| Partie à scorer | `isGameReadyToScore` |
| Compteur de la cloche | `buildNotificationItems().length` (`lib/notifications.ts`) |
| Anti-chevauchement ±2h | front `OVERLAP_MS` **et** triggers DB, synchronisés |

Vérifie aussi :
- **Front vs back** : toute règle métier dupliquée entre le client TS et un trigger/RPC SQL
  (fenêtres de temps, seuils, plafonds de niveau, TTL). Signale toute valeur qui diverge.
- **Écriture atomique** : les chemins qui modifient des places / statuts passent-ils par les RPC
  (`join_game`, `free_spot_and_promote`, départ atomique défi) ou font-ils des `update` directs ?
- **Realtime** : abonnements posés, désabonnements au démontage, risques de fuite ou de doublon.
- États impossibles atteignables (ex. `counter_proposed` sans écran de résolution côté joueur).

## PHASE 4 — Sécurité

1. **Secrets** : cherche clés, tokens, mots de passe en dur dans le repo (y compris `SENDING KEY.txt`,
   `google-services.json`, `app.json`, `eas.json`, `scripts/`). Vérifie qu'aucune clé `service_role`
   n'est atteignable côté client. Distingue ce qui est légitimement public (clé `anon`) de ce qui ne l'est pas.
2. **RLS** : pour chaque table de `supabase/migrations/` + `schema.sql`, RLS activée ? policies
   présentes ? Cherche les policies trop permissives (`using (true)`) et les tables sans policy.
3. **RPC `SECURITY DEFINER`** : liste-les et vérifie que chacune contrôle l'identité de l'appelant
   (`auth.uid()`) et ne permet pas d'agir au nom d'autrui (rejoindre, voter, envoyer un DM,
   distribuer un badge, valider un score à la place de quelqu'un).
4. **Edge Functions** (`supabase/functions/*`) : vérification d'origine / secret d'appel, validation
   des entrées, absence de fuite de données dans les réponses et les logs.
5. **Client** : gestion de session (`expo-secure-store` vs `AsyncStorage`), flux reset de mot de passe
   PKCE et deep link `pagmatch://reset-password`, captcha Turnstile (client + vérification serveur),
   WebView de la carte des clubs (contenu injecté, `originWhitelist`), upload/partage d'images.
6. **Données personnelles** : ce que l'app collecte réellement vs ce que déclarent les textes légaux
   (`app/legal/`, `components/legal/`) et la landing. Signale tout écart. Vérifie que la suppression
   de compte in-app existe et fonctionne (exigence de revue Apple).
7. **Modération / abus** : blocage utilisateur, signalement, filtre de profanité, rate-limiting
   des actions sensibles (DM, candidatures, signalements).

Classe chaque finding : **Critique / Élevé / Moyen / Faible**, avec un scénario d'exploitation concret.
Une hypothèse non démontrée n'est pas un finding : marque-la « à vérifier ».

## PHASE 5 — Reste à faire

1. **Migrations** : pour chaque fichier de `supabase/migrations/`, dis s'il paraît appliqué en prod
   (croiser avec `schema.sql`) ou non. La liste des migrations **non appliquées** est le livrable
   le plus important de cette phase — le code client peut supposer un schéma qui n'existe pas.
2. **Git** : `git status` et `git branch`. Résume ce qui est modifié non commité, et ce qui vit sur
   une branche non mergée (`main`, `feature/refonte-defi`, `feature/expiration-invitations`,
   `fix/*`, `build/*`). Signale les features qui existent sur une branche mais pas sur `main`.
3. **Dette** : `TODO`, `FIXME`, `@ts-ignore`, `any`, `console.log` restants, code mort, dépendances
   inutilisées. Résultat de `npx tsc --noEmit`.
4. **Croise** avec `TASKS.md`, `AUDIT.md`, `CAHIER_RECETTE.md`, `docs/DEPLOIEMENT_MAROC.md`,
   `docs/PROCESS_LANCEMENT_STORES.md` : qu'est-ce qui y est marqué à faire et qui l'est encore
   réellement dans le code ? Qu'est-ce qui est fait mais pas coché ?

---

## LIVRABLE

Écris **un seul fichier** : `docs/ETAT_DES_LIEUX_<AAAA-MM-JJ>.md`, en français, structuré ainsi :

1. **Synthèse** — 10 lignes max : santé générale, les 3 risques majeurs, ce qui bloque le lancement.
2. **Tableau des bloquants** — ce qui doit être réglé avant la mise en production, par ordre de gravité,
   chacun avec fichier:ligne et effort estimé (S / M / L).
3. **Carte des features** (Phase 1) — un tableau, une ligne par feature.
4. **Design system** (Phase 2).
5. **Incohérences** (Phase 3) — une entrée par divergence : concept, lecteurs divergents, conséquence
   utilisateur observable, correction suggérée.
6. **Sécurité** (Phase 4) — findings classés par gravité.
7. **Reste à faire** (Phase 5) — dont la liste explicite des migrations non appliquées.
8. **Angles morts** — ce que tu n'as pas pu vérifier depuis le code seul (état réel de la prod,
   comportement device, configuration des dashboards Supabase / Cloudflare / stores), formulé
   en questions précises à poser.

Ne propose aucun correctif dans le code. Le livrable est le rapport.
