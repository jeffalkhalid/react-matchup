-- ============================================================
-- Un siege appartient a un BINOME, jamais a un joueur seul.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- CE FICHIER EST LE TROISIEME, et il ne se suffit pas :
--     1) tournament_partner_consent.sql
--     2) tournament_partner_invite.sql
--     3) CE FICHIER
-- Les corps repris ici viennent des versions PRODUITES PAR (1) et (2), pas de
-- tournaments_rpcs.sql. L'appliquer seul, ou dans le desordre, ecraserait
-- l'invitation par l'inscription d'office.
--
-- LE PROBLEME, constate en test : huit joueurs inscrits SEULS remplissaient la
-- soiree — « COMPLET », plus une place — et AUCUN match n'etait jouable. Une
-- montante se joue par paires : un siege tenu par un joueur seul est un siege
-- mort, et huit sieges morts sont un tournoi mort.
--
-- LA REGLE : la liste principale n'accueille que des BINOMES. Un joueur seul
-- entre en file d'attente et n'en sort qu'apparie. Ce n'est pas une punition,
-- c'est la verite de sa situation : sans partenaire, il n'a pas de place a
-- tenir.
--
-- CONSEQUENCE, ARBITREE : un binome qui se defait retourne EN FILE, les deux
-- membres. Ils repartent en tete — ils etaient installes, donc plus anciens
-- que tout ce qui attend — et leur siege repart aussitot au binome suivant.
-- Cela REVIENT SUR une phrase de tournament_partner_consent.sql (« il garde sa
-- place ») : la regle du siege-aux-binomes la rend intenable, et c'est la
-- regle qui gagne. Ce qu'il garde, c'est son ANCIENNETE.
--
-- CE QUI NE CHANGE PAS : `fn_tournament_align_waitlist` donne toujours aux
-- deux membres la meme position, un binome avance en bloc, et un binome trop
-- grand pour les sieges restants est DEPASSE sans etre coupe ni recule.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_tournament_promote_waitlist(p_tournament uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seats    int;
  v_cand     uuid;
  v_group    uuid[];
  v_size     int;
  v_promoted int := 0;
BEGIN
  -- On parcourt la file DANS L'ORDRE. Le curseur travaille sur l'instantane
  -- pris a l'ouverture de la boucle : un joueur promu en cours de route (comme
  -- coequipier, ou par son propre tour) y figure encore, d'ou le CONTINUE qui
  -- verifie qu'il attend toujours.
  FOR v_cand IN
    SELECT r.player_id
      FROM public.tournament_registrations r
     WHERE r.tournament_id = p_tournament
       AND r.waitlist_position IS NOT NULL
     ORDER BY r.waitlist_position, r.registered_at, r.player_id
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM public.tournament_registrations r
       WHERE r.tournament_id = p_tournament
         AND r.player_id = v_cand
         AND r.waitlist_position IS NOT NULL);

    -- Les SIEGES VIDES, pas `fn_tournament_free_places` : ici c'est justement
    -- la file qui les consomme, et cette derniere vaudrait zero tant qu'elle
    -- n'est pas vide -- personne n'avancerait jamais.
    v_seats := public.fn_tournament_open_seats(p_tournament);
    EXIT WHEN v_seats IS NULL OR v_seats <= 0;

    -- Le groupe indissociable : le candidat, plus son coequipier s'il en a un
    -- ET qu'il attend lui aussi. Le coequipier se lit dans
    -- tournament_participants -- l'inscription, elle, ne porte aucun team_id.
    SELECT coalesce(array_agg(r.player_id), ARRAY[]::uuid[]) INTO v_group
      FROM public.tournament_registrations r
     WHERE r.tournament_id = p_tournament
       AND r.waitlist_position IS NOT NULL
       AND (r.player_id = v_cand
            OR r.player_id IN (
                 SELECT mate.player_id
                   FROM public.tournament_participants me
                   JOIN public.tournament_participants mate
                     ON mate.tournament_id = me.tournament_id
                    AND mate.team_id       = me.team_id
                  WHERE me.tournament_id = p_tournament
                    AND me.player_id     = v_cand));

    v_size := coalesce(array_length(v_group, 1), 0);
    CONTINUE WHEN v_size = 0;         -- ceinture : ne peut pas arriver
    -- SEUL UN BINOME PREND UN SIEGE. Un joueur seul reste en file, quelle que
    -- soit la place disponible : huit joueurs seuls remplissaient la soiree
    -- et AUCUN match n'etait jouable — une montante se joue par paires, un
    -- siege tenu par un solo est un siege mort.
    CONTINUE WHEN v_size < 2;
    CONTINUE WHEN v_size > v_seats;   -- trop grand pour ce qui reste : on passe

    UPDATE public.tournament_registrations
       SET waitlist_position = NULL
     WHERE tournament_id = p_tournament
       AND player_id = ANY(v_group);

    v_promoted := v_promoted + v_size;
  END LOOP;

  PERFORM public.fn_tournament_sync_capacity_status(p_tournament);
  RETURN v_promoted;
