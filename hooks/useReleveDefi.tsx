// Relever un défi nominatif — le geste complet, écrit une seule fois.
//
// RÈGLE (décision du 2026-09-23) : relever un défi qu'on m'adresse et amener
// mon binôme sont UN SEUL geste. Le choix du partenaire passe AVANT
// l'acceptation ; tant qu'il n'est pas fait, je reste « invité » et rien
// n'est engagé. Le choix fait, l'acceptation et l'invitation partent
// ensemble.
//
// Pourquoi un hook et pas trois copies : la première version acceptait
// d'abord et proposait le binôme après — dès que la première moitié est
// faite, la seconde n'a plus d'urgence et personne ne rouvre la fiche pour la
// finir. La règle n'a de valeur que si TOUS les écrans qui relèvent
// l'appliquent à l'identique ; ils partagent donc l'état, la fenêtre et les
// deux écritures, pas seulement l'intention.
import { useState } from 'react';
import { Alert } from 'react-native';
import { InvitePartnerSheet, type PartnerCandidate } from '../components/InvitePartnerSheet';
import { partnerSeatAfterAccepting, partnerSeatToFill, isCreatorConflict } from '../lib/games';
import { notifyPlayers } from '../lib/notify';
import { supabase } from '../lib/supabase';

/** Ce que le hook a besoin de savoir d'une partie — un sur-ensemble partout disponible. */
export interface ReleveGame {
  id: string;
  location?: string | null;
  creator_id?: string | null;
  is_challenge?: boolean | null;
  is_targeted?: boolean | null;
  status?: string | null;
  /** La bande de niveau du défi : la MOYENNE du duo doit y tenir. */
  min_elo?: number | null;
  max_elo?: number | null;
  participants?: {
    id?: string | null; player_id: string; status: string;
    team_side?: string | null; invite_expires_at?: string | null;
  }[] | null;
}

interface Pending {
  /** Ma ligne d'invitation, à accepter en même temps. `null` = déjà accepté. */
  participantId: string | null;
  gameId: string;
  teamSide: string;
  excludeIds: string[];
  /** La contrainte de niveau, transmise telle quelle au sélecteur. */
  bande: { monElo: number; minElo: number | null; maxElo: number | null } | null;
}

/** Les joueurs déjà dans la partie — jamais reproposés comme binôme. */
function dejaLa(game: ReleveGame): string[] {
  return [
    // Le créateur n'a PAS de ligne participants : sans lui, on le
    // reproposerait comme binôme de son propre adversaire.
    game.creator_id,
    ...(game.participants ?? []).map(p => p.player_id),
  ].filter((v): v is string => !!v);
}

export function useReleveDefi({ me, onDone }: {
  me: { id: string; name: string; elo_score: number } | null;
  /** Appelé après une relève réussie — chaque écran recharge ce qu'il affiche. */
  onDone: () => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Relever un défi nominatif. Rend `true` si la fenêtre du binôme a pris la
   * main — l'appelant doit alors s'arrêter là et surtout ne rien accepter.
   */
  const start = (game: ReleveGame, participantId: string): boolean => {
    if (!me) return false;
    const siege = partnerSeatAfterAccepting(game, participantId, me.id);
    if (!siege) return false;
    setPending({
      participantId, gameId: game.id, teamSide: siege, excludeIds: dejaLa(game),
      bande: { monElo: me.elo_score, minElo: game.min_elo ?? null, maxElo: game.max_elo ?? null },
    });
    return true;
  };

  /**
   * Le rattrapage : j'ai déjà accepté (défi relevé avant cette règle, ou
   * invitation du binôme qui a échoué) et mon camp attend toujours quelqu'un.
   */
  const startInvite = (game: ReleveGame): boolean => {
    if (!me) return false;
    const siege = partnerSeatToFill(game, me.id);
    if (!siege) return false;
    setPending({
      participantId: null, gameId: game.id, teamSide: siege, excludeIds: dejaLa(game),
      bande: { monElo: me.elo_score, minElo: game.min_elo ?? null, maxElo: game.max_elo ?? null },
    });
    return true;
  };

  const pick = async (partner: PartnerCandidate) => {
    if (!pending || !me) return;
    setBusyId(partner.id);

    // Mon acceptation D'ABORD : si elle échoue (conflit de créneau), on
    // n'invite personne — sinon on aurait convoqué un binôme dans une partie
    // qu'on ne rejoint finalement pas.
    if (pending.participantId) {
      const { error } = await supabase.from('game_participants')
        .update({ status: 'accepted' }).eq('id', pending.participantId);
      if (error) {
        setBusyId(null); setPending(null);
        Alert.alert(
          isCreatorConflict(error) ? '⚠️ Conflit de créneau' : 'Impossible de relever',
          isCreatorConflict(error)
            ? 'Tu es déjà sur une autre partie au même créneau (±2h). Annule-la ou quitte-la avant de relever ce défi.'
            : 'Une erreur est survenue, réessaie dans un instant.',
        );
        return;
      }
      notifyPlayers({
        playerIds: pending.excludeIds.filter(id => id !== me.id),
        title: '⚔️ Ton défi est relevé !',
        body: `${me.name} relève le défi et amène son binôme.`,
        data: { type: 'lobby', gameId: pending.gameId },
      });
    }

    const { error } = await supabase.from('game_participants').insert({
      game_id: pending.gameId,
      player_id: partner.id,
      status: 'invited',
      team_side: pending.teamSide,
    });
    setBusyId(null);
    const releve = !!pending.participantId;
    setPending(null);
    if (error) {
      // Le serveur porte la meme regle que l'ecran (defi_band_server_guard) :
      // quand c'est lui qui refuse, on le dit dans les mots du joueur plutot
      // que de montrer une erreur technique.
      const horsBande = String((error as any)?.message ?? '').includes('DEFI_BAND');
      Alert.alert(
        horsBande ? 'Binôme hors fourchette' : 'Binôme non invité',
        horsBande
          ? "Votre niveau moyen à tous les deux sort de la fourchette du défi. Choisis un binôme qui vous y ramène."
          : releve
            ? "Tu as bien relevé le défi, mais l'invitation de ton binôme n'est pas partie. Rouvre la partie et réessaie."
            : "L'invitation n'a pas pu être envoyée. Réessaie dans un instant.",
      );
      onDone();
      return;
    }

    notifyPlayers({
      playerIds: [partner.id],
      title: `${me.name} te prend comme binôme`,
      body: 'Un défi vous attend — accepte pour le confirmer.',
      data: { type: 'lobby', gameId: pending.gameId },
    });
    onDone();
  };

  /** Fermer sans choisir : on n'a rien relevé, et on le dit. */
  const close = () => {
    const releve = !!pending?.participantId;
    setPending(null);
    if (releve) {
      Alert.alert(
        'Défi pas encore relevé',
        "Un défi se joue à deux : choisis ton binôme pour le relever. L'invitation reste valable en attendant.",
      );
    }
  };

  const sheet = (
    <InvitePartnerSheet
      visible={!!pending}
      excludeIds={pending?.excludeIds ?? []}
      bande={pending?.bande ?? null}
      busyId={busyId}
      subtitle={pending?.participantId
        ? 'Un défi se joue à deux. En le choisissant, tu relèves le défi et il reçoit son invitation.'
        : undefined}
      onClose={close}
      onPick={pick}
    />
  );

  return { start, startInvite, sheet, actif: !!pending };
}
