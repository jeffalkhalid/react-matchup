# Application montre PagMatch — conception

**Date** : 2026-08-25
**Statut** : validé section par section avec le user, prêt pour le plan d'implémentation
**Prérequis** : `2026-08-23-live-scoring-design.md` (Phase 1 téléphone, en prod)

---

## 1. Objectif

Permettre au scoreur de marquer les points **au poignet**, téléphone rangé dans le sac,
pendant toute la durée du match.

Objectifs hérités du live scoring, inchangés : **A)** score incontestable, **C)** stats
riches, **D)** confort de saisie. **PAS B** (spectateurs live) — décision d'origine du
user, et elle a une conséquence directe ici : le temps réel n'est pas un impératif, ce
qui autorise une conception tolérante aux coupures (§7).

## 2. Contexte et contraintes

**Le spike du 2026-08-25 a validé la faisabilité** : 11 succès / 12, latence < 800 ms,
téléphone en main **comme** téléphone rangé écran éteint. iOS en arrière-plan n'est pas
un obstacle. Spike jetable dans `spikes/garmin-connectiq/` — à supprimer.

Contraintes structurelles qui dictent l'architecture :

| Contrainte | Conséquence |
|---|---|
| Une montre Garmin n'exécute que du Connect IQ (Monkey C) | L'app montre est un **programme séparé**, il ne peut pas être « dans » l'app RN |
| Sur iPhone, ANCS ne relaie pas les boutons d'action des apps tierces vers une montre non-Apple | Pas de pont app-téléphone ↔ montre : **la montre parle directement à Supabase** |
| Il n'existe pas d'app PagMatch iOS (compte Apple en révision) | La montre ne peut hériter d'aucune session téléphone : elle doit **prouver son identité elle-même** |
| La montre passe par le proxy réseau de Garmin Connect Mobile (ou le Wi-Fi) | Le lien peut tomber — parois vitrées du padel, téléphone au fond du sac |

**Montre de référence** : Garmin epix (Gen 2), `epix2`, écran 416×416. Le manifeste cible
aussi les Epix Pro. À élargir aux familles fenix/forerunner à la publication boutique.

## 3. Décisions produit (validées avec le user)

1. **Vraie app sur Garmin, télécommande par notification sur Apple Watch / Wear OS** (§10).
   Le user a explicitement demandé de ne pas oublier les autres wearables.
2. **La montre marque et affiche le score ; elle ne valide pas.** La validation finale
   reste sur le téléphone — plus sûr, et bien moins de travail.
3. **Pour le user d'abord, boutique Garmin plus tard.** L'app est conçue comme un vrai
   produit (appairage propre, révocable), mais on ne bloque pas sur la validation Garmin.
4. **Appairage par code à usage unique**, une seule fois dans la vie de la montre (§5).
5. **Un seul appareil marque à la fois**, imposé par le serveur (§8). Exigence explicite
   du user.

## 4. Parcours utilisateur

**Une fois** : app téléphone → « Connecter ma montre » → six chiffres → saisis sur la
montre → lien établi définitivement.

**À chaque match** :
1. Dans l'app téléphone : créer la partie, se porter volontaire (« Je scorerai »), comme
   aujourd'hui. C'est là que la session live démarre.
2. Sur le terrain : lancer PagMatch sur la montre. **Le match du jour est déjà affiché** —
   la montre a demandé au serveur « quelle session dois-je scorer ? ».
3. Pendant le jeu : un appui par point (ou par jeu), score affiché au poignet, bouton
   annuler pour corriger.
4. À la fin : la montre affiche « Match terminé — valide sur ton téléphone ». Le scoreur
   sort le téléphone une fois, vérifie, valide. Flux de validation classique inchangé.

## 5. Appairage

### Modèle de données

```sql
-- Code éphémère généré par le téléphone (joueur authentifié).
watch_pairing_codes (
  code        text PRIMARY KEY,          -- 6 chiffres
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,      -- now() + 5 min
  consumed_at timestamptz,
  attempts    int NOT NULL DEFAULT 0
)

-- Lien durable montre ↔ compte.
watch_links (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id    uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,     -- sha256 du jeton, JAMAIS le jeton en clair
  device_label text,                     -- « epix2 » pour l'affichage
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at   timestamptz
)
```

### RPC

- `create_watch_pairing_code()` — appelée par le **téléphone** (session authentifiée).
  Invalide les codes précédents du joueur, en crée un nouveau, le renvoie.
- `redeem_watch_pairing_code(p_code text, p_device_label text)` — appelée par la
  **montre**, avec la seule clé anon. Vérifie le code (non expiré, non consommé), crée le
  `watch_links`, renvoie **le jeton en clair une seule fois**. La montre le stocke dans
  `Application.Storage`.
- `revoke_watch_link(p_link_id uuid)` — appelée par le téléphone : « Délier ma montre ».

### Sécurité

Le code fait 6 chiffres (10⁶ combinaisons) pour rester saisissable sur une montre. La
protection ne vient donc pas de sa longueur mais de son encadrement :

