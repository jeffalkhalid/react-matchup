-- Tournois montante / descente — schema.
-- AUCUNE cle etrangere vers `games` : c est deliberé. Les matchs de tournoi ne
-- doivent jamais croiser le declencheur ELO ni le blocage anti-chevauchement
-- ±2h, qui saboterait un format ou le meme binome joue cinq fois en une soiree.
BEGIN;

-- Les places d'un tournoi se comptent en JOUEURS, pas en binomes : un binome
-- se forme parfois tard (inscription solo puis appariement). On ne stocke que
-- le parametre de base (court_count) ; binomes = court_count x 2, places =
-- court_count x 4 se derivent a la lecture (app / requetes), jamais stockes.
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
  price_mad     int  NOT NULL DEFAULT 0,      -- AFFICHE, jamais encaisse
  points_scale  jsonb NOT NULL DEFAULT '{"1":100,"2":80,"3":65,"4":55,"5":45,"6":35,"7":25,"8":15}'::jsonb
                -- Aucune valeur negative : un tournoi ne punit pas, il classe.
                -- jsonb_path_exists est un simple appel de fonction (IMMUTABLE),
                -- pas une sous-requete : autorise dans une CHECK.
                CHECK (NOT jsonb_path_exists(points_scale, '$.* ? (@ < 0)')),
  -- Score credite a CHAQUE camp quand tournament_matches.forfeited_team est
  -- renseigne (c'est ce marqueur, pas ce nombre, qui distingue un forfait
  -- d'un vrai resultat nul -- interdit ailleurs). 0 pour les deux camps par
  -- defaut : un forfait ne credite aucun jeu. Parametrable si l'organisateur
  -- veut un score de courtoisie (ex. 4-0).
  forfeit_games int  NOT NULL DEFAULT 0 CHECK (forfeit_games >= 0),
  status        text NOT NULL DEFAULT 'BROUILLON'
                CHECK (status IN (
                  'BROUILLON','INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN',
                  'PRET','EN_COURS','TERMINE','CLASSEMENT_VALIDE'
                )),
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
  UNIQUE (tournament_id, id)  -- Enables composite FK from registrations/matches/results
);

