# Activité v2 — Hub Strava, partage in-app & fidélité Bilan (charte jaune/noir)

**Date :** 2026-06-17
**Statut :** Design validé (oral), prêt pour le plan
**Refonte de :** specs `2026-06-16-activite-*` (v1 déjà implémentée)
**Design source :** `C:\Users\jeffa\Bureau\Native\design_handoff_activity_tab\designs\02-Bilan-Mensuel.dc.html` (+ `01-Activity-Tab.dc.html`, screenshots)

## Pourquoi v2
Retours utilisateur sur la v1 :
1. **Activité ≠ doublon de Communauté** → en faire un hub à la Strava (partager + animer), pas un point d'entrée de navigation/découverte.
2. **Partage = in-app** (pas de Share Sheet externe dans Activité).
3. **Rendu Bilan à refaire fidèlement** au design (la v1 approximait).
4. **Palette charte = jaune + noir** (le handoff utilisait vert/cyan/bleu — à remapper).
5. **Le Bilan doit remonter en haut** de l'onglet.

## 1. Partage in-app (données)
Migration `activity_moments.sql` :
- `alter table activity_events add column caption text`, `add column is_highlight boolean default false`.
- Type `'bilan'` toléré (payload `{month,label,matches,winRate,eloDelta,topPartner}`).
- RPC `share_match_moment(p_match_id uuid, p_caption text)` (security definer) : upsert l'`activity_event` du match de `auth.uid` (par `player_id+match_id`) → set `caption`, `is_highlight=true`. Pas de doublon.
- RPC `post_bilan(p_month text, p_payload jsonb)` : insert `activity_event(player_id=auth.uid, type='bilan', payload, is_highlight=true, caption=null)`.
- RLS : un joueur ne peut écrire que ses propres events (déjà le cas ; les RPC sont security definer et filtrent sur `auth.uid()`).

`lib/activityFeed.ts` :
- `pickMoments` = events `is_highlight` (7 j) — Moments = highlights curés (matchs partagés + bilans), plus seulement les wins auto.
- `shareMatchMoment(matchId, caption)` et `postBilan(month, payload)` wrappers RPC.

## 2. Compositeur de partage match (Activité)
Remplace `StoryComposerV2` (externe) dans Activité par un **compositeur in-app léger** :
- `StoryMatchPicker` (choisir le match) → modale : **aperçu bloc-score façon « best moment »** (fond noir, score jaune) + `TextInput` légende (~140 car.) + bouton **Publier**.
- `Publier` → `shareMatchMoment` → toast « Publié 🎾 ». Aucun Share Sheet, aucun view-shot.
- L'export externe (`StoryComposerV2`) **reste sur profil + Communauté** (inchangé).

## 3. Reconstruction fidèle du Bilan — palette jaune/noir
Layout, typo (Anton/Barlow/Inter), tailles, espacements **fidèles au `.dc.html`**. Couleurs remappées vers la charte :

