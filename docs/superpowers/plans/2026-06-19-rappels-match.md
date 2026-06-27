# Rappels de match (push T‑1h / T‑30min) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Envoyer un push de rappel confort aux joueurs d'une partie complète à T‑1h et T‑30min du début, 100 % backend (une migration SQL).

**Architecture:** Une colonne marqueur `confirmed_full_at` (posée par trigger quand une partie atteint 4/4), deux flags anti‑doublon, une fonction de sélection pure `match_reminder_due(kind)`, et une fonction cron `send_match_reminders()` qui POST vers l'edge function `send-push` via `pg_net` toutes les 5 min. Calqué sur `invite_expiry.sql` + `monthly_recap_notify.sql`.

**Tech Stack:** PostgreSQL (Supabase), pg_cron, pg_net, supabase_vault, edge function `send-push` (existante, Deno).

## Global Constraints

- **Spec de référence :** `docs/superpowers/specs/2026-06-19-rappels-match-design.md`.
- **Aucun changement client** (React Native). Feature 100 % backend.
- **Occupation dérivée des participants**, jamais du compteur `spots_available` (dénormalisé, sujet au drift).
- **Occupant pour la complétude ET pour les destinataires = `accepted` + créateur** uniquement (PAS les invités non‑expirés). Padel = 4 places ; complet = `1 (créateur) + 3 participants 'accepted' non‑créateur`.
- **Project ref Supabase :** `icshhobxeppttgayxmba`. URL edge function : `https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push`.
- **Clé service role :** lue depuis Vault `select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'` (déjà stockée — cf. `monthly_recap_notify.sql`). NE JAMAIS la mettre en dur.
- **Payload `send-push` :** `{ playerIds: string[], title, body, data: { type:'lobby', gameId } }`.
- **Textes exacts (verbatim) :**
  - T‑1h → titre `⏳ Ton match approche`, corps `Rendez-vous dans 1 h. Prépare ton sac !`
  - T‑30min → titre `⏰ Plus que 30 min`, corps `Ton match commence bientôt. En route !`
- **Migrations non timestampées, appliquées à la main** (drift connu). Nouveau fichier : `supabase/migrations/match_reminders.sql`. Pas de commit automatique : **l'utilisateur commite lui‑même** (convention projet « travailler sur main »).
- **Conditions de marge :** rappel 1h seulement si `confirmed_full_at <= match_date - 60min` ; rappel 30min seulement si `confirmed_full_at <= match_date - 30min`.

---

### Task 1 : Schéma + trigger `confirmed_full_at`

**Files:**
- Create: `react-matchup/supabase/migrations/match_reminders.sql` (section 1 ; le fichier sera complété en Task 2)

**Interfaces:**
- Consumes: tables existantes `open_games(id, creator_id, match_date, status)`, `game_participants(game_id, player_id, status)`.
- Produces:
  - Colonnes `open_games.confirmed_full_at timestamptz`, `open_games.reminded_1h_at timestamptz`, `open_games.reminded_30m_at timestamptz`.
  - Trigger `trg_set_confirmed_full` + fonction `public.set_confirmed_full()` : pose `confirmed_full_at = now()` **une seule fois** quand une partie atteint 4 occupants (`accepted` + créateur). Ne le retire jamais.

- [ ] **Step 1 : Écrire l'en‑tête + le schéma + le trigger dans le fichier de migration**

Créer `react-matchup/supabase/migrations/match_reminders.sql` avec :

```sql
-- ============================================================
-- Rappels de match (push confort T-1h / T-30min).
-- Voir docs/superpowers/specs/2026-06-19-rappels-match-design.md
-- Pré-requis : pg_cron + pg_net + supabase_vault (déjà actifs),
-- secret Vault 'service_role_key' déjà stocké (cf. monthly_recap_notify.sql),
-- edge function send-push déployée.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault;

-- 1) Marqueur « a été complète » + flags anti-doublon (idempotent).
alter table public.open_games
  add column if not exists confirmed_full_at timestamptz,
  add column if not exists reminded_1h_at    timestamptz,
  add column if not exists reminded_30m_at   timestamptz;

-- 2) Trigger : pose confirmed_full_at UNE SEULE FOIS au passage à 4/4.
--    Occupants = créateur (toujours 1) + participants 'accepted' non-créateur.
--    Ne retire JAMAIS le marqueur (une partie qui perd un joueur reste éligible).
create or replace function public.set_confirmed_full()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id  uuid;
  v_creator  uuid;
  v_already  timestamptz;
  v_occupied int;
begin
  v_game_id := coalesce(NEW.game_id, OLD.game_id);

  select creator_id, confirmed_full_at
    into v_creator, v_already
    from open_games where id = v_game_id;

  -- Déjà marqué : rien à faire (posé une seule fois).
  if v_already is not null then
    return coalesce(NEW, OLD);
  end if;

  select 1 + count(*) into v_occupied
    from game_participants
   where game_id = v_game_id
     and status = 'accepted'
     and player_id <> v_creator;

  if v_occupied >= 4 then
    update open_games set confirmed_full_at = now()
      where id = v_game_id and confirmed_full_at is null;
  end if;

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_set_confirmed_full on public.game_participants;
create trigger trg_set_confirmed_full
  after insert or update on public.game_participants
  for each row execute function public.set_confirmed_full();
```

