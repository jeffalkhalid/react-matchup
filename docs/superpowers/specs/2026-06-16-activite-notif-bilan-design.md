# Sous-projet D — Notification Bilan Mensuel

**Date :** 2026-06-16
**Statut :** Design validé, prêt pour le plan d'implémentation
**Index :** `2026-06-16-activite-refonte-index-design.md`
**Handoff :** `design_handoff_activity_tab/designs/04-Notif-Bilan.dc.html` · screenshot `screenshots/06-notif-lockscreen.png`

## Contexte

Push mensuelle qui ramène l'utilisateur dans le Bilan (sous-projet B). Le pipeline push existe (`lib/notify.ts` + edge function `send-push`, livraison Expo confirmée). **Mais aucun Database Webhook n'est configuré** (mémoire `project_supabase_webhooks`) → toute notif côté serveur (cron/trigger) exige de créer le webhook **à la main** dans le dashboard. Dépend de B (route `pagmatch://bilan/<mois>`).

## Objectif

Le 1er de chaque mois (fenêtre 9h–11h locale), envoyer aux users avec ≥1 match le mois précédent une push « Ton bilan de {mois} est prêt 🎾 » qui deep-linke vers le Bilan, slide 0, mois précédent.

## Specs
| Paramètre | Valeur |
|---|---|
| Trigger | 1er du mois, 9h–11h locale |
| Audience | users avec ≥1 match le mois précédent |
| Variante inactifs | « On t'attend en {mois} 🎾 » (plus douce) |
| Deep link | `pagmatch://bilan/<mois précédent>`, slide 0 |
| KPI cibles | 42 % open · 65 % complétion 7/7 · 18 % partage |

## Copywriting (figé)
- **Titre** : `Ton bilan de {mois} est prêt 🎾`
- **Sous-titre** : `{matchs} matchs, {elo} ELO et {badges ? "un nouveau badge" : "ta progression"} — toute ta saison en 7 slides.`
- Exemple : « 12 matchs, +85 ELO et un nouveau badge — toute ta saison en 7 slides. »

## Architecture
1. **Edge function** `supabase/functions/monthly-recap-push/` :
   - Calcule le mois précédent ; lit `monthly_recap` (vue du sous-projet B) pour la liste des users (`matches >= 1`) + matchs/ELO/badges.
   - Segmente actif/inactif → choisit le copy.
   - Appelle `send-push` existant par lots, avec `data: { type: 'bilan', month }`.
   - Émet `notif_bilan_received { month, user_segment }`.
2. **Planification** (`monthly_recap_notify.sql`) : `pg_cron` le 1er du mois → appelle l'edge function via `pg_net`/webhook. **Webhook à créer à la main** dans le dashboard (documenté pas-à-pas dans le plan). Fenêtre 9h–11h : soit cron unique 9h, soit étalement par fuseau (à trancher au plan — défaut : cron 9h UTC+1 Maroc).
3. **Réception client** : `app/_layout.tsx` route le `data.type === 'bilan'` → `router.push('/bilan/<month>')`. Émet `notif_bilan_tapped { month }`.

## Fichiers touchés
| Fichier | Action |
|---|---|
| `supabase/functions/monthly-recap-push/index.ts` | **Nouveau** |
| `supabase/migrations/monthly_recap_notify.sql` | **Nouveau** — `pg_cron` + note webhook |
| `app/_layout.tsx` | Router le deep link `bilan` (notif tap) |
| `lib/notify.ts` | Réutilisé tel quel (aucun changement attendu) |

## Dépendances / risques
- **Bloquant connu** (mémoire `project_deploiement_maroc`) : SMTP custom non réglé — sans rapport direct avec le push, mais à garder en tête pour le lancement global.
- Webhook Supabase à créer manuellement (sinon l'edge function n'est jamais déclenchée — c'est exactement le piège `notify-eject`).
- Dépend de la vue `monthly_recap` (sous-projet B) → livrer D après B.

## Critères de réussite
1. Le 1er du mois, les users éligibles reçoivent la push avec le bon copy (actif/inactif).
2. Tap → ouvre le Bilan slide 0 sur le mois précédent.
3. Le webhook est créé et le cron déclenche réellement l'edge function (vérifié en prod).
4. Tracking `notif_bilan_received` / `notif_bilan_tapped` alimenté.

## Hors-scope
- Étalement multi-fuseaux fin (un seul créneau au départ).
- A/B testing du copy.
- Relance J+3 si non ouvert.
