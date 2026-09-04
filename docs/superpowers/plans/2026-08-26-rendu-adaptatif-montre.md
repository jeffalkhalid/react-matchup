# Rendu adaptatif de l'app montre — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire tourner l'app montre PagMatch sur les 57 modèles Garmin du SDK avec un affichage irréprochable sur chacun, sans aucune position ni police écrite en dur.

**Architecture:** Un module `Layout` mesure la largeur réellement utilisable à chaque hauteur (la corde du cercle sur un écran rond, la largeur pleine sur un rectangle), mesure chaque texte avant de le dessiner, et choisit la plus grande police qui tient. Les vues déclarent leur contenu par ordre d'importance ; `Layout` décide comment. Quand la place manque, le score survit et le reste s'efface.

**Tech Stack:** Monkey C / Connect IQ SDK 9.2.0, PostgreSQL/Supabase (une clé ajoutée à la charge utile), PowerShell (balayage de compilation).

**Spec:** `docs/superpowers/specs/2026-08-26-rendu-adaptatif-montre-design.md`

## Global Constraints

- **Aucune position ni police écrite en dur** dans les vues après ce chantier. Une vue qui contient encore `h * 84 / 100` ou `Graphics.FONT_XTINY` réintroduit le défaut qu'on élimine.
- **Jamais de texte tronqué.** Si rien ne tient, on n'affiche rien — c'est `Layout` qui tranche, pas la vue.
- **Les chaînes DESSINÉES sont sans accents** (les polices Garmin ne les garantissent pas). Les commentaires restent en français accentué.
- **La couleur décore, elle n'informe jamais.** Les équipes se distinguent par leur position (haut/bas), jamais par leur teinte : les profondeurs vont de 4 à 16 bits.
- **Les messages restent sous 20 caractères**, même quand la place le permet.
- **Undo et validation ne partagent JAMAIS le même geste.**
- Vérification : `cd watch; .\build.ps1 -Device <id>` doit atteindre `BUILD SUCCESSFUL`. Il n'existe **aucun framework de test Monkey C** dans ce repo : la vérification est la compilation plus l'inspection visuelle au simulateur.
- Git : branche `main`, ~28 fichiers non commités appartenant à d'autres travaux. **Jamais** `git add -A`, `git add .` ni `git commit -a`. `supabase` est dans `.gitignore` → `git add -f` pour les migrations.
- Migrations SQL appliquées **à la main par le user** dans le SQL Editor. Ne jamais tenter de les appliquer.

### API Connect IQ vérifiées dans le SDK 9.2.0

Toutes confirmées présentes dans `epix2.api.debug.xml` — ne pas en inventer d'autres :

- `System.getDeviceSettings()` → `.screenShape`, `.isTouchScreen`, `.screenWidth`, `.screenHeight`
- Formes : `System.SCREEN_SHAPE_ROUND`, `SCREEN_SHAPE_SEMI_ROUND`, `SCREEN_SHAPE_SEMI_OCTAGON`, `SCREEN_SHAPE_RECTANGLE` — **quatre**, pas trois (la spec en annonçait trois)
- `dc.getTextWidthInPixels(text, font)`, `dc.getFontHeight(font)`, `dc.getTextDimensions(text, font)`
- `onTap(clickEvent)`, `onHold(clickEvent)`, `clickEvent.getCoordinates()`, `CLICK_TYPE_TAP` / `CLICK_TYPE_HOLD`
- Polices texte : `FONT_LARGE`, `FONT_MEDIUM`, `FONT_SMALL`, `FONT_TINY`, `FONT_XTINY`
- Polices chiffres : `FONT_NUMBER_HOT`, `FONT_NUMBER_MEDIUM`, `FONT_NUMBER_MILD`

### Pièges SDK déjà payés sur ce projet

