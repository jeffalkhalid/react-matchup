// components/tournaments/CourtRow.tsx — une ligne du tableau des terrains.
//
// Un terrain par ligne. « Du Terrain 1 en haut » est un fait de l'ORDRE dans
// lequel l'écran appelant rend ces lignes (fetchRoundMatches trie déjà
// court_no ASC) — ce composant ne trie rien, il affiche une ligne.
//
// Le score affiché est TOUJOURS celui de `tournament_matches`, jamais
// recalculé : `gamesA` en face de l'équipe A, `gamesB` en face de l'équipe B,
// exactement l'orientation que porte le match. Un forfait se lit au marqueur
// `forfeitedTeamId` fourni par l'appelant — jamais aux jeux, qui peuvent
// porter un score de courtoisie identique des deux côtés.
//
// Les flèches de montée/descente viennent de `tournament_movements`
// (comment CE binôme est arrivé sur CE terrain ce tour-ci) — passées toutes
// faites par l'écran, jamais recalculées ici.
//
// Style repris de TournamentCard.tsx : carte blanche rayon 18, bordure,
// ombre légère, pastilles <Pill>. Rien d'inventé.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Pill, type PillVariant } from '../Pill';
import { Icon } from '../community/icons';
import type { MatchLiveStatus } from '../../lib/tournaments';

export interface CourtTeamInfo {
  id: string;
  /** Les deux joueurs du binôme, TELS QUELS — jamais « toi / adversaire ». */
  names: [string, string];
  /** Comment ce binôme est arrivé sur ce terrain ce tour-ci. `null`/`'STAY'`
   *  au tour 1 (personne n'a encore bougé) ou tant que la donnée n'est pas
   *  chargée : aucune flèche ne s'affiche alors, ce qui est la vérité. */
  movement?: 'UP' | 'DOWN' | 'STAY' | null;
  /** Je fais partie de ce binôme — accent visuel seulement. */
  mine?: boolean;
}

function MovementBadge({ movement }: { movement: 'UP' | 'DOWN' | 'STAY' | null | undefined }) {
  if (!movement || movement === 'STAY') return null;
  const up = movement === 'UP';
  return (
    <View style={{
      width: 18, height: 18, borderRadius: 6, alignItems: 'center', justifyContent: 'center',
      backgroundColor: up ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.12)',
    }}>
      <Icon name="arrowRight" size={11} rotate={up ? -90 : 90} color={up ? Colors.success : Colors.danger} stroke={2.6} />
    </View>
  );
}

function TeamLine({ team, games, forfeited }: { team: CourtTeamInfo; games: number | null; forfeited?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 }}>
      <MovementBadge movement={team.movement} />
      <Text numberOfLines={1} style={{
        flex: 1, fontSize: 12.5, fontFamily: team.mine ? Fonts.uiBlack : Fonts.uiBold,
        color: forfeited ? Colors.textMuted : (team.mine ? Colors.textPrimary : Colors.textSecondary),
      }}>
        {team.names[0]} · {team.names[1]}
      </Text>
      {forfeited && (
        <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.danger, textTransform: 'uppercase' }}>
          Forfait
        </Text>
      )}
      {games != null && !forfeited && (
        <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, minWidth: 20, textAlign: 'right' }}>
          {games}
        </Text>
      )}
    </View>
  );
}

const STATUS_PILL: Record<MatchLiveStatus, { variant: PillVariant; label: string }> = {
  bye:       { variant: 'neutral', label: 'Repos' },
  forfeited: { variant: 'danger',  label: 'Forfait' },
  confirmed: { variant: 'success', label: 'Acquis' },
  disputed:  { variant: 'danger',  label: 'Litige' },
  awaiting:  { variant: 'warning', label: 'En attente' },
};

export function CourtRow({ courtNo, isTopCourt, teamA, teamB, gamesA, gamesB, forfeitedTeamId, status, onPress }: {
  courtNo: number;
  /** Terrain 1 : le palier le plus fort. Accent visuel seulement. */
  isTopCourt?: boolean;
  teamA: CourtTeamInfo;
  /** `null` seulement pour un bye : ce terrain ne porte alors qu'un binôme. */
  teamB: CourtTeamInfo | null;
  gamesA: number | null;
  gamesB: number | null;
  forfeitedTeamId?: string | null;
  status: MatchLiveStatus;
  onPress?: () => void;
}) {
  const pill = STATUS_PILL[status];
  const showScore = status === 'confirmed';
  return (
    <TouchableOpacity
      activeOpacity={0.8} disabled={!onPress} onPress={onPress}
      style={[cs.card, isTopCourt && cs.cardTop]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 }}>
        <View style={[cs.courtBadge, isTopCourt && cs.courtBadgeTop]}>
          <Text style={[cs.courtBadgeTxt, isTopCourt && cs.courtBadgeTxtTop]}>{courtNo}</Text>
        </View>
        <Text style={{ marginLeft: 8, fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', flex: 1 }}>
          Terrain {courtNo}{isTopCourt ? ' · le plus fort' : ''}
        </Text>
        <Pill variant={pill.variant}>{pill.label}</Pill>
      </View>
      <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>
        <TeamLine team={teamA} games={showScore ? gamesA : null} forfeited={!!forfeitedTeamId && forfeitedTeamId === teamA.id} />
        {teamB ? (
          <TeamLine team={teamB} games={showScore ? gamesB : null} forfeited={!!forfeitedTeamId && forfeitedTeamId === teamB.id} />
        ) : (
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted, fontStyle: 'italic', paddingVertical: 5 }}>
            Repos ce tour
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const cs = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  cardTop: { borderColor: Colors.brand, borderWidth: 1.5 },
  courtBadge: {
    width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
  },
  courtBadgeTop: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  courtBadgeTxt: { fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary },
  courtBadgeTxtTop: { color: Colors.textOnBrand },
});

export default CourtRow;
