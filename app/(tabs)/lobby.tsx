import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, Alert, StyleSheet, Modal,
  Share, Linking,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Polyline, Rect } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { Colors, eloToLevel, padelLevelToElo, Fonts } from '../../lib/theme';
import { notifyPlayers } from '../../lib/notify';
import type { OpenGame, Match } from '../../types';
import GameDetailsSheet from './GameDetailsSheet';
import CreateWizard, { type WizardResult } from './CreateWizard';
import { Pill, pillAccent } from '../../components/Pill';

// ─── Local types ──────────────────────────────────────────────
type TabKey = 'explorer' | 'upcoming' | 'history';
type FilterMode = 'all' | 'urgent';
type TypeFilter = 'all' | 'competitive' | 'friendly' | 'challenge';
type RoleFilter = 'all' | 'playing' | 'creator' | 'pending';
type EloFit = 'fit' | 'close' | 'outside';

interface EnrichedGame extends OpenGame {
  is_creator?: boolean;
  my_status?: 'accepted' | 'pending' | 'invited' | 'waitlist';
  pending_count?: number;
}

// ─── Helpers ─────────────────────────────────────────────────
function getEloFit(game: OpenGame, myElo: number): EloFit {
  const min = game.min_elo ?? 0;
  const max = game.max_elo ?? 9999;
  if (myElo >= min && myElo <= max) return 'fit';
  const margin = Math.min(Math.abs(myElo - min), Math.abs(myElo - max));
  return margin <= 100 ? 'close' : 'outside';
}

function getGameType(game: OpenGame): 'challenge' | 'friendly' | 'competitive' {
  if (game.is_challenge) return 'challenge';
  if ((game.game_format as string) === 'friendly') return 'friendly';
  return 'competitive';
}

function fmtLevel(elo: number): string {
  return eloToLevel(elo).toFixed(1);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tom = new Date(); tom.setDate(today.getDate() + 1);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === today.toDateString()) return `Aujourd'hui · ${hh}h${mm}`;
  if (d.toDateString() === tom.toDateString()) return `Demain · ${hh}h${mm}`;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ` · ${hh}h${mm}`;
}

function hoursUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / 3600000);
}

// Raised by the eject_overlapping_candidatures DB trigger when the
// target player is already organizer of another match within ±4h.
function isCreatorConflict(error: unknown): boolean {
  const msg = (error as { message?: string } | null)?.message;
  return typeof msg === 'string' && msg.includes('CREATOR_CONFLICT');
}

// ─── Icons ───────────────────────────────────────────────────
const IconSearch = ({ size = 16, color = Colors.textMuted }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={11} cy={11} r={7} stroke={color} />
    <Path stroke={color} d="m20 20-3-3" />
  </Svg>
);
const IconPlus = ({ size = 18, color = Colors.textOnDark }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M12 5v14M5 12h14" />
  </Svg>
);

const IconPin = ({ size = 13, color = Colors.textSecondary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <Circle cx={12} cy={10} r={3} stroke={color} />
  </Svg>
);
const IconClock = ({ size = 12, color = Colors.textSecondary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={12} cy={12} r={9} stroke={color} />
    <Path stroke={color} d="M12 7v5l3 2" />
  </Svg>
);
const IconX = ({ size = 14, color = Colors.textSecondary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
const IconSwords = ({ size = 11, color = '#92400e' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Polyline stroke={color} points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" />
    <Line stroke={color} x1={13} y1={19} x2={19} y2={13} />
    <Line stroke={color} x1={16} y1={16} x2={20} y2={20} />
    <Line stroke={color} x1={19} y1={21} x2={21} y2={19} />
    <Polyline stroke={color} points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" />
    <Line stroke={color} x1={5} y1={14} x2={9} y2={18} />
    <Line stroke={color} x1={7} y1={17} x2={4} y2={20} />
    <Line stroke={color} x1={3} y1={19} x2={5} y2={21} />
  </Svg>
);
const IconFire = ({ size = 12, color = Colors.danger }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
    <Path fill={color} d="M12 2s4 5 4 9a4 4 0 1 1-8 0c0-1.5 1-3 1-3s-3 1-3 5a6 6 0 0 0 12 0c0-5-6-11-6-11Z" />
  </Svg>
);

// ─── Avatar ──────────────────────────────────────────────────
const AV_COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#84cc16', '#ec4899', '#8b5cf6'];
function hashColor(name: string): string {
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_COLORS[h % AV_COLORS.length];
}
function Avatar({ name, size = 28, ring }: { name: string; size?: number; ring?: string }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: Math.round(size * 0.3),
      backgroundColor: hashColor(name), alignItems: 'center', justifyContent: 'center',
      borderWidth: ring ? 2 : 0, borderColor: ring ?? 'transparent',
    }}>
      <Text style={{ color: Colors.textOnDark, fontSize: Math.round(size * 0.42), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

function TypePill({ game }: { game: OpenGame }) {
  const t = getGameType(game);
  if (t === 'challenge') return <Pill variant="brand" icon={<IconSwords size={11} color={pillAccent('brand')} />}>Défi</Pill>;
  if (t === 'friendly')  return <Pill variant="success">Amical</Pill>;
  return <Pill variant="ink">Compétitif</Pill>;
}

function EloFitPill({ fit }: { fit: EloFit }) {
  if (fit === 'fit')   return <Pill variant="success">✓ Mon niveau</Pill>;
  if (fit === 'close') return <Pill variant="warning">⚠ Limite</Pill>;
  return <Pill variant="danger">Hors niveau</Pill>;
}

// ─── ModePill ─────────────────────────────────────────────────
function ModePill({ active, onPress, icon, children }: {
  active: boolean; onPress: () => void;
  icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{
      flexDirection: 'row', alignItems: 'center', gap: 5,
      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
      backgroundColor: active ? Colors.primary : Colors.bgCard,
      borderWidth: active ? 0 : 1, borderColor: Colors.border,
      shadowColor: Colors.primary, shadowOpacity: active ? 0.25 : 0.04,
      shadowRadius: active ? 10 : 2, shadowOffset: { width: 0, height: 4 }, elevation: active ? 6 : 1,
    }}>
      {icon}
      <Text style={{
        color: active ? Colors.textOnDark : Colors.textSecondary,
        fontFamily: Fonts.uiExtraBold,
        fontSize: 13,
      }}>{children}</Text>
    </TouchableOpacity>
  );
}

// ─── TypeChip ─────────────────────────────────────────────────
function TypeChip({ active, onPress, children }: {
  active: boolean; onPress: () => void; children: React.ReactNode;
}) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
      backgroundColor: active ? 'rgba(255,193,26,0.14)' : Colors.bgCard,
      borderWidth: 1, borderColor: active ? Colors.brand : Colors.border,
    }}>
      <Text style={{
        color: active ? Colors.brandDeep : Colors.textSecondary,
        fontFamily: Fonts.uiExtraBold,
        fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase',
      }}>
        {children}
      </Text>
    </TouchableOpacity>
  );
}

// ─── Section ──────────────────────────────────────────────────
function Section({ title, count, color, children }: {
  title: string; count: number; color: string; children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <View style={{ width: 3, height: 14, backgroundColor: color, borderRadius: 2 }} />
        <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 1.5, textTransform: 'uppercase' }}>
          {title}
        </Text>
        <View style={{ backgroundColor: color + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
          <Text style={{ fontSize: 11, fontWeight: '900', color }}>{count}</Text>
        </View>
      </View>
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

// ─── Slot helpers (mirrors GameDetailsSheet) ─────────────────
const SIDE_TO_IDX: Record<string, number> = { A_GAU: 0, A_DRO: 1, B_GAU: 2, B_DRO: 3 };
const IDX_TO_SIDE: Record<number, string> = { 0: 'A_GAU', 1: 'A_DRO', 2: 'B_GAU', 3: 'B_DRO' };

function buildGameSlots(game: EnrichedGame, myId: string) {
  const slots: Array<{ id: string; name: string; isMe: boolean; isInvited?: boolean } | null> = [null, null, null, null];
  const creator = game.creator as { name?: string } | undefined;
  const creatorIdx = SIDE_TO_IDX[game.creator_side ?? 'A_GAU'] ?? 0;
  slots[creatorIdx] = { id: game.creator_id, name: creator?.name ?? '?', isMe: game.creator_id === myId };
  (game.participants ?? [])
    .filter((p: any) => (p.status === 'accepted' || p.status === 'invited') && p.player_id !== game.creator_id)
    .forEach((p: any) => {
      const sp = {
        id: p.player_id,
        name: p.player?.name ?? '?',
        isMe: p.player_id === myId,
        isInvited: p.status === 'invited',
      };
      const idx = SIDE_TO_IDX[p.team_side ?? ''];
      if (idx !== undefined && !slots[idx]) slots[idx] = sp;
      else { const free = slots.findIndex(s => s === null); if (free !== -1) slots[free] = sp; }
    });
  return slots;
}

// ─── Slot theme by game type ──────────────────────────────────
// Thème slot par type de jeu : Défi=brand jaune / Amical=success vert / Compétitif=ink noir doux.
// Aligné sur les variants de Pill (cohérence visuelle dans toute la card).
function getSlotTheme(game: OpenGame) {
  if (game.is_challenge) return { accent: Colors.brandDeep, bg: 'rgba(255,193,26,0.14)', border: 'rgba(255,193,26,0.55)' };
  if ((game.game_format as string) === 'friendly') return { accent: '#047857', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.45)' };
  return { accent: Colors.textPrimary, bg: Colors.bgCardAlt, border: Colors.border };
}

// ─── Inline slot grid ─────────────────────────────────────────
function InlineSlots({ game, playerId, onApply, onChangeSide, onCreatorChangeSide }: {
  game: EnrichedGame;
  playerId: string;
  onApply?: (gameId: string, side: string) => void;
  onChangeSide?: (participantId: string, side: string) => void;
  onCreatorChangeSide?: (gameId: string, side: string) => void;
}) {
  const slots = buildGameSlots(game, playerId);
  const st = getSlotTheme(game);
  const isCreator = game.creator_id === playerId;
  const myParticipant = (game.participants ?? []).find(
    (p: any) => p.player_id === playerId && p.status !== 'declined'
  ) as any;
  const isAccepted = myParticipant?.status === 'accepted';
  const alreadyIn = !!myParticipant;
  const isFull = slots.every(s => s !== null);

  const canJoin = !isCreator && !alreadyIn && !isFull && !!onApply;
  const canChange = !isFull && (isCreator ? !!onCreatorChangeSide : (isAccepted && !!onChangeSide));

  const renderSlot = (idx: number) => {
    const s = slots[idx];
    const side = IDX_TO_SIDE[idx];
    const posLabel = side.includes('GAU') ? 'G' : 'D';

    const SLOT_W = 52;
    const nameLabel = s ? (s.isMe ? 'Toi' : (s.name?.split(' ')[0] ?? '?')) : null;

    if (s) {
      return (
        <View key={idx} style={{ alignItems: 'center', gap: 2, width: SLOT_W, opacity: s.isInvited ? 0.45 : 1 }}>
          <Avatar name={s.name} size={30} ring={s.isMe ? Colors.warning : undefined} />
          <Text
            numberOfLines={1}
            style={{
              fontSize: 10, fontWeight: '800', maxWidth: SLOT_W,
              color: s.isMe ? Colors.warning : Colors.textPrimary,
            }}
          >
            {nameLabel}
          </Text>
          <Text style={{ fontSize: 7, fontWeight: '900', color: s.isInvited ? st.accent : Colors.textMuted, letterSpacing: 0.3 }}>
            {s.isInvited ? '⏳ Invité' : posLabel}
          </Text>
        </View>
      );
    }

    if (canJoin) {
      return (
        <TouchableOpacity key={idx} onPress={() => onApply!(game.id, side)}
          activeOpacity={0.7} style={{ alignItems: 'center', gap: 2, width: SLOT_W }}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <View style={{
            width: 30, height: 30, borderRadius: 999,
            borderWidth: 1.5, borderColor: st.border, borderStyle: 'dashed',
            backgroundColor: st.bg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: st.accent, fontSize: 17, fontWeight: '300', lineHeight: 19 }}>+</Text>
          </View>
          <Text style={{ fontSize: 10, fontWeight: '800', color: st.accent }}>Libre</Text>
          <Text style={{ fontSize: 7, fontWeight: '900', color: st.border, letterSpacing: 0.3 }}>{posLabel}</Text>
        </TouchableOpacity>
      );
    }

    if (canChange) {
      const handlePress = () => isCreator
        ? onCreatorChangeSide!(game.id, side)
        : onChangeSide!(myParticipant?.id, side);
      return (
        <TouchableOpacity key={idx} onPress={handlePress}
          activeOpacity={0.7} style={{ alignItems: 'center', gap: 2, width: SLOT_W }}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <View style={{
            width: 30, height: 30, borderRadius: 999,
            borderWidth: 1.5, borderColor: st.border, borderStyle: 'dashed',
            backgroundColor: st.bg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: st.accent, fontSize: 11, fontWeight: '900' }}>↔</Text>
          </View>
          <Text style={{ fontSize: 10, fontWeight: '800', color: st.accent }}>Changer</Text>
          <Text style={{ fontSize: 7, fontWeight: '900', color: st.border, letterSpacing: 0.3 }}>{posLabel}</Text>
        </TouchableOpacity>
      );
    }

    return (
      <View key={idx} style={{ alignItems: 'center', gap: 2, width: SLOT_W }}>
        <View style={{
          width: 30, height: 30, borderRadius: 999,
          borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
          backgroundColor: Colors.bg,
        }} />
        <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted }}>Libre</Text>
        <Text style={{ fontSize: 7, fontWeight: '900', color: Colors.border, letterSpacing: 0.3 }}>{posLabel}</Text>
      </View>
    );
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {renderSlot(0)}
        {renderSlot(1)}
      </View>
      <View style={{ width: 1, height: 22, backgroundColor: Colors.border }} />
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {renderSlot(2)}
        {renderSlot(3)}
      </View>
    </View>
  );
}

// ─── Avatar row ───────────────────────────────────────────────
function AvatarRow({ players, slots }: { players: Array<{ name: string }>; slots: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {players.map((p, i) => (
        <View key={i} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: players.length - i }}>
          <Avatar name={p.name} size={28} ring={Colors.bgCard} />
        </View>
      ))}
      {Array.from({ length: slots }).map((_, i) => (
        <View key={`s${i}`} style={{
          marginLeft: players.length === 0 && i === 0 ? 0 : -8, zIndex: 0,
          width: 28, height: 28, borderRadius: 8,
          borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed',
          backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center',
        }}>
          <IconPlus size={11} color={Colors.textMuted} />
        </View>
      ))}
    </View>
  );
}

