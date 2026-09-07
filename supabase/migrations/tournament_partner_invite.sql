-- ============================================================
-- Inviter un binome : il ACCEPTE, il n'est plus inscrit d'office.
--
-- ORDRE D'APPLICATION - il n'y a pas de runner, un humain applique a la main.
-- Ce fichier remplace public.tournament_register et
-- public.tournament_respond_join (tournaments_rpcs.sql), et desserre une cle
-- etrangere de public.tournament_join_requests. A appliquer APRES
-- tournament_partner_consent.sql.
--
-- LE PROBLEME : s'inscrire avec un partenaire INSCRIVAIT ce partenaire, sans
-- rien lui demander. Il etait prevenu, sa place etait sure, et son mode etait
-- ferme -- le sujet avait ete pense. Mais il se retrouvait engage a une
-- soiree qu'il n'avait pas choisie, et devait se DESINSCRIRE pour en sortir.
--
-- Desormais une DEMANDE part, et il decide. Le binome se forme a
-- l'acceptation, qui l'inscrit a ce moment-la.
--
-- CE QUE CA COUTE, ET C'EST ASSUME : sa place n'est plus retenue pendant
-- qu'il repond. Entre l'invitation et sa reponse, un tiers peut prendre le
-- dernier siege ; l'acceptation repond alors `tournament_full`. Reserver un
-- siege pour une invitation sans reponse exigerait une expiration, faute de
-- quoi des places se perdraient — un mecanisme entier pour un cas rare.
--
-- LA CLE ETRANGERE COMPOSITE SUR `to_player` DOIT TOMBER : elle exigeait que
-- le destinataire soit DEJA inscrit, ce qui rendait cette invitation
-- impossible a exprimer. Celle sur `from_player` reste : le demandeur, lui,
-- est toujours inscrit, et sa desinscription doit bien emporter ses demandes.
--
-- Consequence de ce desserrage : une demande vers quelqu'un qui n'est pas
-- inscrit n'est plus nettoyee par cascade. `tournament_respond_join`
-- revalide donc tout au moment de la reponse, et refuse proprement.
-- ============================================================
BEGIN;

ALTER TABLE public.tournament_join_requests
  DROP CONSTRAINT IF EXISTS tournament_join_requests_tournament_id_to_player_fkey;

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
  v_seated := (coalesce(v_free, 0) >= v_need);
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

