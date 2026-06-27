# Notification Bilan Mensuel — Implementation Plan (sous-projet D)

> REQUIRED SUB-SKILL: subagent-driven-development / executing-plans. Steps en checkbox.

**Goal:** Le 1er du mois, pousser aux joueurs ayant ≥1 match le mois précédent une notif « Ton bilan de {mois} est prêt 🎾 » qui deep-linke vers le Bilan (mois précédent) ; variante douce pour les joueurs « lapsed ».

**Architecture:** Edge function `monthly-recap-push` (Deno) déclenchée par `pg_cron` (à brancher à la main). Réutilise `send-push`. Le tap est routé côté client dans `hooks/usePushNotifications.ts` vers `/bilan/<mois>`.

**Spec :** `docs/superpowers/specs/2026-06-16-activite-notif-bilan-design.md`

## Conventions
- Edge function = Deno, NON couverte par `tsc` (tsconfig exclut `supabase/functions`). Vérif = relecture + cohérence avec `send-push`/`notify-promotion`.
- Client : `node node_modules/typescript/bin/tsc --noEmit` (exit 0).
- Pas de commit. Migration SQL + déploiement edge function + cron = **à faire à la main** par l'utilisateur.

## Structure
| Fichier | Action |
|---|---|
| `hooks/usePushNotifications.ts` | + case `bilan` → `/bilan/<month>` + `track('notif_bilan_tapped')` |
| `supabase/functions/monthly-recap-push/index.ts` | Nouveau — sélection + envoi |
| `supabase/migrations/monthly_recap_notify.sql` | Nouveau — `pg_cron` + doc webhook/secrets |

---

## Task 1: Router le tap de notif (client)

**Files:** Modify `hooks/usePushNotifications.ts`

- [ ] **Step 1:** Dans le `switch (data.type)`, ajouter avant la fin :
```ts
        case 'bilan':
          track('notif_bilan_tapped', { month: data.month });
          router.push((data.month ? `/bilan/${data.month}` : '/bilan/last') as any);
          break;
```
- [ ] **Step 2:** Ajouter l'import en tête du fichier s'il manque : `import { track } from '../lib/analytics';`
- [ ] **Step 3:** `node node_modules/typescript/bin/tsc --noEmit` → exit 0.

---

## Task 2: Edge function `monthly-recap-push`

**Files:** Create `supabase/functions/monthly-recap-push/index.ts`

- [ ] **Step 1: Écrire la fonction** (sélection mois précédent via `monthly_recap`, perso ELO/badges, segments actif/lapsed, envoi via `send-push`).