// ─── Card styles (StyleSheet to bypass NativeWind JSX transforms) ─
const cs = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: Colors.bg, borderRadius: 12,
  },
});

// ─── Calendar + share actions ─────────────────────────────────
function openCalendar(game: EnrichedGame) {
  if (!game.match_date) return;
  const start = new Date(game.match_date);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const accepted = (game.participants ?? [])
    .filter(p => p.status === 'accepted')
    .map(p => (p.player as any)?.name).filter(Boolean).join(', ');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Match Padel – ${game.location ?? ''}`,
    dates: `${fmt(start)}/${fmt(end)}`,
    location: game.location ?? '',
    details: accepted ? `Joueurs : ${accepted}` : 'Match Padel',
  });
  Linking.openURL(`https://calendar.google.com/calendar/render?${params}`);
}

async function shareGame(game: EnrichedGame) {
  if (!game.match_date) return;
  const d = new Date(game.match_date);
  const dateStr = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const typeLabel = game.is_challenge ? 'Défi' : (game as any).game_format === 'friendly' ? 'Amical' : 'Compétitif';
  const minLv = fmtLevel(game.min_elo ?? 0);
  const maxLv = fmtLevel(game.max_elo ?? 1750);
  const spots = game.spots_available;
  const spotsText = spots === 0 ? 'Complet' : `${spots} place${spots > 1 ? 's' : ''} dispo`;
  const creatorObj = game.creator as any;
  const creatorLv = creatorObj ? ` (Niv. ${fmtLevel(creatorObj.elo_score ?? 1000)})` : '';
  const creatorLabel = `${creatorObj?.name ?? ''}${creatorLv}`;
  const others = (game.participants ?? [])
    .filter(p => p.status === 'accepted')
    .map(p => {
      const pl = p.player as any;
      const lv = pl ? ` (Niv. ${fmtLevel(pl.elo_score ?? 1000)})` : '';
      return `${pl?.name ?? ''}${lv}`;
    }).filter(Boolean);
  const playersLine = others.length ? `\n👥 ${others.join(', ')}` : '';
  const url = `https://matchup-padel.vercel.app/lobby?game=${game.id}`;
  const msg = `🎾 Match Padel – ${typeLabel}\n👤 Organisé par ${creatorLabel}${playersLine}\n📅 ${dateStr} à ${timeStr}\n📍 ${game.location ?? ''}\n📊 Niveau : ${minLv} – ${maxLv}\n🟢 ${spotsText}\n🔗 ${url}`;
  try { await Share.share({ message: msg }); } catch { /* cancelled */ }
}

