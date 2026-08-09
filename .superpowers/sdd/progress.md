# Refonte Défi — Phase 1 : progress ledger

Branche : feature/refonte-defi
Plan : docs/superpowers/plans/2026-06-28-refonte-defi-phase1-fondation.md

NOTE ENV : pas d'outil Supabase connecté → les sous-agents écrivent les
fichiers .sql + lancent `npx tsc --noEmit` ; l'APPLICATION SQL et les
requêtes de contrôle sont des étapes MANUELLES (utilisateur, SQL editor).

## Tâches
- [x] Task 1 : colonne stake_multiplier (open_games + matches)
- [x] Task 2 : mise dans trigger ELO + miroir lib/elo.ts
- [x] Task 3 : match hérite du stake (score-entry)
- [x] Task 4 : table defi_applications + RLS
- [x] Task 5 : RPC defi_apply
- [x] Task 6 : RPC defi_accept (course atomique)

## Journal
(rien encore)
Task 1: complete (commit 1cde2b2..e1994fc, review clean — spec exact, 1 minor non-issue; ⚠️ colonnes is_challenge/min_elo/max_elo confirmées existantes par le controller)
Task 2: complete (commit e1994fc..8522108, review clean — SQL/TS parité exacte, placement cap après stake OK, tsc OK; minor .gitignore = non-issue, fichiers suivis)
Task 3: complete (commit 8522108..27073e4, review clean — 3 edits OK + 2 mappings de portage nécessaires fetchGames/loadContestGame, tsc OK)
Task 4: complete (commit 27073e4..fda1e73, review clean — table+RLS conformes, idempotent; ⚠️ current_player_id/creator_id confirmés existants; note: git add -f requis car .gitignore l.44 = supabase)
Task 5: complete (commit fda1e73..6f7d15b, review clean — RPC conforme, FOR UPDATE OK, avg de paire OK). MINORS (final review): (1) garde NULL-avg si partenaire inexistant — déjà défendu par FK partner_id; (2) lecture open_games redondante (micro-optim).
Task 6: complete (commit 6f7d15b..4ba4b4e, review clean — concurrence CORRECTE, 4 invariants OK). MINORS (final review): (1) fusionner double read open_games (FOR UPDATE + select min/max); (2) garde 2 sides B pris = théorique, impossible par design défi.
Revue finale (opus) : 1 CRITIQUE trouvé — defi_stake_elo.sql partait de elo_per_player_k.sql (sans placement) → aurait régressé la phase de placement en prod + divergence SQL/TS. FIX commit 3b7f45f : repart du corps elo_placement_phase.sql, *stake dans les 2 branches, cap 90 après stake. Re-revue (sonnet) : PARITÉ CONFIRMÉE vs canonical + lib/elo.ts. Autres réponses revue finale : ordre application sûr, RPC cohérentes, contraintes OK, périmètre Phase 1 complet.
PHASE 1 : TERMINÉE (commits 1cde2b2..3b7f45f).

2026-06-28 : Phase 1 SQL APPLIQUÉE en prod (5 migrations OK) après fix contrainte stake (domaine seul, commit 1eb0a01). Fondation backend défi 2v2 live.

--- PHASE 2 ---
P2 Task 1: complete (commit 1eb0a01..4c169f6, review clean). Vérif controller: requête participant (lobby 1767) sans filtre statut → partenaire invité VOIT le draft → publish OK. GAP Phase 3: createdRes (1710) filtre [open,closed] → créateur ne voit pas son propre draft → à traiter dans le hub « Mes défis ».
P2 Wizard (Tasks 2-5 groupées): complete (commits 4c169f6..a552285, fix f27bc15, review clean — spec 9/9, AUCUNE régression parcours normal, 2 Important corrigés: cible A1 exacte + titre « Mon binôme »). tsc OK.
P2 REVUE FINALE (composition draft): READY. 6/6 OK (stake domaine, partenaire Team A→trigger, pas de collision side, spots=2 correct, challenges retiré, aucune régression). 1 minor: .neq draft redondant (laissé). PHASE 2 TERMINÉE (commits 4c169f6..f27bc15). RESTE: appliquer defi_draft_publish.sql + rebuild app.

--- PHASE 3a ---
P3a Task 1: complete (commit 3ddb0b9..7eb117d, review clean — lib/defis.ts verbatim, embeds PostgREST OK). ⚠️ résolu: params RPC matchent Phase1. MINORS: over-fetch ids dans fetchCandidatures (fetchMyDefis full→.id), sentinelle maxElo 999999.
P3a Task 2: complete (commit 7eb117d..39e001b, review clean — 8/8, hub 4 sections, handleAcceptBinome OK, shell préservé). À absorber en Task 3: await fetchData, sous-titre « joueurs compatibles » vestige, orphelins useEffect/router, composants 1v1 morts. Device: vérifier 4 onglets dans la barre.
P3a Task 3: complete (commit 39e001b..a302b59, review Approved zero finding). PHASE 3a TERMINEE (3ddb0b9..a302b59). Aucune migration (client+RPC deja en prod). Reste: rebuild app + Phase 3b.

