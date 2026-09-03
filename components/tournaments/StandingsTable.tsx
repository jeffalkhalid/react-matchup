// components/tournaments/StandingsTable.tsx — le classement de la soirée.
//
// LES CHIFFRES VIENNENT DE `tournament_standings`, JAMAIS D'UN CALCUL LOCAL :
// ce composant ne fait que rendre ce que la RPC a déjà tranché (rang, MJ, V,
// D, JG, JP, différence — la hiérarchie complète, abandon et confrontation
// directe comprises, reste dans le SQL). Le mouvement affiché (▲/▼/=) vient
// de `tournament_movements` (même source que CourtRow), pas d'une
// comparaison de rangs qu'aucune donnée locale ne permettrait de faire
// correctement.
//
// Style repris de TournamentCard.tsx : carte blanche rayon 18, pastilles
// <Pill>. Rien d'inventé.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Pill } from '../Pill';
import { Icon } from '../community/icons';
import type { TournamentStanding } from '../../lib/tournaments';

export interface StandingRowData {
  standing: TournamentStanding;
  /** Les deux joueurs du binôme, TELS QUELS. */
  names: [string, string];
  /** Depuis la rotation précédente — `tournament_movements` du tour courant. */
  movement?: 'UP' | 'DOWN' | 'STAY' | null;
  mine?: boolean;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 28 }}>
      <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: tone ?? Colors.textPrimary }}>{value}</Text>
      <Text style={{ fontSize: 8, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 1 }}>
        {label}
      </Text>
    </View>
  );
}

function MoveBadge({ movement }: { movement: 'UP' | 'DOWN' | 'STAY' | null | undefined }) {
  if (!movement || movement === 'STAY') {
    return (
      <View style={{ width: 20, alignItems: 'center' }}>
        <Text style={{ fontSize: 13, color: Colors.textMuted, fontFamily: Fonts.uiBlack }}>–</Text>
      </View>
    );
  }
  const up = movement === 'UP';
  return (
    <View style={{ width: 20, alignItems: 'center' }}>
      <Icon name="arrowRight" size={13} rotate={up ? -90 : 90} color={up ? Colors.success : Colors.danger} stroke={2.6} />
    </View>
  );
}

export function StandingsTable({ rows }: { rows: StandingRowData[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {rows.map(({ standing: s, names, movement, mine }) => (
        <View key={s.team_id} style={[cs.card, mine && cs.cardMine]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
            <View style={[cs.rankBadge, s.rank <= 3 && !s.withdrawn && cs.rankBadgeTop]}>
              <Text style={[cs.rankTxt, s.rank <= 3 && !s.withdrawn && cs.rankTxtTop]}>{s.rank}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{
                fontSize: 13, fontFamily: mine ? Fonts.uiBlack : Fonts.uiBold, color: Colors.textPrimary,
              }}>
                {names[0]} · {names[1]}
              </Text>
              {/* Même mot que partout ailleurs pour cet événement (CourtRow,
                  ScoreSheet, admin.tsx « Forfait d'un binôme ») — jamais
                  « Abandon » ici et « Forfait » là, deux noms pour la même
                  colonne `tournament_teams.withdrawn`. */}
              {s.withdrawn && (
                <View style={{ marginTop: 3, alignSelf: 'flex-start' }}>
                  <Pill variant="danger">Forfait</Pill>
                </View>
              )}
            </View>
            <MoveBadge movement={movement} />
          </View>
          <View style={cs.statsRow}>
            <Stat label="MJ" value={String(s.played)} />
            <Stat label="V" value={String(s.wins)} tone={Colors.success} />
            <Stat label="D" value={String(s.losses)} tone={Colors.danger} />
            <Stat label="JG" value={String(s.games_won)} />
            <Stat label="JP" value={String(s.games_lost)} />
            <Stat
              label="Diff"
              value={s.diff > 0 ? `+${s.diff}` : String(s.diff)}
              tone={s.diff > 0 ? Colors.success : s.diff < 0 ? Colors.danger : undefined}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const cs = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  cardMine: { borderColor: Colors.brand, borderWidth: 1.5 },
  rankBadge: {
    width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
  },
  rankBadgeTop: { backgroundColor: Colors.brand, borderColor: Colors.brand },
  rankTxt: { fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary },
  rankTxtTop: { color: Colors.textOnBrand },
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, gap: 4,
    backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
});

export default StandingsTable;