| Slide | Fond | Accents | Notes fidélité |
|---|---|---|---|
| 0 Cover | `linear 160deg #FFC11A→#E8A906→#0A0A0A` | noir/jaune | label « TON MOIS EN PADEL » ls 2.5px ; titre `{MOIS}\n2026` Barlow 72 ; **strip noir** 3 stats (matchs **jaune**, victoires **vert** `8V`, ELO **vert**) ; « Tape pour découvrir → » |
| 1 Volume | `#0A0A0A→#1A1A1C` (était vert) | jaune | label « TON VOLUME » jaune ; « Tu as joué… » ; **Anton 140** blanc ; « matchs en {mois} » **jaune** 32 ; trend « {x} 🔥 » ; bar chart 6 mois (JAN→JUIN, barre courante **jaune** + pop valeur) ; carte bas « vs mois précédent » |
| 2 Forme | `#0A0A0A→#1A1A1C` | **jaune** (était vert) | « TA FORME » ; « Tu as gagné… » ; **Anton 130 jaune** + `%` 54 ; « de tes matchs » ; ligne stats ; **grille 6 col** carrés **V vert / D rouge** (sémantique) + cases dashed ; carte bas jaune « X% au-dessus de la moyenne 🥇 » |
| 3 Progression | `#1F2937→#0A0A0A` | **jaune** (était cyan) | « TA PROGRESSION » jaune ; `+` 48 + **Anton 130 jaune** ; « points ELO » ; **pill Niveau {from}→{to}** avec flèche ; **line chart SVG** (aire dégradée jaune + ligne jaune + point) axes 1ᵉʳ/15/30 ; carte bas « Prochaine ligue » noir/jaune |
| 4 Duo | `#0A0A0A→#1A1A1C` | jaune | « TON MEILLEUR DUO » ; « Avec qui tu as **le plus gagné** » ; avatar **140 jaune + anneau pointillé** ; nom Barlow 36 + @handle ; **3 tuiles** (matchs blanc / ensemble **jaune** / winrate jaune) ; CTA « Proposer un match à {prénom} → » (in-app) |
| 5 Best moment | `#0A0A0A→#1A1A1C` (était bleu-vert) | jaune | « TON MATCH DU MOIS » ; « Le **{date}** tu as fait ça » ; **carte score** (badge VICTOIRE **vert**, équipes mini-avatars carrés noir/jaune, score **Anton 48 jaune** / perdant blanc 35%) ; **carte badge jaune** (emoji 42 + nom Barlow 22 + desc) |
| 6 Partage | `linear 135deg #FFC11A→#E8A906→#0A0A0A` | noir/jaune | « RÉCAP {mois} » ; « Tu as fait **un mois** de feu 🔥 » ; **carte recap noire** (avatar bordé jaune + nom + Niv. + mois ; **grille 2×2** Matchs blanc / Winrate **jaune** / ELO jaune / Badge ; footer « Meilleur duo … » + logo PAGMATCH) ; **un seul bouton « Partager mon bilan »** (post in-app). PAS d'IG/WhatsApp/Enregistrer |

Navigation Stories inchangée (tap g/d, progress bars, X). `GradientBg` accepte un dégradé multi-stops (3 couleurs).

## 4. Repositionnement (anti-doublon Communauté)
- **Bilan en haut** : carte/bannière proéminente « Ton bilan de {mois} » en tête du fil (sous le header), au lieu du bouton en bas.
- Retirer `DiscoveryRail` + tout `router.push('/community/...')` depuis Activité.
- Frame B : CTA hero « Élargis ton cercle » → **« Partage un moment »** (ouvre compositeur) ; garder « Pinger » (push in-app).
- Frame C (bilan calme) : CTA secondaire « Partager mon bilan » (in-app) au lieu du lien Communauté.
- Conserver : fil chrono + 🔥 + commentaires + filtre par ami + Ta semaine + Hero + Week-end.

## 5. Rendu feed `type='bilan'`
`ActivityCard` : si `e.type==='bilan'` → mini-carte recap (noir, « Bilan {label} », 3 chiffres matchs/winrate/ELO jaune) ; sinon rendu normal + `caption` affichée si présente.

## Fichiers touchés (récap)
- `supabase/migrations/activity_moments.sql` (nouveau)
- `lib/activityFeed.ts` (pickMoments=highlight, shareMatchMoment, postBilan)
- `lib/bilan.ts` (ajouts pour la carte recap/partage si besoin : handle, partnerInitials, vsAvg…)
- `components/bilan/GradientBg.tsx` (multi-stops), tous les `components/bilan/slides/*` (réécriture fidèle), `BarChart6Months`, `LineChartElo` (palette), `ShareCard`→ carte recap fidèle
- `components/bilan/MomentComposer.tsx` (nouveau — compositeur in-app)
- `components/activity/*` : `BilanBanner.tsx` (nouveau, en haut), retrait DiscoveryRail des frames
- `app/(tabs)/activite.tsx` (bilan en haut, compositeur in-app, repositionnement)
- `app/bilan/[month].tsx` (palette, bouton partage in-app, post_bilan)
- `components/community/ActivityCard.tsx` (caption + type bilan)

## Critères de réussite
1. Bilan rendu **fidèle au layout/typo du `.dc.html`**, palette **jaune/noir** (V/D vert/rouge conservés).
2. Partage match & bilan = **post in-app** (aucun Share Sheet dans Activité).
3. Bilan accessible **en haut** de l'onglet.
4. Plus aucun lien Activité → hub Communauté ; DiscoveryRail retiré.
5. `tsc` passe ; pas de régression du fil (kudos/commentaires/filtre).

## Hors-scope
- Export externe dans Activité (reste profil/Communauté).
- Auto-play/long-press Stories.
- Stockage média (règle no-storage maintenue).