--- PHASE 3b ---
P3b Task 1: complete (commit 0b6b837..c511885, vérif controller — lib/compat.ts 8 exports fidèles, seuils scoreElo OK, tsc OK). Extraction verbatim code prod éprouvé.
P3b Task 2: complete (commit c511885..02c9573, review clean — sélecteur partenaire + applyToDefi ordre OK + suggestions compat, hub sans régression). MINORS: suggestions useEffect sans abort flag, couleur spinner primary/brand.
P3b Task 3: complete (commit 02c9573..53115ce, review clean — classement compat non-mutant, useMemo, pas de boucle, pas de régression). MINOR: IIFE async sans annulation (course au refresh, low sev, cohérent codebase).
P3b Task 4: complete (commit 53115ce..dfdc424, review Approved zero finding — Promise.all aligné position 3 vérifié ligne par ligne, régression CLEAR, exclusion draft intacte).
PHASE 3b TERMINEE (commits 0b6b837..dfdc424). Aucune migration. Reste: rebuild app + Phase 4 (notifs) + Phase 5 (nettoyage challenges) + feature future binomes ouverts.

--- PHASE 4 ---
P4 Task 1: complete (commit 243779d..2d0fe79, vérif controller — lib/defiNotify.ts 2 helpers, type challenge, accepteur exclu, tsc OK).
P4 Task 2: complete (commit 2d0fe79..93af60f, vérif controller directe — 4 insertions + copie 2v2 exactes, fire-and-forget, tsc OK). Revue agent a renvoyé un placeholder → vérif diff manuelle.
PHASE 4 TERMINEE (243779d..93af60f). Aucune migration. Notifs différées: créateur à la publication + binômes rejetés (webhook/retour RPC plus tard).
P4 Task 2: revue formelle finalement arrivée — 10/10 checks PASS (confirme vérif manuelle). PHASE 4 VALIDÉE.

--- PHASE 5 ---
P5 Task 2: complete (commit 69ccb25..dff0cc9, vérif controller directe — que suppressions blocs challenges accept/decline + comment games.ts, game_participants/fetchData/reloadNotifs intacts, tsc+grep clean).
P5 Task 1: complete (commit cf040f5..69ccb25, review Approved — tuple aligné position 0, challengeGameIds→Set vide SAFE, nowIso gardé, autres items intacts). Cannot-verify: RLS defi_applications=OK Phase1, cycle de vie pending=ghost faible noté.
P5 Task 3: complete (lib/challenges.ts supprimé, 0 importeur externe, tsc exit 0). PHASE 5 TERMINEE. Table challenges DORMANTE (pas de DROP).

--- PHASE 6 ---
P6 Task 1: complete (commit 6a33f86..ab45036, vérif controller — cancel_defi garde draft/open + SECURITY DEFINER, expire 48h/game-not-open, cron */15, GRANTs, dans le commit).
P6 Task 2: complete (commit ab45036..e1813cd — agent tué avant commit; controller a vérifié les edits, committé UNIQUEMENT lib/defis.ts + matchmaking.tsx, tsc exit 0). 6 fichiers WIP utilisateur (DM/profil) laissés intacts non commités.
PHASE 6 TERMINEE. Refonte défi complete Phases 1-6.

=== BINOMES OUVERTS ===
Plan 1 backend: complete (commits 37c301f..d9de891, review Approved — transcription 5/5, triggers refus+autoclose scrutinés OK). ⚠️ résolus controller: publish trigger no-op sur decline; aucun DELETE trigger game_participants. MINORS: pas de garde is_challenge Task4 (sûr), Task3 sans BEGIN/COMMIT.
RESTE: appliquer 5 migrations (ordre 1-5) + Plan 2 client.

=== PLAN 2 CLIENT ===
P2 Tasks 1-2: complete (commits 236b927..c937f17, vérif controller — lib/showcase.ts 6 fns+2 types, filtre is_targeted OK, tsc OK).
P2 Task 3: complete (commit c937f17..64e1ecd, review clean — spec 4/4, RÉGRESSION CLEAR, Team B verrouillée, cap masqué, insert correct). targeted câblé en Task 4.
P2 Task 4: complete (commit 64e1ecd..ba62f72, review Approved — spec 4/4, régression PASS, Promise.all aligné, round-trip ciblé cohérent).
P2 Task 5: complete (commit ba62f72..377ef29, review Approved — spec 7/7, self-only double-gardé, autre-joueur OK, RPC+refetch OK). À nettoyer en Task 6: code mort handleConfirm/handleDecline/handleClose. Device: maxHeight 90% Android, bottom insets.
P2 Task 6: complete (commit 377ef29..5264575, vérif controller — notifyShowcaseNominated ajouté+câblé, 3 helpers morts retirés, 0 résiduel, tsc OK).
PLAN 2 CLIENT TERMINÉ (236b927..5264575, 6 tâches). FEATURE binômes ouverts + défi ciblé COMPLÈTE (backend prod + client branche). Reste: rebuild + device.
