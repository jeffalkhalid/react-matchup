// components/tournaments/ReportSheet.tsx — « Un score est faux ? », après la
// soirée et avant que les points soient crédités.
//
// ⚠️ MÊME CONTRAT D'ORIENTATION que `ScoreSheet` : `proposedA` est TOUJOURS le
// score de `team_a` DU MATCH, jamais « le mien ». Deux adversaires qui
// signaleraient chacun dans son propre ordre décriraient le même terrain à
// l'envers, et l'organisateur trancherait entre deux versions qui disent la
// même chose.
//
// Ce n'est PAS la feuille de saisie : la soirée est finie, plus rien ne
// bloque, on ne « rentre » pas un score — on dit à l'organisateur que celui
// qui est écrit est faux. D'où des mots différents, et un seul bouton.
//
// Surimpression absolue, pas un <Modal> natif (cf. feedback_nav_depuis_modal_native).
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { bumpGames } from '../../lib/tournamentEvening';
import { reportIssue } from '../../lib/tournamentReports';

function Pas({ signe, onPress }: { signe: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
      accessibilityRole="button"
      accessibilityLabel={signe === '+' ? 'Un jeu de plus' : 'Un jeu de moins'}
      style={{ width: 42, paddingVertical: 12, alignItems: 'center' }}
    >
      <Text style={{ fontSize: 20, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>{signe}</Text>
    </TouchableOpacity>
  );
}

function Compteur({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const vide = value === '';
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
    }}>
      <Pas signe="−" onPress={() => onChange(bumpGames(value, -1))} />
      <Text style={{
        width: 36, textAlign: 'center', fontSize: 20, fontFamily: Fonts.uiBlack,
        color: vide ? Colors.textMuted : Colors.textPrimary,
      }}>
        {vide ? '—' : value}
      </Text>
      <Pas signe="+" onPress={() => onChange(bumpGames(value, 1))} />
    </View>
  );
}

export function ReportSheet({
  visible, courtNo, teamALabel, teamBLabel, currentA, currentB, busy, onSubmit, onClose,
}: {
  visible: boolean;
  courtNo: number;
  /** Toujours `team_a` DU MATCH — jamais réordonné selon qui regarde. */
  teamALabel: string;
  teamBLabel: string;
  /** Le score actuellement inscrit, celui qu'on conteste. */
  currentA: number | null;
  currentB: number | null;
  busy?: boolean;
  onSubmit: (proposedA: number, proposedB: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  // À l'ouverture, on part du score inscrit : on vient en corriger un chiffre,
  // pas ressaisir le match de zéro.
  useEffect(() => {
    if (!visible) return;
    setA(currentA != null ? String(currentA) : '');
    setB(currentB != null ? String(currentB) : '');
  }, [visible, currentA, currentB]);

  if (!visible) return null;

  const souci = reportIssue(a === '' ? null : Number(a), b === '' ? null : Number(b));
  const identique = currentA != null && currentB != null
    && Number(a) === currentA && Number(b) === currentB;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'flex-end' }}>
      <Pressable onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,10,10,0.45)' }} />

      <View style={{
        backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: 20, paddingBottom: insets.bottom + 20, gap: 14,
      }}>
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 19, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 6 }}>
            Un score est faux ?
          </Text>
          <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 18 }}>
            Terrain {courtNo}. Dis le score que tu as joué — l’organisateur
            tranche avant de valider le classement.
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
              {teamALabel}
            </Text>
            <Compteur value={a} onChange={setA} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
              {teamBLabel}
            </Text>
            <Compteur value={b} onChange={setB} />
          </View>
        </View>

        {currentA != null && currentB != null && (
          <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
            Actuellement inscrit : {currentA} – {currentB}
          </Text>
        )}

        {(souci || identique) && (
          <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
            {souci ?? 'C’est le score déjà inscrit — il n’y a rien à signaler.'}
          </Text>
        )}

        <TouchableOpacity
          onPress={() => onSubmit(Number(a), Number(b))}
          disabled={!!souci || identique || busy}
          activeOpacity={0.85}
          style={{
            backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15,
            alignItems: 'center', opacity: (souci || identique || busy) ? 0.45 : 1,
          }}
        >
          {busy ? <ActivityIndicator color={Colors.textOnDark} /> : (
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, letterSpacing: 0.5, color: Colors.textOnDark }}>
              ENVOYER À L’ORGANISATEUR
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={onClose} style={{ alignItems: 'center', padding: 6 }}>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            Laisse tomber
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