// ─── Game Card ────────────────────────────────────────────────
function GameCard({ game, variant, myElo, playerId, onPress, onApply, onChangeSide, onCreatorChangeSide, hideActions, scorable, onScorePress, onAcceptInvitation, onDeclineInvitation }: {
  game: EnrichedGame; variant: 'explore' | 'upcoming' | 'history';
  myElo: number; playerId?: string; onPress: () => void;
  onApply?: (gameId: string, side: string) => void;
  onChangeSide?: (participantId: string, side: string) => void;
  onCreatorChangeSide?: (gameId: string, side: string) => void;
  hideActions?: boolean;
  scorable?: boolean;
  onScorePress?: () => void;
  onAcceptInvitation?: (participantId: string, gameId: string) => void;
  onDeclineInvitation?: (participantId: string, gameId: string) => void;
}) {
  const router = useRouter();
  const fit = getEloFit(game, myElo);
  const hoursLeft = game.match_date ? hoursUntil(game.match_date) : 0;
  const isUrgent = game.spots_available === 1 && hoursLeft > 0 && hoursLeft <= 6;
  const accepted = (game.participants ?? []).filter(p => p.status === 'accepted');
  const creatorObj = game.creator as { name: string } | undefined;
  const allPlayers: Array<{ name: string }> = [
    ...(creatorObj ? [creatorObj] : []),
    ...accepted.map(p => p.player as { name: string }).filter(Boolean),
  ];
  const levelRange = (game.min_elo || game.max_elo)
    ? `Niv. ${fmtLevel(game.min_elo ?? 0)}–${fmtLevel(game.max_elo ?? 9999)}`
    : null;

  const showInlineSlots = variant !== 'history' && !!playerId;
  const st = getSlotTheme(game);
  const stripColor = isUrgent ? Colors.danger : st.accent;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={cs.card}>
      <View style={{ height: 3, backgroundColor: stripColor }} />
      <View style={{ padding: 14 }}>
        {/* Pills row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            <TypePill game={game} />
            {isUrgent && <Pill variant="danger">🔥 {hoursLeft}h</Pill>}
            {(game as any).gender_pref === 'men'   && <Pill variant="info">♂ Hommes</Pill>}
            {(game as any).gender_pref === 'women' && <Pill variant="magenta">♀ Femmes</Pill>}
            {(game as any).gender_pref === 'mixed' && <Pill variant="neutral">⚧ Mixte</Pill>}
          </View>
          {variant === 'explore' && <EloFitPill fit={fit} />}
          {variant === 'upcoming' && game.my_status === 'pending' && (
            <Pill variant="warning">En attente</Pill>
          )}
          {variant === 'upcoming' && game.my_status === 'invited' && (
            <Pill variant="warning">{game.is_challenge ? '⚡ Défi reçu' : '✉️ Invité'}</Pill>
          )}
          {variant === 'upcoming' && game.my_status === 'accepted' && (
            <Pill variant="success">✓ Inscrit</Pill>
          )}
          {variant === 'upcoming' && (game.is_creator || game.my_status === 'accepted') && (game.pending_count ?? 0) > 0 && (
            <Pill variant="warning">
              {game.pending_count} demande{(game.pending_count ?? 0) > 1 ? 's' : ''}
            </Pill>
          )}
        </View>

        {game.location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <IconPin size={13} color={Colors.textSecondary} />
            <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, flex: 1 }} numberOfLines={1}>
              {game.location}
            </Text>
          </View>
        ) : null}

        {game.match_date ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 }}>
            <IconClock size={12} color={Colors.textSecondary} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textSecondary }}>{formatDate(game.match_date)}</Text>
          </View>
        ) : <View style={{ marginBottom: 10 }} />}

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          {showInlineSlots
            ? <InlineSlots game={game} playerId={playerId!}
                onApply={onApply}
                onChangeSide={onChangeSide}
                onCreatorChangeSide={onCreatorChangeSide} />
            : <AvatarRow players={allPlayers} slots={0} />
          }
          <View style={{ alignItems: 'flex-end' }}>
            {levelRange ? (
              <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textSecondary, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                {levelRange}
              </Text>
            ) : null}
            {variant !== 'history' && (
              <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                {game.spots_available === 0 ? 'Complet'
                  : `${game.spots_available} place${(game.spots_available ?? 0) > 1 ? 's' : ''} libre${(game.spots_available ?? 0) > 1 ? 's' : ''}`}
              </Text>
            )}
          </View>
        </View>

        {scorable && (
          <>
            <View style={{ height: 1, backgroundColor: Colors.bgCardAlt, marginTop: 10, marginBottom: 8 }} />
            <TouchableOpacity
              onPress={onScorePress ?? onPress}
              activeOpacity={0.8}
              style={{ backgroundColor: Colors.warning, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark, letterSpacing: 0.3 }}>🏆 Saisir le score</Text>
            </TouchableOpacity>
          </>
        )}
        {variant === 'upcoming' && game.my_status === 'invited' && playerId && onAcceptInvitation && onDeclineInvitation && (() => {
          const myPart = (game.participants ?? []).find((p: any) => p.player_id === playerId && p.status === 'invited');
          if (!myPart) return null;
          return (
            <>
              <View style={{ height: 1, backgroundColor: Colors.bgCardAlt, marginTop: 10, marginBottom: 8 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); onDeclineInvitation((myPart as any).id, game.id); }}
                  activeOpacity={0.8}
                  style={{ flex: 1, backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger, letterSpacing: 0.3 }}>Refuser</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); onAcceptInvitation((myPart as any).id, game.id); }}
                  activeOpacity={0.8}
                  style={{ flex: 1, backgroundColor: Colors.success, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark, letterSpacing: 0.3 }}>
                    {game.is_challenge ? '⚡ Relever le défi' : '✓ Accepter'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}
        {!hideActions && game.match_date && variant !== 'history' && (
          <>
            <View style={{ height: 1, backgroundColor: Colors.bgCardAlt, marginTop: 10, marginBottom: 8 }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {variant === 'upcoming' && (game.is_creator || game.my_status === 'accepted') && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); openCalendar(game); }}
                  style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgCardAlt, borderRadius: 8 }}
                  activeOpacity={0.7}
                  accessibilityLabel="Ajouter au calendrier"
                >
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={Colors.textSecondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <Line x1="16" y1="2" x2="16" y2="6" />
                    <Line x1="8" y1="2" x2="8" y2="6" />
                    <Line x1="3" y1="10" x2="21" y2="10" />
                  </Svg>
                </TouchableOpacity>
              )}
              {variant === 'upcoming' && (game.is_creator || game.my_status === 'accepted') && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); router.push(`/chat/${game.id}` as any); }}
                  style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgCardAlt, borderRadius: 8 }}
                  activeOpacity={0.7}
                  accessibilityLabel="Discussion"
                >
                  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={Colors.textSecondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </Svg>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); shareGame(game); }}
                style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgCardAlt, borderRadius: 8 }}
                activeOpacity={0.7}
                accessibilityLabel="Partager"
              >
                <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={Colors.textSecondary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <Path d="M16 6l-4-4-4 4" />
                  <Line x1="12" y1="2" x2="12" y2="15" />
                </Svg>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Badge fallback emojis ────────────────────────────────────
const BADGE_FALLBACK: Record<string, string> = {
  'MVP': '👑', 'La Bombe': '💥', 'Le Smash': '🎯', 'Le Phénix': '🔥',
  'Le Mur': '🧱', "L'Essuie-glace": '🏃', 'Roi du Filet': '🎾',
  'Le Cerveau': '🧠', 'Le Capitaine': '⭐',
  'Fair-Play': '🤝', 'Bonne Ambiance': '😄', '3e Mi-temps': '🍻', 'Ponctuel': '⏰',
  CANNON: '💥', SMASH: '🎯', COMEBACK: '🔥', WALL: '🧱',
};

// ─── Pending validation bottom sheet ──────────────────────────
function PendingValidationSheet({ matches, playerId, onClose, onValidated, onContest, onOpenVote }: {
  matches: Match[];
  playerId: string;
  onClose: () => void;
  onValidated: (matchId: string) => void;
  onContest: (matchId: string) => void;
  onOpenVote: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [validatedIds, setValidatedIds] = useState<Set<string>>(new Set());

  const visible = matches.filter(m => needsMyValidation(m, playerId) || validatedIds.has(m.id));

  const handleValidate = async (m: Match) => {
    if (validatingId) return;
    setValidatingId(m.id);
    const { error } = await supabase
      .from('matches')
      .update({ status: 'validated' })
      .eq('id', m.id);
    setValidatingId(null);
    if (error) { Alert.alert('Erreur', 'Impossible de valider ce match.'); return; }
    setValidatedIds(prev => new Set(prev).add(m.id));
    onValidated(m.id);
  };

  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' }}>
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Scores à valider</Text>
              <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textMuted, marginTop: 2 }}>
                Valide ou conteste les scores soumis par les autres joueurs
              </Text>
            </View>
            <TouchableOpacity onPress={onClose}
              style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: Colors.textSecondary, fontSize: 14, fontFamily: Fonts.uiBlack }}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
            showsVerticalScrollIndicator={false}
          >
            {visible.length === 0 ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <Text style={{ fontSize: 36, marginBottom: 8 }}>✅</Text>
                <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Tout est à jour</Text>
                <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textMuted, marginTop: 4 }}>
                  Aucun score en attente de ta validation
                </Text>
              </View>
            ) : visible.map(m => {
              const isValidated = validatedIds.has(m.id);
              const isValidating = validatingId === m.id;
              const won = m.winner_id === playerId || m.winner_id_2 === playerId;
              const winnerNames = [m.winner?.name, m.winner_2?.name].filter(Boolean).join(' & ') || '?';
              const loserNames  = [m.loser?.name,  m.loser_2?.name ].filter(Boolean).join(' & ') || '?';
              return (
                <View key={m.id} style={{
                  backgroundColor: isValidated ? 'rgba(16,185,129,0.06)' : Colors.bgCard,
                  borderWidth: 1, borderColor: isValidated ? 'rgba(16,185,129,0.45)' : Colors.border,
                  borderRadius: 14, padding: 14, marginBottom: 10,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Pill variant={isValidated ? 'success' : 'warning'}>
                        {isValidated ? '✓ Validé' : '⏳ En attente'}
                      </Pill>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted }}>
                        {won ? 'Victoire' : 'Défaite'}
                      </Text>
                    </View>
                    {m.score_text ? (
                      <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: won ? '#047857' : '#B91C1C' }}>
                        {m.score_text}
                      </Text>
                    ) : null}
                  </View>
                  <View style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: '#047857' }} numberOfLines={1}>
                      🏆 {winnerNames}
                    </Text>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, marginVertical: 2 }}>vs</Text>
                    <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textSecondary }} numberOfLines={1}>
                      {loserNames}
                    </Text>
                  </View>
                  {isValidated ? (
                    <TouchableOpacity
                      onPress={onOpenVote}
                      activeOpacity={0.85}
                      style={{
                        backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: 'rgba(99,102,241,0.45)',
                        borderRadius: 12, paddingVertical: 11, alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: '#4338ca' }}>🏅 Noter tes partenaires</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => handleValidate(m)}
                        disabled={isValidating}
                        activeOpacity={0.85}
                        style={{
                          flex: 1, backgroundColor: Colors.success, borderRadius: 12,
                          paddingVertical: 12, alignItems: 'center', opacity: isValidating ? 0.6 : 1,
                        }}
                      >
                        {isValidating
                          ? <ActivityIndicator color={Colors.textOnDark} />
                          : <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>✅ Valider</Text>}
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => { onContest(m.id); onClose(); }}
                        activeOpacity={0.85}
                        style={{
                          flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.50)',
                          borderRadius: 12, paddingVertical: 11, alignItems: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: '#B45309' }}>✏️ Contester</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Match detail sheet ───────────────────────────────────────
function MatchDetailSheet({ match, playerId, onClose, onValidated, onContest, onRematch }: {
  match: Match; playerId: string; onClose: () => void;
  onValidated?: (matchId: string) => void;
  onContest?: (matchId: string) => void;
  onRematch?: (matchId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [badges, setBadges] = useState<{ badge_type: string; giver: { name: string } | null }[]>([]);
  const [validating, setValidating] = useState(false);
  const needsValidation = needsMyValidation(match, playerId);

  const handleValidate = async () => {
    if (validating) return;
    setValidating(true);
    const { error } = await supabase
      .from('matches')
      .update({ status: 'validated' })
      .eq('id', match.id);
    setValidating(false);
    if (error) { Alert.alert('Erreur', 'Impossible de valider ce match.'); return; }
    onValidated?.(match.id);
  };

  useEffect(() => {
    supabase
      .from('reputation_votes')
      .select('badge_type, giver:giver_id(name)')
      .eq('match_id', match.id)
      .eq('receiver_id', playerId)
      .then(({ data }) => setBadges((data ?? []) as any));
  }, [match.id, playerId]);

  const won = match.winner_id === playerId || match.winner_id_2 === playerId;
  const myTeam = [match.winner, match.winner_2].filter(Boolean) as { name: string }[];
  const oppTeam = [match.loser, match.loser_2].filter(Boolean) as { name: string }[];
  const [teamA, teamB] = won ? [myTeam, oppTeam] : [oppTeam, myTeam];

  const date = new Date(match.created_at).toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  return (
    <Modal visible animationType="slide" transparent statusBarTranslucent>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={{ backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' }}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>

          {/* Result header */}
          <View style={{
            marginHorizontal: 20, marginTop: 8, marginBottom: 16,
            backgroundColor: won ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)',
            borderRadius: 16, padding: 16, alignItems: 'center',
          }}>
            <Text style={{ fontSize: 28 }}>{won ? '🏆' : '😤'}</Text>
            <Text style={{ fontSize: 20, fontFamily: Fonts.uiBlack, color: won ? '#047857' : '#B91C1C', marginTop: 4 }}>
              {won ? 'Victoire' : 'Défaite'}
            </Text>
            {match.score_text ? (
              <Text style={{ fontSize: 28, fontFamily: Fonts.uiBlack, color: won ? '#047857' : '#B91C1C', marginTop: 4, letterSpacing: 1 }}>
                {match.score_text}
              </Text>
            ) : null}
            <Text style={{ fontSize: 12, color: Colors.textMuted, fontWeight: '600', marginTop: 6, textTransform: 'capitalize' }}>{date}</Text>
          </View>

          {/* Teams */}
          <View style={{ flexDirection: 'row', marginHorizontal: 20, gap: 10, marginBottom: 16 }}>
            {[{ team: teamA, label: 'Ton équipe', color: won ? '#047857' : '#B91C1C', bg: won ? 'rgba(16,185,129,0.10)' : 'rgba(239,68,68,0.10)' },
              { team: teamB, label: 'Adversaires', color: Colors.textSecondary, bg: Colors.bg }].map(({ team, label, color, bg }) => (
              <View key={label} style={{ flex: 1, backgroundColor: bg, borderRadius: 14, padding: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{label}</Text>
                {team.map((p, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: i < team.length - 1 ? 6 : 0 }}>
                    <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color }}>{p.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textPrimary, flexShrink: 1 }} numberOfLines={1}>{p.name}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>

          {/* Badges received */}
          {badges.length > 0 && (
            <View style={{ marginHorizontal: 20 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Badges reçus
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {badges.map((b, i) => (
                  <View key={i} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: Colors.bgCardAlt, borderRadius: 20,
                    paddingHorizontal: 12, paddingVertical: 6,
                  }}>
                    <Text style={{ fontSize: 16 }}>{BADGE_FALLBACK[b.badge_type] ?? '🏅'}</Text>
                    <View>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.textPrimary }}>{b.badge_type}</Text>
                      {b.giver?.name ? (
                        <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600' }}>par {b.giver.name}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {match.status === 'validated' && onRematch && (
            <View style={{ marginHorizontal: 20, marginTop: 18 }}>
              <TouchableOpacity
                onPress={() => { onRematch(match.id); onClose(); }}
                activeOpacity={0.85}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14,
                  shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
                }}
              >
                <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark, letterSpacing: 0.3 }}>
                  🔄 Rejouer avec la même équipe
                </Text>
              </TouchableOpacity>
            </View>
          )}
          {needsValidation && (
            <View style={{ marginHorizontal: 20, marginTop: 18, gap: 8 }}>
              <View style={{
                backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.50)',
                borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14,
                flexDirection: 'row', alignItems: 'center', gap: 8,
              }}>
                <Text style={{ fontSize: 14 }}>⚠️</Text>
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: '#B45309', flex: 1 }}>
                  Ce score attend ta validation
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={handleValidate}
                  disabled={validating}
                  activeOpacity={0.85}
                  style={{
                    flex: 1, backgroundColor: Colors.success, borderRadius: 14,
                    paddingVertical: 14, alignItems: 'center', opacity: validating ? 0.6 : 1,
                  }}
                >
                  {validating
                    ? <ActivityIndicator color={Colors.textOnDark} />
                    : <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark, letterSpacing: 0.3 }}>✅ Valider</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { onContest?.(match.id); onClose(); }}
                  activeOpacity={0.85}
                  style={{
                    flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.50)',
                    borderRadius: 14, paddingVertical: 13, alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: '#B45309', letterSpacing: 0.3 }}>✏️ Contester</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Pending matches the player must validate: excludes scores submitted by the