-- Inscription INDIVIDUELLE : un joueur s'inscrit seul (ou en duo, mais chacun
-- a sa propre ligne) ; un binome se forme ensuite via tournament_teams (Task 3).
-- C'est cette table, pas tournament_teams, qui porte la capacite du tournoi :
-- les places se comptent en joueurs (tournaments.court_count x 4).
--
-- Regle #1 (portee ici) : un joueur n'a qu'UNE inscription par tournoi — la
-- PRIMARY KEY (tournament_id, player_id) le garantit. C'est distinct de la
-- regle #2 (portee par tournament_participants plus bas) : un joueur n'est
-- que dans UN binome par tournoi. Un joueur peut respecter la regle #1 sans
-- encore respecter/violer la regle #2 : il est inscrit, pas encore apparie.
--
-- PAS de team_id ici. L'equipe d'un joueur est un fait qui a deja un domicile
-- unique : tournament_participants, derivee et maintenue par le declencheur
-- sur tournament_teams. Une colonne "equipe" ici en serait une deuxieme copie,
-- sans rien pour la garder synchronisee -- une fonction pourrait pointer une
-- inscription vers un binome auquel le joueur n'appartient meme pas, et
-- aucune contrainte ne le verrait. Un lecteur qui veut l'equipe d'un inscrit
-- fait un JOIN vers tournament_participants (tournament_id, player_id) :
-- c'est le cout de la normalisation, moindre qu'un trigger dont le seul
-- metier serait de garder deux verites egales.
--
-- Jetons de check-in (a reprendre a l'identique cote client / Task 3) :
-- 'pending' (par defaut, pas encore enregistre le jour J),
-- 'checked_in' (present, confirme sur place),
-- 'no_show' (absent, ne s'est jamais presente).
CREATE TABLE IF NOT EXISTS public.tournament_registrations (
  tournament_id     uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  player_id         uuid NOT NULL REFERENCES public.players(id),
  side              text NOT NULL CHECK (side IN ('left','right','both')),
  -- true : n'importe qui peut me choisir comme partenaire directement.
  -- false : appariement seulement sur accord explicite (Task 3).
  open_to_join      boolean NOT NULL DEFAULT true,
  waitlist_position int CHECK (waitlist_position IS NULL OR waitlist_position > 0),
  check_in_status   text NOT NULL DEFAULT 'pending'
                    CHECK (check_in_status IN ('pending','checked_in','no_show')),
  registered_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

-- Normalize: one player, one team per tournament. This table is maintained by a
-- trigger on tournament_teams (fn_tournament_teams_sync_participants), not written
-- by application code. The PK (tournament_id, player_id) enforces the uniqueness
-- at the database level, rejecting any duplicate on INSERT or UPDATE.
-- Ces lignes ne survivent PAS a l'equipe : defaire un binome supprime la ligne
-- de tournament_teams, et le ON DELETE CASCADE ci-dessous emporte les deux
-- lignes de participants -- c'est ce qui permet a tournament_leave_team de
-- rendre les deux joueurs seuls, et a un joueur desinscrit de se reinscrire
-- (il repart alors en FIN de file, max(waitlist_position) + 1). La garantie
-- portee ici est « un joueur, UN SEUL binome A LA FOIS », pas « a jamais ».
--
-- Regle #2 (distincte de la regle #1 portee par tournament_registrations
-- ci-dessus) : un joueur n'appartient qu'a UN binome par tournoi. Cette table
-- ne connait rien de l'inscription (side, open_to_join, check-in...) — elle
-- ne fait qu'une chose : rendre "un joueur, un binome" inviolable.
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
  team_a        uuid,
  team_b        uuid,   -- NULL = bye
  -- Score final, une fois l'accord entre camps atteint (tournament_match_entries
  -- porte les saisies individuelles qui menent a cet accord). NULL tant que
  -- personne n'a saisi, ou que les deux camps ne concordent pas encore.
  games_a       int  CHECK (games_a >= 0),
  games_b       int  CHECK (games_b >= 0),
  -- L'equipe qui a declare forfait sur CE match ; NULL = resultat joue
  -- normalement. C'est le SEUL cas ou une egalite de score est licite -- la
  -- spec interdit le nul partout ailleurs (sans vainqueur, la logique de
  -- mouvement ne saurait quelle equipe descend). forfeited_team est donc a
  -- la fois ce qui AUTORISE le score egal, ce qui dit a la logique de
  -- mouvement quelle equipe descend (l'autre monte automatiquement), et ce
  -- qui permet a tout ecran d'afficher "forfait" plutot qu'un 0-0 muet.
  forfeited_team uuid,
  confirmed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- PAS de UNIQUE (tournament_id, round_no, court_no) ici : un palier peut
  -- porter DEUX lignes au meme tour, un bye ET un match. Le cas apparait des
  -- qu un binome declare forfait au milieu de l echelle : le survivant reste
  -- sur son palier apres son bye, et y recoit le perdant du dessus et le
  -- gagnant du dessous -- trois equipes, donc un bye plus un match. Les deux
  -- garanties utiles sont posees juste apres la table, en index PARTIELS :
  -- au plus un match reel et au plus un bye par (tournoi, tour, palier).
  -- Composite FKs ensure teams belong to this match's tournament, not another.
  -- NULL team (bye) passes the FK check because any NULL in a FK is unchecked.
  FOREIGN KEY (tournament_id, team_a) REFERENCES public.tournament_teams(tournament_id, id),
  FOREIGN KEY (tournament_id, team_b) REFERENCES public.tournament_teams(tournament_id, id),
  -- L'equipe forfait doit etre l'un des deux camps de CE match, et il doit y
  -- avoir un adversaire reel en face : on ne "forfait" pas un bye, il n'y a
  -- personne a qui attribuer la victoire.
  CHECK (forfeited_team IS NULL OR (team_b IS NOT NULL AND forfeited_team IN (team_a, team_b))),
  -- Jamais de match nul, SAUF un forfait -- l'unique exception prevue par la
  -- spec (tournaments.forfeit_games credite le meme score, 0-0 par defaut,
  -- aux deux camps). En dehors de ce cas, un score final egal est rejete par
  -- la contrainte elle-meme, avant toute logique applicative.
  CHECK (forfeited_team IS NOT NULL OR games_a IS NULL OR games_b IS NULL OR games_a <> games_b),
  UNIQUE (tournament_id, id)  -- Enables composite FK from tournament_match_entries
);

CREATE INDEX IF NOT EXISTS tournament_matches_tour ON public.tournament_matches (tournament_id, round_no);

-- Unicite par palier, en deux moities : un palier porte au plus UN match reel
-- et au plus UN bye au meme tour. Un seul index sur les trois colonnes
-- interdirait la coexistence des deux, qui est precisement ce que le format
-- exige apres un forfait en milieu d echelle.
CREATE UNIQUE INDEX IF NOT EXISTS tournament_matches_one_match_per_court
  ON public.tournament_matches (tournament_id, round_no, court_no)
  WHERE team_b IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tournament_matches_one_bye_per_court
  ON public.tournament_matches (tournament_id, round_no, court_no)
  WHERE team_b IS NULL;

-- Une ligne par SAISIE DE JOUEUR (pas par match) : chaque camp declare son
-- score independamment, et c'est la concordance des saisies qui vaut accord
-- (calculee par les fonctions de la Task 3, pas par ce schema). Une saisie
-- peut etre corrigee : UNIQUE (match_id, player_id) fait de chaque nouvelle
-- saisie une mise a jour de la meme ligne, jamais un empilement.
CREATE TABLE IF NOT EXISTS public.tournament_match_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  match_id      uuid NOT NULL,
  player_id     uuid NOT NULL REFERENCES public.players(id),
  games_a       int  NOT NULL CHECK (games_a >= 0),
  games_b       int  NOT NULL CHECK (games_b >= 0),
  entered_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, player_id),
  -- Le match doit appartenir au MEME tournoi que la saisie.
  FOREIGN KEY (tournament_id, match_id) REFERENCES public.tournament_matches(tournament_id, id) ON DELETE CASCADE,
  -- Une saisie ne peut venir que d'un joueur INSCRIT a ce tournoi : la cle
  -- composite pointe vers tournament_registrations (regle #1), pas vers
  -- players seul, qui ne saurait rien du tournoi.
  FOREIGN KEY (tournament_id, player_id) REFERENCES public.tournament_registrations(tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS tournament_match_entries_match ON public.tournament_match_entries (match_id);

-- Parcours d'un binome, tour par tour : c'est ce qui permet d'afficher
-- "T4 -> T3 (monte) -> T2 (monte)" sans recalculer l'historique a la volee.
CREATE TABLE IF NOT EXISTS public.tournament_movements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL,
  round_no      int  NOT NULL CHECK (round_no > 0),
  court_before  int  NOT NULL CHECK (court_before > 0),
  court_after   int  NOT NULL CHECK (court_after > 0),
  movement      text NOT NULL CHECK (movement IN ('UP','DOWN','STAY')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, team_id, round_no),
  -- Le binome doit appartenir au MEME tournoi que le mouvement.
  FOREIGN KEY (tournament_id, team_id) REFERENCES public.tournament_teams(tournament_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.tournament_results (
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  team_id       uuid NOT NULL,
  player_id     uuid NOT NULL REFERENCES public.players(id),
  final_rank    int  NOT NULL,
  played        int  NOT NULL,
  -- Victoires du binome sur le tournoi. Elle ne se DEDUIT d'aucune autre
  -- colonne -- ni de `played`, ni des jeux, ni du rang, ni des points : les
  -- recalculer supposerait de rejouer tout le classement d'un tournoi clos,
  -- alors que cette table existe precisement pour ne plus avoir a le faire.
  -- Les DEFAITES, elles, se deduisent : `played - wins`, donc pas de colonne.
  -- DEFAULT 0 : la table est un agregat de fin de soiree, `tournament_close`
  -- ecrit toujours la valeur.
  wins          int  NOT NULL DEFAULT 0,
  games_won     int  NOT NULL,
  games_lost    int  NOT NULL,
  points        int  NOT NULL,
  PRIMARY KEY (tournament_id, player_id),
  -- Composite FK ensures team_id belongs to this result's tournament.
  FOREIGN KEY (tournament_id, team_id) REFERENCES public.tournament_teams(tournament_id, id) ON DELETE CASCADE
);

ALTER TABLE public.tournaments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_teams          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_registrations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_matches        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_match_entries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_movements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_results        ENABLE ROW LEVEL SECURITY;

-- Lecture ouverte a tout utilisateur connecte : un tournoi est un evenement
-- public. Toute ECRITURE passe par les RPC de la Task 3, jamais en direct.
CREATE POLICY tournaments_read              ON public.tournaments              FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_teams_read         ON public.tournament_teams         FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_registrations_read ON public.tournament_registrations FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_participants_read  ON public.tournament_participants  FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_matches_read       ON public.tournament_matches       FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_match_entries_read ON public.tournament_match_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_movements_read     ON public.tournament_movements     FOR SELECT TO authenticated USING (true);
CREATE POLICY tournament_results_read       ON public.tournament_results       FOR SELECT TO authenticated USING (true);

-- Trigger: maintain tournament_participants as a derived table from tournament_teams.
-- The PK (tournament_id, player_id) enforces "one player per tournament", preventing
-- double-booking at the database level on INSERT. Updates that would violate this
-- (e.g., swapping or duplicating a player already in the tournament) fail at the
-- PK constraint. Deletes cascade via ON DELETE CASCADE on the FK.
CREATE OR REPLACE FUNCTION public.fn_tournament_teams_sync_participants()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- INSERT: create participant rows for both players.
    -- If either player is already in this tournament (from another team),
    -- the PK constraint on (tournament_id, player_id) will fail here.
    INSERT INTO public.tournament_participants (tournament_id, player_id, team_id)
    VALUES
      (NEW.tournament_id, NEW.player1_id, NEW.id),
      (NEW.tournament_id, NEW.player2_id, NEW.id);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- UPDATE: if the pair changed, atomically delete both old rows and insert both new ones.
    -- This granularity (the pair, not individual columns) prevents false collisions.
    -- Example: (A, B) → (B, A) (swap) is valid and must succeed.
    -- The old rows for the swap are deleted first, so the reinserted rows never collide
    -- with themselves. But if a new player is already in the tournament (different team_id),
    -- the PK constraint on (tournament_id, player_id) still catches it.
    IF (OLD.player1_id, OLD.player2_id) <> (NEW.player1_id, NEW.player2_id) THEN
      DELETE FROM public.tournament_participants
      WHERE tournament_id = OLD.tournament_id AND team_id = OLD.id;
      INSERT INTO public.tournament_participants (tournament_id, player_id, team_id)
      VALUES
        (NEW.tournament_id, NEW.player1_id, NEW.id),
        (NEW.tournament_id, NEW.player2_id, NEW.id);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- DELETE: remove both participant rows. The ON DELETE CASCADE on the FK
    -- in tournament_participants will handle this automatically, but we
    -- explicitly delete here for clarity.
    DELETE FROM public.tournament_participants
    WHERE tournament_id = OLD.tournament_id AND team_id = OLD.id;
    RETURN OLD;
  END IF;
END;
$$;

-- Restrict function access: only the trigger (via SECURITY DEFINER) can call it.
-- REVOKE ... FROM PUBLIC ne retire PAS les droits directs de anon et
-- authenticated : il faut les nommer tous les trois.
REVOKE ALL ON FUNCTION public.fn_tournament_teams_sync_participants() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER tournament_teams_sync_participants
AFTER INSERT OR UPDATE OR DELETE ON public.tournament_teams
FOR EACH ROW EXECUTE FUNCTION public.fn_tournament_teams_sync_participants();

COMMIT;

NOTIFY pgrst, 'reload schema';