- `type="watch-app"` avec un tiret (`watchapp` est refusé).
- Les callbacks réseau doivent être **typés**, avec les noms **qualifiés** (`Lang.Number`), car les sources utilisent `using` et non `import`.
- `hidden` est **refusé** sur les fonctions de module (hors classe).
- Le callback de `Timer.start` doit être typé `as Void`.
- Connect IQ n'accepte **que des objets JSON** en réponse : un `null` est rejeté par `-400`.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `watch/source/Layout.mc` | **Nouveau.** Mesure, choix de police, dessin ou abandon. Sans état. |
| `watch/source/Demo.mc` | **Nouveau, TEMPORAIRE.** Jeu de données type pour la vérification visuelle. Retiré en Task 8. |
| `watch/source/SessionView.mc` | Passe par `Layout`, applique la règle de priorité, gère le tactile |
| `watch/source/PairingView.mc` | Passe par `Layout` |
| `watch/source/ConfirmView.mc` | Passe par `Layout` |
| `supabase/migrations/watch_team_initials.sql` | **Nouveau.** Ajoute les initiales à la charge utile |
| `watch/manifest.xml` | Les 57 cibles |
| `watch/build.ps1` | Option `-All` : balayage de compilation |

---

## Task 1 : Le moteur de mesure

**Files:**
- Create: `watch/source/Layout.mc`
- Create: `watch/source/Demo.mc`

**Interfaces:**
- Produces: `Layout.usableWidth(dc, y)`, `Layout.fitFont(dc, text, maxWidth, ladder)`, `Layout.drawFit(dc, y, text, ladder, color)`, `Layout.drawBest(dc, y, variants, ladder, color)`, `Layout.textLadder()`, `Layout.numberLadder()`, `Layout.isRound()`, `Layout.isTouch()`, `Demo.ENABLED`, `Demo.payload()`.

- [ ] **Step 1 : Écrire le module de mesure**

```monkeyc
// watch/source/Layout.mc
// Mesure et dessine — sans jamais supposer la taille ni la forme de l'ecran.
//
// Pourquoi ce module existe : trois defauts d'affichage du meme type ont ete
// trouves en une seule journee de test (lignes poussees vers le bord, marge
// verticale reduite de moitie, messages rognes aux deux bouts). Tous venaient
// de positions et de polices reglees a l'oeil sur UNE montre. Le parc va de
// 148 a 486 px, en rond ET en rectangle : aucune valeur en dur ne peut y etre
// juste. Ici on mesure, on ne suppose pas.
//
// SANS ETAT : ne memorise rien entre deux dessins.
using Toybox.Graphics;
using Toybox.System;
using Toybox.Math;
using Toybox.Lang;

module Layout {

    // Marge VOLONTAIREMENT genereuse : les metriques de police Garmin
    // surestiment l'encre reelle (verifie en revue), donc un calcul au pixel
    // pres donnerait une fausse assurance dans les deux sens.
    const MARGIN_PCT = 6;
    const MARGIN_MIN = 8;

    // De la plus grande a la plus petite.
    function textLadder() {
        return [Graphics.FONT_LARGE, Graphics.FONT_MEDIUM, Graphics.FONT_SMALL,
                Graphics.FONT_TINY, Graphics.FONT_XTINY];
    }

    function numberLadder() {
        return [Graphics.FONT_NUMBER_HOT, Graphics.FONT_NUMBER_MEDIUM,
                Graphics.FONT_NUMBER_MILD, Graphics.FONT_LARGE,
                Graphics.FONT_MEDIUM, Graphics.FONT_SMALL, Graphics.FONT_TINY];
    }

    // SEMI_ROUND et SEMI_OCTAGON sont traites comme ronds : leur largeur decroit
    // aussi vers les bords. Seul RECTANGLE garde sa pleine largeur partout.
    function isRound() {
        return System.getDeviceSettings().screenShape != System.SCREEN_SHAPE_RECTANGLE;
    }

    function isTouch() {
        return System.getDeviceSettings().isTouchScreen;
    }

    function margin(dc) {
        var m = dc.getWidth() * MARGIN_PCT / 100;
        return m < MARGIN_MIN ? MARGIN_MIN : m;
    }

    // Largeur REELLEMENT utilisable a la hauteur y.
    // Rond : la corde du cercle, 2*racine(r^2 - (y-r)^2). C'est le calcul qui
    // manquait et qui rognait les textes en bas d'ecran.
    function usableWidth(dc, y) {
        var w = dc.getWidth();
        var m = margin(dc);
        if (!isRound()) {
            var flat = w - 2 * m;
            return flat > 0 ? flat : 0;
        }
        var r = dc.getHeight() / 2.0;
        var dy = y - r;
        var inside = r * r - dy * dy;
        if (inside <= 0) { return 0; }
        var chord = 2.0 * Math.sqrt(inside);
        if (chord > w) { chord = w; }   // ecran rond pas forcement carre
        var usable = chord - 2 * m;
        return usable > 0 ? usable : 0;
    }

    // Premiere police de l'echelle dont le texte tient. null si aucune :
    // l'appelant decide alors quoi abandonner.
    function fitFont(dc, text, maxWidth, ladder) {
        if (text == null) { return null; }
        if (text.length() == 0) { return null; }
        for (var i = 0; i < ladder.size(); i = i + 1) {
            if (dc.getTextWidthInPixels(text, ladder[i]) <= maxWidth) {
                return ladder[i];
            }
        }
        return null;
    }

    // Dessine si ca tient, sinon ne dessine RIEN et renvoie false.
    // Jamais de texte tronque : c'est precisement le defaut qu'on elimine.
    function drawFit(dc, y, text, ladder, color) {
        var f = fitFont(dc, text, usableWidth(dc, y), ladder);
        if (f == null) { return false; }
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, y, f, text, Graphics.TEXT_JUSTIFY_CENTER);
        return true;
    }

    // Essaie plusieurs formulations, de la plus riche a la plus pauvre, et
    // dessine la premiere qui tient. C'est ainsi que « admin & Kay » devient
    // « A&K » puis rien du tout quand l'ecran retrecit.
    function drawBest(dc, y, variants, ladder, color) {
        for (var i = 0; i < variants.size(); i = i + 1) {
            if (drawFit(dc, y, variants[i], ladder, color)) { return true; }
        }
        return false;
    }
}
```