// player or their partner (those count as the team's submission already).
function needsMyValidation(m: Match, playerId: string): boolean {
  if (m.status !== 'pending') return false;
  if (m.created_by === playerId) return false;
  const cb = m.created_by;
  if (
    (cb === m.winner_id   && m.winner_id_2 === playerId) ||
    (cb === m.winner_id_2 && m.winner_id   === playerId) ||
    (cb === m.loser_id    && m.loser_id_2  === playerId) ||
    (cb === m.loser_id_2  && m.loser_id    === playerId)
  ) return false;
  return true;
}

// ─── Match card (history) ─────────────────────────────────────
function MatchCard({ match, playerId, onPress, onRematch }: {
  match: Match;
  playerId: string;
  onPress: () => void;
  onRematch?: (matchId: string) => void;
}) {
  const won = match.winner_id === playerId || match.winner_id_2 === playerId;
  const winnerTeam = [match.winner, match.winner_2].filter(Boolean) as { name: string }[];
  const loserTeam  = [match.loser,  match.loser_2 ].filter(Boolean) as { name: string }[];
  const winnerNames = winnerTeam.map(p => p.name).join(' & ') || '?';
  const loserNames  = loserTeam .map(p => p.name).join(' & ') || '?';
  const canRematch = onRematch && match.status === 'validated';
  return (
    <TouchableOpacity style={[cs.card, { padding: 14 }]} onPress={onPress} activeOpacity={0.8}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pill variant={won ? 'success' : 'danger'}>
            {won ? 'Victoire' : 'Défaite'}
          </Pill>
          <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.textMuted }}>
            {new Date(match.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </Text>
        </View>
        {match.score_text ? (
          <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: won ? '#047857' : '#B91C1C' }}>
            {match.score_text}
          </Text>
        ) : null}
      </View>
      {(match.game?.location || match.game?.match_date) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          {match.game?.location ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 11 }}>📍</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }} numberOfLines={1}>{match.game.location}</Text>
            </View>
          ) : null}
          {match.game?.match_date ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ fontSize: 11 }}>🕒</Text>
              <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>
                {new Date(match.game.match_date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          ) : null}
        </View>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AvatarRow players={winnerTeam} slots={0} />
        <Text style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBlack, color: '#047857' }} numberOfLines={1}>
          {winnerNames}
        </Text>
      </View>
      <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, marginLeft: 6, marginVertical: 4 }}>vs</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AvatarRow players={loserTeam} slots={0} />
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: Colors.textSecondary }} numberOfLines={1}>
          {loserNames}
        </Text>
      </View>
      {canRematch && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation?.(); onRematch!(match.id); }}
          activeOpacity={0.85}
          style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            marginTop: 10, paddingVertical: 9, borderRadius: 10,
            backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border,
          }}
        >
          <Text style={{ fontSize: 13 }}>🔄</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, letterSpacing: 0.3 }}>
            Rejouer avec la même équipe
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── Empty state ──────────────────────────────────────────────
function EmptyState({ text, sub }: { text: string; sub?: string }) {
  return (
    <View style={{
      paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center',
      backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
      borderStyle: 'dashed', borderRadius: 18,
    }}>
      <Text style={{ fontSize: 32, marginBottom: 8 }}>🎾</Text>
      <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary, fontSize: 14, textAlign: 'center' }}>{text}</Text>
      {sub ? <Text style={{ color: Colors.textMuted, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 4 }}>{sub}</Text> : null}
    </View>
  );
}

// ─── Explorer tab ─────────────────────────────────────────────
function ExploreTab({ games, myElo, filterMode, setFilterMode, typeFilter, setTypeFilter, search, setSearch, onOpenGame, playerId, onApply, onChangeSide, onCreatorChangeSide }: {
  games: EnrichedGame[]; myElo: number;
  filterMode: FilterMode; setFilterMode: (v: FilterMode) => void;
  typeFilter: TypeFilter; setTypeFilter: (v: TypeFilter) => void;
  search: string; setSearch: (v: string) => void; onOpenGame: (g: EnrichedGame) => void;
  playerId: string;
  onApply: (gameId: string, side: string) => void;
  onChangeSide: (participantId: string, side: string) => void;
  onCreatorChangeSide: (gameId: string, side: string) => void;
}) {
  const filtered = useMemo(() => {
    let arr = [...games];
    if (filterMode === 'urgent') arr = arr.filter(g => {
      const h = g.match_date ? hoursUntil(g.match_date) : 0;
      return g.spots_available === 1 && h > 0 && h <= 6;
    });
    if (typeFilter !== 'all') arr = arr.filter(g => getGameType(g) === typeFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      arr = arr.filter(g =>
        (g.location ?? '').toLowerCase().includes(q) ||
        ((g.creator as any)?.name ?? '').toLowerCase().includes(q)
      );
    }
    return arr;
  }, [games, filterMode, typeFilter, search, myElo]);

  const recommended = useMemo(() => games.filter(g => getEloFit(g, myElo) === 'fit'), [games, myElo]);
  const urgentCount = useMemo(() => games.filter(g => {
    const h = g.match_date ? hoursUntil(g.match_date) : 0;
    return g.spots_available === 1 && h > 0 && h <= 6;
  }).length, [games]);

  const countLabel = filterMode === 'urgent' ? `urgente${filtered.length > 1 ? 's' : ''}`
    : `disponible${filtered.length > 1 ? 's' : ''}`;

  return (
    <View style={{ paddingBottom: 100 }}>
      {/* Search bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14,
        marginTop: 12, marginBottom: 2, backgroundColor: Colors.bgCard, borderRadius: 12,
        borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 9,
      }}>
        <IconSearch size={16} color={Colors.textMuted} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Rechercher un club, un joueur…"
          placeholderTextColor={Colors.textMuted}
          style={{ flex: 1, fontSize: 13, color: Colors.textPrimary }}
        />
      </View>

      {/* Mode pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
        <ModePill active={filterMode === 'all'} onPress={() => setFilterMode('all')}>Toutes</ModePill>
        <ModePill active={filterMode === 'urgent'} onPress={() => setFilterMode('urgent')}
          icon={<IconFire size={12} color={filterMode === 'urgent' ? Colors.textOnDark : Colors.danger} />}>
          {urgentCount > 0 ? `Urgent (${urgentCount})` : 'Urgent'}
        </ModePill>
      </ScrollView>

      {/* Type chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
        <TypeChip active={typeFilter === 'all'} onPress={() => setTypeFilter('all')}>Tous</TypeChip>
        <TypeChip active={typeFilter === 'competitive'} onPress={() => setTypeFilter('competitive')}>Compétitif</TypeChip>
        <TypeChip active={typeFilter === 'friendly'} onPress={() => setTypeFilter('friendly')}>Amical</TypeChip>
        <TypeChip active={typeFilter === 'challenge'} onPress={() => setTypeFilter('challenge')}>Défi</TypeChip>
      </ScrollView>

      {/* "Pour toi" horizontal scroll */}
      {filterMode === 'all' && recommended.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={{
            fontSize: 11, fontWeight: '900', color: Colors.success,
            letterSpacing: 1.5, textTransform: 'uppercase',
            paddingHorizontal: 14, marginBottom: 8,
          }}>
            ✨ Pour toi · {recommended.length}
          </Text>
          <View style={{ paddingHorizontal: 14, gap: 10 }}>
            {recommended.map(g => (
              <GameCard key={g.id} game={g} variant="explore" myElo={myElo} playerId={playerId}
                onApply={onApply} onChangeSide={onChangeSide} onCreatorChangeSide={onCreatorChangeSide}
                onPress={() => onOpenGame(g)} />
            ))}
          </View>
        </View>
      )}

      {/* Main list */}
      <View style={{ paddingHorizontal: 14 }}>
        <Text style={{
          fontSize: 11, fontWeight: '900', color: Colors.textSecondary,
          letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8,
        }}>
          {filtered.length} partie{filtered.length > 1 ? 's' : ''} {countLabel}
        </Text>
        {filtered.length === 0
          ? <EmptyState text="Aucune partie ne correspond" sub="Essaie de réinitialiser les filtres ou crée la tienne" />
          : <View style={{ gap: 10 }}>
              {filtered.map(g => (
                <GameCard key={g.id} game={g} variant="explore" myElo={myElo} playerId={playerId}
                  onApply={onApply} onChangeSide={onChangeSide} onCreatorChangeSide={onCreatorChangeSide}
                  onPress={() => onOpenGame(g)} />
              ))}
            </View>
        }
      </View>
    </View>
  );
}