- **expiration 5 minutes** ;
- **un seul code actif par joueur** (le nouveau invalide l'ancien) ;
- **limiteur par IP** : 10 échecs par minute et par origine, plus un filet global à 200
  échecs/minute — volontairement haut, car un seuil global bas serait un déni de service :
  la RPC étant ouverte à `anon`, quiconque pourrait bloquer l'appairage de tous les
  joueurs en soumettant quelques mauvais codes ;
- le code ne donne accès à rien d'autre que la création du lien.

Le jeton durable, lui, est un aléa de 32 octets, **stocké haché** côté serveur. Il n'ouvre
que les RPC `watch_*` (§6), qui ne voient que les données du joueur lié. Perte ou vol de
la montre → « Délier ma montre » dans l'app.

## 6. RPC de la montre

Toutes en `SECURITY DEFINER`, toutes prennent le jeton en premier argument et résolvent
le joueur elles-mêmes. La montre n'est **pas** un utilisateur Supabase authentifié : elle
appelle avec la clé anon, l'autorisation est portée par le jeton.

- `watch_current_session(p_token)` → la session `live` où le joueur est scoreur, avec
  `current_state`, `scoring_mode`, `golden_point`, les prénoms des 4 joueurs, `contest_count`
  et `input_device`. Renvoie `null` s'il n'y en a pas.
- `watch_apply_event(p_token, p_session_id, p_event_type, p_payload, p_client_seq)` →
  applique l'événement en réutilisant la logique existante d'`apply_live_event`, **sans la
  dupliquer** (§13). Pose `input_device = 'watch'`.

Chaque appel met `watch_links.last_seen_at` à jour.

## 7. File locale et tolérance aux coupures

**Principe : le poignet fait foi immédiatement, le réseau rattrape.**

Un appui est enregistré localement sur la montre et affiché **sans attendre le serveur**.
L'envoi part aussitôt ; s'il échoue, l'événement reste en file et est renvoyé à chaque
tentative suivante, ainsi qu'au retour de connexion.

**Envoi immédiat, jamais par paquets.** Regrouper économiserait de la batterie mais
augmenterait ce qu'on perd si la montre s'éteint. On envoie donc un par un pour que la
file soit presque toujours vide.

**Idempotence — point critique.** Une réponse perdue est indiscernable d'un envoi échoué :
la montre va renvoyer. Chaque événement porte donc un `client_seq` monotone par session,
et la table porte une contrainte d'unicité `(session_id, watch_link_id, client_seq)` avec
`ON CONFLICT DO NOTHING`. **Sans ça, la moindre coupure double des points.**

`watch_link_id` — et non `device_label`, qui n'est qu'une étiquette d'affichage et pourrait
être identique sur deux montres. La RPC le résout depuis le jeton, la montre ne le
manipule jamais.

**Pire cas** — téléphone éteint tout le match : la montre garde le match entier et le
déverse quand la liaison revient. Rien n'est perdu ; seul l'affichage temps réel des trois
autres joueurs prend du retard, ce qui est acceptable puisque le suivi par spectateurs n'a
jamais été un objectif (§1).

## 8. Garde-fou : un seul appareil de saisie

Exigence explicite du user : il ne doit pas être possible de compter un point deux fois en
tapant sur la montre **et** sur le téléphone.

Deux colonnes sur `live_match_sessions` : `input_device` (`'phone'` | `'watch'`, défaut
`'phone'`) et `input_device_at`.

**Asymétrie volontaire :**

- **La montre prend la main automatiquement** dès le premier appui — le simple fait
  d'avoir ouvert l'app au poignet et tapé est un acte délibéré.
- **Le téléphone doit la réclamer explicitement.** Tant que `input_device = 'watch'`,
  `apply_live_event` rejette les événements du téléphone avec `watch_has_control`. L'écran
  live affiche le score en lecture seule, un bandeau « C'est ta montre qui marque » et un
  bouton « Reprendre la saisie ici », qui rappelle la RPC avec `p_claim := true`.

Ce sens unique est délibéré : le risque à couvrir est le **geste réflexe sur le téléphone**,
pas l'inverse — pour taper sur la montre il faut déjà y avoir ouvert l'app.

**À ne pas confondre avec le changement de scoreur** (`take_over_scoring`), qui désigne un
*autre joueur*. Ici on ne parle que de l'appareil du scoreur courant. Un changement de
scoreur remet `input_device = 'phone'` (celui du nouveau scoreur).

**Compatibilité** : si la montre n'est jamais utilisée, `input_device` reste `'phone'` et
rien ne change dans l'app actuelle — aucun bandeau, aucun message.

## 9. Contestation, changement de scoreur, fin de match

**Contestation.** Un lecteur conteste depuis son téléphone (mécanique existante, marqueur
silencieux). La montre affiche un discret « ⚠️ 1 contestation ». Le scoreur corrige avec
le bouton annuler, ou continue s'il maintient son score. **Le règlement du désaccord reste
sur le téléphone** : trop bavard pour un petit écran.

**Changement de scoreur.** Si un autre joueur reprend le score, le serveur rejette les
appuis de la montre (`not_the_scorer`, contrôle déjà en place). La montre l'affiche
clairement et cesse d'accepter les appuis plutôt que de laisser marquer dans le vide.

**Fin de match.** C'est **le serveur** qui signale la fin : `current_state` porte déjà de
quoi la déterminer, et la réponse de `watch_apply_event` indique que le match est joué. La
montre se contente de l'afficher — « Match terminé, valide sur ton téléphone ». Elle ne
recalcule rien, conformément au §13. Elle **ne** finalise **pas** non plus : `finalize_live_session`
reste appelée depuis l'app, qui crée le match en `pending` et déclenche le circuit de
validation classique (cf. pivot du 2026-08-24).

## 10. Les autres wearables

Rien de natif : on réutilise la **notification à boutons d'action**, dont la mécanique a
été validée côté app lors du spike du 2026-08-23.

Quand une session live démarre et que le joueur est scoreur, l'app affiche une notification
persistante portant trois actions : *Jeu équipe 1*, *Jeu équipe 2*, *Annuler*. Le système
la relaie tout seul vers la montre appairée : **Android → Wear OS / Galaxy Watch**, et
**iPhone → Apple Watch**.

L'action est traitée **par l'app téléphone**, qui applique l'événement normalement : du
point de vue du serveur, c'est le téléphone qui marque. Le garde-fou du §8 n'est donc pas
concerné.

Cette voie ne fonctionne pas pour **iPhone + Garmin** (ANCS, §2) — c'est précisément le
trou que comble l'app Connect IQ.

Une app Apple Watch **native** est écartée : Swift/SwiftUI, obligatoirement embarquée dans
une app iOS qui n'existe pas encore, exige un Mac, et Expo ne gère pas les cibles watchOS.

## 11. Écrans de la montre

1. **Appairage** (premier lancement) : saisie des 6 chiffres au sélecteur numérique.
2. **Aucun match** : « Aucun match en cours ».
3. **Match** : noms des deux équipes, sets gagnés, set en cours, jeu en cours si mode
   point par point ; deux gros boutons de saisie ; annuler.
4. **Main perdue** : « Le téléphone a repris la main » ou « Tu n'es plus le scoreur ».
5. **Fin** : « Match terminé — valide sur ton téléphone ».

Contrainte d'affichage héritée du spike : **pas d'accents dans les chaînes dessinées** —
les polices système Garmin ne les garantissent pas sur tous les modèles.

## 12. Hors périmètre (YAGNI)

- Validation du score depuis la montre.
- Règlement des contestations depuis la montre.
- Mode lecteur au poignet (seul le scoreur a l'app).
- Publication sur la boutique Garmin (étape ultérieure).
- App native Apple Watch ou Wear OS.
- Statistiques ou historique consultables sur la montre.

## 13. Points de vigilance techniques

- **Ne pas dupliquer la logique de score.** `watch_apply_event` doit s'appuyer sur la
  logique existante d'`apply_live_event` / `fn_live_replay`. La parité
  `lib/liveScore.ts` ↔ `fn_live_replay` est déjà un point de fragilité connu ; un troisième
  moteur de score en Monkey C serait une faute. **La montre n'affiche que ce que le serveur
  lui renvoie**, sauf pour l'aperçu optimiste immédiat de son propre appui.
- **Idempotence obligatoire** (§7) : sans la contrainte d'unicité, la file offline double
  des points.
- **Clé anon publique** : les RPC `watch_*` ne doivent rien exposer au-delà du joueur lié.
- **Le rejet doit être lisible** : `watch_has_control`, `not_the_scorer`, `token_revoked`
  doivent produire un message clair au poignet, jamais un échec muet.

## 14. Tests

- **SQL** : appairage (code expiré, déjà consommé, essais dépassés), idempotence du même
  `client_seq`, rejet du téléphone quand la montre a la main, reprise explicite, remise à
  zéro sur changement de scoreur.
- **Monkey C** : la file locale (mise en attente, renvoi, purge après succès) est la seule
  logique non triviale côté montre ; le reste est de l'affichage.
- **Protocole réel** : un match complet à deux téléphones + la montre, en couvrant une
  coupure volontaire (téléphone en mode avion en plein match) pour vérifier que rien n'est
  perdu et que rien n'est compté deux fois.

## 15. Livraison par étapes

1. **Backend** : tables + RPC d'appairage + RPC montre + garde-fou `input_device` + tests SQL.
2. **App téléphone** : écran « Connecter ma montre » (code + liste des montres liées +
   délier), bandeau et verrouillage de l'écran live (§8).
3. **App montre** : appairage, découverte de session, saisie, file locale, écrans d'état.
4. **Test réel** selon le protocole du §14.
5. **Télécommande par notification** pour Apple Watch / Wear OS (§10).
6. **Publication boutique Garmin** — plus tard, une fois l'usage éprouvé.

Les étapes 1 à 4 forment le cœur ; l'étape 5 est indépendante et peut être menée à tout
moment ; l'étape 6 est un dossier, pas du développement.
