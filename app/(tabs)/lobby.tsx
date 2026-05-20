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
import { Colors, eloToLevel, padelLevelToElo } from '../../lib/theme';
import { notifyPlayers } from '../../lib/notify';
import type { OpenGame, Match } from '../../types';
import GameDetailsSheet from './GameDetailsSheet';
import CreateWizard, { type WizardResult } from './CreateWizard';

// ─── Local types ──────────────────────────────────────────────
type TabKey = 'explorer' | 'upcoming' | 'history';
type FilterMode = 'all' | 'forme' | 'urgent';
type TypeFilter = 'all' | 'competitive' | 'friendly' | 'challenge';
type RoleFilter = 'all' | 'playing' | 'creator' | 'pending';
type EloFit = 'fit' | 'close' | 'outside';

interface EnrichedGame extends OpenGame {
  is_creator?: boolean;
  my_status?: 'accepted' | 'pending';
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

// ─── Icons ───────────────────────────────────────────────────
const IconSearch = ({ size = 16, color = '#94a3b8' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={11} cy={11} r={7} stroke={color} />
    <Path stroke={color} d="m20 20-3-3" />
  </Svg>
);
const IconPlus = ({ size = 18, color = '#fff' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M12 5v14M5 12h14" />
  </Svg>
);

const IconPin = ({ size = 13, color = '#64748b' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <Circle cx={12} cy={10} r={3} stroke={color} />
  </Svg>
);
const IconClock = ({ size = 12, color = '#64748b' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={12} cy={12} r={9} stroke={color} />
    <Path stroke={color} d="M12 7v5l3 2" />
  </Svg>
);
const IconX = ({ size = 14, color = '#475569' }) => (
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
const IconBolt = ({ size = 12, color = '#10b981' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill={color} stroke="none">
    <Path fill={color} d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  </Svg>
);
const IconFire = ({ size = 12, color = '#ef4444' }) => (
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
      <Text style={{ color: '#fff', fontSize: Math.round(size * 0.42), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ─── Pill ────────────────────────────────────────────────────
function Pill({ bg, fg, border, icon, children }: {
  bg: string; fg: string; border: string;
  icon?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 3,
      backgroundColor: bg, borderWidth: 1, borderColor: border,
      paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999,
    }}>
      {icon}
      <Text style={{ color: fg, fontSize: 10, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase' }}>
        {children}
      </Text>
    </View>
  );
}

function TypePill({ game }: { game: OpenGame }) {
  const t = getGameType(game);
  if (t === 'challenge') return <Pill bg="#fef3c7" fg="#92400e" border="#fcd34d" icon={<IconSwords size={11} color="#92400e" />}>Défi</Pill>;
  if (t === 'friendly') return <Pill bg="#f0fdf4" fg="#15803d" border="#86efac">Amical</Pill>;
  return <Pill bg="#eef2ff" fg="#3730a3" border="#c7d2fe">Compétitif</Pill>;
}

function EloFitPill({ fit }: { fit: EloFit }) {
  if (fit === 'fit') return <Pill bg="#ecfdf5" fg="#047857" border="#a7f3d0">✓ Mon niveau</Pill>;
  if (fit === 'close') return <Pill bg="#fffbeb" fg="#b45309" border="#fcd34d">⚠ Limite</Pill>;
  return <Pill bg="#fef2f2" fg="#b91c1c" border="#fecaca">Hors niveau</Pill>;
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
      backgroundColor: active ? '#0f172a' : '#fff',
      borderWidth: active ? 0 : 1, borderColor: '#e2e8f0',
      shadowColor: '#0f172a', shadowOpacity: active ? 0.25 : 0.04,
      shadowRadius: active ? 10 : 2, shadowOffset: { width: 0, height: 4 }, elevation: active ? 6 : 1,
    }}>
      {icon}
      <Text style={{ color: active ? '#fff' : '#475569', fontWeight: '800', fontSize: 13 }}>{children}</Text>
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
      backgroundColor: active ? '#eef2ff' : '#fff',
      borderWidth: 1, borderColor: active ? '#4f46e5' : '#e2e8f0',
    }}>
      <Text style={{
        color: active ? '#3730a3' : '#64748b',
        fontWeight: '800', fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase',
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
        <Text style={{ fontSize: 11, fontWeight: '900', color: '#0f172a', letterSpacing: 1.5, textTransform: 'uppercase' }}>
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
  const slots: Array<{ id: string; name: string; isMe: boolean } | null> = [null, null, null, null];
  const creator = game.creator as { name?: string } | undefined;
  const creatorIdx = SIDE_TO_IDX[game.creator_side ?? 'A_GAU'] ?? 0;
  slots[creatorIdx] = { id: game.creator_id, name: creator?.name ?? '?', isMe: game.creator_id === myId };
  (game.participants ?? [])
    .filter((p: any) => p.status === 'accepted' && p.player_id !== game.creator_id)
    .forEach((p: any) => {
      const sp = { id: p.player_id, name: p.player?.name ?? '?', isMe: p.player_id === myId };
      const idx = SIDE_TO_IDX[p.team_side ?? ''];
      if (idx !== undefined && !slots[idx]) slots[idx] = sp;
      else { const free = slots.findIndex(s => s === null); if (free !== -1) slots[free] = sp; }
    });
  return slots;
}

// ─── Slot theme by game type ──────────────────────────────────
function getSlotTheme(game: OpenGame) {
  if (game.is_challenge) return { accent: '#d97706', bg: '#fef3c7', border: '#fde68a' };
  if ((game.game_format as string) === 'friendly') return { accent: '#059669', bg: '#d1fae5', border: '#6ee7b7' };
  return { accent: '#4f46e5', bg: '#e0e7ff', border: '#c7d2fe' };
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

    if (s) {
      return (
        <View key={idx} style={{ alignItems: 'center', gap: 2 }}>
          <Avatar name={s.name} size={30} ring={s.isMe ? '#f59e0b' : undefined} />
          <Text style={{ fontSize: 7, fontWeight: '900', color: '#94a3b8', letterSpacing: 0.3 }}>{posLabel}</Text>
        </View>
      );
    }

    if (canJoin) {
      return (
        <TouchableOpacity key={idx} onPress={() => onApply!(game.id, side)}
          activeOpacity={0.7} style={{ alignItems: 'center', gap: 2 }}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <View style={{
            width: 30, height: 30, borderRadius: 999,
            borderWidth: 1.5, borderColor: st.border, borderStyle: 'dashed',
            backgroundColor: st.bg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: st.accent, fontSize: 17, fontWeight: '300', lineHeight: 19 }}>+</Text>
          </View>
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
          activeOpacity={0.7} style={{ alignItems: 'center', gap: 2 }}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <View style={{
            width: 30, height: 30, borderRadius: 999,
            borderWidth: 1.5, borderColor: st.border, borderStyle: 'dashed',
            backgroundColor: st.bg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: st.accent, fontSize: 11, fontWeight: '900' }}>↔</Text>
          </View>
          <Text style={{ fontSize: 7, fontWeight: '900', color: st.border, letterSpacing: 0.3 }}>{posLabel}</Text>
        </TouchableOpacity>
      );
    }

    return (
      <View key={idx} style={{ alignItems: 'center', gap: 2 }}>
        <View style={{
          width: 30, height: 30, borderRadius: 999,
          borderWidth: 1.5, borderColor: '#e2e8f0', borderStyle: 'dashed',
          backgroundColor: '#f8fafc',
        }} />
        <Text style={{ fontSize: 7, fontWeight: '900', color: '#cbd5e1', letterSpacing: 0.3 }}>{posLabel}</Text>
      </View>
    );
  };

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 5 }}>
        {renderSlot(0)}
        {renderSlot(1)}
      </View>
      <View style={{ width: 1, height: 22, backgroundColor: '#e2e8f0' }} />
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
          <Avatar name={p.name} size={28} ring="#fff" />
        </View>
      ))}
      {Array.from({ length: slots }).map((_, i) => (
        <View key={`s${i}`} style={{
          marginLeft: players.length === 0 && i === 0 ? 0 : -8, zIndex: 0,
          width: 28, height: 28, borderRadius: 8,
          borderWidth: 2, borderColor: '#cbd5e1', borderStyle: 'dashed',
          backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center',
        }}>
          <IconPlus size={11} color="#94a3b8" />
        </View>
      ))}
    </View>
  );
}

// ─── Card styles (StyleSheet to bypass NativeWind JSX transforms) ─
const cs = StyleSheet.create({
  card: {
    backgroundColor: '#fff', borderRadius: 18,
    borderWidth: 1, borderColor: '#e2e8f0', overflow: 'hidden',
    shadowColor: '#0f172a', shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#f8fafc', borderRadius: 12,
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
function GameCard({ game, variant, myElo, playerId, onPress, onApply, onChangeSide, onCreatorChangeSide, hideActions, scorable, onScorePress }: {
  game: EnrichedGame; variant: 'explore' | 'upcoming' | 'history';
  myElo: number; playerId?: string; onPress: () => void;
  onApply?: (gameId: string, side: string) => void;
  onChangeSide?: (participantId: string, side: string) => void;
  onCreatorChangeSide?: (gameId: string, side: string) => void;
  hideActions?: boolean;
  scorable?: boolean;
  onScorePress?: () => void;
}) {
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

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={cs.card}>
      {isUrgent && <View style={{ height: 3, backgroundColor: '#ef4444' }} />}
      <View style={{ padding: 14 }}>
        {/* Pills row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            <TypePill game={game} />
            {isUrgent && <Pill bg="#fef2f2" fg="#b91c1c" border="#fecaca">🔥 {hoursLeft}h</Pill>}
            {(game as any).gender_pref === 'men'   && <Pill bg="#eff6ff" fg="#1d4ed8" border="#bfdbfe">♂ Hommes</Pill>}
            {(game as any).gender_pref === 'women' && <Pill bg="#fdf4ff" fg="#7e22ce" border="#e9d5ff">♀ Femmes</Pill>}
            {(game as any).gender_pref === 'mixed' && <Pill bg="#f1f5f9" fg="#475569" border="#e2e8f0">⚧ Mixte</Pill>}
          </View>
          {variant === 'explore' && <EloFitPill fit={fit} />}
          {variant === 'upcoming' && game.my_status === 'pending' && (
            <Pill bg="#fffbeb" fg="#b45309" border="#fcd34d">En attente</Pill>
          )}
          {variant === 'upcoming' && game.my_status === 'accepted' && (
            <Pill bg="#ecfdf5" fg="#047857" border="#a7f3d0">✓ Inscrit</Pill>
          )}
          {variant === 'upcoming' && (game.is_creator || game.my_status === 'accepted') && (game.pending_count ?? 0) > 0 && (
            <Pill bg="#fffbeb" fg="#b45309" border="#fcd34d">
              {game.pending_count} demande{(game.pending_count ?? 0) > 1 ? 's' : ''}
            </Pill>
          )}
        </View>

        {game.location ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
            <IconPin size={13} color="#64748b" />
            <Text style={{ fontSize: 15, fontWeight: '900', color: '#0f172a', flex: 1 }} numberOfLines={1}>
              {game.location}
            </Text>
          </View>
        ) : null}

        {game.match_date ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 }}>
            <IconClock size={12} color="#64748b" />
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748b' }}>{formatDate(game.match_date)}</Text>
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
              <Text style={{ fontSize: 11, fontWeight: '900', color: '#64748b', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                {levelRange}
              </Text>
            ) : null}
            {variant !== 'history' && (
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.4, textTransform: 'uppercase' }}>
                {game.spots_available === 0 ? 'Complet'
                  : `${game.spots_available} place${(game.spots_available ?? 0) > 1 ? 's' : ''} libre${(game.spots_available ?? 0) > 1 ? 's' : ''}`}
              </Text>
            )}
          </View>
        </View>

        {scorable && (
          <>
            <View style={{ height: 1, backgroundColor: '#f1f5f9', marginTop: 10, marginBottom: 8 }} />
            <TouchableOpacity
              onPress={onScorePress ?? onPress}
              activeOpacity={0.8}
              style={{ backgroundColor: '#f59e0b', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}
            >
              <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff', letterSpacing: 0.3 }}>🏆 Saisir le score</Text>
            </TouchableOpacity>
          </>
        )}
        {!hideActions && game.match_date && variant !== 'history' && (
          <>
            <View style={{ height: 1, backgroundColor: '#f1f5f9', marginTop: 10, marginBottom: 8 }} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {variant === 'upcoming' && (game.is_creator || game.my_status === 'accepted') && (
                <TouchableOpacity
                  onPress={(e) => { e.stopPropagation?.(); openCalendar(game); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                  activeOpacity={0.7}
                >
                  <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <Line x1="16" y1="2" x2="16" y2="6" />
                    <Line x1="8" y1="2" x2="8" y2="6" />
                    <Line x1="3" y1="10" x2="21" y2="10" />
                  </Svg>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Calendrier</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); shareGame(game); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
                activeOpacity={0.7}
              >
                <Svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <Path d="M16 6l-4-4-4 4" />
                  <Line x1="12" y1="2" x2="12" y2="15" />
                </Svg>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#475569' }}>Partager</Text>
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

// ─── Match detail sheet ───────────────────────────────────────
function MatchDetailSheet({ match, playerId, onClose }: {
  match: Match; playerId: string; onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [badges, setBadges] = useState<{ badge_type: string; giver: { name: string } | null }[]>([]);

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
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' }}>
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0' }} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>

          {/* Result header */}
          <View style={{
            marginHorizontal: 20, marginTop: 8, marginBottom: 16,
            backgroundColor: won ? '#ecfdf5' : '#fef2f2',
            borderRadius: 16, padding: 16, alignItems: 'center',
          }}>
            <Text style={{ fontSize: 28 }}>{won ? '🏆' : '😤'}</Text>
            <Text style={{ fontSize: 20, fontWeight: '900', color: won ? '#047857' : '#b91c1c', marginTop: 4 }}>
              {won ? 'Victoire' : 'Défaite'}
            </Text>
            {match.score_text ? (
              <Text style={{ fontSize: 28, fontWeight: '900', color: won ? '#047857' : '#b91c1c', marginTop: 4, letterSpacing: 1 }}>
                {match.score_text}
              </Text>
            ) : null}
            <Text style={{ fontSize: 12, color: '#94a3b8', fontWeight: '600', marginTop: 6, textTransform: 'capitalize' }}>{date}</Text>
          </View>

          {/* Teams */}
          <View style={{ flexDirection: 'row', marginHorizontal: 20, gap: 10, marginBottom: 16 }}>
            {[{ team: teamA, label: 'Ton équipe', color: won ? '#047857' : '#b91c1c', bg: won ? '#ecfdf5' : '#fef2f2' },
              { team: teamB, label: 'Adversaires', color: '#475569', bg: '#f8fafc' }].map(({ team, label, color, bg }) => (
              <View key={label} style={{ flex: 1, backgroundColor: bg, borderRadius: 14, padding: 12 }}>
                <Text style={{ fontSize: 10, fontWeight: '800', color, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{label}</Text>
                {team.map((p, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: i < team.length - 1 ? 6 : 0 }}>
                    <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color }}>{p.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a', flexShrink: 1 }} numberOfLines={1}>{p.name}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>

          {/* Badges received */}
          {badges.length > 0 && (
            <View style={{ marginHorizontal: 20 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                Badges reçus
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {badges.map((b, i) => (
                  <View key={i} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: '#f1f5f9', borderRadius: 20,
                    paddingHorizontal: 12, paddingVertical: 6,
                  }}>
                    <Text style={{ fontSize: 16 }}>{BADGE_FALLBACK[b.badge_type] ?? '🏅'}</Text>
                    <View>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: '#0f172a' }}>{b.badge_type}</Text>
                      {b.giver?.name ? (
                        <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>par {b.giver.name}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Match card (history) ─────────────────────────────────────
function MatchCard({ match, playerId, onPress }: { match: Match; playerId: string; onPress: () => void }) {
  const won = match.winner_id === playerId || match.winner_id_2 === playerId;
  const allPlayers = [
    ...[match.winner, match.winner_2].filter(Boolean) as { name: string }[],
    ...[match.loser, match.loser_2].filter(Boolean) as { name: string }[],
  ];
  return (
    <TouchableOpacity style={[cs.card, { padding: 14 }]} onPress={onPress} activeOpacity={0.8}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Pill bg={won ? '#ecfdf5' : '#fef2f2'} fg={won ? '#047857' : '#b91c1c'} border={won ? '#a7f3d0' : '#fecaca'}>
          {won ? 'Victoire' : 'Défaite'}
        </Pill>
        {match.score_text ? (
          <Text style={{ fontSize: 14, fontWeight: '900', color: won ? '#047857' : '#b91c1c' }}>
            {match.score_text}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AvatarRow players={allPlayers} slots={0} />
        <Text style={{ fontSize: 11, fontWeight: '600', color: '#94a3b8' }}>
          {new Date(match.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Empty state ──────────────────────────────────────────────
function EmptyState({ text, sub }: { text: string; sub?: string }) {
  return (
    <View style={{
      paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center',
      backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0',
      borderStyle: 'dashed', borderRadius: 18,
    }}>
      <Text style={{ fontSize: 32, marginBottom: 8 }}>🎾</Text>
      <Text style={{ fontWeight: '900', color: '#0f172a', fontSize: 14, textAlign: 'center' }}>{text}</Text>
      {sub ? <Text style={{ color: '#94a3b8', fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 4 }}>{sub}</Text> : null}
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
    if (filterMode === 'forme') arr = arr.filter(g => getEloFit(g, myElo) !== 'outside');
    else if (filterMode === 'urgent') arr = arr.filter(g => {
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

  const countLabel = filterMode === 'forme' ? 'à ton niveau'
    : filterMode === 'urgent' ? `urgente${filtered.length > 1 ? 's' : ''}`
    : `disponible${filtered.length > 1 ? 's' : ''}`;

  return (
    <View style={{ paddingBottom: 100 }}>
      {/* Search bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14,
        marginTop: 12, marginBottom: 2, backgroundColor: '#fff', borderRadius: 12,
        borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, paddingVertical: 9,
      }}>
        <IconSearch size={16} color="#94a3b8" />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Rechercher un club, un joueur…"
          placeholderTextColor="#94a3b8"
          style={{ flex: 1, fontSize: 13, color: '#0f172a' }}
        />
      </View>

      {/* Mode pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
        <ModePill active={filterMode === 'all'} onPress={() => setFilterMode('all')}>Toutes</ModePill>
        <ModePill active={filterMode === 'forme'} onPress={() => setFilterMode('forme')}
          icon={<IconBolt size={12} color={filterMode === 'forme' ? '#fff' : '#10b981'} />}>
          En forme
        </ModePill>
        <ModePill active={filterMode === 'urgent'} onPress={() => setFilterMode('urgent')}
          icon={<IconFire size={12} color={filterMode === 'urgent' ? '#fff' : '#ef4444'} />}>
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
            fontSize: 11, fontWeight: '900', color: '#047857',
            letterSpacing: 1.5, textTransform: 'uppercase',
            paddingHorizontal: 14, marginBottom: 8,
          }}>
            ✨ Pour toi · {recommended.length}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 6, gap: 10 }}>
            {recommended.map(g => (
              <View key={g.id} style={{ width: 268 }}>
                <GameCard game={g} variant="explore" myElo={myElo} playerId={playerId}
                  onApply={onApply} onChangeSide={onChangeSide} onCreatorChangeSide={onCreatorChangeSide}
                  onPress={() => onOpenGame(g)} />
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Main list */}
      <View style={{ paddingHorizontal: 14 }}>
        <Text style={{
          fontSize: 11, fontWeight: '900', color: '#64748b',
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
function UpcomingTab({ games, myElo, roleFilter, setRoleFilter, onOpenGame, playerId, onChangeSide, onCreatorChangeSide }: {
  games: EnrichedGame[]; myElo: number;
  roleFilter: RoleFilter; setRoleFilter: (v: RoleFilter) => void;
  onOpenGame: (g: EnrichedGame) => void;
  playerId: string;
  onChangeSide: (participantId: string, side: string) => void;
  onCreatorChangeSide: (gameId: string, side: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const byType = (g: EnrichedGame) => typeFilter === 'all' || getGameType(g) === typeFilter;

  const created = games.filter(g => g.is_creator).filter(byType);
  const accepted = games.filter(g => !g.is_creator && g.my_status === 'accepted').filter(byType);
  const pending = games.filter(g => !g.is_creator && g.my_status === 'pending').filter(byType);

  const showCreated = roleFilter === 'all' || roleFilter === 'creator' || roleFilter === 'playing';
  const showAccepted = roleFilter === 'all' || roleFilter === 'playing';
  const showPending = roleFilter === 'all' || roleFilter === 'pending';

  const cardProps = { playerId, onChangeSide, onCreatorChangeSide };

  return (
    <View style={{ padding: 14, paddingBottom: 100 }}>
      {/* Role chips */}
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

      {/* Type chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
        <TypeChip active={typeFilter === 'all'} onPress={() => setTypeFilter('all')}>Tous types</TypeChip>
        <TypeChip active={typeFilter === 'competitive'} onPress={() => setTypeFilter('competitive')}>Compétitif</TypeChip>
        <TypeChip active={typeFilter === 'friendly'} onPress={() => setTypeFilter('friendly')}>Amical</TypeChip>
        <TypeChip active={typeFilter === 'challenge'} onPress={() => setTypeFilter('challenge')}>Défi</TypeChip>
      </ScrollView>

      {showCreated && created.length > 0 && (
        <Section title="J'organise" count={created.length} color="#4f46e5">
          {created.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {showAccepted && accepted.length > 0 && (
        <Section title="Je joue" count={accepted.length} color="#10b981">
          {accepted.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {showPending && pending.length > 0 && (
        <Section title="En attente d'approbation" count={pending.length} color="#f59e0b">
          {pending.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} />)}
        </Section>
      )}
      {created.length + accepted.length + pending.length === 0 && (
        <EmptyState text="Aucune partie à venir" sub={typeFilter !== 'all' ? 'Aucun match de ce type' : 'Explore le lobby ou crée la tienne'} />
      )}
    </View>
  );
}

// ─── History tab ──────────────────────────────────────────────
function HistoryTab({ matches, playerId, onOpenMatch, pastCompleteGames, onOpenGame, onScoreGame }: {
  matches: Match[]; playerId: string; onOpenMatch: (m: Match) => void;
  pastCompleteGames: EnrichedGame[]; onOpenGame: (g: EnrichedGame) => void;
  onScoreGame: (gameId: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const byType = (m: Match) => {
    if (typeFilter === 'all') return true;
    if (typeFilter === 'challenge') return !!m.is_challenge;
    if (typeFilter === 'friendly') return (m.game_format as string) === 'friendly';
    return !m.is_challenge && (m.game_format as string) !== 'friendly';
  };

  const toScore = matches.filter(m => m.status === 'pending').filter(byType);
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
        <Section title="À scorer" count={pastCompleteGames.length} color="#f59e0b">
          {pastCompleteGames.map(g => (
            <GameCard key={g.id} game={g} variant="upcoming" myElo={0}
              playerId={playerId} hideActions scorable
              onPress={() => onOpenGame(g)}
              onScorePress={() => onScoreGame(g.id)} />
          ))}
        </Section>
      )}
      {toScore.length > 0 && (
        <Section title="Score à saisir" count={toScore.length} color="#f59e0b">
          {toScore.map(m => <MatchCard key={m.id} match={m} playerId={playerId} onPress={() => onOpenMatch(m)} />)}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Matchs passés" count={past.length} color="#64748b">
          {past.map(m => <MatchCard key={m.id} match={m} playerId={playerId} onPress={() => onOpenMatch(m)} />)}
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
  const { create, tab: tabParam, role: roleParam, challenge, 'with': withId, pname, pelo } = useLocalSearchParams<{ create?: string; tab?: string; role?: string; challenge?: string; with?: string; pname?: string; pelo?: string }>();
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
  const [showCreate, setShowCreate] = useState(false);
  const [challengeWith, setChallengeWith] = useState<{ id: string; name: string; elo_score: number } | null>(null);

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
        .select('*, winner:winner_id(name), winner_2:winner_id_2(name), loser:loser_id(name), loser_2:loser_id_2(name)')
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
      .in('status', ['accepted', 'pending', 'waitlist']);

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
    setGames((explorerRes.data ?? []).filter((g: any) => !alreadyInIds.has(g.id) && genderAllowed(g)) as EnrichedGame[]);

    const allUpcoming = [...creatorGames, ...participantGames];
    const now = new Date();
    const readyToScore = (g: EnrichedGame) =>
      !!g.match_date && new Date(g.match_date) < now && g.spots_available === 0;

    setUpcomingGames(allUpcoming.filter(g => !readyToScore(g)));
    setPastCompleteGames(allUpcoming.filter(readyToScore));
    setMatches((matchesRes.data ?? []) as Match[]);
    setLoading(false);
  }, [player]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  useEffect(() => {
    if (create === '1') {
      if (challenge === '1' && withId) {
        setChallengeWith({ id: withId, name: decodeURIComponent(pname ?? ''), elo_score: Number(pelo ?? 0) });
      }
      setShowCreate(true);
      router.setParams({ create: undefined, challenge: undefined, with: undefined, pname: undefined, pelo: undefined });
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
    if (error) { Alert.alert('Erreur', error.message); throw error; }

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

    const { data: game, error } = await supabase
      .from('open_games')
      .insert({
        creator_id: player.id,
        creator_side: data.creatorSide,
        game_format: data.gameType === 'Amical' ? 'friendly' : 'competitive',
        is_challenge: data.gameType === 'Défi',
        gender_pref: data.genre,
        match_date: new Date(`${data.matchDate}T${data.matchTime}:00`).toISOString(),
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
      status: 'pending' as const,
      team_side: p.team_side ?? 'A_GAU',
    }));

    if (invites.length > 0) {
      await supabase.from('game_participants').insert(invites);
      // Notify invited players
      notifyPlayers({
        playerIds: invites.map(i => i.player_id),
        title: '⚡ Invitation reçue',
        body: `${player.name} t'invite à une partie de padel`,
        data: { type: 'lobby', gameId: game.id },
      });
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

    if (error) { Alert.alert('Erreur', error.message); return; }

    if (allApproved) {
      // Notify the accepted player
      notifyPlayers({
        playerIds: [participantPlayerId],
        title: '✅ Candidature acceptée !',
        body: `Tu as été accepté dans la partie à ${game?.location ?? ''}.`,
        data: { type: 'lobby', gameId },
      });

      // Eject the player from overlapping pending applications
      if (game?.match_date) {
        const OVERLAP = 4 * 60 * 60 * 1000;
        const acceptedTime = new Date(game.match_date).getTime();

        const { data: otherApps } = await supabase
          .from('game_participants')
          .select('id, game:game_id(match_date)')
          .eq('player_id', participantPlayerId)
          .eq('status', 'pending')
          .neq('game_id', gameId);

        const toEject = (otherApps ?? []).filter((p: any) => {
          const t = new Date(p.game?.match_date).getTime();
          return !isNaN(t) && Math.abs(t - acceptedTime) < OVERLAP;
        });

        if (toEject.length > 0) {
          await supabase
            .from('game_participants')
            .update({ status: 'declined' })
            .in('id', toEject.map((p: any) => p.id));

          notifyPlayers({
            playerIds: [participantPlayerId],
            title: '📅 Candidature retirée',
            body: `Tu es confirmé sur un autre créneau — ta candidature a été retirée automatiquement.`,
            data: { type: 'lobby' },
          });
        }
      }
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

  if (!player) return null;

  const upcomingBadge = upcomingGames.length;

  return (
    <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      {/* ── Header ── */}
      <View style={{
        backgroundColor: '#102820',
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>

        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <View>
            <Text style={{ fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: -0.5 }}>Le Lobby</Text>
            <Text style={{ fontSize: 12, fontWeight: '600', color: '#475569', marginTop: 2 }}>
              Niv. {fmtLevel(myElo)} · {games.length > 0
                ? `${games.length} partie${games.length > 1 ? 's' : ''} disponible${games.length > 1 ? 's' : ''}`
                : 'aucune partie disponible'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowCreate(true)}
            activeOpacity={0.85}
            style={{
              backgroundColor: '#10b981', borderRadius: 16,
              paddingHorizontal: 14, paddingVertical: 10,
              shadowColor: '#10b981', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
            }}
          >
            <Text style={{ color: '#0f172a', fontSize: 13, fontWeight: '900' }}>➕ Créer</Text>
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
                  backgroundColor: active ? '#fff' : 'transparent',
                  borderRadius: 14, paddingVertical: 9,
                }}
              >
                <Text style={{ color: active ? '#0f172a' : 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {t.label}
                </Text>
                {t.count > 0 && (
                  <View style={{ backgroundColor: active ? '#f1f5f9' : 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: active ? '#64748b' : '#fff', fontSize: 9, fontWeight: '900' }}>{t.count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

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
            />
          )}
          {tab === 'history' && (
            <HistoryTab matches={matches} playerId={player.id} onOpenMatch={setOpenMatch}
              pastCompleteGames={pastCompleteGames} onOpenGame={(g) => setOpenGameId(g.id)}
              onScoreGame={(gameId) => router.push(('/score-entry?gameId=' + gameId) as any)} />
          )}
        </ScrollView>
      )}

      {/* ── FAB ── */}
      <TouchableOpacity
        onPress={() => setShowCreate(true)}
        activeOpacity={0.88}
        style={{
          position: 'absolute', right: 18, bottom: insets.bottom + 24, zIndex: 30,
          width: 56, height: 56, borderRadius: 18, backgroundColor: '#4f46e5',
          alignItems: 'center', justifyContent: 'center',
          shadowColor: '#4f46e5', shadowOpacity: 0.45, shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 }, elevation: 10,
        }}
      >
        <IconPlus size={26} color="#fff" />
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
          onLeave={handleLeaveGame}
        />
      )}

      <CreateWizard
        visible={showCreate}
        onClose={() => { setShowCreate(false); setChallengeWith(null); }}
        onPublish={handlePublish}
        player={player}
        initialGameType={challengeWith ? 'Défi' : undefined}
        initialInvite={challengeWith ?? undefined}
      />

      {openMatch && (
        <MatchDetailSheet
          match={openMatch}
          playerId={player.id}
          onClose={() => setOpenMatch(null)}
        />
      )}
    </View>
  );
}