END;
$$;

CREATE OR REPLACE FUNCTION public.tournament_register(
  p_tournament   uuid,
  p_side         text,
  p_open_to_join boolean DEFAULT true,
  p_partner      uuid    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      uuid := public.current_player_id();
  v_status  text;
  v_free    int;
  v_need    int := 1;
  v_last    int := 0;
  v_seated  boolean;
  v_team    uuid;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- aucune ecriture avant la fin de cette section. Un refus ne
  -- leve pas, donc rien ne serait annule : un INSERT place ici laisserait sa
  -- ligne derriere lui ET annoncerait un refus.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  IF p_side IS NULL OR p_side NOT IN ('left','right','both') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_side');
  END IF;

  -- FOR UPDATE : serialise TOUT ce qui touche a ce tournoi. Deux inscriptions
  -- simultanees ne peuvent pas lire la meme derniere place libre, et deux
  -- appariements simultanes ne peuvent pas se croiser.
  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  -- COMPLET accepte encore : au-dela des places on entre en file d'attente,
  -- ce n'est pas un refus. A partir de CHECK_IN, les inscriptions sont closes.
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_registrations r
              WHERE r.tournament_id = p_tournament AND r.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
  END IF;

  IF p_partner IS NOT NULL THEN
    IF p_partner = v_me THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_partner');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.players WHERE id = p_partner) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'partner_not_found');
    END IF;
    -- Deja inscrit : il a peut-etre deja un binome, ou attend une reponse.
    -- Dans tous les cas on ne l'inscrit pas une seconde fois -- c'est
    -- `tournament_join` qui sert a rejoindre un deja-inscrit.
    IF EXISTS (SELECT 1 FROM public.tournament_registrations r
                WHERE r.tournament_id = p_tournament AND r.player_id = p_partner) THEN
      -- Plus d'inscription du partenaire ici : une collision restante ne peut
    -- venir que d'une invitation deja en attente vers la meme personne
    -- (index unique partiel de tournament_join_requests).
    RETURN jsonb_build_object('ok', false, 'reason', 'invite_already_sent');
    END IF;
    -- Une seule place demandee desormais : le partenaire n'est plus inscrit
    -- ici, il est INVITE. Sa place n'est PAS retenue pendant qu'il repond --
    -- choix assume : reserver un siege pour une invitation sans reponse
    -- exigerait une expiration, faute de quoi des places se perdraient.
    v_need := 1;
  END IF;

  -- `free_places` (et non `open_seats`) : il vaut deja zero quand une file
  -- existe, donc ce seul test porte les DEUX regles -- ne pas doubler la file,
  -- et ne s'asseoir que si le groupe ENTIER tient.
  v_free := public.fn_tournament_free_places(p_tournament);
  -- TOUTE inscription passe ici SEULE (le partenaire est invite, pas inscrit),
  -- et un joueur seul ne tient jamais un siege : il entre en file et n'en sort
  -- qu'en binome, par fn_tournament_promote_waitlist.
  v_seated := false;
  IF NOT v_seated THEN
    SELECT coalesce(max(r.waitlist_position), 0) INTO v_last
      FROM public.tournament_registrations r
     WHERE r.tournament_id = p_tournament;
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES -- toutes dans LE MEME sous-bloc. Une violation annule le
  -- sous-bloc ENTIER (mon inscription, celle du partenaire, le binome) et rend
  -- un refus : jamais une inscription a moitie ecrite.
  ---------------------------------------------------------------------------
  BEGIN
    -- Mon mode de consentement est celui que J'AI demande, avec ou sans
    -- partenaire : ce n'est pas a l'inscription d'en decider pour moi.
    INSERT INTO public.tournament_registrations
           (tournament_id, player_id, side, open_to_join, waitlist_position)
    VALUES (p_tournament, v_me, p_side,
            coalesce(p_open_to_join, true),
            CASE WHEN v_seated THEN NULL ELSE v_last + 1 END);

    -- L'INVITATION REMPLACE L'INSCRIPTION D'OFFICE. Inscrire quelqu'un sans
    -- son accord, meme en le prevenant, l'engage a une soiree qu'il n'a pas
    -- choisie et l'oblige a se desinscrire pour en sortir. Il recoit
    -- desormais une demande, et decide. Le binome se forme a l'acceptation
    -- (tournament_respond_join), qui l'inscrit a ce moment-la.
    IF p_partner IS NOT NULL THEN
      INSERT INTO public.tournament_join_requests (tournament_id, from_player, to_player)
      VALUES (p_tournament, v_me, p_partner);
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- Course perdue : quelqu'un s'est inscrit ou apparie entre nos controles
    -- et nos ecritures. Tout le sous-bloc est annule -- et on regarde QUI a
    -- collisionne, parce que dire « tu es deja inscrit » a quelqu'un qui ne
    -- l'est pas l'enverrait chercher une inscription inexistante.
    IF EXISTS (SELECT 1 FROM public.tournament_registrations r
                WHERE r.tournament_id = p_tournament AND r.player_id = v_me)
       OR EXISTS (SELECT 1 FROM public.tournament_participants tp
                   WHERE tp.tournament_id = p_tournament AND tp.player_id = v_me) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'already_registered');
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'partner_already_registered');
  END;

  -- APRES l'ecriture, jamais avant. Une inscription peut LIBERER un siege pour
  -- quelqu'un d'autre : un binome qui ne tient pas dans le dernier siege part
  -- en file, et ce siege revient alors au premier solo qui attend. Sans cet
  -- appel, il restait vide jusqu'au coup d'envoi.
  -- (La promotion synchronise le statut elle-meme : pas de second appel.)
  PERFORM public.fn_tournament_promote_waitlist(p_tournament);

  RETURN jsonb_build_object(
    'ok', true,
    'team_id', v_team,
    'waitlisted', NOT v_seated,
    'waitlist_position', CASE WHEN v_seated THEN NULL ELSE v_last + 1 END);