- [ ] **Step 2 : Écrire le jeu de données de démonstration**

```monkeyc
// watch/source/Demo.mc
// TEMPORAIRE — retire en Task 8.
//
// Le simulateur n'a ni jeton d'appairage ni session live : sans ce jeu de
// donnees, impossible de VOIR l'ecran de match sur les 15 familles. On simule
// donc le pire cas realiste : trois sets, noms longs, score de point, message.
module Demo {

    // Mettre a true UNIQUEMENT pour la passe de verification visuelle.
    const ENABLED = false;

    function payload() {
        return {
            "has_session"   => true,
            "session_id"    => "demo",
            "scoring_mode"  => "points",
            "golden_point"  => true,
            "team1"         => "Alexandre & Christophe",
            "team2"         => "Bartholomew & Dominique",
            "team1_short"   => "A&C",
            "team2_short"   => "B&D",
            "sets"          => [ {"t1" => 6, "t2" => 4}, {"t1" => 3, "t2" => 6}, {"t1" => 5, "t2" => 4} ],
            "sets_won"      => {"t1" => 1, "t2" => 1},
            "game_label"    => {"t1" => "40", "t2" => "AV"},
            "contest_count" => 0,
            "input_device"  => "watch",
            "is_scorer"     => true,
            "finished"      => false,
            "match_decided" => false
        };
    }
}
```

- [ ] **Step 3 : Compiler**

Run: `cd watch; .\build.ps1 -Device epix2`
Expected: `BUILD SUCCESSFUL`. Si le compilateur refuse `const` dans un module ou une déclaration de tableau, appliquer la correction minimale et la **noter dans le rapport** — c'est un piège SDK de plus à consigner.

- [ ] **Step 4 : Proposer le commit**