// ─── Upcoming tab ─────────────────────────────────────────────
function UpcomingTab({ games, myElo, roleFilter, setRoleFilter, onOpenGame, playerId, onChangeSide, onCreatorChangeSide, onAcceptInvitation, onDeclineInvitation }: {
  games: EnrichedGame[]; myElo: number;
  roleFilter: RoleFilter; setRoleFilter: (v: RoleFilter) => void;
  onOpenGame: (g: EnrichedGame) => void;
  playerId: string;
  onChangeSide: (participantId: string, side: string) => void;
  onCreatorChangeSide: (gameId: string, side: string) => void;
  onAcceptInvitation: (participantId: string, gameId: string) => void;
  onDeclineInvitation: (participantId: string, gameId: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const byType = (g: EnrichedGame) => typeFilter === 'all' || getGameType(g) === typeFilter;

  const created = games.filter(g => g.is_creator).filter(byType);
  const accepted = games.filter(g => !g.is_creator && g.my_status === 'accepted').filter(byType);
  const invited  = games.filter(g => !g.is_creator && g.my_status === 'invited').filter(byType);
  const pending  = games.filter(g => !g.is_creator && g.my_status === 'pending').filter(byType);

  const showCreated = roleFilter === 'all' || roleFilter === 'creator' || roleFilter === 'playing';
  const showAccepted = roleFilter === 'all' || roleFilter === 'playing';
  const showInvited = roleFilter === 'all' || roleFilter === 'pending';
  const showPending = roleFilter === 'all' || roleFilter === 'pending';

  const cardProps = { playerId, onChangeSide, onCreatorChangeSide };

  return (
    <View style={{ padding: 14, paddingBottom: 100 }}>
      {/* Filtres masqués — à réactiver plus tard si besoin */}
      {/*
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 8 }}>
        {([
          { v: 'all', label: 'Tout' },
          { v: 'playing', label: 'Je joue' },
          { v: 'creator', label: "J'organise" },
          { v: 'pending', label: 'En attente' },
        ] as { v: RoleFilter; label: string }[]).map(o => (
          <TypeChip key={o.v} active={roleFilter === o.v} onPress={() => setRoleFilter(o.v)}>
            {o.label}
          </TypeChip>
        ))}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
        <TypeChip active={typeFilter === 'all'} onPress={() => setTypeFilter('all')}>Tous types</TypeChip>
        <TypeChip active={typeFilter === 'competitive'} onPress={() => setTypeFilter('competitive')}>Compétitif</TypeChip>
        <TypeChip active={typeFilter === 'friendly'} onPress={() => setTypeFilter('friendly')}>Amical</TypeChip>
        <TypeChip active={typeFilter === 'challenge'} onPress={() => setTypeFilter('challenge')}>Défi</TypeChip>
      </ScrollView>
      */}

      {showInvited && invited.length > 0 && (
        <Section title="À répondre" count={invited.length} color={Colors.brand}>
          {invited.map(g => (
            <GameCard
              key={g.id}
              game={g}
              variant="upcoming"
              myElo={myElo}
              playerId={playerId}
              onPress={() => onOpenGame(g)}
              onAcceptInvitation={onAcceptInvitation}
              onDeclineInvitation={onDeclineInvitation}
            />
          ))}
        </Section>
      )}
      {showCreated && created.length > 0 && (
        <Section title="J'organise" count={created.length} color={Colors.primary}>
          {created.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {showAccepted && accepted.length > 0 && (
        <Section title="Je joue" count={accepted.length} color={Colors.success}>
          {accepted.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {showPending && pending.length > 0 && (
        <Section title="En attente d'approbation" count={pending.length} color={Colors.warning}>
          {pending.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} />)}
        </Section>
      )}
      {created.length + accepted.length + invited.length + pending.length === 0 && (
        <EmptyState text="Aucune partie à venir" sub={typeFilter !== 'all' ? 'Aucun match de ce type' : 'Explore le lobby ou crée la tienne'} />
      )}
    </View>
  );
}

// ─── History tab ──────────────────────────────────────────────
function HistoryTab({ matches, playerId, onOpenMatch, pastCompleteGames, onOpenGame, onScoreGame, onRematch }: {
  matches: Match[]; playerId: string; onOpenMatch: (m: Match) => void;
  pastCompleteGames: EnrichedGame[]; onOpenGame: (g: EnrichedGame) => void;
  onScoreGame: (gameId: string) => void;
  onRematch: (matchId: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const byType = (m: Match) => {
    if (typeFilter === 'all') return true;
    if (typeFilter === 'challenge') return !!m.is_challenge;
    if (typeFilter === 'friendly') return (m.game_format as string) === 'friendly';
    return !m.is_challenge && (m.game_format as string) !== 'friendly';
  };

  const toScore = matches.filter(m => needsMyValidation(m, playerId)).filter(byType);
  const past = matches.filter(m => m.status === 'validated').filter(byType);

  return (
    <View style={{ padding: 14, paddingBottom: 100 }}>
      {/* Type chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
        <TypeChip active={typeFilter === 'all'} onPress={() => setTypeFilter('all')}>Tous types</TypeChip>
        <TypeChip active={typeFilter === 'competitive'} onPress={() => setTypeFilter('competitive')}>Compétitif</TypeChip>
        <TypeChip active={typeFilter === 'friendly'} onPress={() => setTypeFilter('friendly')}>Amical</TypeChip>
        <TypeChip active={typeFilter === 'challenge'} onPress={() => setTypeFilter('challenge')}>Défi</TypeChip>
      </ScrollView>

      {pastCompleteGames.length > 0 && (
        <Section title="À scorer" count={pastCompleteGames.length} color={Colors.warning}>
          {pastCompleteGames.map(g => (
            <GameCard key={g.id} game={g} variant="upcoming" myElo={0}
              playerId={playerId} hideActions scorable
              onPress={() => onOpenGame(g)}
              onScorePress={() => onScoreGame(g.id)} />
          ))}
        </Section>
      )}
      {toScore.length > 0 && (
        <Section title="Score à saisir" count={toScore.length} color={Colors.warning}>
          {toScore.map(m => <MatchCard key={m.id} match={m} playerId={playerId} onPress={() => onOpenMatch(m)} />)}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Matchs passés" count={past.length} color={Colors.textSecondary}>
          {past.map(m => <MatchCard key={m.id} match={m} playerId={playerId} onPress={() => onOpenMatch(m)} onRematch={onRematch} />)}
        </Section>
      )}
      {pastCompleteGames.length + toScore.length + past.length === 0 && (
        <EmptyState
          text={matches.length === 0 ? 'Aucun match joué encore' : 'Aucun match de ce type'}
          sub={matches.length === 0 ? 'Rejoins une partie depuis Explorer !' : undefined}
        />
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function LobbyScreen() {
  const { player } = usePlayer();
  const insets = useSafeAreaInsets();
  const { create, tab: tabParam, role: roleParam, challenge, 'with': withId, pname, pelo, pside, openValidation, gameId: gameIdParam, rematch: rematchParam } = useLocalSearchParams<{ create?: string; tab?: string; role?: string; challenge?: string; with?: string; pname?: string; pelo?: string; pside?: string; openValidation?: string; gameId?: string; rematch?: string }>();
  const router = useRouter();

  const [tab, setTab] = useState<TabKey>('explorer');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [search, setSearch] = useState('');

  const [games, setGames] = useState<EnrichedGame[]>([]);
  const [upcomingGames, setUpcomingGames] = useState<EnrichedGame[]>([]);
  const [pastCompleteGames, setPastCompleteGames] = useState<EnrichedGame[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const [openMatch, setOpenMatch] = useState<Match | null>(null);
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [challengeWith, setChallengeWith] = useState<{ id: string; name: string; elo_score: number; court_side?: string } | null>(null);
  const [rematchInvites, setRematchInvites] = useState<Partial<Record<'A1' | 'B0' | 'B1', { id: string; name: string; elo_score: number }>> | null>(null);
  const [rematchGameType, setRematchGameType] = useState<'Compétitif' | 'Amical' | 'Défi' | undefined>(undefined);

  // Derived: always reflects latest fetched data — no stale snapshots
  const openGame = useMemo(
    () => [...games, ...upcomingGames, ...pastCompleteGames].find(g => g.id === openGameId) ?? null,
    [openGameId, games, upcomingGames, pastCompleteGames],
  );

  const myElo = player?.elo_score ?? 1000;

  const fetchData = useCallback(async () => {
    if (!player) return;

    const GAME_SELECT = '*, creator:creator_id(id, name, elo_score, win_count, loss_count), participants:game_participants(id, player_id, status, team_side, approvals, player:player_id(id, name, elo_score, win_count, loss_count))';

    const [explorerRes, createdRes, matchesRes] = await Promise.all([
      supabase
        .from('open_games')
        .select(GAME_SELECT)
        .eq('status', 'open')
        .neq('creator_id', player.id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('open_games')
        .select(GAME_SELECT)
        .eq('creator_id', player.id)
        .in('status', ['open', 'closed'])
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('matches')
        .select('*, winner:winner_id(name), winner_2:winner_id_2(name), loser:loser_id(name), loser_2:loser_id_2(name), game:game_id(location, match_date)')
        .or(`winner_id.eq.${player.id},loser_id.eq.${player.id},winner_id_2.eq.${player.id},loser_id_2.eq.${player.id}`)
        .in('status', ['pending', 'validated'])
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const creatorGames: EnrichedGame[] = (createdRes.data ?? []).map((g: any) => ({
      ...g,
      is_creator: true,
      pending_count: (g.participants ?? []).filter((p: any) => p.status === 'pending').length,
    }));

    // Games where I'm a participant (not as creator) — all statuses except declined
    const { data: partEntries } = await supabase
      .from('game_participants')
      .select(`status, game:game_id(${GAME_SELECT})`)
      .eq('player_id', player.id)
      .in('status', ['accepted', 'pending', 'waitlist', 'invited']);

    const createdIds = new Set(creatorGames.map(g => g.id));
    const participantGames: EnrichedGame[] = (partEntries ?? [])
      .map((e: any) => ({ ...e.game, is_creator: false, my_status: e.status }))
      .filter((g: any) => g?.id && !createdIds.has(g.id));

    // Explorer: exclude games the player created or already applied to
    const alreadyInIds = new Set([
      ...creatorGames.map(g => g.id),
      ...participantGames.map(g => g.id),
    ]);
    const genderAllowed = (g: any) => {
      if (!g.gender_pref || g.gender_pref === 'mixed') return true;
      if (g.gender_pref === 'men')   return player.gender === 'male';
      if (g.gender_pref === 'women') return player.gender === 'female';
      return true;
    };
    const nowMs = Date.now();
    // Une partie "ouverte" dont la date de match est passée ne doit plus s'afficher dans l'explorer,
    // même si `cleanup_expired_games` n'a pas encore tourné côté DB.
    const notExpired = (g: any) => !g.match_date || new Date(g.match_date).getTime() >= nowMs;
    setGames((explorerRes.data ?? []).filter((g: any) => !alreadyInIds.has(g.id) && genderAllowed(g) && notExpired(g)) as EnrichedGame[]);

    const allUpcoming = [...creatorGames, ...participantGames];
    const now = new Date();
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const scoredGameIds = new Set(
      (matchesRes.data ?? []).map((m: any) => m.game_id).filter(Boolean) as string[]
    );
    // Mêmes critères que score-entry: la partie doit être full, ni close ni cancel,
    // et le joueur doit y avoir réellement joué (créateur ou accepté).
    const readyToScore = (g: EnrichedGame) => {
      if (!g.match_date) return false;
      const matchDate = new Date(g.match_date);
      if (matchDate >= now) return false;
      if (matchDate < fortyEightHoursAgo) return false;
      if (scoredGameIds.has(g.id)) return false;
      if ((g as any).status === 'closed' || (g as any).status === 'cancelled') return false;
      if (!g.is_creator && g.my_status !== 'accepted') return false;
      if (g.spots_available !== 0) return false;
      const acceptedCount = (g.participants ?? []).filter((p: any) => p.status === 'accepted').length;
      return 1 + acceptedCount >= 4;
    };

    setUpcomingGames(allUpcoming.filter(g =>
      (g as any).status !== 'cancelled' &&
      !readyToScore(g) &&
      (!g.match_date || new Date(g.match_date) >= now)
    ));
    setPastCompleteGames(allUpcoming.filter(readyToScore));
    setMatches((matchesRes.data ?? []) as Match[]);
    setLoading(false);
  }, [player]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  useEffect(() => {
    if (create === '1') {
      if (challenge === '1' && withId) {
        setChallengeWith({
          id: withId,
          name: decodeURIComponent(pname ?? ''),
          elo_score: Number(pelo ?? 0),
          court_side: pside || undefined,
        });
      }
      setShowCreate(true);
      router.setParams({ create: undefined, challenge: undefined, with: undefined, pname: undefined, pelo: undefined, pside: undefined });
    }
  }, [create]);

  useEffect(() => {
    if (tabParam === 'upcoming') {
      setTab('upcoming');
      if (roleParam === 'playing') setRoleFilter('playing');
      router.setParams({ tab: undefined, role: undefined });
    } else if (tabParam === 'history') {
      setTab('history');
      router.setParams({ tab: undefined });
    }
  }, [tabParam, roleParam]);

  // Auto-ouvre la sheet de validation quand on arrive depuis une notif "Score à valider".
  // Attend que `matches` soit chargé pour éviter d'ouvrir sur un état vide qui se fermerait juste après.
  useEffect(() => {
    if (openValidation === '1' && !loading && matches.length > 0) {
      setPendingSheetOpen(true);
      router.setParams({ openValidation: undefined });
    }
  }, [openValidation, loading, matches.length]);

  // Auto-ouvre le GameDetailsSheet quand on arrive depuis une notif (lien invitation / défi).
  useEffect(() => {
    if (!gameIdParam || loading) return;
    const found = [...games, ...upcomingGames, ...pastCompleteGames].find(g => g.id === gameIdParam);
    if (found) {
      setTab('upcoming');
      setOpenGameId(gameIdParam);
      router.setParams({ gameId: undefined });
    }
  }, [gameIdParam, loading, games, upcomingGames, pastCompleteGames]);

  // Auto-ouvre le wizard de création quand on arrive avec ?rematch=<matchId> (depuis le profil).
  useEffect(() => {
    if (!rematchParam) return;
    handleRematch(rematchParam);
    router.setParams({ rematch: undefined });
  }, [rematchParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const handleApply = async (gameId: string, joinWaitlist: boolean, teamSide?: string) => {
    if (!player) return;
    const game = games.find(g => g.id === gameId) ?? upcomingGames.find(g => g.id === gameId);
    const eloFit = game ? getEloFit(game, myElo) : 'outside';
    const autoAccept = !joinWaitlist && eloFit === 'fit' && (game?.spots_available ?? 0) > 0;
    const newStatus = joinWaitlist || (game?.spots_available ?? 0) === 0
      ? 'waitlist'
      : autoAccept ? 'accepted' : 'pending';

    const { error } = await supabase.from('game_participants').insert({
      game_id: gameId,
      player_id: player.id,
      status: newStatus,
      ...(teamSide ? { team_side: teamSide } : {}),
    });
    if (error) {
      if (isCreatorConflict(error)) {
        Alert.alert(
          'Créneau déjà occupé',
          "Tu es l'organisateur·trice d'une autre partie au même créneau. Annule-la ou transfère-la d'abord.",
        );
      } else {
        Alert.alert('Erreur', error.message);
      }
      throw error;
    }

    if (newStatus === 'accepted' && game) {
      await supabase.from('open_games')
        .update({ spots_available: Math.max(0, (game.spots_available ?? 1) - 1) })
        .eq('id', gameId);
      const confirmedIds = [
        game.creator_id,
        ...(game.participants?.filter((p: any) => p.status === 'accepted').map((p: any) => p.player_id) ?? []),
      ].filter((id: string) => id !== player.id);
      if (confirmedIds.length > 0) {
        notifyPlayers({
          playerIds: confirmedIds,
          title: '✅ Nouveau joueur confirmé !',
          body: `${player.name} a rejoint la partie à ${game.location}.`,
          data: { type: 'lobby', gameId },
        });
      }
      Alert.alert('✅ Accepté !', 'Ton niveau correspond — tu es directement dans la partie !');
      setOpenGameId(null);
    } else if (newStatus === 'pending') {
      if (game?.creator_id) {
        notifyPlayers({
          playerIds: [game.creator_id],
          title: '📋 Nouvelle demande',
          body: `${player.name} veut rejoindre ta partie`,
          data: { type: 'lobby', gameId },
        });
      }
      Alert.alert('Demande envoyée !', 'Le créateur doit accepter ta demande.');
      setOpenGameId(null);
    }
    fetchData();
  };

  const handlePublish = async (data: WizardResult): Promise<string> => {
    if (!player) throw new Error('Not logged in');

    const matchDate = new Date(`${data.matchDate}T${data.matchTime}:00`);
    const matchDateIso = matchDate.toISOString();

    // ── Conflict pre-check (±4h window) — warn but allow override
    const OVERLAP_MS = 4 * 60 * 60 * 1000;
    const fromIso = new Date(matchDate.getTime() - OVERLAP_MS).toISOString();
    const toIso   = new Date(matchDate.getTime() + OVERLAP_MS).toISOString();

    const [{ data: myCreated }, { data: myJoined }] = await Promise.all([
      supabase.from('open_games')
        .select('id, location, match_date')
        .eq('creator_id', player.id)
        .neq('status', 'cancelled')
        .gte('match_date', fromIso)
        .lte('match_date', toIso),
      supabase.from('game_participants')
        .select('status, game:game_id(id, location, match_date, status)')
        .eq('player_id', player.id)
        .in('status', ['accepted', 'pending', 'invited', 'waitlist']),
    ]);

    const joinedConflicts = (myJoined ?? []).filter((p: any) => {
      const g = p.game;
      if (!g || g.status === 'cancelled') return false;
      if (!g.match_date) return false;
      const t = new Date(g.match_date).getTime();
      return Math.abs(t - matchDate.getTime()) <= OVERLAP_MS;
    });
    const totalConflicts = (myCreated?.length ?? 0) + joinedConflicts.length;

    if (totalConflicts > 0) {
      const fmt = (d: string) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const createdLines = (myCreated ?? []).map((g: any) => `• ${fmt(g.match_date)} — ${g.location ?? '?'}`);
      const joinedLines  = joinedConflicts.map((p: any) => {
        const statusLabel = p.status === 'accepted' ? 'inscrit' : p.status === 'invited' ? 'invité' : p.status === 'waitlist' ? "liste d'attente" : 'candidature';
        return `• ${fmt(p.game.match_date)} — ${p.game.location ?? '?'} (${statusLabel})`;
      });

      const nCreated = createdLines.length;
      const nJoined  = joinedLines.length;
      let body = '';

      if (nCreated > 0 && nJoined === 0) {
        // Pur conflit organisateur
        body =
          `Tu organises déjà ${nCreated > 1 ? `${nCreated} parties` : 'une partie'} au même créneau (±4h) :\n\n` +
          `${createdLines.join('\n')}\n\n` +
          `En publiant celle-ci, tu auras ${nCreated + 1} parties à gérer simultanément — tu devras en annuler une plus tard depuis sa fiche.`;
      } else if (nCreated === 0 && nJoined > 0) {
        // Pur conflit candidature/inscription
        body =
          `Tu es déjà engagé sur ${nJoined > 1 ? `${nJoined} parties` : 'une partie'} au même créneau (±4h) :\n\n` +
          `${joinedLines.join('\n')}\n\n` +
          `En publiant, ces engagements seront automatiquement retirés.`;
      } else {
        // Mixte
        body =
          `Tu as ${nCreated + nJoined} parties au même créneau (±4h) :\n\n` +
          `Tu organises :\n${createdLines.join('\n')}\n\n` +
          `Tu participes :\n${joinedLines.join('\n')}\n\n` +
          `En publiant, tes engagements seront retirés. Les parties que tu organises restent — à toi de les annuler si besoin.`;
      }

      const confirmed: boolean = await new Promise(resolve => {
        Alert.alert(
          '⚠️ Conflit de créneau',
          body,
          [
            { text: 'Annuler', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Publier quand même', style: 'destructive', onPress: () => resolve(true) },
          ],
        );
      });
      if (!confirmed) throw new Error('CONFLICT_CANCELLED');
    }

    const { data: game, error } = await supabase
      .from('open_games')
      .insert({
        creator_id: player.id,
        creator_side: data.creatorSide,
        game_format: data.gameType === 'Amical' ? 'friendly' : 'competitive',
        is_challenge: data.gameType === 'Défi',
        gender_pref: data.genre,
        match_date: matchDateIso,
        location: data.location,
        has_reservation: data.hasReservation,
        min_elo: padelLevelToElo(data.minLevel),
        max_elo: padelLevelToElo(data.maxLevel),
        status: 'open',
        spots_available: 3 - data.confirmedPlayers.length,
      })
      .select('id')
      .single();

    if (error || !game) { Alert.alert('Erreur', error?.message ?? 'Création échouée'); throw error; }

    const invites = data.confirmedPlayers.map(p => ({
      game_id: game.id,
      player_id: p.id,
      status: 'invited' as const,
      team_side: p.team_side ?? 'A_GAU',
    }));

    if (invites.length > 0) {
      await supabase.from('game_participants').insert(invites);
      const isChallenge = data.gameType === 'Défi';
      notifyPlayers({
        playerIds: invites.map(i => i.player_id),
        title: isChallenge ? '⚡ Tu as été défié !' : '⚡ Invitation reçue',
        body: isChallenge
          ? `${player.name} te défie en duel sur le padel`
          : `${player.name} t'invite à une partie de padel`,
        data: { type: 'lobby', gameId: game.id },
      });

      // Option B2 : tracer le défi dans `challenges` (lié au game_id) pour
      // l'afficher et le gérer (accept/decline) depuis l'onglet Matchmaking.
      if (isChallenge) {
        await supabase.from('challenges').insert(
          invites.map(i => ({
            challenger_id: player.id,
            challenged_id: i.player_id,
            game_id: game.id,
            status: 'pending' as const,
          })),
        );
      }
    }

    fetchData();
    return game.id;
  };

  const handleApprovePending = async (
    participantId: string,
    gameId: string,
    participantPlayerId: string,
    currentApprovals: string[],
  ) => {
    if (!player) return;
    if (currentApprovals.includes(player.id)) return;
    const newApprovals = [...currentApprovals, player.id];

    const game = upcomingGames.find(g => g.id === gameId) ?? games.find(g => g.id === gameId);

    // All current players (creator + accepted) must approve — same rule as the display in GameDetailsSheet
    const requiredApprovers = [
      game?.creator_id,
      ...(game?.participants?.filter((p: any) => p.status === 'accepted').map((p: any) => p.player_id) ?? []),
    ].filter((id): id is string => !!id && id !== participantPlayerId).slice(0, 3);
    const allApproved = requiredApprovers.every(id => newApprovals.includes(id));

    // If all approved, resolve which side to assign
    let assignedSide: string | null = null;
    if (allApproved && game) {
      const SIDE_ORDER = ['A_GAU', 'A_DRO', 'B_GAU', 'B_DRO'];
      const takenSides = new Set<string>([
        ...(game.creator_side ? [game.creator_side] : ['A_GAU']),
        ...(game.participants ?? [])
          .filter((p: any) => p.status === 'accepted' && p.id !== participantId)
          .map((p: any) => p.team_side)
          .filter(Boolean),
      ]);
      const preferred = (game.participants ?? []).find((p: any) => p.id === participantId)?.team_side ?? null;
      assignedSide = (preferred && !takenSides.has(preferred))
        ? preferred
        : SIDE_ORDER.find(s => !takenSides.has(s)) ?? null;
    }

    const { error } = await supabase
      .from('game_participants')
      .update({
        approvals: newApprovals,
        ...(allApproved ? { status: 'accepted', team_side: assignedSide } : {}),
      })
      .eq('id', participantId);

    if (error) {
      if (isCreatorConflict(error)) {
        Alert.alert(
          'Créneau déjà occupé',
          'Ce joueur organise une autre partie au même créneau — sa candidature ne peut pas être acceptée.',
        );
      } else {
        Alert.alert('Erreur', error.message);
      }
      return;
    }

    if (allApproved) {
      notifyPlayers({
        playerIds: [participantPlayerId],
        title: '✅ Candidature acceptée !',
        body: `Tu as été accepté dans la partie à ${game?.location ?? ''}.`,
        data: { type: 'lobby', gameId },
      });
      // Overlapping pending/invited/waitlist rows are auto-declined by the
      // eject_overlapping_candidatures DB trigger; notify-eject pushes the
      // "Candidature retirée" message to the affected player.
    }

    fetchData();
  };

  const handleChangeSide = async (participantId: string, side: string) => {
    const { error } = await supabase
      .from('game_participants')
      .update({ team_side: side })
      .eq('id', participantId);
    if (error) Alert.alert('Erreur', error.message);
    else fetchData();
  };

  const handleCreatorChangeSide = async (gameId: string, side: string) => {
    const { error } = await supabase
      .from('open_games')
      .update({ creator_side: side })
      .eq('id', gameId);
    if (error) Alert.alert('Erreur', error.message);
    else fetchData();
  };

  const handleLeaveGame = async (gameId: string, participantId: string, wasAccepted: boolean) => {
    const game = upcomingGames.find(g => g.id === gameId) ?? games.find(g => g.id === gameId);
    const isWaitlist = game?.participants?.find((p: any) => p.id === participantId)?.status === 'waitlist';
    const label = isWaitlist ? "Quitter la liste d'attente ?" : wasAccepted ? 'Quitter cette partie ?' : 'Retirer ta candidature ?';
    const msg   = isWaitlist ? 'Tu seras retiré de la liste.' : wasAccepted ? 'Ta place sera libérée.' : 'Ta demande sera annulée.';

    Alert.alert(label, msg, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Confirmer', style: 'destructive', onPress: async () => {
          await supabase.from('game_participants').delete().eq('id', participantId);

          if (wasAccepted && player) {
            // Remove this player's vote from all pending candidates
            const { data: pendingRows } = await supabase
              .from('game_participants')
              .select('id, approvals')
              .eq('game_id', gameId)
              .eq('status', 'pending');
            if (pendingRows && pendingRows.length > 0) {
              await Promise.all(
                pendingRows
                  .filter((p: any) => (p.approvals ?? []).includes(player.id))
                  .map((p: any) =>
                    supabase.from('game_participants')
                      .update({ approvals: (p.approvals as string[]).filter(id => id !== player.id) })
                      .eq('id', p.id)
                  )
              );
            }

            // Promote first waitlisted player if any
            const { data: nextUp } = await supabase
              .from('game_participants')
              .select('id, player_id, player:player_id(name)')
              .eq('game_id', gameId)
              .eq('status', 'waitlist')
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle();

            if (nextUp) {
              const takenSides = new Set<string>([
                ...(game?.creator_side ? [game.creator_side] : ['A_GAU']),
                ...(game?.participants ?? [])
                  .filter((p: any) => p.status === 'accepted' && p.id !== participantId)
                  .map((p: any) => p.team_side).filter(Boolean),
              ]);
              const promoSide = ['A_GAU', 'A_DRO', 'B_GAU', 'B_DRO'].find(s => !takenSides.has(s)) ?? null;
              await supabase.from('game_participants').update({
                status: 'accepted',
                ...(promoSide ? { team_side: promoSide } : {}),
              }).eq('id', nextUp.id);
              notifyPlayers({
                playerIds: [nextUp.player_id],
                title: '🎉 Place libérée — tu es accepté !',
                body: `Tu passes de la liste d'attente à confirmé !`,
                data: { type: 'lobby', gameId },
              });
            } else {
              const currentSpots = game?.spots_available ?? 0;
              await supabase.from('open_games')
                .update({ spots_available: currentSpots + 1, status: 'open' })
                .eq('id', gameId);
            }
          }

          fetchData();
        },
      },
    ]);
  };

  const handleDeclinePending = async (participantId: string) => {
    const { error } = await supabase
      .from('game_participants')
      .update({ status: 'declined' })
      .eq('id', participantId);

    if (error) Alert.alert('Erreur', error.message);
    else fetchData();
  };

  const handleCancelGame = async (gameId: string) => {
    if (!player) return;
    const game = upcomingGames.find(g => g.id === gameId) ?? games.find(g => g.id === gameId);
    if (!game || game.creator_id !== player.id) return;

    Alert.alert(
      'Annuler la partie ?',
      `Tous les joueurs inscrits, invités et candidats seront notifiés. Cette action est irréversible.`,
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Annuler la partie',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('open_games')
              .update({ status: 'cancelled' })
              .eq('id', gameId);
            if (error) { Alert.alert('Erreur', error.message); return; }

            const targetIds = (game.participants ?? [])
              .filter((p: any) => ['accepted', 'invited', 'pending', 'waitlist'].includes(p.status))
              .map((p: any) => p.player_id)
              .filter((id: string) => id && id !== player.id);

            if (targetIds.length > 0) {
              notifyPlayers({
                playerIds: targetIds,
                title: '❌ Partie annulée',
                body: `${player.name} a annulé la partie à ${game.location ?? ''}.`,
                data: { type: 'lobby', gameId },
              });
            }

            setOpenGameId(null);
            fetchData();
          },
        },
      ],
    );
  };

  const handleRematch = async (matchId: string) => {
    if (!player) return;
    const { data: m, error } = await supabase
      .from('matches')
      .select('winner_id, winner_id_2, loser_id, loser_id_2, game_format, is_challenge')
      .eq('id', matchId)
      .single();
    if (error || !m) { Alert.alert('Erreur', 'Impossible de charger ce match.'); return; }

    const wasWinner = m.winner_id === player.id || m.winner_id_2 === player.id;
    const myTeamIds  = wasWinner ? [m.winner_id, m.winner_id_2] : [m.loser_id, m.loser_id_2];
    const oppTeamIds = wasWinner ? [m.loser_id, m.loser_id_2]   : [m.winner_id, m.winner_id_2];
    const partnerId = myTeamIds.find((id: string | null) => id && id !== player.id) ?? null;
    const opp1Id = oppTeamIds[0] ?? null;
    const opp2Id = oppTeamIds[1] ?? null;

    const allIds = [partnerId, opp1Id, opp2Id].filter(Boolean) as string[];
    if (allIds.length === 0) { Alert.alert('Erreur', 'Aucun joueur à inviter pour rejouer.'); return; }

    const { data: players } = await supabase
      .from('players')
      .select('id, name, elo_score')
      .in('id', allIds);
    const byId = new Map((players ?? []).map((p: any) => [p.id, p]));

    const invites: Partial<Record<'A1' | 'B0' | 'B1', { id: string; name: string; elo_score: number }>> = {};
    if (partnerId && byId.has(partnerId)) invites.A1 = byId.get(partnerId);
    if (opp1Id && byId.has(opp1Id))       invites.B0 = byId.get(opp1Id);
    if (opp2Id && byId.has(opp2Id))       invites.B1 = byId.get(opp2Id);

    const gameType: 'Compétitif' | 'Amical' | 'Défi' = m.is_challenge
      ? 'Défi'
      : m.game_format === 'friendly' ? 'Amical' : 'Compétitif';

    setOpenMatch(null);
    setRematchInvites(invites);
    setRematchGameType(gameType);
    setShowCreate(true);
  };

  const handleAcceptInvitation = async (participantId: string, gameId: string) => {
    if (!player) return;
    const game = upcomingGames.find(g => g.id === gameId) ?? games.find(g => g.id === gameId);

    const { error } = await supabase
      .from('game_participants')
      .update({ status: 'accepted' })
      .eq('id', participantId);
    if (error) {
      if (isCreatorConflict(error)) {
        Alert.alert(
          'Créneau déjà occupé',
          "Tu es l'organisateur·trice d'une autre partie au même créneau. Annule-la ou transfère-la d'abord.",
        );
      } else {
        Alert.alert('Erreur', error.message);
      }
      return;
    }

    if (game?.creator_id) {
      const otherIds = [
        game.creator_id,
        ...(game.participants?.filter((p: any) => p.status === 'accepted').map((p: any) => p.player_id) ?? []),
      ].filter((id: string) => id !== player.id);
      if (otherIds.length > 0) {
        notifyPlayers({
          playerIds: otherIds,
          title: '✅ Nouveau joueur confirmé !',
          body: `${player.name} a rejoint la partie à ${game.location ?? ''}.`,
          data: { type: 'lobby', gameId },
        });
      }
    }
    fetchData();
  };

  const handleDeclineInvitation = async (participantId: string, gameId: string) => {
    if (!player) return;
    const game = upcomingGames.find(g => g.id === gameId) ?? games.find(g => g.id === gameId);

    const { error } = await supabase
      .from('game_participants')
      .update({ status: 'declined' })
      .eq('id', participantId);
    if (error) { Alert.alert('Erreur', error.message); return; }

    // Free the spot that was held by the invitation
    if (game) {
      await supabase.from('open_games')
        .update({ spots_available: Math.min(3, (game.spots_available ?? 0) + 1) })
        .eq('id', gameId);
      if (game.creator_id && game.creator_id !== player.id) {
        notifyPlayers({
          playerIds: [game.creator_id],
          title: '❌ Invitation refusée',
          body: `${player.name} a refusé ton invitation`,
          data: { type: 'lobby', gameId },
        });
      }
    }
    setOpenGameId(null);
    fetchData();
  };

  if (!player) return null;

  const upcomingBadge = upcomingGames.length;
  const scoresToValidate = matches.filter(m => needsMyValidation(m, player.id)).length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── Header ── */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>

        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <View>
            <Text style={{ fontSize: 26, fontFamily: Fonts.welcome, color: Colors.textOnDark, includeFontPadding: false }}>
              Le <Text style={{ color: Colors.brand }}>Lobby</Text>
            </Text>
            <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, marginTop: 2 }}>
              Niv. {fmtLevel(myElo)} · {games.length > 0
                ? `${games.length} partie${games.length > 1 ? 's' : ''} disponible${games.length > 1 ? 's' : ''}`
                : 'aucune partie disponible'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowCreate(true)}
            activeOpacity={0.85}
            style={{
              backgroundColor: Colors.brand, borderRadius: 16,
              paddingHorizontal: 14, paddingVertical: 10,
              shadowColor: Colors.brand, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
            }}
          >
            <Text style={{ color: Colors.textOnBrand, fontSize: 13, fontFamily: Fonts.uiBlack }}>➕ Créer</Text>
          </TouchableOpacity>
        </View>

        {/* Tabs — pill style */}
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 4, gap: 3 }}>
          {([
            { id: 'explorer',  label: 'Explorer',   count: games.length },
            { id: 'upcoming',  label: 'À venir',    count: upcomingBadge },
            { id: 'history',   label: 'Historique', count: pastCompleteGames.length },
          ] as { id: TabKey; label: string; count: number }[]).map(t => {
            const active = tab === t.id;
            return (
              <TouchableOpacity
                key={t.id} onPress={() => setTab(t.id)} activeOpacity={0.7}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                  backgroundColor: active ? Colors.bgCard : 'transparent',
                  borderRadius: 14, paddingVertical: 9,
                }}
              >
                <Text style={{ color: active ? Colors.textPrimary : 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: Fonts.uiBlack, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {t.label}
                </Text>
                {t.count > 0 && (
                  <View style={{ backgroundColor: active ? Colors.bgCardAlt : 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: active ? Colors.textSecondary : Colors.textOnDark, fontSize: 9, fontWeight: '900' }}>{t.count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Pending validation banner (history only) ── */}
      {!loading && tab === 'history' && scoresToValidate > 0 && (
        <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
          <TouchableOpacity
            onPress={() => setPendingSheetOpen(true)}
            activeOpacity={0.85}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              backgroundColor: '#F97316', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
              shadowColor: '#F97316', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
            }}
          >
            <Text style={{ fontSize: 13 }}>✍️</Text>
            <Text style={{ flex: 1, color: Colors.textOnDark, fontSize: 13, fontFamily: Fonts.uiBlack, letterSpacing: 0.2 }}>
              {scoresToValidate} score{scoresToValidate > 1 ? 's' : ''} à valider
            </Text>
            <Text style={{ color: '#FED7AA', fontSize: 14, fontFamily: Fonts.uiBlack }}>›</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Content ── */}
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ flex: 1 }} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {tab === 'explorer' && (
            <ExploreTab
              games={games} myElo={myElo}
              filterMode={filterMode} setFilterMode={setFilterMode}
              typeFilter={typeFilter} setTypeFilter={setTypeFilter}
              search={search} setSearch={setSearch} onOpenGame={(g) => setOpenGameId(g.id)}
              playerId={player.id}
              onApply={(gameId, side) => handleApply(gameId, false, side)}
              onChangeSide={handleChangeSide}
              onCreatorChangeSide={handleCreatorChangeSide}
            />
          )}
          {tab === 'upcoming' && (
            <UpcomingTab
              games={upcomingGames} myElo={myElo}
              roleFilter={roleFilter} setRoleFilter={setRoleFilter}
              onOpenGame={(g) => setOpenGameId(g.id)}
              playerId={player.id}
              onChangeSide={handleChangeSide}
              onCreatorChangeSide={handleCreatorChangeSide}
              onAcceptInvitation={handleAcceptInvitation}
              onDeclineInvitation={handleDeclineInvitation}
            />
          )}
          {tab === 'history' && (
            <HistoryTab matches={matches} playerId={player.id} onOpenMatch={setOpenMatch}
              pastCompleteGames={pastCompleteGames} onOpenGame={(g) => setOpenGameId(g.id)}
              onScoreGame={(gameId) => router.push(('/score-entry?gameId=' + gameId) as any)}
              onRematch={handleRematch} />
          )}
        </ScrollView>
      )}

      {/* ── FAB ── */}
      <TouchableOpacity
        onPress={() => setShowCreate(true)}
        activeOpacity={0.88}
        style={{
          position: 'absolute', right: 18, bottom: insets.bottom + 24, zIndex: 30,
          width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: Colors.primary, shadowOpacity: 0.45, shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 }, elevation: 10,
        }}
      >
        <IconPlus size={26} color={Colors.textOnDark} />
      </TouchableOpacity>

      {openGame && (
        <GameDetailsSheet
          game={openGame}
          myElo={myElo}
          playerId={player.id}
          onClose={() => setOpenGameId(null)}
          onApply={handleApply}
          onChangeSide={handleChangeSide}
          onCreatorChangeSide={handleCreatorChangeSide}
          onApprovePending={handleApprovePending}
          onDeclinePending={handleDeclinePending}
          onAcceptInvitation={handleAcceptInvitation}
          onDeclineInvitation={handleDeclineInvitation}
          onLeave={handleLeaveGame}
          onCancelGame={handleCancelGame}
        />
      )}

      <CreateWizard
        visible={showCreate}
        onClose={() => { setShowCreate(false); setChallengeWith(null); setRematchInvites(null); setRematchGameType(undefined); }}
        onPublish={handlePublish}
        player={player}
        initialGameType={rematchGameType ?? (challengeWith ? 'Défi' : undefined)}
        initialInvite={challengeWith ?? undefined}
        initialInvites={rematchInvites ?? undefined}
      />

      {openMatch && (
        <MatchDetailSheet
          match={openMatch}
          playerId={player.id}
          onClose={() => setOpenMatch(null)}
          onValidated={(matchId) => {
            setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'validated' } : m));
            setOpenMatch(prev => prev && prev.id === matchId ? { ...prev, status: 'validated' } : prev);
          }}
          onContest={(matchId) => {
            setOpenMatch(null);
            router.push((`/score-entry?matchId=${matchId}`) as any);
          }}
          onRematch={handleRematch}
        />
      )}

      {pendingSheetOpen && (
        <PendingValidationSheet
          matches={matches}
          playerId={player.id}
          onClose={() => setPendingSheetOpen(false)}
          onValidated={(matchId) => {
            setMatches(prev => prev.map(m => m.id === matchId ? { ...m, status: 'validated' } : m));
          }}
          onContest={(matchId) => {
            setPendingSheetOpen(false);
            router.push((`/score-entry?matchId=${matchId}`) as any);
          }}
          onOpenVote={() => {
            setPendingSheetOpen(false);
            router.push('/(tabs)?openBadge=1' as any);
          }}
        />
      )}
    </View>
  );
}
