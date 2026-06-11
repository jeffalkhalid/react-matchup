# PAG MATCH — Process de lancement sur les stores (document de passation)

> Document autonome destiné à être transmis. Décrit tout ce qu'il reste à faire pour publier l'app **PAG MATCH** sur Google Play (puis l'App Store).
> Dernière mise à jour : 2026-06-11.

---

## 1. Contexte en bref

- **App** : PAG MATCH (Padel Active Game) — application mobile de matchmaking padel (Expo / React Native).
- **Éditeur légal** : **QUARTZTEC, SARL AU** au capital de 100 000 MAD, RC Casablanca n° 521941.
- **Domaine** : `pagmatch.com` (site vitrine + pages légales en ligne).
- **Backend** : Supabase (hébergé UE — Irlande).
- **Cible** : utilisateurs au Maroc. **Android d'abord, iOS en 2ᵉ vague.**

## 2. Décisions déjà prises (ne pas remettre en question)

1. **Android d'abord** : le projet Android est prêt (build configuré), iOS sera fait plus tard.
2. **Compte développeur de type ORGANISATION** (au nom de QUARTZTEC), pas Personnel.
   - Raison : afficher « QUARTZTEC » comme éditeur (cohérent avec les CGU/confidentialité/CNDP) + éviter l'obligation Google des « 12 testeurs pendant 14 jours » qui s'applique aux comptes Personnels.
3. **Email officiel** : `support@pagmatch.com` (contact stores + modération + support).

## 3. Ce qui est DÉJÀ fait (côté produit — rien à refaire)

✅ Sécurité base de données (RLS), captcha (Cloudflare Turnstile), politique de confidentialité + CGU (in-app **et** en ligne sur pagmatch.com), suppression de compte in-app, modération (bloquer/signaler), seuil d'âge 18 ans. Tout est en production.

➡️ **Le travail restant est surtout administratif et lié aux comptes stores**, pas du code.

---

## 4. PROCESS — à faire dans cet ordre

### 🟥 BLOC A — Démarches administratives (à LANCER EN PREMIER : délais externes)

#### A1. Email au domaine — `support@pagmatch.com`
- **Où** : https://www.zoho.com/mail/ (plan gratuit).
- **Quoi** : ajouter le domaine `pagmatch.com`, vérifier (enregistrement TXT), ajouter les MX de Zoho dans le gestionnaire DNS (BusyRack), créer la boîte `support@pagmatch.com`, activer la redirection vers une boîte Gmail.
- **Note DNS** : NE PAS toucher l'enregistrement **A** (`216.198.79.1`) ni le **CNAME `www`** → ils font tourner le site. On ne touche qu'aux MX + on ajoute des TXT.
- **Délai** : ~30 min. **À faire en premier** (nécessaire pour les démarches suivantes).

#### A2. Numéro D-U-N-S (identifiant légal international de QUARTZTEC) — GRATUIT
- **⚠️ Important** : le portail D-U-N-S d'Apple NE couvre PAS le Maroc. Au Maroc, passer par le représentant officiel de Dun & Bradstreet :
  - **Inforisk Altares Africa** → https://iaa-dnb.com/d-u-n-s-number/
  - Alternative : https://www.dnb.com/fr-ca/smb/duns/get-a-duns.html
  - Guide pas-à-pas (ambassade US Maroc) : https://ma.usembassy.gov/wp-content/uploads/sites/153/Step-by-step-on-how-to-apply-for-a-DUNS.pdf
- **Délai** : jusqu'à ~30 jours → **à demander dès maintenant**.
- **Sert pour** : le compte Google Play Organisation ET le compte Apple plus tard (un seul numéro pour les deux).
- **Infos à fournir** (voir §5 — doivent être **identiques au RC**).

#### A3. Déclaration CNDP (obligation légale au Maroc — loi 09-08)
- **Où** : plateforme **CNDP-FORMS** sur https://www.cndp.ma/ → page « Formalités / Notifier un traitement » : https://www.cndp.ma/fr/responsabilites/traitement-au-maroc/formalites.html
- **Quoi** : déclarer en ligne le traitement de données. Formulaire **F214** (déclaration simplifiée) en principe ; **F211** si déclaration normale. Au nom de QUARTZTEC.
- **Transfert hors Maroc** (Supabase UE/Irlande) : à mentionner. L'hébergement UE (RGPD) est favorable. Confirmer auprès de la CNDP si une simple déclaration suffit ou si une autorisation de transfert est requise.
- **Délai** : récépissé délivré **sous 24 h** après dépôt.
- **N'empêche pas de soumettre l'app**, mais c'est une obligation légale → à lancer en parallèle. Relecture par un juriste marocain conseillée.

---

### 🟦 BLOC B — Compte Google Play (dès que le D-U-N-S est reçu)

#### B1. Créer le compte développeur — type Organisation
- **Où** : https://play.google.com/console/signup
- **Quoi** :
  - Se connecter avec le compte Google choisi comme propriétaire.
  - Choisir **Organisation**.
  - Payer **25 $** (paiement unique, à vie).
  - Créer un **profil de paiement professionnel** avec les infos légales de QUARTZTEC.
  - Saisir le **numéro D-U-N-S**.
  - Vérifier email + téléphone (code OTP).
- **Réf.** : https://support.google.com/googleplay/android-developer/answer/13628312

#### B2. Vérification d'identité & d'entité
- **Où** : Play Console → **Paramètres → Account Verification**.
- **Quoi** : fournir pièce d'identité + justificatifs de l'entité. **Obligatoire avant de publier.**
- **Réf.** : https://support.google.com/googleplay/android-developer/answer/10841920

---

### 🟩 BLOC C — Préparer & publier l'app

#### C1. Tests sur appareil réel (gratuits — à faire avant le build final)
- Tester la **suppression de compte** (compte jetable + quelques matchs → vérifier purge + reconnexion impossible + ELO des adversaires intact).
- **Smoke-test sécurité** : un compte B ne doit pas lire les chats privés ni modifier le profil d'un compte A.
- **Notifications push** : tester avec 2 appareils / 2 comptes.
- Vérifier qu'un compte supprimé ne ressort plus du classement + que la tâche planifiée `pg_cron` est active.

#### C2. Builder l'application (AAB)
- **Doc** : https://docs.expo.dev/build/setup/
- **Commandes** :
  ```
  npm install -g eas-cli
  eas login
  eas build --platform android --profile production
  ```
- Récupérer le fichier **.aab**.

#### C3. Remplir la fiche Play Console
- **Data Safety** (déclaration des données collectées — doit être cohérente avec la politique de confidentialité).
- **URL de politique de confidentialité** : `https://www.pagmatch.com/confidentialite` *(déjà en ligne)*.
- **Classification de contenu** (questionnaire IARC).
- Description, captures d'écran, icône, catégorie.

#### C4. Soumettre
- `eas submit --platform android` (ou upload manuel de l'AAB).
- Publier d'abord en **test interne**, puis en **production**.

---

### 🍎 BLOC D — iOS (2ᵉ vague — réutilise le même D-U-N-S)

- **Apple Developer Program → Organization** : https://developer.apple.com/programs/enroll/ — **99 $/an**, même D-U-N-S que Google (Apple peut téléphoner pour vérifier l'entité).
- Créer l'app dans **App Store Connect** : https://appstoreconnect.apple.com
- Générer la **clé APNs** (notifications push iOS).
- Compléter `eas.json` (`submit.production` : appleId, ascAppId, appleTeamId).
- **Privacy Nutrition Labels** + URL de confidentialité.
- **Tester la suppression de compte AVANT soumission** (le validateur Apple l'essaie — motif de rejet classique).
- `eas build --platform ios` (pas de Mac nécessaire, build dans le cloud) → `eas submit --platform ios`.

---

## 5. Infos QUARTZTEC à préparer (à garder identiques partout)

> ⚠️ Le nom et l'adresse doivent être **identiques à l'identique** sur le D-U-N-S, Google Play, Apple et la CNDP. Toute divergence (abréviation, accent, adresse) = vérification rejetée. Se caler sur le libellé exact du **RC Casablanca 521941**.

- Nom légal : **QUARTZTEC, SARL AU** (capital 100 000 MAD)
- RC : **Casablanca n° 521941**
- **ICE** de la société : _________________ (à renseigner — le D-U-N-S en est l'équivalent international)
- Adresse du siège : _________________ (telle qu'au RC)
- Téléphone société : _________________
- Email : `support@pagmatch.com`
- Site web : `pagmatch.com`
- Représentant légal (nom + fonction) : _________________

---

## 6. Récapitulatif des délais

| Tâche | Lien | Délai |
|---|---|---|
| Email domaine (Zoho) | zoho.com/mail | ~30 min |
| **D-U-N-S** (Inforisk, Maroc) | iaa-dnb.com/d-u-n-s-number | **jusqu'à ~30 j** |
| **CNDP** | cndp.ma (CNDP-FORMS) | récépissé **24 h** après dépôt |
| Compte Play Organisation + vérif | play.google.com/console/signup | quelques heures → jours |
| Tests device | — | ~½ journée |
| Build + fiche + soumission | docs.expo.dev | ~1 journée |

**Chemin critique = le D-U-N-S.** Tout le reste peut avancer en parallèle pendant son obtention.

---

## 7. Plan B si le D-U-N-S est trop long

Le D-U-N-S n'est **pas obligatoire pour lancer** — il l'est seulement pour le compte **Organisation**. On peut créer un compte Google Play **Personnel** (sans D-U-N-S) et lancer plus vite, MAIS :
- obligation de **12 testeurs pendant 14 jours consécutifs** avant la production,
- le store affiche un **nom personnel** (pas QUARTZTEC),
- compte **non convertible** en Organisation ensuite (il faudrait tout recréer).

→ **Décision actuelle : on garde le cap Organisation** (demande D-U-N-S lancée, on avance sur tout le reste en parallèle). On ne bascule sur le Personnel que si le D-U-N-S tarde au point de bloquer le lancement.

---

## 8. Première action concrète

1. Créer l'email `support@pagmatch.com` (Zoho).
2. Avec cet email, déposer la **demande D-U-N-S** chez Inforisk (iaa-dnb.com).
3. Déposer la **déclaration CNDP**.
4. Pendant l'attente du D-U-N-S : tests device + préparation de la fiche Play (captures, description, Data Safety).
