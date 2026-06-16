import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, Alert, StyleSheet, Modal,
  Share, Linking, Image,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Line, Polyline, Rect } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { useNotificationCount } from '../../hooks/useNotificationCount';
import { supabase } from '../../lib/supabase';
import { Colors, eloToLevel, padelLevelToElo, getLeague, Fonts } from '../../lib/theme';
import { notifyPlayers } from '../../lib/notify';
import { notifyMatchingAlerts, lobbyGameLink, playerStoryLink, SHARE_LABEL } from '../../lib/community';
import { getHiddenPlayerIds } from '../../lib/moderation';
import { displayName } from '../../lib/players';
import { buildStoryMatch } from '../../components/story/storyTheme';
import StoryComposerV2 from '../../components/StoryComposerV2';
import type { StoryPlayer, StoryMatchData, InviteData } from '../../components/story/storyTheme';
import type { OpenGame, Match } from '../../types';
import { MatchCard as MatchScoreCard } from '../../components/profile/components';
import { matchToView } from '../../lib/matchView';
import GameDetailsSheet from './GameDetailsSheet';
import CreateWizard, { type WizardResult } from './CreateWizard';
import { Pill, pillAccent } from '../../components/Pill';
import { ProfileAvatarButton } from '../../components/ProfileAvatarButton';
import { joinGame, occupiesSpot, withdrawInvitation, isInviteActive } from '../../lib/games';
import ApplicationNoteSheet from '../../components/ApplicationNoteSheet';
import { containsProfanity } from '../../lib/profanity';

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

// Places libres = dérivées des vrais joueurs (créateur + acceptés/invités, sur 4
// au padel), PAS du compteur stocké open_games.spots_available qui peut dériver
// (le décrément était oublié sur l'approbation pending→accepted). Auto-réparant :
// colle toujours aux slots affichés. Repli sur le compteur si participants absents.
function freeSpots(game: OpenGame): number {
  if (!game.participants) return game.spots_available ?? 0;
  const occupied = 1 + game.participants.filter(
    (p: any) => occupiesSpot(p) && p.player_id !== game.creator_id,
  ).length;
  return Math.max(0, 4 - occupied);
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
// target player is already organizer of another match within ±2h.
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

// ─── Role icons (section bandeaux « À venir ») ────────────────
// Style trait minimal, charte noir/jaune. Couleur passée depuis la pastille.
const IconMail = ({ size = 14, color = Colors.textOnDark }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Rect x={3} y={5} width={18} height={14} rx={2} stroke={color} />
    <Path stroke={color} d="m3 7 9 6 9-6" />
  </Svg>
);
const IconMegaphone = ({ size = 14, color = Colors.textOnDark }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="m3 11 18-5v12L3 14v-3z" />
    <Path stroke={color} d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
  </Svg>
);
const IconCrown = ({ size = 14, color = Colors.textOnDark }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} fill={color} d="M3 8.5 6.5 12l3-5 2.5 4 2.5-4 3 5L21 8.5 19 19H5L3 8.5z" />
  </Svg>
);
const IconCheck = ({ size = 15, color = Colors.textOnDark }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M20 6 9 17l-5-5" />
  </Svg>
);
const IconHourglass = ({ size = 14, color = Colors.textOnDark }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Path stroke={color} d="M5 2h14M5 22h14" />
    <Path stroke={color} d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4A2 2 0 0 0 17 6.2V2" />
    <Path stroke={color} d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4A2 2 0 0 0 7 17.8V22" />
  </Svg>
);
const IconWaitClock = ({ size = 14, color = Colors.textOnDark }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx={12} cy={12} r={9} stroke={color} />
    <Path stroke={color} d="M12 7.5v5l3 2" />
  </Svg>
);