END;
$$;

CREATE OR REPLACE FUNCTION public.tournament_leave_team(p_tournament uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_status text;
  v_team   uuid;
  v_mate   uuid;
BEGIN
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = p_tournament FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  -- « Un binome se defait a tout moment AVANT LE LANCEMENT ». Apres, un binome
  -- ne change plus de joueur, sauf intervention de l'organisateur.
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  -- Des que les matchs sont tires, la composition ne bouge plus. Le controle
  -- n'est pas theorique : les cles composites de `tournament_matches` vers
  -- `tournament_teams` ne sont PAS ON DELETE CASCADE, donc le DELETE plus bas
  -- leverait un `foreign_key_violation` NON CAPTURE -- une erreur SQL brute
  -- rendue au client, a la place du `{ok:false, reason}` que tout ce fichier
  -- promet. Le statut PRET est accepte par cette fonction, et rien n'interdit
  -- a la tache « deroulement » d'y generer le premier tour : le garde-fou
  -- appartient donc a ICI, pas a la tache qui creera la condition.
  IF EXISTS (SELECT 1 FROM public.tournament_matches m
              WHERE m.tournament_id = p_tournament) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'matches_already_generated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tournament_registrations r
                  WHERE r.tournament_id = p_tournament AND r.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_registered');
  END IF;

  SELECT tp.team_id INTO v_team
    FROM public.tournament_participants tp
   WHERE tp.tournament_id = p_tournament AND tp.player_id = v_me;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT tp.player_id INTO v_mate
    FROM public.tournament_participants tp
   WHERE tp.tournament_id = p_tournament AND tp.team_id = v_team
     AND tp.player_id <> v_me;

  ---------------------------------------------------------------------------
  -- ECRITURES.
  ---------------------------------------------------------------------------
  -- Le DELETE est la SEULE ecriture : le declencheur retire les deux lignes de
  -- `tournament_participants`, et l'absence de ligne suffit a dire « ces deux
  -- joueurs cherchent un partenaire ». Ni les places ni les positions de file
  -- ne bougent (les deux gardent leur rang commun), et surtout pas
  -- `open_to_join`, qui n'appartient qu'a son proprietaire.
  DELETE FROM public.tournament_teams WHERE id = v_team;

  -- LE BINOME ROMPU RETOURNE EN FILE. Aucun des deux ne peut tenir un siege
  -- seul — c'est la regle. Ils repartent EN TETE : ils etaient deja installes,
  -- donc plus anciens que tout ce qui attend. Position = le minimum courant
  -- (jamais 0 ni negatif, la colonne l'interdit), et `registered_at` departage
  -- en leur faveur. Leur siege repart aussitot au binome suivant.
  UPDATE public.tournament_registrations
     SET waitlist_position = coalesce(
           (SELECT min(w.waitlist_position) FROM public.tournament_registrations w
             WHERE w.tournament_id = p_tournament AND w.waitlist_position IS NOT NULL), 1)
   WHERE tournament_id = p_tournament
     AND player_id IN (v_me, v_mate)
     AND waitlist_position IS NULL;

  -- CELUI QUI SUBIT SE REFERME. Le commentaire ci-dessus dit vrai pour celui
  -- qui AGIT : son mode lui appartient, on n'y touche pas. Mais son binome,
  -- lui, n'a rien choisi -- il se retrouve seul sans l'avoir demande, et
  -- ouvert, n'importe qui pourrait se coller a lui d'un geste. On le referme :
  -- il rouvrira lui-meme s'il le veut (tournament_set_open_to_join).
  IF v_mate IS NOT NULL THEN
    UPDATE public.tournament_registrations
       SET open_to_join = false
     WHERE tournament_id = p_tournament AND player_id = v_mate;
  END IF;

  -- Ici l'appel n'est PAS decoratif : un binome en attente qui se defait
  -- devient deux candidats de taille 1, et un siege qui ne pouvait pas
  -- accueillir le binome peut accueillir l'un d'eux.
  PERFORM public.fn_tournament_promote_waitlist(p_tournament);

  RETURN jsonb_build_object('ok', true, 'team_id', v_team, 'partner_id', v_mate);
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_tournament_withdraw_player(
  p_tournament uuid, p_player uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_wl   boolean;
  v_team     uuid;
  v_mate     uuid;
  v_promoted int := 0;
BEGIN
  SELECT r.waitlist_position IS NOT NULL INTO v_was_wl
    FROM public.tournament_registrations r
   WHERE r.tournament_id = p_tournament AND r.player_id = p_player;

  SELECT tp.team_id INTO v_team
    FROM public.tournament_participants tp
   WHERE tp.tournament_id = p_tournament AND tp.player_id = p_player;
  IF FOUND THEN
    SELECT tp.player_id INTO v_mate
      FROM public.tournament_participants tp
     WHERE tp.tournament_id = p_tournament AND tp.team_id = v_team
       AND tp.player_id <> p_player;
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES.
  ---------------------------------------------------------------------------
  -- Le binome se defait, et c'est tout : le partenaire garde sa place, son
  -- rang de file s'il en avait un, et son mode de consentement.
  IF v_team IS NOT NULL THEN
    DELETE FROM public.tournament_teams WHERE id = v_team;

  -- LE BINOME ROMPU RETOURNE EN FILE. Aucun des deux ne peut tenir un siege
  -- seul — c'est la regle. Ils repartent EN TETE : ils etaient deja installes,
  -- donc plus anciens que tout ce qui attend. Position = le minimum courant
  -- (jamais 0 ni negatif, la colonne l'interdit), et `registered_at` departage
  -- en leur faveur. Leur siege repart aussitot au binome suivant.
    IF v_mate IS NOT NULL THEN
      UPDATE public.tournament_registrations
         SET waitlist_position = coalesce(
               (SELECT min(w.waitlist_position) FROM public.tournament_registrations w
                 WHERE w.tournament_id = p_tournament AND w.waitlist_position IS NOT NULL), 1)
       WHERE tournament_id = p_tournament AND player_id = v_mate
         AND waitlist_position IS NULL;
    END IF;

    -- CELUI QUI RESTE SE REFERME : il n'a pas choisi de se retrouver seul.
    IF v_mate IS NOT NULL THEN
      UPDATE public.tournament_registrations
         SET open_to_join = false
       WHERE tournament_id = p_tournament AND player_id = v_mate;
    END IF;
  END IF;

  DELETE FROM public.tournament_registrations
   WHERE tournament_id = p_tournament AND player_id = p_player;

  -- Une seule regle, sans exception a retenir : apres toute mutation
  -- d'inscription, la file tourne. Partir depuis la file ne libere aucun
  -- siege, la promotion ne fera alors rien -- et elle synchronise le statut
  -- dans tous les cas.
  v_promoted := public.fn_tournament_promote_waitlist(p_tournament);

  RETURN jsonb_build_object('ok', true,
                            'was_waitlisted', coalesce(v_was_wl, false),
                            'partner_id', v_mate, 'promoted', v_promoted);
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
