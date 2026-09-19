// Carte « Ton match d'hier » — vote d'après-match remonté dans le hub
// Activité (étape 1). Un tap sur un badge suffit : la carte ne propose qu'UN
// destinataire (le plus pertinent, lib/postMatchVote.featuredReceiver) et
// envoie le vote aussitôt — la modale complète (tous les matchs, tous les
// destinataires) reste disponible depuis l'accueil.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { MatchCard } from '../profile/components';
import { BadgePill } from '../profile/BadgePill';
import { useNeutralVoteBadges } from '../profile/BadgeDefsProvider';
import { matchToView } from '../../lib/matchView';
import { getPendingVoteMatch, featuredReceiver, submitSingleVote, getTopBadgeCounts } from '../../lib/postMatchVote';
import type { Match, Player } from '../../types';

const CARD = { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 14 } as const;

export function PostMatchVoteCard({ playerId }: { playerId: string }) {
  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<Match | null>(null);
  const [reputation, setReputation] = useState<{ key: string; count: number }[]>([]);
  const [sentFor, setSentFor] = useState<string | null>(null); // prénom du destinataire, une fois voté
  const badges = useNeutralVoteBadges().slice(0, 4);

  const load = useCallback(() => {
    setLoading(true); setSentFor(null);
    (async () => {
      const m = await getPendingVoteMatch(playerId);
      setMatch(m);
      setReputation(m ? [] : await getTopBadgeCounts(playerId));
      setLoading(false);
    })();
  }, [playerId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={[CARD, { alignItems: 'center' }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  const receiver: Player | null = match ? featuredReceiver(match, playerId) : null;

  const vote = async (key: string) => {
    if (!match || !receiver) return;
    setSentFor(receiver.name.split(' ')[0]);
    await submitSingleVote(match.id, playerId, receiver.id, [key]);
  };

  // ── État calme : rien à voter ────────────────────────────────
  if (!match || !receiver) {
    return (
      <View style={CARD}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="check" size={15} color={Colors.brandDeep} stroke={2.6} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: Colors.textPrimary }}>Tes votes sont à jour</Text>
        </View>
        {reputation.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            {reputation.map(r => (
              <View key={r.key} style={{ flex: 1, alignItems: 'center', backgroundColor: '#F8F8F7', borderWidth: 1, borderColor: '#EFEDEA', borderRadius: 12, paddingVertical: 10 }}>
                <BadgePill badge={r.key} size={30} />
                <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.textPrimary, marginTop: 6 }}>{r.count}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.textSecondary, marginTop: 4 }}>
            Après ton prochain match, tu pourras dire ce que tes partenaires ont fait de mieux.
          </Text>
        )}
      </View>
    );
  }

  // ── Vote envoyé ───────────────────────────────────────────────
  if (sentFor) {
    return (
      <View style={CARD}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: Colors.textPrimary }}>
          Vote envoyé · <Text style={{ color: Colors.brandDeep }}>{sentFor}</Text> le verra sur son profil
        </Text>
      </View>
    );
  }

  const pronoun = receiver.gender === 'female' ? 'elle' : 'il';

  return (
    <View style={CARD}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="star" size={15} color={Colors.brandDeep} stroke={2} />
        <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6 }}>
          Ton match d'hier
        </Text>
      </View>

      <View style={{ marginTop: 10, marginBottom: 12 }}>
        <MatchCard m={matchToView(match, playerId, true)} showActions={false} showDelta={false} compact />
      </View>

      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13, color: Colors.textPrimary, marginBottom: 10 }}>
        Qu'est-ce qu'{pronoun} a fait de mieux ?
      </Text>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        {badges.map(b => (
          <TouchableOpacity key={b.key} onPress={() => vote(b.key)} activeOpacity={0.8} style={{
            flex: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 4,
            borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center',
          }}>
            <BadgePill badge={b.key} size={34} />
            <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: Colors.textPrimary, marginTop: 6, textAlign: 'center' }}>
              {b.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