```ts
// Cron mensuel : notif « Bilan du mois précédent ».
// - Actifs (≥1 match le mois précédent) → push personnalisée + deep link bilan.
// - Lapsed (≥1 match il y a 2 mois mais 0 le mois dernier) → relance douce.
// Déclenchée par pg_cron (voir monthly_recap_notify.sql). Réutilise send-push.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function monthKey(d: Date): string { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }

async function sb(path: string, params: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${params}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) return [];
  return await res.json();
}

async function sendPush(playerIds: string[], title: string, body: string, data: Record<string, string>) {
  if (!playerIds.length) return;
  await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
    body: JSON.stringify({ playerIds, title, body, data }),
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' } });
  }
  try {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const prev2 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    const prevKey = monthKey(prev);
    const prevLabel = MONTHS_FR[prev.getUTCMonth()];
    const nextLabel = MONTHS_FR[now.getUTCMonth()]; // mois en cours = « on t'attend en … »
    const startISO = prev.toISOString();
    const endISO = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    // 1) Actifs = monthly_recap du mois précédent (matches>=1).
    const active = await sb('monthly_recap', `select=user_id,matches,wins,win_rate&month=eq.${prevKey}-01&matches=gte.1`);
    const activeIds: string[] = active.map((r: any) => r.user_id);

    // 2) ELO delta par joueur (somme elo_change sur le mois) — 1 requête.
    const eloRows = activeIds.length
      ? await sb('elo_history', `select=player_id,elo_change&created_at=gte.${startISO}&created_at=lt.${endISO}&player_id=in.(${activeIds.join(',')})`)
      : [];
    const eloByUser = new Map<string, number>();
    for (const r of eloRows) eloByUser.set(r.player_id, (eloByUser.get(r.player_id) ?? 0) + (r.elo_change ?? 0));

    // 3) Badge débloqué ce mois-ci ? — 1 requête.
    const achRows = activeIds.length
      ? await sb('player_achievements', `select=player_id&unlocked_at=gte.${startISO}&unlocked_at=lt.${endISO}&player_id=in.(${activeIds.join(',')})`)
      : [];
    const hasBadge = new Set<string>(achRows.map((r: any) => r.player_id));

    // 4) Envoi personnalisé aux actifs (1 push/joueur — volume mensuel faible).
    let sent = 0;
    for (const r of active) {
      const uid = r.user_id as string;
      const elo = Math.round(eloByUser.get(uid) ?? 0);
      const eloStr = `${elo >= 0 ? '+' : ''}${elo} ELO`;
      const tail = hasBadge.has(uid) ? 'un nouveau badge' : 'ta progression';
      await sendPush([uid],
        `Ton bilan de ${prevLabel} est prêt 🎾`,
        `${r.matches} matchs, ${eloStr} et ${tail} — toute ta saison en 7 slides.`,
        { type: 'bilan', month: prevKey });
      sent++;
    }

    // 5) Lapsed = a joué il y a 2 mois mais pas le mois dernier → relance douce.
    const prev2Key = monthKey(prev2);
    const m2 = await sb('monthly_recap', `select=user_id&month=eq.${prev2Key}-01&matches=gte.1`);
    const activeSet = new Set(activeIds);
    const lapsedIds = [...new Set(m2.map((r: any) => r.user_id as string))].filter(id => !activeSet.has(id));
    await sendPush(lapsedIds,
      `On t'attend en ${nextLabel} 🎾`,
      'Reprends la raquette — une partie suffit à relancer ta saison.',
      { type: 'bilan', month: prevKey });

    return new Response(JSON.stringify({ ok: true, active: sent, lapsed: lapsedIds.length, month: prevKey }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
```

- [ ] **Step 2:** Relecture (pas de tsc — Deno). Vérifier cohérence avec `send-push` (mêmes champs `playerIds/title/body/data`).

---

## Task 3: Migration cron `monthly_recap_notify.sql`

**Files:** Create `supabase/migrations/monthly_recap_notify.sql`

- [ ] **Step 1: Écrire le SQL + la doc**

```sql
-- Planification mensuelle de la notif Bilan (sous-projet D).
-- Pré-requis : pg_cron + pg_net activés (pg_net l'est déjà — cf. invitations).
-- ⚠️ Aucun Database Webhook n'est requis ici : le cron appelle directement
-- l'edge function `monthly-recap-push` via pg_net (http_post).
--
-- À FAIRE À LA MAIN dans le dashboard / SQL editor :
--   1) Déployer l'edge function :  supabase functions deploy monthly-recap-push
--   2) Remplacer <PROJECT_REF> et <SERVICE_ROLE_KEY> ci-dessous (ou les stocker
--      dans Vault et lire via vault.decrypted_secrets — recommandé).
--   3) Exécuter ce fichier.
--
-- Le 1er de chaque mois à 09:00 UTC+1 (= 08:00 UTC, Maroc). Ajuster si besoin.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent : retire l'ancien job s'il existe.
select cron.unschedule('monthly-recap-push')
where exists (select 1 from cron.job where jobname = 'monthly-recap-push');

select cron.schedule(
  'monthly-recap-push',
  '0 8 1 * *',  -- min hour day month dow → 08:00 UTC le 1er
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/monthly-recap-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2:** Relecture. NE PAS exécuter (l'utilisateur le fera après avoir renseigné PROJECT_REF + clé).

---

## Self-Review
- Tap notif `bilan` → `/bilan/<mois>` + tracking. ✅ (T1)
- Edge function : actifs (perso matchs/ELO/badge) + lapsed (relance douce), deep link `type:'bilan', month`. ✅ (T2)
- Copy figé conforme (titre + sous-titre variables actif/inactif). ✅
- Cron mensuel via pg_net (pas de webhook requis), doc secrets. ✅ (T3)
- Réutilise `send-push` (tokens + Expo gérés là-bas). ✅

## Notes / reste à faire manuellement
- **Déployer** `supabase functions deploy monthly-recap-push`.
- **Renseigner** PROJECT_REF + SERVICE_ROLE_KEY (idéalement via Vault) et **exécuter** `monthly_recap_notify.sql`.
- Dépend de la vue `monthly_recap` (sous-projet B) → l'appliquer d'abord.
- Fenêtre 9h–11h locale du handoff : ici 1 créneau fixe 08:00 UTC. Étalement multi-fuseaux = hors-scope.
- Personnalisation par joueur = 1 push/joueur (volume mensuel faible) ; batcher si la base grossit.
