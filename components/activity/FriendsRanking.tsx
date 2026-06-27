import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import type { Player, SocialPlayer } from '../../types';

const initials = (n: string) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const RANK_COLOR = ['#E8A906', '#A1A1AA', '#0A0A0A'];

// Classement « Top amis » — toi + tes amis, classés par points de saison
// (repli : niveau). Données déjà chargées, aucune requête.
export function FriendsRanking({ me, friends, monthLabel, onSeeAll }: {
  me: Player; friends: SocialPlayer[]; monthLabel?: string; onSeeAll?: () => void;
}) {
  if (friends.length === 0) return null;
  const all = [
    { id: me.id, name: 'Toi', pts: me.season_points ?? 0, level: eloToLevel(me.elo_score), isMe: true },
    ...friends.map(f => ({ id: f.id, name: f.name, pts: f.season_points ?? 0, level: eloToLevel(f.elo_score), isMe: false })),
  ];
  const usePts = all.some(r => r.pts > 0);
  const metric = (r: typeof all[number]) => (usePts ? r.pts : r.level);
  const rows = [...all].sort((a, b) => metric(b) - metric(a)).slice(0, 5);
  const max = Math.max(1, ...rows.map(metric));

  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>🏆</Text>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary }}>Top amis{monthLabel ? ` · ${monthLabel.charAt(0) + monthLabel.slice(1).toLowerCase()}` : ''}</Text>
        </View>
        {onSeeAll ? (
          <TouchableOpacity onPress={onSeeAll} hitSlop={8}><Text style={{ fontFamily: Fonts.uiBold, fontSize: 11, color: Colors.textSecondary }}>Voir tout →</Text></TouchableOpacity>
        ) : null}
      </View>

      {rows.map((r, i) => {
        const val = usePts ? `${r.pts}` : r.level.toFixed(2);
        return (
          <View key={r.id} style={{
            flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5,
            ...(r.isMe ? { backgroundColor: 'rgba(255,193,26,0.12)', borderRadius: 9, paddingHorizontal: 6, marginHorizontal: -6 } : null),
          }}>
            <Text style={{ width: 20, textAlign: 'center', fontFamily: Fonts.uiBlack, fontSize: 13, color: RANK_COLOR[i] ?? Colors.textMuted }}>{i + 1}</Text>
            <View style={{ width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
              backgroundColor: r.isMe ? '#0A0A0A' : Colors.brand, borderWidth: r.isMe ? 1.5 : 0, borderColor: Colors.brand }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: r.isMe ? Colors.brand : '#0A0A0A' }}>{initials(r.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textPrimary }}>{r.name}</Text>
              <View style={{ backgroundColor: '#F6F5F3', height: 4, borderRadius: 999, marginTop: 3, overflow: 'hidden' }}>
                <View style={{ width: `${Math.round((metric(r) / max) * 100)}%`, height: 4, backgroundColor: Colors.brand, borderRadius: 999 }} />
              </View>
            </View>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.success }}>{val}</Text>
          </View>
        );
      })}
    </View>
  );
}