// ─── Avatar ──────────────────────────────────────────────────
// Charte jaune/noir : par défaut on alterne ink ↔ brand selon le nom,
// pour garder de la variété entre joueurs sans sortir de la charte.
const AV_PALETTE = [
  { bg: Colors.primary, fg: Colors.textOnDark },   // noir, texte blanc
  { bg: Colors.brand,   fg: Colors.textOnBrand },  // jaune, texte noir
];
function hashTone(name: string) {
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_PALETTE[h % AV_PALETTE.length];
}
// Couleurs équipe (charte) — A = ink, B = brand
const TEAM_BG  = { A: Colors.primary,    B: Colors.brand };
const TEAM_FG  = { A: Colors.textOnDark, B: Colors.textOnBrand };
function Avatar({ name, size = 28, ring, team, creator }: { name: string; size?: number; ring?: string; team?: 'A' | 'B'; creator?: boolean }) {
  const tone = hashTone(name);
  const bg = team ? TEAM_BG[team] : tone.bg;
  const fg = team ? TEAM_FG[team] : tone.fg;
  const bs = Math.max(13, Math.round(size * 0.5));
  return (
    <View style={{
      width: size, height: size, borderRadius: Math.round(size * 0.3),
      backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
      borderWidth: ring ? 2 : 0, borderColor: ring ?? 'transparent',
    }}>
      <Text style={{ color: fg, fontSize: Math.round(size * 0.42), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
      {creator ? (
        <View style={{
          position: 'absolute', top: -4, right: -4,
          width: bs, height: bs, borderRadius: bs,
          backgroundColor: Colors.brand, borderWidth: 1.5, borderColor: Colors.bgCard,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <IconCrown size={Math.round(bs * 0.62)} color={Colors.primary} />
        </View>
      ) : null}
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
function Section({ title, count, color, icon, children }: {
  title: string; count: number; color: string;
  icon?: React.ReactNode; children: React.ReactNode;
}) {
  // Bandeau renforcé quand une icône de rôle est fournie (onglet « À venir »).
  // Sinon : en-tête fin d'origine (Historique, scores…) → aucun impact ailleurs.
  const onColor = color === Colors.brand ? Colors.textOnBrand : Colors.textOnDark;
  return (
    <View style={{ marginBottom: 18 }}>
      {icon ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: color + '14',
          borderLeftWidth: 4, borderLeftColor: color,
          borderRadius: 10, paddingVertical: 9, paddingLeft: 11, paddingRight: 10,
          marginBottom: 10,
        }}>
          <View style={{
            width: 26, height: 26, borderRadius: 8, backgroundColor: color,
            alignItems: 'center', justifyContent: 'center',
          }}>
            {icon}
          </View>
          <Text style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.6, textTransform: 'uppercase' }}>
            {title}
          </Text>
          <View style={{ minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: color, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, fontWeight: '900', color: onColor }}>{count}</Text>
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <View style={{ width: 3, height: 14, backgroundColor: color, borderRadius: 2 }} />
          <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            {title}
          </Text>
          <View style={{ backgroundColor: color + '22', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 }}>
            <Text style={{ fontSize: 11, fontWeight: '900', color }}>{count}</Text>
          </View>
        </View>
      )}
      <View style={{ gap: 10 }}>{children}</View>
    </View>
  );
}

// ─── Slot helpers (mirrors GameDetailsSheet) ─────────────────
const SIDE_TO_IDX: Record<string, number> = { A_GAU: 0, A_DRO: 1, B_GAU: 2, B_DRO: 3 };
const IDX_TO_SIDE: Record<number, string> = { 0: 'A_GAU', 1: 'A_DRO', 2: 'B_GAU', 3: 'B_DRO' };

function buildGameSlots(game: EnrichedGame, myId: string) {
  const slots: Array<{ id: string; name: string; isMe: boolean; isInvited?: boolean; isCreator?: boolean; elo?: number | null } | null> = [null, null, null, null];
  const creator = game.creator as { name?: string; elo_score?: number | null } | undefined;
  const creatorIdx = SIDE_TO_IDX[game.creator_side ?? 'A_GAU'] ?? 0;
  slots[creatorIdx] = { id: game.creator_id, name: creator?.name ?? '?', isMe: game.creator_id === myId, isCreator: true, elo: creator?.elo_score ?? null };
  (game.participants ?? [])
    .filter((p: any) => (p.status === 'accepted' || (p.status === 'invited' && isInviteActive(p))) && p.player_id !== game.creator_id)
    .forEach((p: any) => {
      const sp = {
        id: p.player_id,
        name: p.player?.name ?? '?',
        isMe: p.player_id === myId,
        isInvited: p.status === 'invited',
        elo: p.player?.elo_score ?? null,
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
  const router = useRouter();
  const slots = buildGameSlots(game, playerId);
  const st = getSlotTheme(game);
  const isCreator = game.creator_id === playerId;
  // « Déjà dans la partie » = relation VIVANTE (accepté / candidature en cours /
  // invitation NON expirée). On exclut les états terminaux ('declined', 'expired')
  // et les invitations expirées par l'horloge — sinon une invite périmée grise les
  // emplacements et empêche de re-candidater. Aligné sur GameDetailsSheet.
  const myParticipant = (game.participants ?? []).find(
    (p: any) => p.player_id === playerId && p.status !== 'declined' && p.status !== 'expired'
  ) as any;
  const isAccepted = myParticipant?.status === 'accepted';
  const alreadyIn = !!myParticipant && (
    isAccepted
    || myParticipant.status === 'pending'
    || myParticipant.status === 'waitlist'
    || isInviteActive(myParticipant)
  );
  const isFull = slots.every(s => s !== null);

  const canJoin = !isCreator && !alreadyIn && !isFull && !!onApply;
  const canChange = !isFull && (isCreator ? !!onCreatorChangeSide : (isAccepted && !!onChangeSide));

  const renderSlot = (idx: number) => {
    const s = slots[idx];
    const side = IDX_TO_SIDE[idx];
    const posLabel = side.includes('GAU') ? 'G' : 'D';

    const SLOT_W = 60;
    const nameLabel = s ? (s.isMe ? 'Toi' : (s.name?.split(' ')[0] ?? '?')) : null;

    if (s) {
      const team: 'A' | 'B' = side.startsWith('A_') ? 'A' : 'B';
      const lvl = s.elo != null ? fmtLevel(s.elo) : null;
      return (
        <TouchableOpacity
          key={idx}
          onPress={() => router.push(`/player/${s.id}` as any)}
          activeOpacity={0.7}
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          style={{ alignItems: 'center', gap: 3, width: SLOT_W, opacity: s.isInvited ? 0.45 : 1 }}>
          <Avatar name={s.name} size={42} ring={s.isMe ? Colors.warning : undefined} team={team} creator={s.isCreator} />
          <Text
            numberOfLines={1}
            style={{
              fontSize: 13, fontWeight: '900', maxWidth: SLOT_W,
              color: s.isMe ? Colors.warning : Colors.textPrimary,
            }}
          >
            {nameLabel}
          </Text>
          {lvl ? (
            <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.brandDeep, letterSpacing: 0.2 }}>
              Niv {lvl}
            </Text>
          ) : null}
          <Text style={{ fontSize: 9, fontWeight: '900', color: s.isInvited ? st.accent : Colors.textMuted, letterSpacing: 0.3 }}>
            {s.isInvited ? '⏳ Invité' : posLabel}
          </Text>
        </TouchableOpacity>
      );
    }

    if (canJoin) {
      return (
        <TouchableOpacity key={idx} onPress={() => onApply!(game.id, side)}
          activeOpacity={0.7} style={{ alignItems: 'center', gap: 3, width: SLOT_W }}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <View style={{
            width: 42, height: 42, borderRadius: 999,
            borderWidth: 1.5, borderColor: st.border, borderStyle: 'dashed',
            backgroundColor: st.bg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: st.accent, fontSize: 24, fontWeight: '300', lineHeight: 26 }}>+</Text>
          </View>
          <Text style={{ fontSize: 12, fontWeight: '800', color: st.accent }}>Libre</Text>
          <Text style={{ fontSize: 9, fontWeight: '900', color: st.border, letterSpacing: 0.3 }}>{posLabel}</Text>
        </TouchableOpacity>
      );
    }

    if (canChange) {
      const handlePress = () => isCreator
        ? onCreatorChangeSide!(game.id, side)
        : onChangeSide!(myParticipant?.id, side);
      return (
        <TouchableOpacity key={idx} onPress={handlePress}
          activeOpacity={0.7} style={{ alignItems: 'center', gap: 3, width: SLOT_W }}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <View style={{
            width: 42, height: 42, borderRadius: 999,
            borderWidth: 1.5, borderColor: st.border, borderStyle: 'dashed',
            backgroundColor: st.bg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: st.accent, fontSize: 15, fontWeight: '900' }}>↔</Text>
          </View>
          <Text style={{ fontSize: 12, fontWeight: '800', color: st.accent }}>Changer</Text>
          <Text style={{ fontSize: 9, fontWeight: '900', color: st.border, letterSpacing: 0.3 }}>{posLabel}</Text>
        </TouchableOpacity>
      );
    }

    return (
      <View key={idx} style={{ alignItems: 'center', gap: 3, width: SLOT_W }}>
        <View style={{
          width: 30, height: 30, borderRadius: 999,
          borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
          backgroundColor: Colors.bg,
        }} />
        <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textMuted }}>Libre</Text>
        <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.border, letterSpacing: 0.3 }}>{posLabel}</Text>
      </View>
    );
  };

  // alignItems 'flex-start' : les colonnes avec joueur ont une ligne de plus
  // (« Niv X ») que les colonnes « Libre ». En centrant, l'équipe tout-libre
  // (plus courte) était poussée vers le bas et ses pastilles ne s'alignaient plus
  // avec les avatars. On aligne tout par le haut → avatars/pastilles sur la même
  // ligne, les libellés pendent dessous. Le séparateur reste centré sur la bande.
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        {renderSlot(0)}
        {renderSlot(1)}
      </View>
      {/* Séparateur « VS » entre les deux équipes (remplace le filet vertical), centré sur les avatars. */}
      <Text style={{ fontSize: 24, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, letterSpacing: 0.5, marginTop: 9 }}>
        VS
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        {renderSlot(2)}
        {renderSlot(3)}
      </View>
    </View>
  );
}

