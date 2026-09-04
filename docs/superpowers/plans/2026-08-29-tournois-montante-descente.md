# Tournois montante / descente — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le format montante / descente de PAG MATCH : inscription seul ou en binôme, rotations simultanées sur tous les terrains, montée et descente automatiques, rotation finale de classement, et historique par joueur.

**Architecture:** Tables `tournament_*` **sans aucun lien avec `games`**, pour ne toucher ni au déclencheur ELO ni au blocage anti-chevauchement ±2h. Le format est du calcul pur, écrit et testé en TypeScript, et répliqué en SQL qui fait autorité — avec un test de parité qui interdit la divergence. Tout est derrière un interrupteur éteint par défaut.

**Tech Stack:** PostgreSQL / Supabase (RPC `SECURITY DEFINER`), TypeScript, React Native / Expo Router, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-tournois-montante-descente-design.md`

## Point de départ

Une première implémentation existe sur cette branche, tirée d'une spec antérieure. **Aucune
migration n'a été appliquée nulle part** : les fichiers SQL se réécrivent donc **sur place**,
sans empiler d'`ALTER`.

| Fichier | Lignes | Sort |
|---|---|---|
| `supabase/migrations/tournaments_flag.sql` | 21 | **inchangé** |
| `lib/tournament.ts` | 197 | sens des paliers, classement et rotation finale à refaire ; `pairUp` et l'invariant se gardent |
| `lib/__tests__/tournament.test.ts` | 369 | à reprendre avec le moteur |
| `supabase/migrations/tournaments.sql` | 173 | l'architecture et le déclencheur d'unicité se gardent ; le reste s'étend |
| `supabase/migrations/tournaments_rpcs.sql` | 1088 | très largement à refaire |

**Ce qui se reprend tel quel, et qu'il ne faut pas réinventer :** l'absence totale de lien
avec `games` ; le déclencheur qui maintient l'unicité joueur/tournoi ; l'interrupteur ;
l'invariant « deux binômes par terrain » du moteur, vrai quel que soit le sens ; la règle du
terrain à effectif impair (bye au binôme qui en a eu le moins, personne n'est écarté).

## Global Constraints

- **Le Terrain 1 est le palier le plus fort ; on monte vers les numéros les plus petits.** La version précédente supposait l'inverse : c'est la première chose à vérifier dans tout code repris.
- **Ne jamais modifier** `elo_on_validate.sql`, `block_accepted_overlaps.sql`, la table `games`, ni aucune migration hors de cette branche.
- **Aucune clé étrangère de `tournament_*` vers `games`.**
- **Le nombre de terrains est le paramètre** : binômes = terrains × 2, places = terrains × 4 (les places se comptent **en joueurs**).
- **Classement provisoire, dans cet ordre** : palier actuel → nombre de victoires → différence de jeux → jeux gagnés → confrontation directe. **La confrontation directe agrège TOUTES les rencontres** entre deux binômes, jamais la première seule.
- **Le classement final est celui de la rotation de classement** (la 6ᵉ), pas des statistiques cumulées. **Si elle n'a pas lieu**, c'est le classement provisoire de la dernière rotation complète, et les points sont attribués normalement.
- **Un match ne peut pas être nul.** L'application **refuse un score à égalité** — le point décisif s'inscrit comme un jeu (6-5).
- **Sauf pour un forfait**, dont le score par défaut est **0-0 avec victoire pour l'adversaire**. ⚠️ `0-0` est à égalité : le chemin du forfait doit contourner le refus explicitement.
- **Un score est acquis dès que deux joueurs de binômes OPPOSÉS saisissent le même score.** Deux coéquipiers d'accord ne valident rien. Deux joueurs opposés qui divergent ouvrent un litige tranché par l'organisateur.
- **Une rotation ne se génère jamais tant que les quatre matchs de la précédente ne sont pas acquis**, et l'écran doit dire lesquels manquent.
- **Un binôme qui prend un bye reste sur son terrain** — ni victoire, ni défaite, ni jeux.
- **Aucun binôme ne disparaît jamais d'un tableau**, quelle que soit la parité d'un terrain.
- **Le classement en cours se calcule, il ne se stocke pas.** Seul `tournament_results`, figé à la clôture, est persistant.
- **Les scores confirmés ne sont jamais détruits** : une clôture anticipée **borne** le classement, elle n'efface aucune ligne.
- **Interrupteur `tournaments_enabled`, éteint par défaut** (clé absente = désactivé).
- **Piège des droits Supabase** : `REVOKE ALL ON FUNCTION ... FROM PUBLIC` ne retire pas les droits directs d'`anon` et `authenticated`. Toujours `FROM PUBLIC, anon, authenticated`.
- **Piège plpgsql** : un `INSERT` suivi d'un `RAISE EXCEPTION` dans la même transaction est annulé. Les fonctions renvoient `{ok:false, reason}` plutôt que de lever — donc **tout contrôle doit précéder toute écriture**.
- Toute fonction : `SECURITY DEFINER`, `SET search_path = public` ; chaque migration finit par `NOTIFY pgrst, 'reload schema';` après `COMMIT;`.
- **Les agents n'appliquent aucune migration.** Elles sont remises au user en un lot unique à la fin.
- **`scoreSide()` de `lib/compat.ts` est réutilisée** pour l'appariement automatique — ne pas en écrire une seconde.
- Le prix est **affiché, jamais encaissé**.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `lib/tournament.ts` | le moteur pur : placement, mouvement, byes, classement, rotation de classement |
| `lib/__tests__/tournament.test.ts` | tests du moteur |
| `lib/__tests__/tournamentParite.test.ts` | parité TypeScript ↔ SQL |
| `supabase/migrations/tournaments.sql` | tables, index, déclencheurs, RLS |
| `supabase/migrations/tournaments_flag.sql` | l'interrupteur *(inchangé)* |
| `supabase/migrations/tournaments_rpcs.sql` | inscription, appariement, déroulement, classement, clôture |
| `app/tournaments/index.tsx` | liste des tournois |
| `app/tournaments/[id].tsx` | fiche + onglets Tableau / Classement |
| `app/tournaments/parcours.tsx` | Mon parcours |
| `components/tournaments/` | cartes et tableaux réutilisables |
| `app/(tabs)/admin.tsx` | *(modifié)* créer, check-in, appariement, conduire, clôturer |

---

### Task 1 : Le moteur — sens des paliers, classement, rotation de classement

**Files:**
- Modify: `lib/tournament.ts`
- Test: `lib/__tests__/tournament.test.ts`

**Interfaces:**
- Produces: `initialCourts(teams)`, `pairUp(courts, byeCount)`, `nextCourts(courts, matches, courtCount)`, `lastCompleteRound(matches)`, `standings(teams, matches)`, `finalRanking(matches, courtCount)`.

**Lire `lib/tournament.ts` en entier avant d'écrire.** Le fichier existe, il est testé, et une
grande partie se garde. Trois choses changent, et une s'ajoute.

**1. Le sens des paliers s'inverse.** Le **Terrain 1 est le plus fort** ; le gagnant va vers
le numéro **plus petit**, le perdant vers le plus grand. Exceptions : le gagnant du Terrain 1
y reste, le perdant du dernier terrain aussi. `initialCourts` place donc les binômes les plus
forts au Terrain 1.

*L'invariant ne change pas et reste le test central :* chaque terrain reçoit le gagnant du
terrain en dessous et le perdant du terrain au-dessus, soit exactement deux binômes ; aux
extrémités, celui qui reste remplace le voisin manquant. **Vérifier qu'il tient toujours après
l'inversion, sur cinq rotations.**

**2. Le classement change de hiérarchie**, et gagne un critère que le moteur ne comptait pas :

1. **palier actuel** (Terrain 1 devant les autres)
2. **nombre de victoires** ← nouveau, à ajouter à `Standing`
3. **différence de jeux**
4. **jeux gagnés**
5. **confrontation directe**, **agrégée sur toutes les rencontres**

L'agrégation existe déjà dans le fichier et a été durement acquise : un comparateur par
paires et un agrégat **ne donnent pas le même ordre sur une égalité à trois**. La garder
telle quelle.

**3. Un bye n'est ni une victoire ni une défaite**, ne rapporte aucun jeu, et le binôme reste
sur son terrain. Vérifier que `standings` ne compte pas un bye comme un match joué.

**4. Nouveau : `finalRanking(matches, courtCount)`.** La dernière rotation ne fait plus monter
ni descendre : elle **classe directement**. Le gagnant du Terrain 1 est 1ᵉʳ, son perdant 2ᵉ,
le gagnant du Terrain 2 est 3ᵉ, son perdant 4ᵉ, et ainsi de suite.

- [ ] **Step 1 : Écrire les tests d'abord**

Ajouter au fichier de tests, en gardant ceux qui restent valables :

```ts
describe('sens des paliers', () => {
  it('place les plus forts au Terrain 1', () => {
    const c = initialCourts(EIGHT);          // EIGHT trie par niveau decroissant
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBe(1);
    expect(c.get('h')).toBe(4);
  });

  it('le gagnant descend d indice, le perdant monte', () => {
    const c0 = initialCourts(EIGHT);
    const ms = joue(pairUp(c0, new Map()), { 1: 'a', 2: 'c', 3: 'e', 4: 'g' });
    const c1 = nextCourts(c0, ms, 4);
    expect(c1.get('c')).toBe(1);   // gagnant du 2 monte vers 1
    expect(c1.get('d')).toBe(3);   // perdant du 2 descend vers 3
  });

  it('aux extremites, on ne bouge pas', () => {
    const c0 = initialCourts(EIGHT);
    const ms = joue(pairUp(c0, new Map()), { 1: 'a', 2: 'c', 3: 'e', 4: 'g' });
    const c1 = nextCourts(c0, ms, 4);
    expect(c1.get('a')).toBe(1);   // gagne au Terrain 1 : reste
    expect(c1.get('h')).toBe(4);   // perd au dernier : reste
  });
});

