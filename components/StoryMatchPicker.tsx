import { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, FlatList, ActivityIndicator, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { Colors, Fonts } from '../lib/theme';
import { buildStoryMatch, type StoryMatchData } from './story/storyTheme';
import { displayName, type JoinedPlayer } from '../lib/players';

interface MatchRow {
  id: string;
  score_text: string | null;
  created_at: string;
  is_challenge: boolean | null;
  winner_id: string | null;
  loser_id: string | null;
  winner_id_2: string | null;
  loser_id_2: string | null;
  winner: JoinedPlayer | null;
  loser: JoinedPlayer | null;
  winner_2: JoinedPlayer | null;
  loser_2: JoinedPlayer | null;
  game: { location: string | null; match_date: string | null } | null;
}

interface Props {
  visible: boolean;
  playerId: string;
  onClose: () => void;
  onPick: (match: StoryMatchData, matchId: string) => void;
  // Quand fourni (ex. 7), restreint la liste aux matchs joués dans les N derniers
  // jours — pour le flux « Moment de la semaine » (un moment >1 semaine n'a pas
  // de sens). Absent → tous les matchs (story externe sur le profil).
  recentWithinDays?: number;
  subtitle?: string;
}

export default function StoryMatchPicker({ visible, playerId, onClose, onPick, recentWithinDays, subtitle }: Props) {
  const insets = useSafeAreaInsets();
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    supabase
      .from('matches')
      .select(`id, score_text, created_at, is_challenge, winner_id, loser_id, winner_id_2, loser_id_2,
        winner:winner_id(id, name, deleted_at), loser:loser_id(id, name, deleted_at),
        winner_2:winner_id_2(id, name, deleted_at), loser_2:loser_id_2(id, name, deleted_at),
        game:game_id(location, match_date)`)
      .or(`winner_id.eq.${playerId},loser_id.eq.${playerId},winner_id_2.eq.${playerId},loser_id_2.eq.${playerId}`)
      .eq('status', 'validated')
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        let rows = (data ?? []) as unknown as MatchRow[];
        if (recentWithinDays) {
          const cutoff = Date.now() - recentWithinDays * 24 * 60 * 60 * 1000;
          rows = rows.filter(m => new Date(m.game?.match_date ?? m.created_at).getTime() >= cutoff);
        }
        setMatches(rows);
        setLoading(false);
      });
  }, [visible, playerId, recentWithinDays]);

  const handlePick = (m: MatchRow) => {
    onPick(buildStoryMatch(m, playerId), m.id);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>
        {/* Header */}
        <View style={{
          paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt,
        }}>
          <TouchableOpacity onPress={onClose} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 18, color: Colors.textSecondary }}>✕</Text>
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Choisir un match</Text>
            <Text style={{ fontSize: 11, color: Colors.textMuted }}>{subtitle ?? 'pour ta story'}</Text>
          </View>
          <View style={{ width: 36 }} />
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} size="large" />
        ) : matches.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
            <Image source={require('../assets/auth/splash-racket.png')} style={{ width: 40, height: 40, marginBottom: 8 }} resizeMode="contain" />
            <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, textAlign: 'center' }}>
              {recentWithinDays ? 'Aucun match cette semaine' : 'Aucun match validé encore'}
            </Text>
            <Text style={{ fontSize: 12, color: Colors.textMuted, textAlign: 'center', marginTop: 4 }}>
              {recentWithinDays
                ? 'Joue un match cette semaine pour le mettre en avant dans tes Moments.'
                : 'Joue ta première partie pour pouvoir créer une story.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={matches}
            keyExtractor={m => m.id}
            contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 24, gap: 10 }}
            renderItem={({ item }) => <Row match={item} playerId={playerId} onPick={() => handlePick(item)} />}
          />
        )}
      </View>
    </Modal>
  );
}

function Row({ match, playerId, onPick }: { match: MatchRow; playerId: string; onPick: () => void }) {
  const won = match.winner_id === playerId || match.winner_id_2 === playerId;
  const winnerRole = won ? 'partner' : 'opponent';
  const loserRole  = won ? 'opponent' : 'partner';
  const winners = [match.winner, match.winner_2].filter(Boolean).map(p => displayName(p, winnerRole)).join(' & ');
  const losers  = [match.loser,  match.loser_2 ].filter(Boolean).map(p => displayName(p, loserRole)).join(' & ');
  const date = (match.game?.match_date ?? match.created_at);
  const dateStr = new Date(date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <TouchableOpacity
      onPress={onPick}
      activeOpacity={0.85}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        backgroundColor: Colors.bgCard, borderRadius: 14,
        padding: 12, borderWidth: 1, borderColor: Colors.border,
      }}
    >
      <View style={{
        backgroundColor: won ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.10)',
        paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999,
      }}>
        <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: won ? Colors.success : Colors.danger, letterSpacing: 0.5 }}>
          {won ? 'VICTOIRE' : 'DÉFAITE'}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }} numberOfLines={1}>
          {winners} <Text style={{ color: Colors.textMuted, fontWeight: '600' }}>vs</Text> {losers}
        </Text>
        <Text style={{ fontSize: 11, color: Colors.textMuted, marginTop: 2 }} numberOfLines={1}>
          {dateStr}{match.game?.location ? ` · ${match.game.location}` : ''}
        </Text>
      </View>
      {match.score_text ? (
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: won ? Colors.success : Colors.danger }}>
          {match.score_text}
        </Text>
      ) : null}
      <Text style={{ fontSize: 14, color: Colors.textMuted }}>›</Text>
    </TouchableOpacity>
  );
}