// ─── Avatar row ───────────────────────────────────────────────
function AvatarRow({ players, slots }: { players: Array<{ id?: string; name: string; team?: 'A' | 'B'; isCreator?: boolean }>; slots: number }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {players.map((p, i) => (
        <TouchableOpacity
          key={i}
          disabled={!p.id}
          onPress={() => p.id && router.push(`/player/${p.id}` as any)}
          activeOpacity={0.7}
          style={{ marginLeft: i === 0 ? 0 : -8, zIndex: players.length - i }}>
          <Avatar name={p.name} size={28} ring={Colors.bgCard} team={p.team} creator={p.isCreator} />
        </TouchableOpacity>
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
  const spots = freeSpots(game);
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
  const url = lobbyGameLink(game.id);
  const msg = `Match Padel – ${typeLabel}\n👤 Organisé par ${creatorLabel}${playersLine}\n📅 ${dateStr} à ${timeStr}\n📍 ${game.location ?? ''}\n📊 Niveau : ${minLv} – ${maxLv}\n🟢 ${spotsText}\n🔗 ${url}`;
  try { await Share.share({ message: msg }); } catch { /* cancelled */ }
}

// ─── Game Card ────────────────────────────────────────────────
export function GameCard({ game, variant, myElo, playerId, onPress, onApply, onChangeSide, onCreatorChangeSide, hideActions, scorable, onScorePress, onAcceptInvitation, onDeclineInvitation }: {
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
  const spotsLeft = freeSpots(game);
  const isUrgent = spotsLeft === 1 && hoursLeft > 0 && hoursLeft <= 6;
  const accepted = (game.participants ?? []).filter(p => p.status === 'accepted');
  const creatorObj = game.creator as { id?: string; name: string } | undefined;
  const teamOf = (side?: string): 'A' | 'B' | undefined => side ? (side.startsWith('B') ? 'B' : 'A') : undefined;
  const allPlayers: Array<{ id?: string; name: string; team?: 'A' | 'B'; isCreator?: boolean }> = [
    ...(creatorObj?.name ? [{ id: creatorObj.id ?? game.creator_id, name: creatorObj.name, team: teamOf((game as any).creator_side), isCreator: true }] : []),
    ...accepted.flatMap(p => {
      const nm = (p.player as { name: string } | undefined)?.name;
      return nm && p.player_id !== game.creator_id ? [{ id: p.player_id, name: nm, team: teamOf((p as any).team_side) }] : [];
    }),
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
          {variant === 'upcoming' && game.my_status === 'pending' && (() => {
            const mine = (game.participants ?? []).find((p: any) => p.player_id === playerId);
            const got = (mine as any)?.approvals?.length ?? 0;
            const acceptedCount = (game.participants ?? []).filter((p: any) => p.status === 'accepted').length;
            const required = Math.min(1 + acceptedCount, 3);
            return <Pill variant="warning">En attente · {got}/{required}</Pill>;
          })()}
          {variant === 'upcoming' && game.my_status === 'invited' && (
            <Pill variant="warning">{game.is_challenge ? '⚡ Défi reçu' : '✉️ Invité'}</Pill>
          )}
          {variant === 'upcoming' && game.my_status === 'accepted' && (
            <Pill variant="success">✓ Inscrit</Pill>
          )}
          {variant === 'upcoming' && game.my_status === 'waitlist' && (() => {
            const wl = (game.participants ?? [])
              .filter((p: any) => p.status === 'waitlist')
              .sort((a: any, b: any) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
            const idx = wl.findIndex((p: any) => p.player_id === playerId);
            const pos = idx >= 0 ? idx + 1 : null;
            return <Pill variant="warning">⏳ {pos ? `${pos === 1 ? '1ʳᵉ' : `${pos}ᵉ`} en attente` : "Liste d'attente"}</Pill>;
          })()}
          {variant === 'upcoming' && (game.is_creator || game.my_status === 'accepted') && (game.pending_count ?? 0) > 0 && (
            <Pill variant="warning">
              {game.pending_count} demande{(game.pending_count ?? 0) > 1 ? 's' : ''}
            </Pill>
          )}
        </View>

        {/* Lieu + horaire (colonne gauche) et niveau + places (colonne droite), alignés en haut. */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {game.location ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                <IconPin size={13} color={Colors.textSecondary} />
                <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, flex: 1 }} numberOfLines={1}>
                  {game.location}
                </Text>
              </View>
            ) : null}
            {game.match_date ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <IconClock size={12} color={Colors.textSecondary} />
                <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textSecondary }}>{formatDate(game.match_date)}</Text>
              </View>
            ) : null}
          </View>
          {(levelRange || variant !== 'history') && (
            <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
              {levelRange ? (
                <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textSecondary, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                  {levelRange}
                </Text>
              ) : null}
              {variant !== 'history' && (
                <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 1 }}>
                  {spotsLeft === 0 ? 'Complet'
                    : `${spotsLeft} place${spotsLeft > 1 ? 's' : ''} libre${spotsLeft > 1 ? 's' : ''}`}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Joueurs : équipe A — VS — équipe B */}
        <View style={{ alignItems: 'center' }}>
          {showInlineSlots
            ? <InlineSlots game={game} playerId={playerId!}
                onApply={onApply}
                onChangeSide={onChangeSide}
                onCreatorChangeSide={onCreatorChangeSide} />
            : <AvatarRow players={allPlayers} slots={0} />
          }
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
  'Le Mur': '🧱', "L'Essuie-glace": '🏃', 'Roi du Filet': '🥅',
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
              const winnerNames = [m.winner, m.winner_2].filter(Boolean).map(p => displayName(p, won ? 'partner' : 'opponent')).join(' & ') || '?';
              const loserNames  = [m.loser,  m.loser_2 ].filter(Boolean).map(p => displayName(p, won ? 'opponent' : 'partner')).join(' & ') || '?';
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
function MatchDetailSheet({ match, playerId, onClose, onValidated, onContest, onRematch, onShare }: {
  match: Match; playerId: string; onClose: () => void;
  onValidated?: (matchId: string) => void;
  onContest?: (matchId: string) => void;
  onRematch?: (matchId: string) => void;
  onShare?: (m: Match) => void;
}) {
  const router = useRouter();
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
  // Côté joueur : le vainqueur est mon équipe si j'ai gagné, sinon ce sont les adversaires.
  const winnerTeam = [match.winner, match.winner_2].filter(Boolean).map(p => ({ name: displayName(p, won ? 'partner' : 'opponent') }));
  const loserTeam  = [match.loser,  match.loser_2 ].filter(Boolean).map(p => ({ name: displayName(p, won ? 'opponent' : 'partner') }));
  const [myTeam, oppTeam] = won ? [winnerTeam, loserTeam] : [loserTeam, winnerTeam];
  const [teamA, teamB] = [myTeam, oppTeam];

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

          {/* Carte de match — même affichage que le profil (en-tête + équipes en lignes + grille de score) */}
          <View style={{ marginHorizontal: 20, marginTop: 8, marginBottom: 16 }}>
            <MatchScoreCard m={matchToView(match, playerId)} showDelta={false} showActions={false} onPlayerPress={(id) => { onClose(); router.push(`/player/${id}` as any); }} />
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

          {match.status === 'validated' && (onRematch || onShare) && (
            <View style={{ marginHorizontal: 20, marginTop: 18, gap: 10 }}>
              {onRematch && (
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
              )}
              {onShare && (
                <TouchableOpacity
                  onPress={() => { onShare(match); onClose(); }}
                  activeOpacity={0.85}
                  style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    backgroundColor: Colors.bgCardAlt, borderRadius: 14, paddingVertical: 14,
                    borderWidth: 1, borderColor: Colors.border,
                  }}
                >
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.3 }}>
                    📸 Partager en story
                  </Text>
                </TouchableOpacity>
              )}
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
function MatchCard({ match, playerId, onPress, onRematch, onShare }: {
  match: Match;
  playerId: string;
  onPress: () => void;
  onRematch?: (matchId: string) => void;
  onShare?: () => void;
}) {
  const router = useRouter();
  const canRematch = onRematch && match.status === 'validated';
  const footer = (canRematch || onShare) ? (
    <View style={{ flexDirection: 'row', gap: 8, borderTopWidth: 1, borderTopColor: Colors.bgCardAlt, paddingTop: 10 }}>
      {canRematch && (
        <TouchableOpacity
          onPress={(e) => { (e as any).stopPropagation?.(); onRematch!(match.id); }}
          activeOpacity={0.85}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }}
        >
          <Text style={{ fontSize: 13 }}>🔄</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.3 }}>Rejouer</Text>
        </TouchableOpacity>
      )}
      {onShare && (
        <TouchableOpacity
          onPress={(e) => { (e as any).stopPropagation?.(); onShare(); }}
          activeOpacity={0.85}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }}
        >
          <Text style={{ fontSize: 13 }}>📸</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.3 }}>Partager</Text>
        </TouchableOpacity>
      )}
    </View>
  ) : undefined;
  return (
    <MatchScoreCard m={matchToView(match, playerId)} onPress={onPress} showDelta={false} showActions={false} footer={footer} onPlayerPress={(id) => router.push(`/player/${id}` as any)} />
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
      <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary, fontSize: 14, textAlign: 'center' }}>{text}</Text>
      {sub ? <Text style={{ color: Colors.textMuted, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 4 }}>{sub}</Text> : null}
    </View>
  );
}