```bash
git add watch/source/Layout.mc watch/source/Demo.mc
git commit -m "feat(montre): moteur de rendu qui mesure au lieu de supposer"
```

---

## Task 2 : Les initiales côté serveur

**Files:**
- Create: `supabase/migrations/watch_team_initials.sql`

**Interfaces:**
- Produces: clés `team1_short` et `team2_short` dans la charge utile de `watch_current_session` / `watch_apply_event`, au format `« A&K »`.

**Pourquoi côté serveur :** Monkey C n'a pas de découpage de chaîne ; extraire des initiales de `« admin & Kay »` au poignet demanderait une analyse fragile. Le serveur sait déjà qui sont les joueurs — il envoie les deux formes, la montre choisit celle qui tient. Cohérent avec la règle « la montre est un pur afficheur ».

- [ ] **Step 1 : Écrire la migration**

```sql
-- ============================================================
-- App montre — initiales d'equipe pour les petits ecrans.
--
-- ORDRE : après watch_rpcs.sql et watch_feature_flag.sql. Ré-appliquable.
--
-- La montre affiche « admin & Kay » quand la place le permet, « A&K » quand
-- elle manque, rien du tout sur les plus petits ecrans. Les deux formes sont
-- calculees ICI : Monkey C n'a pas de split() et la montre ne doit rien
-- deduire (spec §4).
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_watch_payload(p_session_id uuid, p_player uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s RECORD; st jsonb; t1 text; t2 text; t1s text; t2s text;
BEGIN
  SELECT * INTO s FROM public.live_match_sessions WHERE id = p_session_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  st := coalesce(s.current_state, public.fn_live_replay(p_session_id));

  SELECT string_agg(split_part(p.name, ' ', 1), ' & ' ORDER BY ord),
         string_agg(upper(left(p.name, 1)), '&' ORDER BY ord)
    INTO t1, t1s
    FROM unnest(s.team1_ids) WITH ORDINALITY AS u(pid, ord)
    JOIN public.players p ON p.id = u.pid;

  SELECT string_agg(split_part(p.name, ' ', 1), ' & ' ORDER BY ord),
         string_agg(upper(left(p.name, 1)), '&' ORDER BY ord)
    INTO t2, t2s
    FROM unnest(s.team2_ids) WITH ORDINALITY AS u(pid, ord)
    JOIN public.players p ON p.id = u.pid;

  RETURN jsonb_build_object(
    'has_session',   true,
    'session_id',    s.id,
    'scoring_mode',  coalesce(s.scoring_mode, 'games'),
    'golden_point',  coalesce(s.golden_point, true),
    'team1',         coalesce(t1, 'Equipe 1'),
    'team2',         coalesce(t2, 'Equipe 2'),
    'team1_short',   coalesce(t1s, 'E1'),
    'team2_short',   coalesce(t2s, 'E2'),
    'sets',          coalesce(st->'sets', '[]'::jsonb),
    'sets_won',      coalesce(st->'setsWon', jsonb_build_object('t1', 0, 't2', 0)),
    'current_game',  coalesce(st->'currentGame', 'null'::jsonb),
    'tie_break',     coalesce(st->>'tieBreak', 'false')::boolean,
    'contest_count', coalesce(s.contest_count, 0),
    'input_device',  coalesce(s.input_device, 'phone'),
    'is_scorer',     (s.scorer_id = p_player),
    'finished',      (s.status <> 'live'),
    'game_label',    CASE
      WHEN coalesce(s.scoring_mode, 'games') <> 'points'
        OR st->'currentGame' IS NULL
        OR jsonb_typeof(st->'currentGame') = 'null'
      THEN NULL
      ELSE public.fn_game_label(
        (st->'currentGame'->>'t1')::int,
        (st->'currentGame'->>'t2')::int,
        coalesce(s.golden_point, true),
        coalesce((st->>'tieBreak')::boolean, false))
    END,
    'match_decided', (
      coalesce((st->'setsWon'->>'t1')::int, 0) <> coalesce((st->'setsWon'->>'t2')::int, 0)
      AND greatest(coalesce((st->'setsWon'->>'t1')::int, 0),
                   coalesce((st->'setsWon'->>'t2')::int, 0)) >= 2
    )
  );
END; $$;

REVOKE ALL ON FUNCTION public.fn_watch_payload(uuid, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

- [ ] **Step 2 : Vérifier la fidélité avant de proposer l'application**

⚠️ **Cette fonction est EN PRODUCTION.** Comparer le corps ci-dessus, clé par clé, avec la version actuelle de `supabase/migrations/watch_rpcs.sql` : toutes les clés existantes doivent être présentes à l'identique, seules `team1_short` et `team2_short` s'ajoutent. Une clé perdue casserait l'écran de match sans qu'aucun compilateur ne bronche.

Si le fichier du dépôt diverge de ce qui est écrit ici, **reprendre le corps du dépôt** et n'y ajouter que les deux clés.

- [ ] **Step 3 : Faire appliquer par le user, attendre confirmation**

Vérification à lui donner, à lancer après application :

```sql
select public.fn_watch_payload(s.id, s.scorer_id) -> 'team1_short' as initiales
from public.live_match_sessions s order by s.started_at desc limit 1;
```

Attendu : une chaîne du type `"A&K"`.

- [ ] **Step 4 : Proposer le commit**

```bash
git add -f supabase/migrations/watch_team_initials.sql
git commit -m "feat(montre): initiales d'equipe pour les petits ecrans"
```

---

## Task 3 : L'écran de match sur le moteur de mesure

**Files:**
- Modify: `watch/source/SessionView.mc`

**Interfaces:**
- Consumes: tout `Layout` (Task 1), `Demo.ENABLED` / `Demo.payload()` (Task 1), `team1_short` / `team2_short` (Task 2).

- [ ] **Step 1 : Mémoriser les initiales**

Dans `apply(d)`, à côté de `_team1` / `_team2` :

```monkeyc
        _team1Short = d["team1_short"];
        _team2Short = d["team2_short"];
