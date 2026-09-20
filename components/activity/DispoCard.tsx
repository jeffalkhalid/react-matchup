// Carte « Dispos ce soir » — hub Activité, étape 1. Montre qui, dans mon
// cercle (mes amis — le mercato « joueurs de mon niveau » viendra à l'étape
// suivante), s'est déclaré libre sur le créneau le plus proche.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts, formatPadelLevel } from '../../lib/theme';
import { Icon } from '../community/icons';
import { Chip } from '../community/ui';
import { PlayerAvatar } from '../PlayerAvatar';
import { AMB, isAmbassador } from '../../lib/ambassador';
import { AmbassadorRing } from '../ambassador/primitives';
import { notifyPlayers } from '../../lib/notify';
import {
  availabilitySlots, isSlotActive, slotTitle, slotShortLabel, slotLabel, missingPlayers,
  fetchCircleAvailability, type AvailabilityRow, type Slot,
} from '../../lib/availability';

const CARD = { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 14 } as const;
const PREVIEW_ROWS = 2;

export function DispoCard({ playerId, playerName, playerAvatarPath, playerIsAmbassador, friendIds, mine, onToggleSlot }: {
  playerId: string;
  playerName: string;
  playerAvatarPath?: string | null;
  playerIsAmbassador?: boolean;
  friendIds: string[];
  /** Mes propres dispos (chargées par l'écran, pour les chips du header). */
  mine: Pick<AvailabilityRow, 'slot_start' | 'slot_end'>[];
  /** Coche/décoche un créneau — même geste que les chips du header. */
  onToggleSlot: (slot: Slot) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [circle, setCircle] = useState<AvailabilityRow[]>([]);

  // Le créneau affiché : le plus proche dans le temps, quel que soit celui
  // que le joueur a coché (voir captures 11/12 — la carte reste « Dispos ce
  // soir » même quand aucun chip n'est actif).
  const slot = availabilitySlots()[0];

  const load = useCallback(() => {
    setLoading(true);
    fetchCircleAvailability(friendIds, slot).then(rows => { setCircle(rows); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendIds.join(','), slot.key]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const iAmIn = isSlotActive(slot, mine);
  const othersCount = circle.length;
  const missing = missingPlayers(othersCount);
  const rows = [
    ...(iAmIn ? [{
      id: playerId, name: playerName, elo: null as number | null,
      avatarPath: playerAvatarPath ?? null, ambassador: !!playerIsAmbassador, isMe: true,
    }] : []),
    ...circle.map(r => ({
      id: r.player_id ?? r.id ?? r.player?.id ?? '', name: r.player?.name ?? 'Joueur',
      elo: r.player?.elo_score ?? null, avatarPath: r.player?.avatar_path ?? null,
      ambassador: isAmbassador(r.player), isMe: false,
    })),
  ].slice(0, PREVIEW_ROWS);

  const prevenirCercle = () => {
    if (friendIds.length === 0) return;
    notifyPlayers({
      playerIds: friendIds,
      title: `${playerName} cherche à jouer`,
      body: `Dispo ${slotShortLabel(slot)} — tape pour te déclarer aussi.`,
      data: { type: 'availability' },
    });
  };

  const calm = othersCount === 0 && !iAmIn;

  return (
    <View style={CARD}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: calm ? 12 : 10 }}>
        <Icon name="clock" size={15} color={Colors.textPrimary} stroke={2} />
        <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6, flexShrink: 1 }}>
          {slotTitle(slot)}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: 10 }} />
      ) : calm ? (
        <>
          <View style={{ flexDirection: 'row' }}>
            {[0, 1, 2].map(i => (
              <View key={i} style={{
                width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0EEEC',
                marginLeft: i > 0 ? -10 : 0, borderWidth: 2, borderColor: '#FFFFFF',
              }} />
            ))}
          </View>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13.5, color: Colors.textPrimary, marginTop: 10 }}>
            Personne ne s'est encore déclaré
          </Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 }}>
            Dis quand tu es libre : tes amis le voient tout de suite. C'est comme ça que les parties se montent.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -14, marginTop: 12 }}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
          >
            {availabilitySlots().map(s => (
              <Chip key={s.key} label={s.label} on={isSlotActive(s, mine)} onPress={() => onToggleSlot(s)} pill />
            ))}
          </ScrollView>
          <TouchableOpacity onPress={prevenirCercle} activeOpacity={0.85} disabled={friendIds.length === 0}
            style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10, opacity: friendIds.length === 0 ? 0.5 : 1 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: '#FFFFFF' }}>Prévenir mon cercle</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={{ gap: 12 }}>
            {rows.map(r => {
              const avatar = (
                <PlayerAvatar name={r.name} path={r.avatarPath} size={40} backgroundColor={Colors.brand} textColor={Colors.primary}
                  fontFamily={Fonts.uiBlack} fontSize={14} initialsMax={2} />
              );
              return (
              <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {r.ambassador ? <AmbassadorRing size={40} radius={20}>{avatar}</AmbassadorRing> : avatar}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: Colors.textPrimary, flexShrink: 1 }}>
                      {r.isMe ? 'Toi' : r.name.split(' ')[0]}
                    </Text>
                    {r.elo != null ? (
                      <View style={{ borderWidth: 1.5, borderColor: Colors.brand, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 }}>
                        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10.5, color: AMB.chipText }}>{formatPadelLevel(r.elo)}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textMuted, marginTop: 1 }}>{slotLabel(slot)}</Text>
                </View>
                <Text style={{ fontFamily: Fonts.uiBold, fontSize: 11, color: Colors.textMuted }}>à confirmer</Text>
              </View>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 10 }}>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 12, color: Colors.textSecondary }}>
              {othersCount} joueur{othersCount > 1 ? 's' : ''} dispo{othersCount > 1 ? 's' : ''} {slotShortLabel(slot)}
            </Text>
            {othersCount > PREVIEW_ROWS ? (
              <TouchableOpacity onPress={() => router.push('/(tabs)/lobby' as any)} hitSlop={8}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: Colors.brandDeep, textDecorationLine: 'underline' }}>
                  Voir les {othersCount} →
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {missing > 0 ? (
            <View style={{ backgroundColor: '#F5F5F4', borderRadius: 999, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textMuted }}>
                Il manque {missing} joueur{missing > 1 ? 's' : ''}
              </Text>
            </View>
          ) : (
            <TouchableOpacity onPress={() => router.push('/(tabs)/lobby?create=1' as any)} activeOpacity={0.85}
              style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center' }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: '#FFFFFF' }}>
                Créer la partie · {slotShortLabel(slot)}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