CREATE OR REPLACE FUNCTION public.tournament_respond_join(p_request uuid, p_accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     uuid := public.current_player_id();
  v_req    public.tournament_join_requests%ROWTYPE;
  v_status text;
  v_mine   public.tournament_registrations%ROWTYPE;
  v_from   public.tournament_registrations%ROWTYPE;
  v_team   uuid;
  v_closed int;
BEGIN
  ---------------------------------------------------------------------------
  -- CONTROLES -- avant toute ecriture.
  ---------------------------------------------------------------------------
  IF NOT public.fn_tournaments_enabled() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'feature_disabled');
  END IF;
  IF v_me IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Une demande qui ne m'est pas adressee, ou deja repondue, est traitee comme
  -- inexistante : meme refus, aucune information rendue sur son existence.
  --
  -- PREMIERE lecture SANS VERROU, uniquement pour connaitre le tournoi.
  -- L'ORDRE DES VERROUS EST TOUJOURS LE MEME DANS CE FICHIER : le tournoi
  -- d'abord, les lignes ensuite. Verrouiller la demande ici, puis attendre le
  -- tournoi, croiserait `tournament_join` -- qui tient le tournoi et va
  -- chercher les demandes -- et les deux se bloqueraient mutuellement.
  SELECT * INTO v_req FROM public.tournament_join_requests jr
   WHERE jr.id = p_request AND jr.to_player = v_me AND jr.status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
  END IF;

  SELECT t.status INTO v_status
    FROM public.tournaments t WHERE t.id = v_req.tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_found');
  END IF;
  IF v_status NOT IN ('INSCRIPTIONS_OUVERTES','COMPLET','CHECK_IN','PRET') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'tournament_not_open');
  END IF;

  -- Le tournoi est a nous : on peut relire la demande SOUS VERROU. Si elle a
  -- ete repondue entre les deux lectures (l'autre moitie d'une demande
  -- croisee, un refus automatique), elle n'est plus 'pending' et le refus
  -- tombe ici, avant toute ecriture.
  SELECT * INTO v_req FROM public.tournament_join_requests jr
   WHERE jr.id = p_request AND jr.to_player = v_me AND jr.status = 'pending'
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'request_not_found');
  END IF;

  ---------------------------------------------------------------------------
  -- REFUS : rien d'autre que la demande elle-meme ne change.
  ---------------------------------------------------------------------------
  IF p_accept IS NOT TRUE THEN
    UPDATE public.tournament_join_requests
       SET status = 'declined', responded_at = now()
     WHERE id = v_req.id;
    RETURN jsonb_build_object('ok', true, 'accepted', false);
  END IF;

  -- L'inscription du DEMANDEUR existe forcement (cle etrangere composite).
  -- Celle de celui qui accepte, NON : depuis tournament_partner_invite.sql,
  -- une invitation part vers quelqu'un qui n'est pas encore inscrit, et c'est
  -- l'acceptation qui l'inscrit.
  SELECT * INTO v_from FROM public.tournament_registrations r
   WHERE r.tournament_id = v_req.tournament_id AND r.player_id = v_req.from_player;
  IF NOT FOUND THEN
    -- Le demandeur s'est desinscrit entre-temps : la demande n'a plus d'objet.
    UPDATE public.tournament_join_requests
       SET status = 'declined', responded_at = now() WHERE id = v_req.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'partner_not_registered');
  END IF;

  SELECT * INTO v_mine FROM public.tournament_registrations r
   WHERE r.tournament_id = v_req.tournament_id AND r.player_id = v_me;

  IF NOT FOUND THEN
    -- J'ACCEPTE SANS ETRE INSCRIT : c'est le chemin normal d'une invitation.
    -- Je rejoins le demandeur DANS SON ETAT DE FILE, jamais a cheval : le
    -- moteur interdit un binome dont une moitie est assise et l'autre en
    -- attente (waitlist_mismatch), et c'est cette regle qui decide ici.
    IF v_from.waitlist_position IS NULL THEN
      -- Lui est assis : il me faut un siege libre. Sa place n'a PAS ete
      -- retenue pendant que je reflechissais -- s'il n'en reste plus, je ne
      -- peux pas le rejoindre assis, et le lui voler serait pire.
      IF coalesce(public.fn_tournament_free_places(v_req.tournament_id), 0) < 1 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'tournament_full');
      END IF;
      INSERT INTO public.tournament_registrations
             (tournament_id, player_id, side, open_to_join, waitlist_position)
      VALUES (v_req.tournament_id, v_me, 'both', false, NULL);
    ELSE
      -- Lui attend : je prends SON rang, pas le suivant. Un binome occupe UN
      -- rang et avance en bloc (fn_tournament_align_waitlist).
      INSERT INTO public.tournament_registrations
             (tournament_id, player_id, side, open_to_join, waitlist_position)
      VALUES (v_req.tournament_id, v_me, 'both', false, v_from.waitlist_position);
    END IF;
    SELECT * INTO v_mine FROM public.tournament_registrations r
     WHERE r.tournament_id = v_req.tournament_id AND r.player_id = v_me;
  END IF;

  IF EXISTS (SELECT 1 FROM public.tournament_participants tp
              WHERE tp.tournament_id = v_req.tournament_id AND tp.player_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_participants tp
              WHERE tp.tournament_id = v_req.tournament_id
                AND tp.player_id = v_req.from_player) THEN
    -- Le demandeur s'est apparie ailleurs entre-temps -- typiquement une
    -- demande croisee, qu'il a acceptee le premier.
    RETURN jsonb_build_object('ok', false, 'reason', 'partner_already_registered');
  END IF;
  IF (v_mine.waitlist_position IS NULL) <> (v_from.waitlist_position IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'waitlist_mismatch');
  END IF;

  ---------------------------------------------------------------------------
  -- ECRITURES.
  ---------------------------------------------------------------------------
  BEGIN
    INSERT INTO public.tournament_teams (tournament_id, player1_id, player2_id)
    VALUES (v_req.tournament_id, v_req.from_player, v_me)
    RETURNING id INTO v_team;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END;

  -- Meme regle de file que dans `tournament_join` : le binome recule au rang
  -- de son membre le plus recule.
  PERFORM public.fn_tournament_align_waitlist(
            v_req.tournament_id, v_me, v_req.from_player);

  -- Refuse TOUT ce qui reste vivant autour des deux joueurs, la demande
  -- courante comprise...
  v_closed := public.fn_tournament_close_pending_requests(
                v_req.tournament_id, v_me, v_req.from_player);
  -- ... puis rend a la demande courante son vrai statut.
  UPDATE public.tournament_join_requests
     SET status = 'accepted', responded_at = now()
   WHERE id = v_req.id;

  PERFORM public.fn_tournament_promote_waitlist(v_req.tournament_id);

  RETURN jsonb_build_object('ok', true, 'accepted', true, 'team_id', v_team,
                            'requests_closed', greatest(v_closed - 1, 0));
END;
$$;

-- ── Prevenir l'invite ────────────────────────────────────────────────────
-- L'ancienne notification partait sur l'INSERT de son inscription. Il n'est
-- plus inscrit a ce moment-la : sans ce declencheur, une invitation partirait
-- sans que personne ne le sache. Meme motif que les deux existants
-- (declencheur + pg_net -> send-push), jamais un push depuis le client.
CREATE OR REPLACE FUNCTION public.fn_tournament_invite_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url  text := 'https://icshhobxeppttgayxmba.supabase.co/functions/v1/send-push';
  v_key  text;
  v_from text;
  v_nom  text;
BEGIN
  -- Une notification ratee ne doit jamais empecher l'invitation.
  BEGIN
    SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
    IF v_key IS NULL THEN RETURN NEW; END IF;
    SELECT name INTO v_from FROM public.players WHERE id = NEW.from_player;
    SELECT name INTO v_nom  FROM public.tournaments WHERE id = NEW.tournament_id;
    PERFORM net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body    := jsonb_build_object(
                   'playerIds', to_jsonb(ARRAY[NEW.to_player]),
                   'title', 'Invitation a un tournoi',
                   'body',  coalesce(v_from, 'Un joueur') || ' te propose de faire binome'
                            || coalesce(' pour ' || v_nom, '') || '.',
                   'data',  jsonb_build_object('type', 'tournament', 'tournamentId', NEW.tournament_id))
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.fn_tournament_invite_notify() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tournament_invite_notify ON public.tournament_join_requests;
CREATE TRIGGER trg_tournament_invite_notify
  AFTER INSERT ON public.tournament_join_requests
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.fn_tournament_invite_notify();

COMMIT;

NOTIFY pgrst, 'reload schema';