- [ ] **Step 2 : Appliquer la section 1 en prod (SQL editor Supabase)**

Coller le contenu ci‑dessus dans le SQL editor et exécuter. Attendu : `Success. No rows returned`. Les 3 colonnes et le trigger existent.

- [ ] **Step 3 : Test (transaction rollback) — le trigger pose `confirmed_full_at` au passage à 4/4**

Trouver une partie réellement complète (4 occupants acceptés, créateur inclus) :

```sql
select g.id
from open_games g
where g.status not in ('closed','cancelled')
  and (1 + (select count(*) from game_participants p
            where p.game_id = g.id and p.status='accepted' and p.player_id<>g.creator_id)) >= 4
limit 1;
```

Remplacer `:GAME` par cet id, puis exécuter ce test (il ROLLBACK, aucune écriture persistée) :

```sql
do $$
declare
  v_game uuid := ':GAME';
  v_pid  uuid;
  v_set  timestamptz;
begin
  -- On part d'un marqueur vide pour observer le trigger.
  update open_games set confirmed_full_at = null where id = v_game;
  -- Re-toucher un participant accepté déclenche le trigger AFTER UPDATE.
  select player_id into v_pid from game_participants
    where game_id = v_game and status='accepted' limit 1;
  update game_participants set status='accepted'
    where game_id = v_game and player_id = v_pid;

  select confirmed_full_at into v_set from open_games where id = v_game;
  if v_set is null then
    raise exception 'ÉCHEC : confirmed_full_at non posé sur une partie complète';
  end if;
  raise notice 'OK : confirmed_full_at posé (%).', v_set;
  rollback;
end $$;
```

Attendu : `NOTICE: OK : confirmed_full_at posé (...)`. (Le `rollback` dans le `do` annule tout.)

- [ ] **Step 4 : Test (transaction rollback) — le marqueur n'est pas écrasé une 2ᵉ fois**

```sql
do $$
declare
  v_game uuid := ':GAME';
  v_pid  uuid;
  v_first timestamptz;
  v_second timestamptz;
begin
  update open_games set confirmed_full_at = timestamptz '2000-01-01 00:00:00+00' where id = v_game;
  select player_id into v_pid from game_participants
    where game_id = v_game and status='accepted' limit 1;
  update game_participants set status='accepted'
    where game_id = v_game and player_id = v_pid;
  select confirmed_full_at into v_second from open_games where id = v_game;
  if v_second <> timestamptz '2000-01-01 00:00:00+00' then
    raise exception 'ÉCHEC : confirmed_full_at écrasé (idempotence cassée)';
  end if;
  raise notice 'OK : marqueur préservé.';
  rollback;
end $$;
```

Attendu : `NOTICE: OK : marqueur préservé.`

---

### Task 2 : Sélection des rappels dus + fonction cron + planification

**Files:**
- Modify: `react-matchup/supabase/migrations/match_reminders.sql` (ajouter sections 3‑5)

**Interfaces:**
- Consumes: colonnes/trigger de Task 1 ; secret Vault `service_role_key` ; edge function `send-push`.
- Produces:
  - `public.match_reminder_due(p_kind text) returns table(game_id uuid, recipient_ids uuid[])` — sélection PURE (sans effet de bord), `p_kind ∈ {'1h','30m'}`.
  - `public.send_match_reminders() returns integer` — pour chaque partie due : POST `send-push` (si destinataires) puis pose le flag ; renvoie le nombre de parties traitées.
  - Job cron `send-match-reminders` (`*/5 * * * *`).

- [ ] **Step 1 : Écrire la fonction de sélection pure `match_reminder_due`**

