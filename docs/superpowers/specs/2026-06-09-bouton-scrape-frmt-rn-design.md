# Design — Bouton de scrape FRMT dans l'app React Native

**Date :** 2026-06-09
**App cible :** `react-matchup` (Expo / React Native)
**Dépendances externes :** repo GitHub `jeffalkhalid/matchup_padel` (scraper Playwright + workflow `scrape-frmt.yml`), projet Supabase `icshhobxeppttgayxmba`.

## Contexte

Le scraper FRMT existe déjà, entièrement en code, dans le projet Next.js `matchup_padel` :
- `scripts/scrape-frmt.ts` — scraper Playwright (ouvre `https://info2.frmt.ma/...`, parcourt
  Messieurs + Dames tranche par tranche en AJAX, écrit dans la table Supabase `frmt_rankings`).
  Vérifié le 2026-06-09 en dry-run : **2784 joueurs** (Masculin = 2334, Féminin = 450).
- `.github/workflows/scrape-frmt.yml` — GitHub Actions : cron hebdo (lundi 6h UTC) + `workflow_dispatch`.
- `app/api/admin/scrape-frmt/route.ts` — bouton dans l'admin **du site Next.js**, mais qui lance
  Playwright via `child_process` → **ne marche pas sur Vercel** (serverless, pas de navigateur).

L'app **React Native** n'a aucun moyen de déclencher un scrape : son onglet admin ne fait que le
linking manuel FRMT ↔ joueur.

## Objectif

Ajouter un bouton « 🔄 Lancer un scrape » dans l'onglet admin FRMT de l'app RN, fiable même en
production, sans dupliquer ni fragiliser le scraper existant.

## Contrainte structurante

Le scraper a besoin d'un **vrai navigateur Chromium** (le site FRMT est une appli WEBDEV dont le
tableau se charge par AJAX au changement des `<select>` `#A16`/`#A18` — un simple `fetch` ne récupère
rien). Or :
- **Supabase Edge Functions** (Deno) : aucun binaire navigateur possible → impossible.
- **Vercel serverless** : timeout max 300 s, le scrape prend 5-8 min → non viable.
- **GitHub Actions** : Chromium complet, timeout 15 min, gratuit, **déjà configuré** → retenu.

Donc le bouton **ne peut pas exécuter** le scrape ; il **déclenche le workflow GitHub Actions**
existant via `workflow_dispatch`.

## Architecture

```
[Bouton admin RN]
   │  supabase.functions.invoke('trigger-frmt-scrape')   (même pattern que send-push)
   ▼
[Edge Function Supabase  trigger-frmt-scrape  (nouvelle)]
   │  1. vérifie via le JWT que l'appelant est admin (players.is_admin) — sinon 403
   │  2. POST GitHub API → workflow_dispatch de scrape-frmt.yml (secret GITHUB_PAT)
   ▼
[GitHub Actions]  → scraper Playwright existant → frmt_rankings + auto-match
```

## Composants

### 1. Edge Function `trigger-frmt-scrape`
Emplacement : `react-matchup/supabase/functions/trigger-frmt-scrape/index.ts`.
Calquée sur `send-push/index.ts` (CORS, `Deno.serve`).

- **Auth admin** : lire le header `Authorization` (JWT de l'appelant). Créer un client Supabase avec
  l'anon key + ce header → `auth.getUser()`. Puis client service-role → vérifier
  `players.is_admin = true` pour ce `user_id`. Sinon `403`.
- **Déclenchement** :
  `POST https://api.github.com/repos/jeffalkhalid/matchup_padel/actions/workflows/scrape-frmt.yml/dispatches`
  - Headers : `Authorization: Bearer <GITHUB_PAT>`, `Accept: application/vnd.github+json`,
    `User-Agent: matchup-padel`, `X-GitHub-Api-Version: 2022-11-28`.
  - Body : `{ "ref": "<branche par défaut du repo>" }`.
  - Succès attendu : `204 No Content`.
- **Secret** : `GITHUB_PAT` (PAT fine-grained, scope *Actions: Read and write* sur `matchup_padel`),
  posé via `supabase secrets set GITHUB_PAT=…`.
- **Retour** : `{ ok: true }` (200) ou `{ error }` (403 / 500) avec message clair.

### 2. Bouton dans l'onglet FRMT de `app/(tabs)/admin.tsx`
- Bouton « 🔄 Lancer un scrape » dans le header de `FrmtTab`.
- État `scraping` : pendant l'appel, spinner + libellé « Scrape lancé… ».
- `supabase.functions.invoke('trigger-frmt-scrape')` → succès :
  `Alert("✅ Scrape lancé", "Résultats dans ~3-5 min. Reviens rafraîchir.")`.
- Afficher **« Dernier scrape »** = max `scraped_at` des entrées `frmt_rankings` (déjà chargées par
  `loadFrmt`, exposer la valeur).
- Bouton « Rafraîchir » pour relancer `loadFrmt` après quelques minutes.

### 3. Étapes manuelles (hors code, une fois)
- **Secrets GitHub Actions du repo** : `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  (prérequis : leur absence faisait échouer le workflow avec `Error: supabaseUrl is required`).
  → posés le 2026-06-09.
- Créer le PAT GitHub + `supabase secrets set GITHUB_PAT=…`.
- `supabase functions deploy trigger-frmt-scrape`.
- Vérifier que `scrape-frmt.yml` est sur la **branche par défaut** du repo.

## Compromis assumé

Déclenchement **asynchrone** : GitHub Actions tourne 3-5 min. Le bouton confirme « Scrape lancé »,
il n'affiche pas le nombre de joueurs importés en direct. L'admin voit le résultat via la date
« Dernier scrape » après rafraîchissement. Un résultat synchrone exigerait un worker always-on
payant (Railway/Render) — écarté.

## Hors périmètre (inchangé)

Scraper Playwright, auto-matching, cron hebdomadaire, bouton du site Next.js, schéma
`frmt_rankings`. On ajoute uniquement un déclencheur mobile.

## Risques / points d'attention

- **PAT GitHub** : à durée de vie limitée → prévoir une rotation. Stocké uniquement en secret Supabase.
- **Spam du bouton** : un admin peut lancer plusieurs runs. Acceptable (peu d'admins) ; possibilité
  future de désactiver le bouton X min après un déclenchement.
- **Feedback d'échec** : si le scrape échoue côté GitHub, le bouton ne le saura pas (async). L'admin
  doit regarder l'onglet Actions. Amélioration future possible : notifier en fin de workflow.
