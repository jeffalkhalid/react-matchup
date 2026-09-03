// components/tournaments/FinalStandings.tsx — le classement FIGÉ d'un
// tournoi clos (TERMINE ou CLASSEMENT_VALIDE), lu depuis `tournament_results`.
//
// ⚠️ CE N'EST PAS `StandingsTable` (le classement VIVANT de `tournament_standings`,
// trié abandon → palier → victoires → différence → jeux → confrontation).
// `tournament_close` fige les rangs et les points aux CRÉNEAUX de la rotation
// de classement (`fn_tournament_final_slots`), une valeur DIFFÉRENTE du
// classement vivant. Un tournoi clos ne doit JAMAIS montrer les deux sous le
// même mot « Classement » : c'est ce composant-ci qui porte la vérité figée,
// `StandingsTable` ne sert plus qu'en cours de soirée (`EN_COURS`).
//
// Les POINTS sont l'information manquante de `StandingsTable` — la seule
// raison d'être de la clôture (« tu finis 3e, +65 points ») — donc affichés
// ici en évidence, avec `validated` qui dit s'ils sont déjà CRÉDITÉS
// (CLASSEMENT_VALIDE) ou encore en ATTENTE (TERMINE, pas encore validé).
//
// Style repris de StandingsTable.tsx / parcours.tsx `ResultRow` : carte
// blanche rayon 18, pastilles <Pill>, badge de rang doré/argenté/bronze sur
// le podium. Rien d'inventé.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';

export interface FinalStandingRowData {
  team_id: string;
  final_rank: number;
  played: number;
  wins: number;
  games_won: number;
  games_lost: number;
  points: number;
  /** Les deux joueurs du binôme, TELS QUELS. */
  names: [string, string];
  mine?: boolean;
}

function RankBadge({ rank }: { rank: number }) {
  const podium = rank <= 3;
  // Fond doré/argenté/bronze sur le podium — `tone` sert le FOND, pas le
  // texte (toujours `textOnBrand`, lisible sur les trois couleurs).
  const tone = rank === 1 ? '#F59E0B' : rank === 2 ? '#94A3B8' : rank === 3 ? '#B45309' : undefined;
  return (
    <View style={{
      width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
      backgroundColor: podium ? (tone ?? Colors.brand) : Colors.bg,
      borderWidth: 1, borderColor: podium ? (tone ?? Colors.brand) : Colors.border,
    }}>
      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: podium ? Colors.textOnBrand : Colors.textPrimary }}>
        {rank}
      </Text>
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 26 }}>
      <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: tone ?? Colors.textPrimary }}>{value}</Text>
      <Text style={{ fontSize: 7.5, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 1 }}>
        {label}
      </Text>
    </View>
  );
}

export function FinalStandings({ rows, validated }: {
  rows: FinalStandingRowData[];
  /** `true` : CLASSEMENT_VALIDE, les points sont crédités. `false` : TERMINE,
   *  ce sont les points qui SERONT crédités à la validation — jamais encore. */
  validated: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      {rows.map(r => {
        const diff = r.games_won - r.games_lost;
        const diffTone = diff > 0 ? Colors.success : diff < 0 ? Colors.danger : undefined;
        const diffValue = diff > 0 ? `+${diff}` : String(diff);
        const losses = r.played - r.wins;
        return (
          <View key={r.team_id} style={[cs.card, r.mine && cs.cardMine]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
              <RankBadge rank={r.final_rank} />
              <Text numberOfLines={1} style={{
                flex: 1, fontSize: 13, fontFamily: r.mine ? Fonts.uiBlack : Fonts.uiBold, color: Colors.textPrimary,
              }}>
                {r.names[0]} · {r.names[1]}
              </Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.brandDeep }}>
                  {validated ? `+${r.points}` : r.points}
                </Text>
                <Text style={{ fontSize: 8, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 0.3, textTransform: 'uppercase' }}>
                  {validated ? 'points crédités' : 'points en attente'}
                </Text>
              </View>
            </View>
            <View style={cs.statsRow}>
              <Stat label="MJ" value={String(r.played)} />
              <Stat label="V" value={String(r.wins)} tone={Colors.success} />
              <Stat label="D" value={String(losses)} tone={Colors.danger} />
              <Stat label="JG" value={String(r.games_won)} />
              <Stat label="JP" value={String(r.games_lost)} />
              <Stat label="Diff" value={diffValue} tone={diffTone} />
            </View>
          </View>
        );
      })}
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
  statsRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10, gap: 4,
    backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
});

export default FinalStandings;