Ajouter à `match_reminders.sql` :

```sql
-- 3) Sélection PURE des parties dont le rappel est dû (sans effet de bord).
--    p_kind : '1h' ou '30m'. Destinataires = créateur + 'accepted' non-créateur.
create or replace function public.match_reminder_due(p_kind text)
returns table(game_id uuid, recipient_ids uuid[])
language sql
stable
security definer
set search_path = public
as $$
  select g.id,
         array_agg(distinct r.pid) as recipient_ids
  from open_games g
  cross join lateral (
    select g.creator_id as pid
    union
    select p.player_id
    from game_participants p
    where p.game_id = g.id
      and p.status = 'accepted'
      and p.player_id <> g.creator_id
  ) r
  where g.confirmed_full_at is not null
    and g.status not in ('closed','cancelled')
    and g.match_date > now()
    and (
      (p_kind = '1h'
        and g.reminded_1h_at is null
        and g.confirmed_full_at <= g.match_date - interval '60 min'
        and g.match_date <= now() + interval '60 min')
      or
      (p_kind = '30m'
        and g.reminded_30m_at is null
        and g.confirmed_full_at <= g.match_date - interval '30 min'
        and g.match_date <= now() + interval '30 min')
    )
  group by g.id;
$$;
```

- [ ] **Step 2 : Appliquer la section 3 puis tester la logique de marge (rollback)**

Exécuter la section 3 dans le SQL editor. Puis, avec `:GAME` = la partie complète trouvée en Task 1, vérifier les 3 scénarios de marge (le `do` ROLLBACK à la fin) :

```sql
do $$
declare
  v_game uuid := ':GAME';
  v_in boolean;
begin
  -- Scénario A : pleine à >1h → due en '1h' ET '30m'
  update open_games set confirmed_full_at = now() - interval '3 h',
                        match_date = now() + interval '55 min',
                        reminded_1h_at = null, reminded_30m_at = null,
                        status = 'open'
    where id = v_game;
  select exists(select 1 from match_reminder_due('1h') where game_id = v_game) into v_in;
  if not v_in then raise exception 'A: 1h attendu dû'; end if;

  -- Scénario B : pleine entre 1h et 30min → 1h SAUTÉ, 30m dû
  update open_games set confirmed_full_at = now() - interval '40 min',
                        match_date = now() + interval '25 min'
    where id = v_game;
  select exists(select 1 from match_reminder_due('1h') where game_id = v_game) into v_in;
  if v_in then raise exception 'B: 1h ne doit PAS partir (marge <60min au remplissage)'; end if;
  select exists(select 1 from match_reminder_due('30m') where game_id = v_game) into v_in;
  if not v_in then raise exception 'B: 30m attendu dû'; end if;

  -- Scénario C : pleine à <30min → aucun rappel
  update open_games set confirmed_full_at = now() - interval '10 min',
                        match_date = now() + interval '8 min'
    where id = v_game;
  select exists(select 1 from match_reminder_due('30m') where game_id = v_game) into v_in;
  if v_in then raise exception 'C: 30m ne doit PAS partir (marge <30min)'; end if;

  -- Scénario D : flag déjà posé → plus dû
  update open_games set confirmed_full_at = now() - interval '3 h',
                        match_date = now() + interval '55 min',
                        reminded_1h_at = now()
    where id = v_game;
  select exists(select 1 from match_reminder_due('1h') where game_id = v_game) into v_in;
  if v_in then raise exception 'D: flag posé, ne doit plus être dû'; end if;

  raise notice 'OK : marges 1h/30m + flag corrects (A,B,C,D).';
  rollback;
end $$;
```

Attendu : `NOTICE: OK : marges 1h/30m + flag corrects (A,B,C,D).`

- [ ] **Step 3 : Écrire la fonction d'envoi `send_match_reminders`**

Ajouter à `match_reminders.sql` :

