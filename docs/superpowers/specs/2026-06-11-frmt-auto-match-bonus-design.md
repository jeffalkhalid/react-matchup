# FRMT : vrai classement affiché + auto-matching nom/prénom + bonus de niveau

> Design en cours de validation (2026-06-11). PAG MATCH (react-matchup).
> Suite de la session « historique / stories / comptes supprimés ».

## Objectif

1. Afficher le **vrai classement FRMT scrapé** (`#position · points pts`), jamais le bracket auto-déclaré « PXXX ».
2. **Matcher automatiquement** un joueur à son entrée FRMT via nom+prénom (exact normalisé) → le vérifie sans intervention admin.
3. Le FRMT **ajoute au déclaratif** : un joueur vérifié reçoit un **bonus de niveau** calibré par sa position FRMT, **en plus** de son niveau déclaré, pour rester cohérent (ex. « intermédiaire » + TOP 50% FRMT = un peu au-dessus d'intermédiaire, pas élite).
4. Si pas de match auto → liaison manuelle admin, qui applique **le même bonus**.

## Décisions validées (questions utilisateur)

- **Affichage** : `FRMT #position · points pts ✓` (position + points). Plus de fallback « PXXX ».
- **Confiance** : auto-vérifié complet (match nom+prénom → `frmt_verified=true` + bonus). Risque d'usurpation accepté (petite communauté, faible enjeu, détectable).
- **Matching** : exact normalisé (minuscule + sans accents + tokens triés). Il faut **exactement un** résultat ; 0 ou plusieurs → pas de match (fallback admin).
- **Déclenchement** : à l'inscription **et** après chaque scrape (re-tente les non-liés).
- **Bonus** : **additif au niveau déclaré**, calibré par percentile FRMT, appliqué en **plancher** (ne baisse jamais un joueur).

## Modèle du bonus (à confirmer — valeurs ajustables)

`niveau_final = min(8, niveau_déclaré + bonus_niveaux(percentile_FRMT))`, converti en ELO, puis appliqué en plancher :
**Plafond = niveau 8** (max produit, ELO 2300). Le bonus ne pousse jamais au-delà.
`elo = max(elo_actuel, padelLevelToElo(niveau_final))`.

- `niveau_déclaré` = niveau issu de l'ELO de base figé à l'inscription (nouvelle colonne `declared_elo`, voir plus bas) → stable, évite que le bonus se cumule à chaque scrape.
- `percentile_FRMT` = position du joueur dans **sa liste** (même genre/catégorie) : `1 - (position-1)/(N-1)` → #1 = 1.0 (top), dernier = 0.

Barème proposé (bonus en **niveaux**, courbe convexe : doux au milieu, fort au sommet) :

| Percentile FRMT | Exemple | Bonus |
|---|---|---|
| TOP 1 % | élite nationale | +3.0 |
| TOP 5 % | | +2.5 |
| TOP 10 % | | +2.0 |
| TOP 25 % | | +1.5 |
| TOP 50 % | « un peu plus » | +1.0 |
| TOP 75 % | | +0.5 |
| reste (classé) | | +0.25 |

Exemples de cohérence :
- Déclare **Intermédiaire** (~niv.4) + **TOP 50 %** → niv.5.0 (un peu au-dessus, ✔).
- Déclare **Expert** (niv.5.5) + **TOP 10 %** → niv.7.5.
- Déclare **Avancé** (niv.4.9) + **TOP 1 %** → niv.7.9.
- Le plafond non-vérifié (1525 / niv.5.5) **saute** dès que vérifié.

> ⚠️ Le barème est un point de départ — à valider/ajuster par toi (c'est un choix produit).

## Données & normalisation

- `players` : champs FRMT existants (`frmt_verified`, `frmt_position`, `frmt_points`, `frmt_full_name`, `frmt_rank`) + **nouvelle colonne `declared_elo`** (ELO de base figé à l'inscription, sert d'assiette stable au bonus). Backfill : `declared_elo = elo_score` pour les comptes existants non vérifiés (au moment de la migration).
- `frmt_rankings` : `frmt_name`, `ranking_position`, `ranking_points`, `scraped_at`, `player_id`.
  - **Dépendance à confirmer** : existe-t-il une colonne genre/catégorie pour partitionner le percentile (ex. `category`/`gender`) ? Sinon le percentile mélange Messieurs/Dames → faux. À défaut, on partitionne sur le `gender` du joueur via un mapping, ou on ajoute la colonne au scraper.
- `frmt_normalize(text)` : fonction immuable — `lower(unaccent(trim(...)))`, split sur espaces, tri des tokens, jointure. Gère l'ordre nom/prénom. Nécessite l'extension `unaccent` (dispo sur Supabase).

## Logique côté base (Postgres, robuste cross-repo)

Le scraper vit dans le repo `matchup_padel` → on met la logique dans des fonctions Postgres appelées par triggers/RPC, indépendantes de qui écrit.

1. `frmt_target_elo(player_id)` (ou via position+gender) : calcule le percentile dans la bonne liste et renvoie l'ELO cible = `padelLevelToElo(min(9, level(declared_elo) + bonus(percentile)))`.
2. `try_link_frmt_for_player(player_id)` (SECURITY DEFINER) :
   - normalise `frmt_full_name` du joueur ;
   - cherche dans `frmt_rankings` **exactement une** ligne au nom normalisé identique, non liée à un autre joueur ;
   - si trouvée : `frmt_rankings.player_id = player`, `players.frmt_verified=true, frmt_position, frmt_points`, `elo_score = max(elo_score, frmt_target_elo(...))` ;
   - renvoie trouvé/pas trouvé.
3. `relink_unlinked_frmt()` : batch — pour chaque joueur avec `frmt_full_name` et `frmt_verified=false`, tente `try_link_frmt_for_player`. Appelée **après chaque scrape**.
4. `admin_link_frmt(entry_id, player_id)` : liaison manuelle — pose player_id/verified/position/points **et applique le même plancher ELO**.
5. **Triggers / appels** :
   - Trigger `AFTER INSERT/UPDATE OF frmt_full_name ON players` → `try_link_frmt_for_player` (couvre l'inscription).
   - `relink_unlinked_frmt()` exposée en RPC, appelée depuis l'écran admin après scrape / au refresh de l'onglet FRMT (le scraper pourra aussi l'appeler en fin de run).

## Front

- `lib/frmt-match.ts` : `formatFrmtRanking` ne **retombe plus** sur `frmt_rank` → renvoie `#position · points pts` si `frmt_verified && frmt_position`, sinon `null`. Tue le « PXXX » partout (profil + story).
- `app/(tabs)/player/[id].tsx` : la story peut repasser sur `formatFrmtRanking` simple (le gate position devient redondant mais inoffensif).
- `app/(tabs)/admin.tsx` :
  - `handleLink` → appelle `admin_link_frmt` (bonus appliqué) ;
  - **fix** `handleUnlink` → réinitialise `frmt_verified=false, frmt_position=null, frmt_points=null` (ne touche pas à l'ELO déjà acquis) ;
  - optionnel : appeler `relink_unlinked_frmt()` au refresh.
- `app/(auth)/signup.tsx` : capture déjà `frmt_full_name`. Stocke aussi `declared_elo` = ELO calculé à l'inscription (via le trigger signup ou le meta).

## Sécurité / cohérence

- Auto-vérification par nom = usurpable (accepté). Mitigation : match **unique exact** requis (un homonyme parfait bloque le match → fallback admin), et la liaison `frmt_rankings.player_id` empêche qu'une même entrée serve deux comptes.
- Bonus en **plancher** → ne dégrade jamais un joueur qui a grimpé en match.
- `declared_elo` figé → le bonus ne se cumule pas aux re-runs post-scrape.

## Tests / vérif

- Unitaire (logique pure, à porter en SQL ou TS) : `frmt_normalize` (accents, casse, ordre), `bonus(percentile)`, `target_elo` (exemples du tableau).
- Scénarios : signup avec nom matchant → vérifié + bon niveau ; homonyme double → pas de match ; scrape met à jour une position → plancher re-évalué sans cumul ; unlink → flags reset, ELO conservé ; admin link → bonus appliqué.
- Manuel : LAMINE → après relink, affiche `#position · points` et niveau cohérent.

## Hors périmètre

- Recalibration globale des `PADEL_ANCHORS` sur les vérifiés FRMT (idée parquée séparée).
- Matching fuzzy / suggestions multiples.
