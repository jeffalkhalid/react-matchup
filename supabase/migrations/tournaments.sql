-- Tournois montante / descente — schema.
-- AUCUNE cle etrangere vers `games` : c est deliberé. Les matchs de tournoi ne
-- doivent jamais croiser le declencheur ELO ni le blocage anti-chevauchement
-- ±2h, qui saboterait un format ou le meme binome joue cinq fois en une soiree.
BEGIN;

CREATE TABLE IF NOT EXISTS public.tournaments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  club_id       uuid REFERENCES public.clubs(id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz,
  level_min     numeric(3,1),
  level_max     numeric(3,1),
  court_count   int  NOT NULL CHECK (court_count > 0),
  round_count   int  NOT NULL CHECK (round_count > 0),
  max_teams     int  NOT NULL CHECK (max_teams > 0 AND max_teams % 2 = 0),
  price_mad     int  NOT NULL DEFAULT 0,      -- AFFICHE, jamais encaisse
  points_scale  jsonb NOT NULL DEFAULT '{"1":20,"2":15,"3":10,"5":5,"7":-2}'::jsonb,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','open','live','finished','cancelled')),
  current_round int  NOT NULL DEFAULT 0,
  created_by    uuid NOT NULL REFERENCES public.players(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tournament_teams (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player1_id    uuid NOT NULL REFERENCES public.players(id),
  player2_id    uuid NOT NULL REFERENCES public.players(id),
  start_court   int,
  withdrawn     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (player1_id <> player2_id),
  UNIQUE (tournament_id, id)  -- Enables composite FK from matches/results
);

-- Normalize: one player, one team per tournament. The PK enforces this at the
-- database level. Without this table, a player could appear in player1_id of
-- one team and player2_id of another (the old indexes only prevented within-column
-- duplication, not across). Withdrawal prevents re-registration since the PK
-- (tournament_id, player_id) already exists.
CREATE TABLE IF NOT EXISTS public.tournament_participants (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES public.players(id),
  team_id       uuid NOT NULL,
  PRIMARY KEY (tournament_id, player_id),
  FOREIGN KEY (tournament_id, team_id) REFERENCES public.tournament_teams(tournament_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.tournament_matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  round_no      int  NOT NULL CHECK (round_no > 0),
  court_no      int  NOT NULL CHECK (court_no > 0),
  team_a        uuid REFERENCES public.tournament_teams(id),
  team_b        uuid REFERENCES public.tournament_teams(id),   -- NULL = bye
  games_a       int  NOT NULL DEFAULT 0 CHECK (games_a >= 0),
  games_b       int  NOT NULL DEFAULT 0 CHECK (games_b >= 0),
  entered_by    uuid REFERENCES public.players(id),
  confirmed_by  uuid REFERENCES public.players(id),
  confirmed_at  timestamptz,
  UNIQUE (tournament_id, round_no, court_no),
  -- Composite FKs ensure teams belong to this match's tournament, not another.
  -- NULL team (bye) passes the FK check.
  FOREIGN KEY (tournament_id, team_a) REFERENCES public.tournament_teams(tournament_id, id),
  FOREIGN KEY (tournament_id, team_b) REFERENCES public.tournament_teams(tournament_id, id)
);

CREATE INDEX IF NOT EXISTS tournament_matches_tour ON public.tournament_matches (tournament_id, round_no);

CREATE TABLE IF NOT EXISTS public.tournament_results (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL,
  player_id     uuid NOT NULL REFERENCES public.players(id),
  final_rank    int  NOT NULL,
  played        int  NOT NULL,
  games_won     int  NOT NULL,
  games_lost    int  NOT NULL,
  points        int  NOT NULL,
  PRIMARY KEY (tournament_id, player_id),
  -- Composite FK ensures team_id belongs to this result's tournament.
  FOREIGN KEY (tournament_id, team_id) REFERENCES public.tournament_teams(tournament_id, id) ON DELETE CASCADE
);

ALTER TABLE public.tournaments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_teams   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_results ENABLE ROW LEVEL SECURITY;

-- Lecture ouverte a tout utilisateur connecte : un tournoi est un evenement
-- public. Toute ECRITURE passe par les RPC de la Task 3, jamais en direct.
CREATE POLICY tournaments_read        ON public.tournaments        FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_teams_read   ON public.tournament_teams   FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_participants_read ON public.tournament_participants FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_matches_read ON public.tournament_matches FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_results_read ON public.tournament_results FOR SELECT TO authenticated USING (true);

COMMIT;

NOTIFY pgrst, 'reload schema';