```

avec les champs déclarés près des autres :

```monkeyc
    hidden var _team1Short = "E1";
    hidden var _team2Short = "E2";
```

- [ ] **Step 2 : Brancher le mode démonstration**

Au tout début de `onShow()`, avant `refresh()` :

```monkeyc
        // Passe de verification visuelle : le simulateur n'a ni jeton ni
        // session, on injecte un match type au lieu d'interroger le serveur.
        if (Demo.ENABLED) { apply(Demo.payload()); return; }
```

- [ ] **Step 3 : Réécrire `onUpdate` selon la règle de priorité**

Remplacer **tout** le corps de `onUpdate` par :

```monkeyc
    function onUpdate(dc) {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        var h = dc.getHeight();

        if (_sid == null) {
            Layout.drawFit(dc, h / 2, _msg, Layout.textLadder(), Graphics.COLOR_LT_GRAY);
            return;
        }

        // PRIORITE (spec §5) : le score survit toujours, le reste s'efface.
        // Chaque element est tente a sa hauteur ; s'il ne tient pas, on ne
        // dessine rien plutot qu'un texte rogne.

        // 1. Le score, l'element consulte entre deux points.
        Layout.drawFit(dc, h * 26 / 100, _score1, Layout.numberLadder(), Graphics.COLOR_WHITE);
        Layout.drawFit(dc, h * 64 / 100, _score2, Layout.numberLadder(), Graphics.COLOR_WHITE);

        // 2. Le point en cours — la raison d'etre du mode points.
        var hasPoint = false;
        if (_pointLabel != null) {
            hasPoint = Layout.drawFit(dc, h * 75 / 100, _pointLabel,
                                      Layout.textLadder(), Graphics.COLOR_YELLOW);
        }

        // 3. Les noms : complets, puis initiales, puis rien.
        Layout.drawBest(dc, h * 10 / 100, [_team1, _team1Short],
                        Layout.textLadder(), Graphics.COLOR_YELLOW);
        Layout.drawBest(dc, h * 50 / 100, [_team2, _team2Short],
                        Layout.textLadder(), Graphics.COLOR_YELLOW);

        // 4. Le message, le moins critique. Remonte quand aucun point
        //    n'occupe la place : la corde y est plus large.
        var msgY = hasPoint ? (h * 84 / 100) : (h * 78 / 100);
        if (_contests > 0) {
            Layout.drawFit(dc, msgY, _contests.toString() + " contestation",
                           Layout.textLadder(), Graphics.COLOR_ORANGE);
        } else {
            Layout.drawFit(dc, msgY, _msg, Layout.textLadder(), Graphics.COLOR_LT_GRAY);
        }
    }