describe('classement', () => {
  it('le palier prime sur les jeux gagnes', () => {
    // b a accumule des jeux en bas, a s est maintenu en haut
    const s = standings(TEAMS, MATCHES_PALIER);
    expect(s[0].teamId).toBe('a');
    expect(s[0].gamesWon).toBeLessThan(s[1].gamesWon);   // et pourtant devant
  });

  it('a palier egal, les victoires priment sur la difference', () => {
    const s = standings(TEAMS, MATCHES_VICTOIRES);
    expect(s[0].wins).toBeGreaterThan(s[1].wins);
    expect(s[0].diff).toBeLessThan(s[1].diff);           // et pourtant devant
  });

  it('un bye n est ni victoire ni defaite et ne rapporte aucun jeu', () => {
    const s = standings(TEAMS, [BYE_MATCH]);
    const t = s.find(x => x.teamId === 'a')!;
    expect(t.played).toBe(0);
    expect(t.wins).toBe(0);
    expect(t.gamesWon).toBe(0);
  });
});

describe('rotation de classement', () => {
  it('le gagnant du Terrain 1 est premier, son perdant deuxieme', () => {
    const r = finalRanking(FINAL_MATCHES, 4);
    expect(r[0]).toEqual({ rank: 1, teamId: 'a' });
    expect(r[1]).toEqual({ rank: 2, teamId: 'c' });
    expect(r[2]).toEqual({ rank: 3, teamId: 'b' });   // gagnant du Terrain 2
  });

  it('un terrain sans match ne decale pas les rangs suivants', () => {
    const r = finalRanking(FINAL_MATCHES_AVEC_BYE, 4);
    expect(r.map(x => x.rank)).toEqual([1, 2, 3, 5, 6, 7, 8]);
  });
});
```

Les jeux de données (`TEAMS`, `MATCHES_PALIER`, `MATCHES_VICTOIRES`, `FINAL_MATCHES`) sont à
construire de façon à **discriminer** : dans `MATCHES_PALIER`, le binôme classé premier doit
avoir **moins** de jeux gagnés que le second, sans quoi le test ne prouve pas que le palier
prime.

- [ ] **Step 2 : Lancer les tests, vérifier qu'ils échouent pour la bonne raison**

Run: `npm test -- tournament`
Expected: échecs sur le sens des paliers, le classement, et `finalRanking` absente.

- [ ] **Step 3 : Modifier le moteur**

Inverser le sens dans `initialCourts` et `nextCourts` ; ajouter `wins` à `Standing` et le
compter dans `standings` ; réordonner le comparateur selon la nouvelle hiérarchie ; écrire
`finalRanking`.

- [ ] **Step 4 : Vérifier**

Run: `npm test`
Expected: tous au vert, **y compris les 46 tests préexistants** du dépôt.

- [ ] **Step 5 : Prouver que les tests discriminent**

Pour chacun des tests ajoutés : casser la ligne exacte qu'il couvre, vérifier qu'il échoue,
revenir. **Rendre compte dans le rapport de quel test tue quel défaut.** Un test qui passe
contre une implémentation cassée ne prouve rien — c'est la norme de ce chantier.

- [ ] **Step 6 : Commit**

```bash
git add lib/tournament.ts lib/__tests__/tournament.test.ts
git commit -m "feat(tournois): Terrain 1 au sommet, classement au palier, rotation de classement"
```

---

### Task 2 : Le schéma

**Files:**
- Modify: `supabase/migrations/tournaments.sql`

**Interfaces:**
- Produces: les tables `tournaments`, `tournament_registrations`, `tournament_teams`, `tournament_matches`, `tournament_match_entries`, `tournament_movements`, `tournament_results`.

**Lire le fichier existant avant d'écrire.** Aucune migration n'a été appliquée : on le
**réécrit sur place**, sans `ALTER`. L'architecture, les politiques RLS et le déclencheur
d'unicité se gardent ; le modèle d'inscription change en profondeur.

**Ce qui change, et pourquoi :**

- **Les places se comptent en joueurs.** `tournaments` porte `court_count` comme paramètre ; les binômes valent `court_count × 2` et les places `court_count × 4`. Ne pas stocker les trois — stocker le terrain, dériver le reste.
- **`tournament_registrations`** est la table d'inscription, **par joueur** : tournoi, joueur, **côté déclaré pour ce tournoi** (`left` / `right` / `both`), `open_to_join` (booléen : n'importe qui peut me rejoindre, ou sur accord), équipe éventuelle, position en liste d'attente, statut de check-in. Un joueur n'a **qu'une** inscription par tournoi.
- **`tournament_teams`** ne porte plus l'inscription mais le binôme formé : les deux joueurs, le terrain de départ, le forfait.
- **`tournament_match_entries`** est nouvelle et porte **une ligne par saisie de joueur** : match, joueur, jeux A, jeux B, horodatage. C'est elle qui permet l'accord entre camps.
- **`tournament_movements`** est nouvelle : tournoi, binôme, rotation, terrain avant, terrain après, mouvement (`UP` / `DOWN` / `STAY`). C'est ce qui permet d'afficher le parcours `T4 → T3 ↑ → T2 ↑`.
- **`tournaments.status`** suit la machine à états de la spec : `BROUILLON`, `INSCRIPTIONS_OUVERTES`, `COMPLET`, `CHECK_IN`, `PRET`, `EN_COURS`, `TERMINE`, `CLASSEMENT_VALIDE`.
- **`points_scale`** par défaut `{"1":100,"2":80,"3":65,"4":55,"5":45,"6":35,"7":25,"8":15}` — **aucune valeur négative**.
- **`forfeit_games`** paramétrable, par défaut `0` pour les deux camps.

**Contraintes à faire porter par la base, pas par le code :**
- un joueur n'a qu'une inscription par tournoi ;
- un joueur n'appartient qu'à un seul binôme par tournoi — **garder le déclencheur existant**, qui maintient un index dérivé et rend la règle inviolable ;
- un match ne peut référencer que des binômes **de son propre tournoi** (clés composites) ;
- une saisie ne peut venir que d'un joueur **inscrit à ce tournoi** ;
- RLS activée sur toutes les tables, **lecture ouverte aux connectés, aucune politique
  d'écriture** — tout passe par les fonctions de la Task 3.

- [ ] **Step 1 : Réécrire la migration**

- [ ] **Step 2 : Vérifier point par point, et le consigner**

Aucune référence à `games` ; chaque `REVOKE ALL ON FUNCTION` nomme `PUBLIC, anon, authenticated` ; `NOTIFY pgrst, 'reload schema';` après `COMMIT;` ; aucune politique d'écriture ; les clés composites en place ; le déclencheur d'unicité conservé et toujours seul écrivain de son index.

- [ ] **Step 3 : Commit**

```bash
git add supabase/migrations/tournaments.sql
git commit -m "feat(tournois): schema — inscription par joueur, saisies, mouvements"
```

---

### Task 3 : Fonctions serveur — inscription et appariement

**Files:**
- Modify: `supabase/migrations/tournaments_rpcs.sql`

**Interfaces:**
- Produces: `tournament_register(p_tournament, p_side, p_open_to_join, p_partner default null)`, `tournament_join(p_registration)`, `tournament_respond_join(p_request, p_accept)`, `tournament_leave_team(p_tournament)`, `tournament_withdraw(p_tournament)`, `tournament_check_in(p_tournament)`, `tournament_autopair(p_tournament)`.

**Les règles que ces fonctions font respecter :**

- **S'inscrire à deux** crée le binôme immédiatement ; les deux places sont prises ; le partenaire est notifié et peut défaire le binôme.
- **S'inscrire seul** prend une place et publie le joueur comme cherchant un partenaire, avec son côté et son mode (`open_to_join`).
- **Rejoindre** : si le joueur visé est ouvert, le binôme se forme d'un geste ; sinon une demande part, qu'il accepte ou refuse. **Accepter une demande refuse automatiquement les autres reçues.**
- **Aucune demande ne retient de place** — les deux joueurs occupent déjà la leur. C'est ce qui rend le mode « sur accord » sans danger.
- **Défaire un binôme** rend les deux joueurs seuls **en gardant chacun sa place**.
- **Au-delà des places**, l'inscription entre en **liste d'attente**, ordonnée par date. Quand des places se libèrent, la file avance à concurrence des places disponibles.
- **`tournament_autopair`** apparie les joueurs encore seuls au lancement : **niveaux proches et côtés complémentaires**. La règle de côté **réutilise la logique de `scoreSide()`** (`lib/compat.ts`) — complémentaires 10, l'un flexible 5, même côté 2 — au lieu d'en écrire une seconde. L'organisateur peut refaire un binôme à la main.
- **Un joueur resté seul** au lancement ne joue pas et retourne en tête de liste d'attente. **Un nombre impair de binômes ne pose aucun problème** : le bye tournant s'en charge.

Refus attendus, chacun nommé : `feature_disabled`, `tournament_not_open`, `already_registered`, `invalid_partner`, `partner_not_found`, `partner_already_registered`, `not_registered`, `not_open_to_join`, `already_in_team`, `request_not_found`, `not_the_organizer`.

⚠️ **Tout contrôle précède toute écriture** : les fonctions renvoient `{ok:false, reason}` sans lever, donc rien ne serait annulé.

- [ ] **Step 1 : Écrire les fonctions**
- [ ] **Step 2 : Tracer dans le rapport** les cas limites : double inscription, demande croisée entre deux joueurs, promotion depuis la file quand deux places se libèrent d'un coup, et appariement automatique avec un nombre impair de joueurs seuls.
- [ ] **Step 3 : Commit**

---

### Task 4 : Fonctions serveur — déroulement d'une rotation

**Files:**
- Modify: `supabase/migrations/tournaments_rpcs.sql`

**Interfaces:**
- Produces: `tournament_start(p_tournament)`, `tournament_generate_round(p_tournament)`, `tournament_enter_score(p_match, p_games_a, p_games_b)`, `tournament_resolve_dispute(p_match, p_games_a, p_games_b)`, `tournament_forfeit(p_tournament, p_team)`, `tournament_reopen_match(p_match)`.

**Ce que le SQL doit reproduire exactement**, sans dériver de `lib/tournament.ts` : le
placement initial, le sens du mouvement (**vers le Terrain 1**), le bye du terrain impair, et
l'enregistrement des mouvements dans `tournament_movements`.

**Les règles de saisie :**
- N'importe lequel des quatre joueurs saisit ; une ligne par saisie.
- **Acquis dès que deux joueurs de binômes opposés saisissent le même score.**
- **Deux joueurs opposés qui divergent ouvrent un litige** ; `tournament_resolve_dispute` le tranche, réservé à l'organisateur.
- **Deux coéquipiers d'accord ne valident rien.**
- **Un score à égalité est refusé** (`draw_not_allowed`) — le point décisif s'inscrit comme un jeu.
- **Le forfait contourne ce refus** : `0-0` avec victoire pour l'adversaire, valeurs prises dans `forfeit_games`.
- **`tournament_generate_round` refuse** tant que les matchs de la rotation courante ne sont pas tous acquis, et renvoie **la liste des matchs manquants** pour que l'écran puisse les nommer.
- **`tournament_reopen_match`** invalide les rotations postérieures, qui sont régénérées. **Aucun score confirmé n'est jamais détruit** hors de ce chemin explicite.

- [ ] **Step 1 : Écrire les fonctions**
- [ ] **Step 2 : Tableau de parité** avec `lib/tournament.ts`, une ligne par règle : ce que fait le TypeScript, ce que fait le SQL. Tout écart trouvé ici coûte infiniment moins cher qu'un classement faux en fin de soirée.
- [ ] **Step 3 : Commit**

---

### Task 5 : Fonctions serveur — classement, rotation finale, clôture

**Files:**
- Modify: `supabase/migrations/tournaments_rpcs.sql`

**Interfaces:**
- Produces: `tournament_standings(p_tournament, p_max_round default null)`, `tournament_final_round(p_tournament)`, `tournament_close(p_tournament)`, `tournament_validate(p_tournament)`.

- **`tournament_standings`** applique la hiérarchie : palier → victoires → différence → jeux gagnés → confrontation directe **agrégée**. Le paramètre `p_max_round` **borne** le calcul ; il ne supprime jamais de ligne.
- **`tournament_final_round`** génère la rotation de classement : les positions sont figées après l'avant-dernière rotation, et chaque terrain joue pour deux places.
- **`tournament_close`** fige `tournament_results` : rang final, matchs joués, victoires, jeux gagnés et perdus, points depuis `points_scale`. **Le classement final vient de la rotation de classement** si elle a eu lieu ; **sinon du classement provisoire de la dernière rotation complète**, et les points sont attribués normalement.
- **`tournament_validate`** passe en `CLASSEMENT_VALIDE` : c'est **là seulement** que les points sont crédités et que le tournoi apparaît dans Mon parcours.
- **Les deux joueurs d'un binôme reçoivent les mêmes points**, une ligne chacun dans `tournament_results`.

- [ ] **Step 1 : Écrire les fonctions**
- [ ] **Step 2 : Tracer** dans le rapport : clôture avec rotation finale, clôture sans, et clôture sur une rotation partielle.
- [ ] **Step 3 : Commit**

---

### Task 6 : Le test de parité

**Files:**
- Test: `lib/__tests__/tournamentParite.test.ts`

**Lire `lib/__tests__/liveScoreParite.test.ts` d'abord** — c'est le test de parité existant du
dépôt, et il donne la forme exacte à reprendre.

- [ ] **Step 1 : Construire un tournoi de référence** — 8 binômes, 6 rotations, tous les scores, en incluant délibérément **les cas qui départagent** : deux binômes à égalité de palier et de victoires, une confrontation directe entre eux, **une égalité à trois** (le cas où un comparateur par paires et un agrégat divergent), un forfait, et un terrain à effectif impair.
- [ ] **Step 2 : Comparer le classement complet** — l'ordre, les victoires, les jeux, les rangs — entre `lib/tournament.ts` et `tournament_standings`.
- [ ] **Step 3** : `npm test -- Parite`. **Un échec ici signifie une divergence réelle** : ce n'est jamais le test qu'on ajuste.
- [ ] **Step 4 : Commit**

---

### Task 7 : Écrans — liste, fiche, inscription

**Files:**
- Create: `app/tournaments/index.tsx`, `app/tournaments/[id].tsx`, `components/tournaments/TournamentCard.tsx`

**Lire `app/(tabs)/lobby.tsx` et `app/player/[id].tsx`** pour les conventions du projet —
en-têtes, cartes, couleurs. Ne pas inventer un style.

- **La liste** : à venir, en cours, passés. **Si l'interrupteur est éteint, l'entrée n'apparaît nulle part** — pas d'écran vide, rien.
- **La fiche** : format, date, club, plage de niveau, terrains, **places en joueurs (13/16)**, prix affiché, « comment ça marche », inscription.
- **L'inscription** : seul ou à deux, **choix du côté** (gauche / droit / les deux, prérempli depuis le profil), et pour une inscription seule le choix **ouvert / sur accord**.
- **La liste des joueurs seuls** affiche leur côté, pour qu'on cherche un complément. **Un binôme de deux joueurs du même côté est autorisé mais signalé.**
- **Chaque refus du serveur reçoit une formulation en français.** Rendre compte de toute raison sans traduction — elle s'afficherait en code brut.

- [ ] **Step 1 : La liste** · **Step 2 : La fiche** · **Step 3 : L'inscription et la liste des joueurs seuls** · **Step 4 : Commit**

---

### Task 8 : Écrans — tableau, classement, saisie

**Files:**
- Modify: `app/tournaments/[id].tsx`
- Create: `components/tournaments/CourtRow.tsx`, `StandingsTable.tsx`, `ScoreSheet.tsx`

- **Le tableau** : un terrain par ligne, **du Terrain 1 en haut**, les deux binômes, le score, et les flèches de montée et de descente.
- **Le classement** : rang, binôme, MJ, V, D, JG, JP, différence, et le mouvement depuis la rotation précédente. **Les chiffres viennent de `tournament_standings`**, jamais d'un calcul local.
- **La saisie** : chaque joueur saisit son score. L'écran montre **ce qui manque pour que le match soit acquis**, et signale un litige en attente d'arbitrage.
- **Refuser un score à égalité** avant même d'appeler le serveur, avec un message qui explique pourquoi (le point décisif s'inscrit comme un jeu).

- [ ] **Step 1 : Le tableau** · **Step 2 : Le classement** · **Step 3 : La saisie** · **Step 4 : Commit**

---

### Task 9 : Mon parcours et classement individuel

**Files:**
- Create: `app/tournaments/parcours.tsx`

- L'historique des tournois du joueur, alimenté par `tournament_results` : tournoi, date, club, MJ, V/D, JG, JP, différence, rang final, points.
- Les cumuls : tournois joués, matchs, pourcentage de victoires, différence de jeux, victoires de tournoi, podiums, **points montante/descente**.
- **Le cas vide** : un joueur sans tournoi voit un message clair, pas une liste vide. C'est l'état le plus fréquent au lancement.
- Les onglets « Résultats » et « Stats » **ne sont pas construits** — non spécifiés.

- [ ] **Step 1 : L'écran** · **Step 2 : Le cas vide** · **Step 3 : Commit**

---

### Task 10 : L'écran d'organisation

**Files:**
- Modify: `app/(tabs)/admin.tsx`

**Lire le fichier avant d'écrire** : il existe et a ses conventions. Ajouter une section, ne
pas restructurer.

- **Créer** : nom, club, date, horaires, plage de niveau, **nombre de terrains**, rotations, durée, prix affiché, barème, mode de placement.
- **Check-in** : qui est là, qui manque, **apparier les joueurs seuls**, remplacer un binôme, lancer quand même.
- **Conduire** : générer la rotation suivante, trancher un litige, déclarer un forfait, rouvrir un score, clôturer, valider le classement.
- **Un refus de générer doit nommer les matchs manquants.** Un refus qui ne dit pas quoi corriger bloque la soirée.
- **Rouvrir un score détruit les rotations postérieures** : le dire avant, en toutes lettres, avec le nombre de matchs concernés — pas un « Êtes-vous sûr ? » générique.

- [ ] **Step 1 : Créer** · **Step 2 : Check-in et appariement** · **Step 3 : Conduire** · **Step 4** : `npm test` · **Step 5 : Commit**

---

## Auto-relecture du plan

**Couverture de la spec :** §2 format et terrains → Tasks 2 et 10 ; §3 inscription, côté, liste d'attente → Tasks 2, 3, 7 ; §4 placement → Tasks 1 et 3 ; §5 déroulement et refus du nul → Tasks 1, 4, 8 ; §6 montée/descente et bye → Task 1 (moteur) et Task 4 (SQL) ; §7 saisie par joueur et accord entre camps → Tasks 4 et 8 ; §8 classement → Tasks 1, 5, 8 ; §9 rotation finale → Tasks 1 et 5 ; §10 mouvements → Tasks 2 et 4 ; §11 points et classements → Tasks 5 et 9 ; §12 Mon parcours → Task 9 ; §14 machine à états → Tasks 2, 3, 5 ; §15 forfaits → Tasks 2 et 4 ; §16 vérification → Tasks 1 et 6. **Aucune section sans tâche.**

**Cohérence des noms :** les six fonctions du moteur sont produites en Task 1 et consommées en Tasks 6 et 8 ; les tables de la Task 2 sont consommées par les Tasks 3, 4 et 5 ; `tournament_standings` est produite en Task 5 et consommée en Tasks 6 et 8 ; `tournament_results` est écrite en Task 5 et lue en Task 9.

**Un point signalé plutôt que caché :** les Tasks 3, 4 et 5 ne contiennent pas le code SQL complet, seulement les règles, les noms, les refus et les pièges. C'est délibéré — écrire ici des fonctions plpgsql non exécutées produirait du code plausible et faux — mais **leur relecture doit être plus stricte, pas plus indulgente**, et la Task 6 les met à l'épreuve.