```sql
-- 4) Fonction cron : POST send-push pour chaque partie due, puis pose le flag.
--    Le flag est posé MÊME si aucun destinataire (on n'appelle alors pas send-push).
create or replace function public.send_match_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r   record;
  v_url text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key text;
  n   integer := 0;
begin
  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  -- ── Rappel T-1h ──
  for r in select * from public.match_reminder_due('1h') loop
    if array_length(r.recipient_ids, 1) is not null then
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type','application/json',
                     'Authorization','Bearer '||v_key),
        body    := jsonb_build_object(
                     'playerIds', to_jsonb(r.recipient_ids),
                     'title', '⏳ Ton match approche',
                     'body',  'Rendez-vous dans 1 h. Prépare ton sac !',
                     'data',  jsonb_build_object('type','lobby','gameId', r.game_id))
      );
    end if;
    update open_games set reminded_1h_at = now() where id = r.game_id;
    n := n + 1;
  end loop;

  -- ── Rappel T-30min ──
  for r in select * from public.match_reminder_due('30m') loop
    if array_length(r.recipient_ids, 1) is not null then
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type','application/json',
                     'Authorization','Bearer '||v_key),
        body    := jsonb_build_object(
                     'playerIds', to_jsonb(r.recipient_ids),
                     'title', '⏰ Plus que 30 min',
                     'body',  'Ton match commence bientôt. En route !',
                     'data',  jsonb_build_object('type','lobby','gameId', r.game_id))
      );
    end if;
    update open_games set reminded_30m_at = now() where id = r.game_id;
    n := n + 1;
  end loop;

  return n;
end;
$$;

revoke all on function public.send_match_reminders() from public;
grant execute on function public.send_match_reminders() to service_role;
```

- [ ] **Step 4 : Appliquer la section 4**

Exécuter la section 4 dans le SQL editor. Attendu : `Success. No rows returned`.

- [ ] **Step 5 : Écrire et appliquer la planification cron**

Ajouter à `match_reminders.sql` puis exécuter :

```sql
-- 5) Planification toutes les 5 min (idempotent).
select cron.unschedule('send-match-reminders')
where exists (select 1 from cron.job where jobname = 'send-match-reminders');

select cron.schedule(
  'send-match-reminders',
  '*/5 * * * *',
  $$ select public.send_match_reminders(); $$
);
```

Vérifier la planification :

```sql
select jobname, schedule, active from cron.job where jobname = 'send-match-reminders';
```

Attendu : une ligne, `schedule = */5 * * * *`, `active = t`.

- [ ] **Step 6 : Vérification de livraison réelle (2 appareils)**

Sur un match de test réellement complet et planifié dans ~1h (avec au moins 2 comptes sur 2 appareils distincts — piège « token par appareil », cf. notes projet) :
- Soit attendre le tick `*/5`, soit forcer `select public.send_match_reminders();` quand `match_date` est dans la fenêtre.
- Attendu : les joueurs **acceptés + créateur** reçoivent le push T‑1h, puis T‑30min ; le tap ouvre le lobby. Un joueur désisté entre‑temps ne reçoit rien. Les flags `reminded_1h_at` / `reminded_30m_at` sont posés (pas de doublon au tick suivant).

- [ ] **Step 7 : Commit (manuel — utilisateur)**

Le fichier `supabase/migrations/match_reminders.sql` est prêt. Selon la convention projet, **l'utilisateur commite lui‑même** sur `main` quand il le décide. Ne pas commiter automatiquement.

---

## Self-Review (auteur du plan)

**Couverture spec :**
- Deux rappels T‑1h/T‑30min, confort, sans action → Task 2 (payloads + cron). ✅
- Destinataires acceptés + créateur, recalculés à l'envoi → `match_reminder_due` (lateral union créateur + accepted). ✅
- Parties éligibles = ont atteint 4/4 (`confirmed_full_at`) → Task 1 trigger. ✅
- Conditions de marge 1h/30m (cas remplissage tardif) → `match_reminder_due` + test scénarios A/B/C. ✅
- pg_net direct vers send-push, pas de webhook → Task 2 Step 3. ✅
- Flags anti‑doublon + idempotence → Task 1 colonnes, test scénario D, `unschedule` avant `schedule`. ✅
- Aucun destinataire → flag posé sans appel send-push → Task 2 Step 3 (`if array_length ... is not null`). ✅
- Match passé exclu (`match_date > now()`), close/cancelled exclus → `match_reminder_due`. ✅
- Quiet hours hors périmètre, aucun changement client → respecté. ✅

**Placeholders :** aucun `TODO`/`TBD` ; tout le SQL est complet. Seul `:GAME` est un paramètre de test à substituer par un id réel (instruction fournie pour le trouver). ✅

**Cohérence des types :** `match_reminder_due(text) → (game_id uuid, recipient_ids uuid[])` consommé tel quel dans `send_match_reminders` (`r.game_id`, `r.recipient_ids`) ; `to_jsonb(uuid[])` → tableau de strings attendu par `send-push.playerIds: string[]`. ✅
