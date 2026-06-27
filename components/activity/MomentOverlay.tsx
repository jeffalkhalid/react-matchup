import { Modal, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { Avatar } from '../community/Avatar';
import { MatchCard as MatchScoreCard } from '../profile/components';
import { BadgePill } from '../profile/BadgePill';
import { matchToView } from '../../lib/matchView';
import type { ActivityEvent } from '../../types';

const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); } catch { return iso; } };

function BilanStat({ n, l, color }: { n: number | string; l: string; color: string }) {
  return (
    <View>
      <Text style={{ fontFamily: Fonts.display, fontSize: 30, color, lineHeight: 30 }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 }}>{l}</Text>
    </View>
  );
}

// Vue PLEIN ÉCRAN d'une publication (match / bilan / promotion / badge).
export function MomentOverlay({ event, myId, onReact, onComment, onClose, onPressActor }: {
  event: ActivityEvent | null;
  myId: string;
  onReact: () => void;
  onComment: () => void;
  onClose: () => void;
  onPressActor?: (playerId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  if (!event) return null;
  const isMatch = (event.type === 'match_win' || event.type === 'match_loss') && !!event.match;
  const fire = event.reactions?.['🔥'] ?? [];
  const liked = fire.includes(myId);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.bgDark, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 }}>
          <TouchableOpacity onPress={() => event.player_id && onPressActor?.(event.player_id)} disabled={!onPressActor || !event.player_id}
            activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            <Avatar name={event.actor?.name} size={40} radius={13} league={event.league} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15, color: '#FFFFFF' }}>{event.actor?.name ?? 'Joueur'}</Text>
              <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{fmtDate(event.created_at)}</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} hitSlop={12} style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 18, color: '#FFFFFF' }}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Contenu — centré, occupe l'écran */}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 20, gap: 16 }}>
          {isMatch ? (
            <MatchScoreCard m={matchToView(event.match!, event.player_id, false)} showActions={false} showDelta={false} />
          ) : event.type === 'promotion' ? (
            <View style={{ borderRadius: 20, padding: 28, alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
              <Text style={{ fontSize: 64 }}>🏆</Text>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.brand, letterSpacing: 1.5, textTransform: 'uppercase' }}>Montée en ligue</Text>
              <Text style={{ fontFamily: Fonts.welcome, fontSize: 30, color: '#FFFFFF', textAlign: 'center' }}>{event.payload.promo_label ?? 'Promotion'}</Text>
            </View>
          ) : event.type === 'bilan' ? (
            <View style={{ borderRadius: 20, padding: 24, gap: 16, backgroundColor: 'rgba(255,255,255,0.04)' }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.brand, letterSpacing: 1.5, textTransform: 'uppercase' }}>Bilan {event.payload.label ?? ''}</Text>
              <View style={{ flexDirection: 'row', gap: 22 }}>
                <BilanStat n={event.payload.matches ?? 0} l="matchs" color="#FFFFFF" />
                <BilanStat n={`${event.payload.winRate ?? 0}%`} l="winrate" color={Colors.brand} />
                <BilanStat n={`${(event.payload.levelDelta ?? 0) >= 0 ? '+' : ''}${(event.payload.levelDelta ?? 0).toFixed(2)}`} l="niveau" color={Colors.brand} />
              </View>
              {event.payload.topPartner ? <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Meilleur duo : {event.payload.topPartner}</Text> : null}
            </View>
          ) : (
            <View style={{ borderRadius: 20, padding: 28, alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,255,255,0.04)' }}>
              <BadgePill badge={event.payload.badge_label ?? ''} size={84} />
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.brand, letterSpacing: 1.5, textTransform: 'uppercase' }}>Badge débloqué</Text>
              <Text style={{ fontFamily: Fonts.welcome, fontSize: 30, color: '#FFFFFF', textAlign: 'center' }}>{event.payload.badge_label ?? 'Badge'}</Text>
            </View>
          )}

          {event.caption ? (
            <Text style={{ fontFamily: Fonts.ui, fontSize: 15, color: '#FFFFFF', lineHeight: 21, textAlign: 'center' }}>{event.caption}</Text>
          ) : null}
        </ScrollView>

        {/* Footer réactions */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
          <TouchableOpacity onPress={onReact} activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: liked ? 'rgba(255,193,26,0.18)' : 'rgba(255,255,255,0.08)' }}>
            <Text style={{ fontSize: 16 }}>🔥</Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: liked ? Colors.brand : '#FFFFFF' }}>{fire.length || ''}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onComment} activeOpacity={0.8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <Text style={{ fontSize: 16 }}>💬</Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#FFFFFF' }}>{event.comment_count || ''}</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={onComment} activeOpacity={0.85}
            style={{ borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11, backgroundColor: Colors.brand }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: Colors.primary }}>Commenter →</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