```

> Les hauteurs restent exprimées en pourcentages — c'est légitime : elles disent *où* poser un élément, pas *quelle taille* il fait. Ce sont les polices et les largeurs, seules sources des défauts constatés, qui sont désormais mesurées.

- [ ] **Step 4 : Compiler**

Run: `cd watch; .\build.ps1 -Device epix2`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5 : Proposer le commit**

```bash
git add watch/source/SessionView.mc
git commit -m "feat(montre): ecran de match sur le moteur de mesure"
```

---

## Task 4 : Appairage et confirmation sur le moteur de mesure

**Files:**
- Modify: `watch/source/PairingView.mc`
- Modify: `watch/source/ConfirmView.mc`

**Interfaces:**
- Consumes: `Layout` (Task 1).

- [ ] **Step 1 : Réécrire `onUpdate` de `PairingView`**

Remplacer chaque `dc.drawText(...)` par un appel à `Layout.drawFit`, en gardant les mêmes hauteurs et les mêmes couleurs. Le code des chiffres saisis (`_digits`) et de la navigation ne change pas. Exemple pour la première ligne :

```monkeyc
        Layout.drawFit(dc, h * 18 / 100, "Code affiche dans l app",
                       Layout.textLadder(), Graphics.COLOR_LT_GRAY);