// Applique les filtres de l'Explorer (mode urgent, type, recherche).
// Factorisé pour que le badge de l'onglet ET la liste utilisent EXACTEMENT
// la même logique → le compteur reflète les filtres actifs.
function filterExploreGames(
  games: EnrichedGame[], filterMode: FilterMode, typeFilter: TypeFilter, search: string,
): EnrichedGame[] {
  let arr = games;
  if (filterMode === 'urgent') arr = arr.filter(g => {
    const h = g.match_date ? hoursUntil(g.match_date) : 0;
    return freeSpots(g) === 1 && h > 0 && h <= 6;
  });
  if (typeFilter !== 'all') arr = arr.filter(g => getGameType(g) === typeFilter);
  if (search.trim()) {
    const q = search.toLowerCase();
    arr = arr.filter(g =>
      (g.location ?? '').toLowerCase().includes(q) ||
      ((g.creator as any)?.name ?? '').toLowerCase().includes(q),
    );
  }
  return arr;
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
  const filtered = useMemo(
    () => filterExploreGames(games, filterMode, typeFilter, search),
    [games, filterMode, typeFilter, search],
  );

  const hasActiveFilter = filterMode !== 'all' || typeFilter !== 'all' || search.trim().length > 0;
  const resetFilters = () => { setFilterMode('all'); setTypeFilter('all'); setSearch(''); };

  const recommended = useMemo(() => games.filter(g => getEloFit(g, myElo) === 'fit'), [games, myElo]);
  const urgentCount = useMemo(() => games.filter(g => {
    const h = g.match_date ? hoursUntil(g.match_date) : 0;
    return freeSpots(g) === 1 && h > 0 && h <= 6;
  }).length, [games]);

  // "Pour toi" is shown above the main list; drop those games from the main
  // list so the same match never appears twice. Masqué dès qu'un filtre est
  // actif → la liste filtrée s'affiche à plat (et l'état vide peut apparaître).
  const showForYou = !hasActiveFilter && recommended.length > 0;
  const recommendedIds = useMemo(() => new Set(recommended.map(g => g.id)), [recommended]);
  const mainList = useMemo(
    () => showForYou ? filtered.filter(g => !recommendedIds.has(g.id)) : filtered,
    [filtered, showForYou, recommendedIds],
  );

  const countLabel = filterMode === 'urgent' ? `urgente${mainList.length > 1 ? 's' : ''}`
    : `disponible${mainList.length > 1 ? 's' : ''}`;

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

      {/* "Pour toi" — pile verticale des parties à ton niveau */}
      {showForYou && (
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

      {/* Main list — hidden entirely when "Pour toi" already covers every game */}
      {(mainList.length > 0 || !showForYou) && (
        <View style={{ paddingHorizontal: 14 }}>
          <Text style={{
            fontSize: 11, fontWeight: '900', color: Colors.textSecondary,
            letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8,
          }}>
            {mainList.length} partie{mainList.length > 1 ? 's' : ''} {countLabel}
          </Text>
          {mainList.length === 0
            ? (hasActiveFilter && games.length > 0
                ? (
                  <View style={{
                    paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center',
                    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
                    borderStyle: 'dashed', borderRadius: 18,
                  }}>
                    <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary, fontSize: 14, textAlign: 'center' }}>
                      Aucune partie ne correspond aux filtres
                    </Text>
                    <Text style={{ color: Colors.textMuted, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                      {games.length} partie{games.length > 1 ? 's' : ''} disponible{games.length > 1 ? 's' : ''} au total
                    </Text>
                    <TouchableOpacity onPress={resetFilters} activeOpacity={0.85}
                      style={{ marginTop: 14, backgroundColor: Colors.brand, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
                      <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontSize: 13 }}>Réinitialiser les filtres</Text>
                    </TouchableOpacity>
                  </View>
                )
                : <EmptyState text="Aucune partie disponible" sub="Crée la tienne pour lancer le jeu" />)
            : <View style={{ gap: 10 }}>
                {mainList.map(g => (
                  <GameCard key={g.id} game={g} variant="explore" myElo={myElo} playerId={playerId}
                    onApply={onApply} onChangeSide={onChangeSide} onCreatorChangeSide={onCreatorChangeSide}
                    onPress={() => onOpenGame(g)} />
                ))}
              </View>
          }
        </View>
      )}
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
  const waitlisted = games.filter(g => !g.is_creator && g.my_status === 'waitlist').filter(byType);

  const showCreated = roleFilter === 'all' || roleFilter === 'creator' || roleFilter === 'playing';
  const showAccepted = roleFilter === 'all' || roleFilter === 'playing';
  const showInvited = roleFilter === 'all' || roleFilter === 'pending';
  const showPending = roleFilter === 'all' || roleFilter === 'pending';
  const showWaitlist = roleFilter === 'all' || roleFilter === 'pending';

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
        <Section title="À répondre" count={invited.length} color={Colors.brand} icon={<IconMail color={Colors.textOnBrand} />}>
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
        <Section title="J'organise" count={created.length} color={Colors.primary} icon={<IconMegaphone color={Colors.textOnDark} />}>
          {created.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {showAccepted && accepted.length > 0 && (
        <Section title="Je joue" count={accepted.length} color={Colors.success} icon={<IconCheck color={Colors.textOnDark} />}>
          {accepted.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {showPending && pending.length > 0 && (
        <Section title="En attente d'approbation" count={pending.length} color={Colors.warning} icon={<IconHourglass color={Colors.textOnDark} />}>
          {pending.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} />)}
        </Section>
      )}
      {showWaitlist && waitlisted.length > 0 && (
        <Section title="Liste d'attente" count={waitlisted.length} color={Colors.textMuted} icon={<IconWaitClock color={Colors.textOnDark} />}>
          {waitlisted.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {created.length + accepted.length + invited.length + pending.length + waitlisted.length === 0 && (
        <EmptyState text="Aucune partie à venir" sub={typeFilter !== 'all' ? 'Aucun match de ce type' : 'Explore le lobby ou crée la tienne'} />
      )}
    </View>
  );
}

// ─── History tab ──────────────────────────────────────────────
function HistoryTab({ matches, playerId, onOpenMatch, pastCompleteGames, onOpenGame, onScoreGame, onRematch, onShare }: {
  matches: Match[]; playerId: string; onOpenMatch: (m: Match) => void;
  pastCompleteGames: EnrichedGame[]; onOpenGame: (g: EnrichedGame) => void;
  onScoreGame: (gameId: string) => void;
  onRematch: (matchId: string) => void;
  onShare: (m: Match) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');

  const byType = (m: Match) => {
    if (typeFilter === 'all') return true;
    if (typeFilter === 'challenge') return !!m.is_challenge;
    if (typeFilter === 'friendly') return (m.game_format as string) === 'friendly';
    return !m.is_challenge && (m.game_format as string) !== 'friendly';
  };

  // Recherche libre : nom d'un joueur (partenaire ou adversaire) ou lieu du match.
  const q = search.trim().toLowerCase();
  const matchSearch = (m: Match) => {
    if (!q) return true;
    const names = [m.winner?.name, m.winner_2?.name, m.loser?.name, m.loser_2?.name];
    return names.some(n => (n ?? '').toLowerCase().includes(q))
      || (m.game?.location ?? '').toLowerCase().includes(q);
  };
  const gameSearch = (g: EnrichedGame) => {
    if (!q) return true;
    const names = [(g.creator as any)?.name, ...(g.participants ?? []).map((p: any) => p.player?.name)];
    return names.some((n: any) => (n ?? '').toLowerCase().includes(q))
      || (g.location ?? '').toLowerCase().includes(q);
  };

  const toScore = matches.filter(m => needsMyValidation(m, playerId)).filter(byType).filter(matchSearch);
  const past = matches.filter(m => m.status === 'validated').filter(byType).filter(matchSearch);
  const pastGames = pastCompleteGames.filter(gameSearch);

  return (
    <View style={{ padding: 14, paddingBottom: 100 }}>
      {/* Search bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        marginBottom: 12, backgroundColor: Colors.bgCard, borderRadius: 12,
        borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 9,
      }}>
        <IconSearch size={16} color={Colors.textMuted} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Rechercher un joueur, un lieu…"
          placeholderTextColor={Colors.textMuted}
          style={{ flex: 1, fontSize: 13, color: Colors.textPrimary }}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <IconX size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* Type chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, marginBottom: 14 }}>
        <TypeChip active={typeFilter === 'all'} onPress={() => setTypeFilter('all')}>Tous types</TypeChip>
        <TypeChip active={typeFilter === 'competitive'} onPress={() => setTypeFilter('competitive')}>Compétitif</TypeChip>
        <TypeChip active={typeFilter === 'friendly'} onPress={() => setTypeFilter('friendly')}>Amical</TypeChip>
        <TypeChip active={typeFilter === 'challenge'} onPress={() => setTypeFilter('challenge')}>Défi</TypeChip>
      </ScrollView>

      {pastGames.length > 0 && (
        <Section title="À scorer" count={pastGames.length} color={Colors.warning}>
          {pastGames.map(g => (
            <GameCard key={g.id} game={g} variant="upcoming" myElo={0}
              playerId={playerId} hideActions scorable
              onPress={() => onOpenGame(g)}
              onScorePress={() => onScoreGame(g.id)} />
          ))}
        </Section>
      )}
      {toScore.length > 0 && (
        <Section title="Score à saisir" count={toScore.length} color={Colors.warning}>
          {toScore.map(m => (
            <View key={m.id} style={{ marginBottom: 10 }}>
              <MatchCard match={m} playerId={playerId} onPress={() => onOpenMatch(m)} />
            </View>
          ))}
        </Section>
      )}
      {past.length > 0 && (
        <Section title="Matchs passés" count={past.length} color={Colors.textSecondary}>
          {past.map(m => (
            <View key={m.id} style={{ marginBottom: 10 }}>
              <MatchCard match={m} playerId={playerId} onPress={() => onOpenMatch(m)} onRematch={onRematch} onShare={() => onShare(m)} />
            </View>
          ))}
        </Section>
      )}
      {pastGames.length + toScore.length + past.length === 0 && (
        <EmptyState
          text={q ? 'Aucun résultat' : matches.length === 0 ? 'Aucun match joué encore' : 'Aucun match de ce type'}
          sub={q ? 'Essaie un autre nom de joueur ou de lieu' : matches.length === 0 ? 'Rejoins une partie depuis Explorer !' : undefined}
        />
      )}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────
export default function LobbyScreen() {
  const { player } = usePlayer();
  const { reload: reloadNotifs } = useNotificationCount();
  const insets = useSafeAreaInsets();
  const { create, tab: tabParam, challenge, 'with': withId, pname, pelo, pside, openValidation, gameId: gameIdParam, rematch: rematchParam } = useLocalSearchParams<{ create?: string; tab?: string; challenge?: string; with?: string; pname?: string; pelo?: string; pside?: string; openValidation?: string; gameId?: string; rematch?: string }>();
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
  const [noteSheet, setNoteSheet] = useState<{ gameId: string; side?: string } | null>(null);
  const [openMatch, setOpenMatch] = useState<Match | null>(null);
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [challengeWith, setChallengeWith] = useState<{ id: string; name: string; elo_score: number; court_side?: string } | null>(null);
  const [rematchInvites, setRematchInvites] = useState<Partial<Record<'A1' | 'B0' | 'B1', { id: string; name: string; elo_score: number }>> | null>(null);
  const [rematchGameType, setRematchGameType] = useState<'Compétitif' | 'Amical' | 'Défi' | undefined>(undefined);
  const [storyMatch, setStoryMatch] = useState<StoryMatchData | null>(null);
  const [storyComposerOpen, setStoryComposerOpen] = useState(false);

  // Derived: always reflects latest fetched data — no stale snapshots
  const openGame = useMemo(
    () => [...games, ...upcomingGames, ...pastCompleteGames].find(g => g.id === openGameId) ?? null,
    [openGameId, games, upcomingGames, pastCompleteGames],
  );

  const myElo = player?.elo_score ?? 1000;

  const fetchData = useCallback(async () => {
    if (!player) return;

    const GAME_SELECT = '*, creator:creator_id(id, name, elo_score, win_count, loss_count), participants:game_participants(id, player_id, status, team_side, approvals, application_note, created_at, invite_expires_at, player:player_id(id, name, elo_score, win_count, loss_count))';

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
        .select('*, winner:winner_id(id, name, deleted_at, elo_score), winner_2:winner_id_2(id, name, deleted_at, elo_score), loser:loser_id(id, name, deleted_at, elo_score), loser_2:loser_id_2(id, name, deleted_at, elo_score), game:game_id(location, match_date)')
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

    const createdIds = new Set(creatorGames.map(g => g.id));

    // Games where I'm a participant (not as creator). Fetched in two reliable
    // steps to avoid the nested `game:game_id(...)` embed, which can silently
    // drop a game (and hide my invitation from "À venir").
    //   1) my participation rows (status only)
    //   2) the matching games, via the same query used for created games
    // A manually-declined row (auto_declined = false) stays hidden; an
    // auto-declined invitation (hidden by the ±2h overlap trigger) is re-offered
    // as 'invited' once its game is still joinable.
    const { data: partRows } = await supabase
      .from('game_participants')
      .select('game_id, status, auto_declined, invite_expires_at')
      .eq('player_id', player.id)
      .in('status', ['accepted', 'pending', 'waitlist', 'invited', 'declined']);

    const myStatusByGame = new Map<string, 'accepted' | 'pending' | 'waitlist' | 'invited'>();
    for (const r of partRows ?? []) {
      if (createdIds.has(r.game_id)) continue;
      if (r.status === 'declined') {
        if (!r.auto_declined) continue;       // manual refusal → keep hidden
        myStatusByGame.set(r.game_id, 'invited'); // re-offer auto-declined invitation
      } else if (r.status === 'invited' && !isInviteActive(r)) {
        // Invitation expirée (horloge dépassée) mais cron expire_stale_invitations
        // pas encore passée : on la traite comme terminale → le match ressort dans
        // l'Explorer et join_game gère la ré-inscription (purge la ligne périmée).
        continue;
      } else {
        myStatusByGame.set(r.game_id, r.status);
      }
    }

    const partGameIds = [...myStatusByGame.keys()];
    let participantGames: EnrichedGame[] = [];
    if (partGameIds.length > 0) {
      const { data: partGameData } = await supabase
        .from('open_games')
        .select(GAME_SELECT)
        .in('id', partGameIds);
      const nowMsPart = Date.now();
      participantGames = (partGameData ?? [])
        .filter((g: any) => {
          // Drop re-offered invitations whose game is no longer joinable.
          if (myStatusByGame.get(g.id) === 'invited'
              && (g.status === 'closed' || g.status === 'cancelled'
                  || (g.match_date && new Date(g.match_date).getTime() < nowMsPart))) {
            // Only drop if it came from a declined row (real invitations stay).
            const row = (partRows ?? []).find((r: any) => r.game_id === g.id);
            if (row?.status === 'declined') return false;
          }
          return true;
        })
        .map((g: any) => {
          const my = myStatusByGame.get(g.id);
          // For a re-offered invitation my own row is 'declined' in the DB —
          // surface it as 'invited' so the accept/refuse buttons render.
          const participants = my === 'invited'
            ? (g.participants ?? []).map((p: any) =>
                p.player_id === player.id ? { ...p, status: 'invited' } : p)
            : g.participants;
          return {
            ...g, participants, is_creator: false, my_status: my,
            // Les participants validés voient aussi le nombre de demandes en attente.
            pending_count: (participants ?? []).filter((p: any) => p.status === 'pending').length,
          };
        });
    }

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
    // Modération : masquer les parties créées par un utilisateur bloqué (2 sens).
    const hidden = await getHiddenPlayerIds(player.id);
    setGames((explorerRes.data ?? []).filter((g: any) => !alreadyInIds.has(g.id) && genderAllowed(g) && notExpired(g) && !hidden.has(g.creator_id)) as EnrichedGame[]);

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
      router.setParams({ tab: undefined, role: undefined });
    } else if (tabParam === 'history') {
      setTab('history');
      router.setParams({ tab: undefined });
    }
  }, [tabParam]);

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

    // Hors-niveau (candidature normale, pas waitlist) → demander un mot optionnel
    // AVANT d'envoyer. Les joueurs dans-le-niveau (acceptés direct) ou la waitlist
    // gardent le chemin direct sans feuille.
    if (!joinWaitlist && game && getEloFit(game, myElo) !== 'fit') {
      setNoteSheet({ gameId, side: teamSide });
      return;
    }
    return submitApplication(gameId, joinWaitlist, teamSide);
  };

  // Envoi effectif de la candidature (avec note optionnelle). Séparé de
  // handleApply pour que la feuille hors-niveau puisse le rappeler après saisie.
  const submitApplication = async (gameId: string, joinWaitlist: boolean, teamSide?: string, note?: string) => {
    if (!player) return;
    const game = games.find(g => g.id === gameId) ?? upcomingGames.find(g => g.id === gameId);
    // Candidature atomique côté serveur : gate sur l'occupation vivante
    // (invités expirés exclus), pas de surbooking concurrent. Renvoie le
    // statut attribué ; on enchaîne sur les notifs adéquates.
    let newStatus: string;
    try {
      newStatus = await joinGame(gameId, teamSide, joinWaitlist, note);
    } catch (error: any) {
      if (isCreatorConflict(error)) {
        Alert.alert(
          'Créneau déjà occupé',
          "Tu es l'organisateur·trice d'un match sur un créneau équivalent ou rapproché (~2h). Annule-le ou transfère-en l'organisation avant de créer ou rejoindre une partie.",
        );
      } else {
        Alert.alert('Erreur', error.message ?? 'Candidature échouée');
      }
      throw error;
    }

    if (newStatus === 'accepted' && game) {
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
      const approverIds = [
        game?.creator_id,
        ...(game?.participants?.filter((p: any) => p.status === 'accepted').map((p: any) => p.player_id) ?? []),
      ].filter((id: string | undefined): id is string => !!id && id !== player.id);
      if (approverIds.length > 0) {
        const loc = game?.location ? ` à ${game.location}` : '';
        const preview = note && note.trim()
          ? ` — « ${note.trim().slice(0, 60)}${note.trim().length > 60 ? '…' : ''} »`
          : '';
        notifyPlayers({
          playerIds: approverIds,
          title: '📋 Nouvelle demande',
          body: `${player.name} veut rejoindre la partie${loc}${preview}`,
          data: { type: 'lobby', gameId },
        });
      }
      Alert.alert('Demande envoyée !', 'Les participants doivent accepter ta demande.');
      setOpenGameId(null);
    } else if (newStatus === 'waitlist') {
      Alert.alert(
        "Liste d'attente",
        "La partie est complète — tu es sur la liste d'attente. Tu seras prévenu·e dès qu'une place se libère.",
      );
      setOpenGameId(null);
    }
    fetchData();
  };

  const handlePublish = async (data: WizardResult): Promise<string> => {
    if (!player) throw new Error('Not logged in');

    const matchDate = new Date(`${data.matchDate}T${data.matchTime}:00`);
    const matchDateIso = matchDate.toISOString();

    // ── Conflict pre-check — warn but allow override.
    // Chevauchement strict des intervalles [début, début+durée+marge) :
    // conflit si |début1 − début2| < (1h30 jeu + 30 min marge) = 2h.
    // Un écart pile de 2h (19h vs 21h) ne se chevauche pas → pas de conflit.
    const OVERLAP_MS = 2 * 60 * 60 * 1000;
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
        .select('status, invite_expires_at, game:game_id(id, location, match_date, status)')
        .eq('player_id', player.id)
        .in('status', ['accepted', 'pending', 'invited', 'waitlist']),
    ]);

    // La requête borne à ±2h *inclus* (gte/lte) ; on re-filtre en strict pour
    // exclure l'écart pile de 2h (qui ne se chevauche pas).
    const createdConflicts = (myCreated ?? []).filter((g: any) =>
      g.match_date && Math.abs(new Date(g.match_date).getTime() - matchDate.getTime()) < OVERLAP_MS);
    const joinedConflicts = (myJoined ?? []).filter((p: any) => {
      const g = p.game;
      if (!g || g.status === 'cancelled') return false;
      if (!g.match_date) return false;
      // Invitation expirée → plus un engagement, pas un conflit.
      if (p.status === 'invited' && !isInviteActive(p)) return false;
      const t = new Date(g.match_date).getTime();
      return Math.abs(t - matchDate.getTime()) < OVERLAP_MS;
    });
    const totalConflicts = createdConflicts.length + joinedConflicts.length;

    if (totalConflicts > 0) {
      const fmt = (d: string) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const createdLines = createdConflicts.map((g: any) => `• ${fmt(g.match_date)} — ${g.location ?? '?'}`);
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
          `Tu organises déjà ${nCreated > 1 ? `${nCreated} parties` : 'une partie'} au même créneau (±2h) :\n\n` +
          `${createdLines.join('\n')}\n\n` +
          `En publiant celle-ci, tu auras ${nCreated + 1} parties à gérer simultanément — tu devras en annuler une plus tard depuis sa fiche.`;
      } else if (nCreated === 0 && nJoined > 0) {
        // Pur conflit candidature/inscription
        body =
          `Tu es déjà engagé sur ${nJoined > 1 ? `${nJoined} parties` : 'une partie'} au même créneau (±2h) :\n\n` +
          `${joinedLines.join('\n')}\n\n` +
          `En publiant, ces engagements seront automatiquement retirés.`;
      } else {
        // Mixte
        body =
          `Tu as ${nCreated + nJoined} parties au même créneau (±2h) :\n\n` +
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

    // Pousse une notif aux joueurs dont une alerte correspond à cette partie
    // (moteur de matching DB find_matching_alerts → send-push). Fire-and-forget.
    notifyMatchingAlerts(game.id, data.location);

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

    // Cas limite : un joueur dans-le-niveau a pu prendre la place pendant le
    // vote (un `pending` ne réserve aucune place). Re-vérifier qu'une place
    // vivante est libre avant d'accepter ; sinon on enregistre l'approbation
    // mais on n'accepte pas (le vote reste en attente d'une place).
    const liveOccupants = 1 + (game?.participants ?? [])
      .filter((p: any) => p.id !== participantId && occupiesSpot(p)).length;
    const spotFree = liveOccupants < 4;
    const willAccept = allApproved && spotFree;
    if (allApproved && !spotFree) {
      Alert.alert(
        'Partie complète',
        "Une place a été prise entre-temps — le vote reste en attente d'une place libre.",
      );
    }

    // If all approved, resolve which side to assign
    let assignedSide: string | null = null;
    if (willAccept && game) {
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
        ...(willAccept ? { status: 'accepted', team_side: assignedSide } : {}),
      })
      .eq('id', participantId);

    if (error) {
      if (isCreatorConflict(error)) {
        Alert.alert(
          'Créneau déjà occupé',
          'Ce joueur organise une autre partie à un créneau équivalent ou rapproché (~2h) — sa candidature ne peut pas être acceptée.',
        );
      } else {
        Alert.alert('Erreur', error.message);
      }
      return;
    }

    if (willAccept) {
      // Le candidat prend maintenant une vraie place → libérer une place de moins.
      // (Une candidature `pending` ne réservait rien, contrairement à une invitation.)
      if (game) {
        await supabase.from('open_games')
          .update({ spots_available: Math.max(0, (game.spots_available ?? 1) - 1) })
          .eq('id', gameId);
      }
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

            // Libération de place déléguée à la fonction serveur partagée
            // (promotion du 1er waitlister, sinon +1 compteur). La notif de
            // promotion part du webhook notify-promotion (waitlist→accepted).
            await supabase.rpc('free_spot_and_promote', { p_game_id: gameId });
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
              .filter((p: any) =>
                ['accepted', 'pending', 'waitlist'].includes(p.status)
                || (p.status === 'invited' && isInviteActive(p)))
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

    // On n'invite que les comptes encore actifs : un compte supprimé ne peut plus
    // accepter (plus d'auth) et bloquerait le créneau à vie. Son slot reste libre.
    const { data: players } = await supabase
      .from('players')
      .select('id, name, elo_score')
      .in('id', allIds)
      .is('deleted_at', null);
    const byId = new Map((players ?? []).map((p: any) => [p.id, p]));

    const invites: Partial<Record<'A1' | 'B0' | 'B1', { id: string; name: string; elo_score: number }>> = {};
    if (partnerId && byId.has(partnerId)) invites.A1 = byId.get(partnerId);
    if (opp1Id && byId.has(opp1Id))       invites.B0 = byId.get(opp1Id);
    if (opp2Id && byId.has(opp2Id))       invites.B1 = byId.get(opp2Id);

    // Combien de joueurs du match d'origine ne sont plus invitables (supprimés) ?
    const skipped = allIds.filter((pid) => !byId.has(pid)).length;
    if (skipped > 0) {
      Alert.alert(
        'Rejouer',
        skipped === 1
          ? 'Un joueur de ce match n’est plus sur l’app — sa place reste libre dans la nouvelle partie.'
          : `${skipped} joueurs de ce match ne sont plus sur l’app — leurs places restent libres dans la nouvelle partie.`,
      );
    }

    const gameType: 'Compétitif' | 'Amical' | 'Défi' = m.is_challenge
      ? 'Défi'
      : m.game_format === 'friendly' ? 'Amical' : 'Compétitif';

    setOpenMatch(null);
    setRematchInvites(invites);
    setRematchGameType(gameType);
    setShowCreate(true);
  };

  // Ouvre le composer de story (mode Match) pré-rempli avec ce match.
  const shareMatch = (m: Match) => {
    if (!player) return;
    setStoryMatch(buildStoryMatch(m, player.id));
    setStoryComposerOpen(true);
  };

  // Données pour le composer de story. Le mode Match n'utilise pas les stats
  // joueur (cf. StoryStyles) → un StoryPlayer minimal suffit ici.
  const lwins = player?.win_count ?? 0;
  const llosses = player?.loss_count ?? 0;
  const lobbyStoryPlayer: StoryPlayer = {
    name: player?.name ?? '',
    league: getLeague(player?.elo_score ?? 1000),
    level: eloToLevel(player?.elo_score ?? 1000),
    rank: 0,
    wins: lwins, losses: llosses,
    winRate: lwins + llosses > 0 ? Math.round((lwins / (lwins + llosses)) * 100) : 0,
    streak: 0,
    recentForm: [],
  };
  const lobbyStoryInvite: InviteData = {
    cta: 'Rejoins-moi sur',
    link: SHARE_LABEL,
    appUrl: 'Télécharger l’app',
    qrValue: player ? playerStoryLink(player.id) : '',
    showApp: true, showQR: true,
  };

  // Retrait manuel d'une invitation par le créateur (silencieux côté invité).
  // RPC serveur qui vérifie l'ownership, supprime la ligne, répercute le défi
  // lié et rouvre la place (free_spot_and_promote).
  const handleWithdrawInvitation = async (gameId: string, playerId: string) => {
    if (!player) return;
    try {
      await withdrawInvitation(gameId, playerId);
    } catch (e: any) {
      Alert.alert('Erreur', e.message ?? 'Retrait échoué');
      return;
    }
    fetchData();
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
          "Tu es l'organisateur·trice d'un match sur un créneau équivalent ou rapproché (~2h). Annule-le ou transfère-en l'organisation avant de créer ou rejoindre une partie.",
        );
      } else {
        Alert.alert('Erreur', error.message);
      }
      return;
    }

    // Si cette invitation est un défi, refléter la réponse sur la table
    // `challenges` (sinon le défi reste 'pending' → toujours compté dans le badge
    // et affiché dans l'onglet « Défis reçus »). No-op si ce n'est pas un défi.
    await supabase
      .from('challenges')
      .update({ status: 'accepted' })
      .eq('game_id', gameId)
      .eq('challenged_id', player.id)
      .eq('status', 'pending');

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
    reloadNotifs();
  };

  const handleDeclineInvitation = async (participantId: string, gameId: string) => {
    if (!player) return;
    const game = upcomingGames.find(g => g.id === gameId) ?? games.find(g => g.id === gameId);

    const { error } = await supabase
      .from('game_participants')
      .update({ status: 'declined' })
      .eq('id', participantId);
    if (error) { Alert.alert('Erreur', error.message); return; }

    // Refléter le refus sur la table `challenges` (no-op si ce n'est pas un défi).
    await supabase
      .from('challenges')
      .update({ status: 'declined' })
      .eq('game_id', gameId)
      .eq('challenged_id', player.id)
      .eq('status', 'pending');

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
    reloadNotifs();
  };

  if (!player) return null;

  const upcomingBadge = upcomingGames.length;
  // Badge Explorer = nombre de parties APRÈS application des filtres (Option A).
  const exploreBadge = useMemo(
    () => filterExploreGames(games, filterMode, typeFilter, search).length,
    [games, filterMode, typeFilter, search],
  );
  const scoresToValidate = matches.filter(m => needsMyValidation(m, player.id)).length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── Header ── */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>
        <ProfileAvatarButton style={{ position: 'absolute', top: insets.top + 8, right: 16, zIndex: 20 }} />

        {/* Brand lockup — raquette + wordmark PAGMATCH */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
          <Image
            source={require('../../assets/auth/splash-racket.png')}
            style={{ width: 22, height: 22 }}
            resizeMode="contain"
          />
          <Image
            source={require('../../assets/auth/splash-wordmark.png')}
            style={{ width: 100, height: 22, marginLeft: -7 }}
            resizeMode="contain"
          />
        </View>
        {/* Title row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontSize: 26, fontFamily: Fonts.welcome, color: Colors.textOnDark, includeFontPadding: false, textAlign: 'center' }}>
              Le <Text style={{ color: Colors.brand }}>Lobby</Text>
            </Text>
            <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' }}>
              Niv. {fmtLevel(myElo)} · {games.length > 0
                ? `${games.length} partie${games.length > 1 ? 's' : ''} disponible${games.length > 1 ? 's' : ''}`
                : 'aucune partie disponible'}
            </Text>
          </View>
        </View>

        {/* Tabs — pill style */}
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 4, gap: 3 }}>
          {([
            { id: 'explorer',  label: 'Explorer',   count: exploreBadge },
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
              onRematch={handleRematch} onShare={shareMatch} />
          )}
        </ScrollView>
      )}

      {/* FAB retiré : la création se fait via l'onglet « Créer » de la barre d'onglets. */}

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
          onWithdrawInvitation={handleWithdrawInvitation}
          onLeave={handleLeaveGame}
          onCancelGame={handleCancelGame}
        />
      )}

      <ApplicationNoteSheet
        visible={noteSheet !== null}
        onCancel={() => setNoteSheet(null)}
        onSubmit={(note) => {
          if (note && containsProfanity(note)) {
            Alert.alert('Message non autorisé', 'Ton message contient des termes interdits — reformule.');
            return; // la feuille reste ouverte
          }
          const target = noteSheet;
          setNoteSheet(null);
          if (target) submitApplication(target.gameId, false, target.side, note || undefined);
        }}
      />

      <CreateWizard
        visible={showCreate}
        onClose={() => { setShowCreate(false); setChallengeWith(null); setRematchInvites(null); setRematchGameType(undefined); }}
        onPublishedDone={() => { setShowCreate(false); setChallengeWith(null); setRematchInvites(null); setRematchGameType(undefined); setTab('upcoming'); }}
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
          onShare={shareMatch}
        />
      )}

      {storyComposerOpen && player && (
        <StoryComposerV2
          visible={storyComposerOpen}
          player={lobbyStoryPlayer}
          match={storyMatch}
          invite={lobbyStoryInvite}
          initialMode="match"
          lockMode
          onClose={() => setStoryComposerOpen(false)}
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
