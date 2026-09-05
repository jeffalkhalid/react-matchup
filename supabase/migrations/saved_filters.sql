-- ============================================================
-- Filtres enregistres, et l'alerte qui va avec.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- Ce fichier suppose public.players, public.open_games, public.clubs, et le
-- motif de push serveur deja en place (extension pg_net + secret
-- 'service_role_key' dans le vault + fonction send-push), cf.
-- cancel_game_notify.sql dont ce declencheur reprend la forme.
--
-- CE QUE CA RESOUT : sur un marche clairseme, le probleme n'est pas de trier
-- trop de parties, c'est de ne pas savoir QUAND la bonne apparait. Enregistrer
-- un filtre pour le rejouer a la main ne vaut pas grand-chose ; enregistrer un
-- filtre qui vous PREVIENT, si.
--
-- LA DISTINCTION QUI GOUVERNE CE FICHIER : tous les criteres ne peuvent pas
-- devenir une alerte.
--
--   « Ce week-end », « il reste une place », « urgent » sont des criteres de
--   CONSULTATION : ils se lisent par rapport a l'instant ou l'on regarde. Une
--   alerte permanente « ce week-end » n'a aucun sens — quel week-end ?
--
--   Le club, la ville, le type, le genre, la tranche horaire et le niveau sont
--   des criteres STABLES : ils decrivent la partie qu'on cherche, pas le moment
--   ou on la cherche. Ce sont les seuls que ce declencheur regarde.
--
-- Le filtre complet est stocke tel quel (l'ecran le rejoue en entier), mais
-- l'alerte n'en lit qu'un sous-ensemble. Le client applique la meme regle et le
-- dit a l'utilisateur, pour qu'il ne croie pas etre prevenu sur un critere que
-- personne ne surveille.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.saved_filters (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  name       text NOT NULL,
  -- Le filtre entier, dans la forme que lit lib/exploreFilters.
  criteria   jsonb NOT NULL DEFAULT '{}'::jsonb,
  alert      boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Dernier envoi, pour ne pas transformer une soiree de creations en rafale
  -- de notifications.
  last_alert_at timestamptz
);

CREATE INDEX IF NOT EXISTS saved_filters_player_idx
  ON public.saved_filters (player_id, created_at DESC);
-- L'index de l'alerte : le declencheur ne balaie que les lignes concernees.
CREATE INDEX IF NOT EXISTS saved_filters_alert_idx
  ON public.saved_filters (alert) WHERE alert;

ALTER TABLE public.saved_filters ENABLE ROW LEVEL SECURITY;

-- Chacun ne voit et ne modifie que SES filtres. players.id est uuid,
-- players.user_id est text (= auth.uid()::text) — d'ou le cast explicite,
-- sinon « operator does not exist: text = uuid ».
DROP POLICY IF EXISTS saved_filters_own ON public.saved_filters;
CREATE POLICY saved_filters_own ON public.saved_filters
  FOR ALL TO authenticated
  USING (player_id = (SELECT id FROM public.players WHERE user_id = auth.uid()::text))
  WITH CHECK (player_id = (SELECT id FROM public.players WHERE user_id = auth.uid()::text));

-- ── L'alerte ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_notify_saved_filters()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url    text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key    text;
  v_ville  text;
  v_heure  int;
  v_type   text;
  v_notify uuid[];
BEGIN
  -- Tout le corps est protege : une alerte qui echoue ne doit JAMAIS empecher
  -- la creation d'une partie.
  BEGIN
    -- Une partie ciblee s'adresse a des joueurs nommes : elle n'a pas a
    -- reveiller tout le monde. Un defi a son propre circuit d'annonce.
    IF NEW.is_targeted IS TRUE OR NEW.is_challenge IS TRUE THEN RETURN NEW; END IF;
    IF NEW.match_date IS NULL OR NEW.match_date < now() THEN RETURN NEW; END IF;

    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;

    -- La ville passe par le NOM du club : les parties portent le nom, pas
    -- l'identifiant. C'est fiable parce que les lieux sont choisis dans une
    -- liste, pas tapes (54 des 61 lieux distincts correspondent a un club).
    SELECT c.city INTO v_ville FROM public.clubs c WHERE c.name = btrim(NEW.location) LIMIT 1;
    v_heure := EXTRACT(hour FROM NEW.match_date)::int;
    v_type  := CASE WHEN NEW.game_format = 'friendly' THEN 'friendly' ELSE 'competitive' END;

    SELECT array_agg(DISTINCT sf.player_id) INTO v_notify
      FROM public.saved_filters sf
      JOIN public.players p ON p.id = sf.player_id
     WHERE sf.alert
       AND sf.player_id <> NEW.creator_id
       -- Anti-rafale : au plus une alerte par heure et par filtre.
       AND (sf.last_alert_at IS NULL OR sf.last_alert_at < now() - interval '1 hour')
       -- Club : liste vide = tous.
       AND (COALESCE(jsonb_array_length(sf.criteria->'clubs'), 0) = 0
            OR sf.criteria->'clubs' ? btrim(NEW.location))
       -- Ville : idem, et un lieu hors referentiel ne passe aucun filtre.
       AND (COALESCE(jsonb_array_length(sf.criteria->'cities'), 0) = 0
            OR (v_ville IS NOT NULL AND sf.criteria->'cities' ? v_ville))
       AND (COALESCE(sf.criteria->>'type', 'all') IN ('all', v_type))
       AND (COALESCE(sf.criteria->>'gender', 'all') IN ('all', COALESCE(NEW.gender_pref, '')))
       -- Tranche horaire : memes bornes que le client (fermees a gauche,
       -- ouvertes a droite), sinon minuit appartiendrait a deux tranches.
       AND (COALESCE(sf.criteria->>'slot', 'any') = 'any'
            OR (sf.criteria->>'slot' = 'morning'   AND v_heure >= 6  AND v_heure < 12)
            OR (sf.criteria->>'slot' = 'afternoon' AND v_heure >= 12 AND v_heure < 18)
            OR (sf.criteria->>'slot' = 'evening'   AND v_heure >= 18)
            OR (sf.criteria->>'slot' = 'night'     AND v_heure < 6))
       -- Niveau : « le mien » se lit sur l'ELO du joueur, au moment ou la
       -- partie parait — pas sur celui qu'il avait en enregistrant le filtre.
       AND (COALESCE(sf.criteria->>'level', 'all') <> 'mine'
            OR ((NEW.min_elo IS NULL OR p.elo_score >= NEW.min_elo)
                AND (NEW.max_elo IS NULL OR p.elo_score <= NEW.max_elo)));

    IF v_notify IS NULL OR array_length(v_notify, 1) IS NULL THEN RETURN NEW; END IF;

    UPDATE public.saved_filters
       SET last_alert_at = now()
     WHERE alert AND player_id = ANY(v_notify);

    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body    := jsonb_build_object(
                   'playerIds', to_jsonb(v_notify),
                   'title', 'Une partie pour toi',
                   'body',  coalesce(nullif(btrim(NEW.location), ''), 'Une partie')
                            || ' — ' || to_char(NEW.match_date, 'DD/MM a HH24hMI')
                            || '. Elle correspond a un de tes filtres.',
                   'data',  jsonb_build_object('type', 'lobby'))
    );
  EXCEPTION WHEN OTHERS THEN
    -- Une alerte ratee coute une notification. Une exception ici couterait la
    -- creation de la partie elle-meme.
    NULL;
  END;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_notify_saved_filters ON public.open_games;
CREATE TRIGGER trg_notify_saved_filters
  AFTER INSERT ON public.open_games
  FOR EACH ROW EXECUTE FUNCTION public.fn_notify_saved_filters();

COMMIT;

NOTIFY pgrst, 'reload schema';