```

Le code à six chiffres utilise `Layout.numberLadder()`, les libellés `Layout.textLadder()`.

- [ ] **Step 2 : Réécrire `onUpdate` de `ConfirmView`**

Même traitement. Les quatre lignes (« Valider le score ? », le score, « START = oui », « RETOUR = non ») passent par `Layout.drawFit` avec `Layout.textLadder()`.

- [ ] **Step 3 : Vérifier qu'il ne reste aucune police en dur**

Run: `cd watch; grep -n "FONT_" source/*.mc`
Expected: des occurrences **uniquement** dans `Layout.mc`. Toute autre occurrence est un reste à corriger.

- [ ] **Step 4 : Compiler**

Run: `cd watch; .\build.ps1 -Device epix2`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5 : Proposer le commit**

```bash
git add watch/source/PairingView.mc watch/source/ConfirmView.mc
git commit -m "feat(montre): appairage et confirmation sur le moteur de mesure"
```

---

## Task 5 : La saisie tactile

**Files:**
- Modify: `watch/source/SessionView.mc`

**Interfaces:**
- Consumes: `Layout.isTouch()` (Task 1).

- [ ] **Step 1 : Marquer en touchant l'équipe**

Dans `SessionDelegate`, ajouter :

```monkeyc
    // Sur ecran tactile, le geste suit le regard comme pour les boutons :
    // on touche la MOITIE de l'ecran ou se trouve l'equipe qui a marque.
    // Indispensable sur les montres sans boutons haut/bas (Venu Sq,
    // Vivoactive), ou onNextPage/onPreviousPage ne sont pas atteignables.
    function onTap(clickEvent) {
        var coords = clickEvent.getCoordinates();
        var y = coords[1];
        var mid = System.getDeviceSettings().screenHeight / 2;
        _view.tap(scoreEvent(), y < mid ? 1 : 2);
        return true;
    }
```

Ajouter `using Toybox.System;` en tête du fichier s'il n'y est pas déjà.

- [ ] **Step 2 : Annuler par appui long sur les montres sans bouton**

```monkeyc
    // Filet pour un appareil tactile dont les boutons ne seraient pas
    // atteignables. Appui LONG : impossible par accident, et distinct du
    // geste de validation (appui long sur HAUT) — les deux ne doivent
    // JAMAIS se confondre.
    function onHold(clickEvent) {
        _view.tap("undo", 0);
        return true;
    }
```

- [ ] **Step 3 : Adapter le texte d'aide**

Le message affiché quand le match est joué doit décrire le geste réellement disponible. Dans `apply(d)`, remplacer la branche `_decided` :

```monkeyc
        } else if (_decided) {
            _msg = Layout.isTouch() ? "Valider : appui long" : "Valider : HAUT long";
```

- [ ] **Step 4 : Compiler**

Run: `cd watch; .\build.ps1 -Device epix2`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5 : Proposer le commit**

```bash
git add watch/source/SessionView.mc
git commit -m "feat(montre): saisie tactile en touchant l'equipe"
```

---

## Task 6 : Les 57 cibles et le balayage de compilation

**Files:**
- Modify: `watch/manifest.xml`
- Modify: `watch/build.ps1`

- [ ] **Step 1 : Recaler le manifeste sur tous les devices du SDK**

✅ **Vérifié avant d'écrire ce plan** : les **57 modèles déclarent `watchApp`** dans leurs `appTypes`, y compris `etrextouch`. Aucun filtrage n'est donc nécessaire, et aucun modèle ne fera échouer le manifeste pour cause de type d'application incompatible.

`build.ps1` possède déjà `-SyncProducts`, mais il filtre sur `fenix|epix|instinct`. Élargir ce filtre à **tous** les devices installés :

```powershell
    $targets  = Get-SdkDevices
```

au lieu de la ligne filtrée. Puis :

Run: `cd watch; .\build.ps1 -SyncProducts`
Expected: `manifest.xml recale sur 57 device(s)`.

- [ ] **Step 2 : Ajouter le balayage de compilation**

Ajouter le paramètre `[switch] $All` au bloc `param(...)`, puis, juste avant le bloc « Compilation » :

```powershell
# ---------------------------------------------------- Balayage des 57 cibles
if ($All) {
    $devs = Get-SdkDevices
    $ok = 0; $ko = @()
    foreach ($d in $devs) {
        $out = Join-Path $BinDir ("PagMatch-" + $d + ".prg")
        & $monkeyc -f (Join-Path $Root "monkey.jungle") -o $out -y $KeyDer -d $d 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $ok = $ok + 1 } else { $ko += $d }
    }
    Write-Host "Compilation : $ok/$($devs.Count) OK"
    if ($ko.Count -gt 0) { Write-Host "ECHECS : $($ko -join ', ')"; exit 1 }
    exit 0
}
```

⚠️ `$BinDir`, `$monkeyc` et `$KeyDer` sont définis plus bas dans le script : **déplacer leur définition au-dessus** de ce bloc, sinon il s'exécute avec des variables vides.

- [ ] **Step 3 : Lancer le balayage**

Run: `cd watch; .\build.ps1 -All`
Expected: `Compilation : 57/57 OK`.

Tout échec est un vrai résultat : il nomme un modèle dont une API manque ou dont la cible est absente du SDK. Le consigner dans le rapport avec la sortie exacte du compilateur — ne pas retirer le modèle du manifeste pour faire passer le balayage.

- [ ] **Step 4 : Proposer le commit**

```bash
git add watch/manifest.xml watch/build.ps1
git commit -m "feat(montre): 57 cibles et balayage de compilation"
```

---

## Task 7 : La vérification visuelle sur les 15 familles

**Files:** aucun fichier modifié — c'est une passe d'inspection.

- [ ] **Step 1 : Activer le mode démonstration**

Dans `watch/source/Demo.mc`, passer `ENABLED` à `true`. **Ne pas commiter cet état.**

- [ ] **Step 2 : Capturer un modèle par famille d'écran**

Un représentant par famille, du plus petit au plus grand :

`vivoactive_hr` (148×205 rect), `epix` (205×148 rect), `fenix3` (218 rond 4 bits), `fenix5s` (218), `venusq` (240×240 rect), `fenix5` (240), `fenix6` (260), `fenix6xpro` (280), `venusq2` (320×360 rect), `epix2pro42mm` (390), `epix2` (416), `venux1` (448×486 rect), `epix2pro51mm` (454), `fenix9pro51mm` (466), `etrextouch` (240×400 rect).

Pour chacun :

```powershell
cd watch
.\build.ps1 -Device <id> -Sim
```

Laisser le simulateur ouvert entre deux modèles, puis capturer l'écran :

```powershell
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width, [System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen(0, 0, 0, 0, $b.Size)
$b.Save("bin\sim-<id>.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $b.Dispose()
```

- [ ] **Step 3 : Regarder chaque capture**

Pour chacune des 15 images, vérifier :
- aucun texte rogné, sur aucun bord ;
- le score est lisible et reste le plus gros élément ;
- aucune ligne n'en chevauche une autre ;
- sur les petits écrans, la dégradation est propre (initiales ou rien, jamais un nom coupé) ;
- **les chiffres du score s'affichent tous**, espaces compris. Les polices `FONT_NUMBER_*` sont conçues pour des chiffres et ne contiennent pas forcément le même jeu de glyphes que les polices texte : un `« 6 4 1 »` correct sur l'Epix ne le garantit pas ailleurs. Si un espace manque sur un modèle, corriger dans `Layout` en écartant la police fautive de `numberLadder()`, jamais par un cas particulier dans la vue ;
- **rien ne dépend de la couleur.** Vérifier sur `fenix3` (4 bits) que les deux équipes restent distinguables : ce qui les sépare doit être leur position, jamais leur teinte (spec §7).

Consigner dans le rapport, **famille par famille**, ce qui est vu — pas une conclusion globale. Une famille non regardée est une famille non vérifiée.

- [ ] **Step 4 : Corriger ce qui est trouvé**

Toute correction doit porter sur **`Layout` ou la règle de priorité**, jamais sur une valeur propre à un modèle. Une exception par appareil réintroduirait exactement le défaut que ce chantier élimine.

Recompiler et recapturer les familles corrigées.

- [ ] **Step 5 : Proposer le commit des correctifs éventuels**

```bash
git add watch/source/Layout.mc watch/source/SessionView.mc
git commit -m "fix(montre): corrections issues de la passe visuelle 15 familles"
```

---

## Task 8 : Retirer le mode démonstration

**Files:**
- Delete: `watch/source/Demo.mc`
- Modify: `watch/source/SessionView.mc`

- [ ] **Step 1 : Supprimer le fichier et son appel**

```bash
rm watch/source/Demo.mc
```

Retirer de `onShow()` la ligne `if (Demo.ENABLED) { apply(Demo.payload()); return; }`.

- [ ] **Step 2 : Vérifier qu'il n'en reste rien**

Run: `cd watch; grep -rn "Demo" source/`
Expected: aucun résultat.

- [ ] **Step 3 : Compiler et rebalayer**

Run: `cd watch; .\build.ps1 -All`
Expected: `Compilation : 57/57 OK`.

- [ ] **Step 4 : Proposer le commit**

```bash
git add watch/source/SessionView.mc
git rm watch/source/Demo.mc
git commit -m "chore(montre): retrait du mode demonstration"
```

---

## Ce que ce plan ne couvre PAS

- La publication sur la boutique Connect IQ — sans elle, l'app reste installable par le seul développeur, quel que soit le nombre de modèles supportés.
- L'enregistrement du match comme activité Garmin et la fréquence cardiaque.
- La télécommande par notification pour Apple Watch et Wear OS.
- Toute évolution fonctionnelle : ce plan ne change que le rendu et la saisie.
