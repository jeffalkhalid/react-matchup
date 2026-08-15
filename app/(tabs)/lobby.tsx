import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  ActivityIndicator, TextInput, Alert, StyleSheet, Modal,
  Share, Linking, Image, useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { HeaderActions } from '../../components/HeaderActions';
import { joinGame, occupiesSpot, withdrawInvitation, isInviteActive, isCreatorConflict, isGameReadyToScore, isConfirmedInGame, pendingInviteCount, spotsLabel, SCORE_WINDOW_MS } from '../../lib/games';
import { matchNeedsMyAction } from '../../lib/matches';
import { openInMaps } from '../../lib/maps';
import ApplicationNoteSheet from '../../components/ApplicationNoteSheet';
import { containsProfanity } from '../../lib/profanity';
import { BadgePill } from '../../components/profile/BadgePill';
import { isBadgeVisible } from '../../lib/badges';
import { Icon, type IconName } from '../../components/community/icons';
import { fetchBinomeInvitations, fetchMyApplications, defiGameWithMyBinome, defiOtherBinomeCount, acceptBinomeInvitation, declineBinomeInvitation, withdrawApplication, cancelDefi, getPromotionWindowMinutes, isDefiQueueOpen, type DefiApplication } from '../../lib/defis';
import { notifyDefiConfirmed, notifyReleverDeclined, notifyBinomeQueued, notifyBinomeWithdrawn } from '../../lib/defiNotify';

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

// Décompose la date en label (« AUJOURD'HUI » / « DEMAIN » / date courte) + heure
// « HH:MM » pour le bloc horaire proéminent des cartes.
function splitDate(iso: string): { label: string; tone: 'today' | 'tomorrow' | 'other'; time: string } {
  const d = new Date(iso);
  const today = new Date();
  const tom = new Date(); tom.setDate(today.getDate() + 1);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === today.toDateString()) return { label: "AUJOURD'HUI", tone: 'today', time };
  if (d.toDateString() === tom.toDateString()) return { label: 'DEMAIN', tone: 'tomorrow', time };
  return {
    label: d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(),
    tone: 'other',
    time,
  };
}

// ─── Icons ── (inline components replaced by registry <Icon …>) ──────────────

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
          <Icon name="crown" size={Math.round(bs * 0.62)} color={Colors.primary} fill={Colors.primary} stroke={2.2} />
        </View>
      ) : null}
    </View>
  );
}

// Pastille locale aux cartes, style maquette : pleine (noir/jaune) ou contour blanc.
// `s` = échelle liée à la largeur d'écran (1 sur iPhone ≥392 dp, réduit sur Android
// étroit) pour que 4 pastilles max tiennent côte à côte sur une seule ligne.
function CardTag({ bg, fg, border, icon, s = 1, children }: {
  bg: string; fg: string; border?: string; icon?: React.ReactNode; s?: number; children: React.ReactNode;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 2,
      backgroundColor: bg, borderWidth: 1, borderColor: border ?? bg,
      paddingHorizontal: 4.5 * s, paddingVertical: 2, borderRadius: 999,
    }}>
      {icon}
      <Text style={{ color: fg, fontSize: 8 * s, letterSpacing: 0.2 * s, textTransform: 'uppercase', fontFamily: Fonts.uiBlack }}>
        {children}
      </Text>
    </View>
  );
}

// Type de match : Défi noir (épées), Compétitif jaune, Amical gris.
function TypePill({ game, s = 1 }: { game: OpenGame; s?: number }) {
  const t = getGameType(game);
  if (t === 'challenge') {
    return (
      <CardTag bg={Colors.primary} fg={Colors.textOnDark} s={s}
        icon={<Icon name="swords" size={10 * s} color={Colors.textOnDark} stroke={2.2} />}>
        Défi
      </CardTag>
    );
  }
  if (t === 'friendly') return <CardTag bg={Colors.bgCardAlt} fg={Colors.textSecondary} border={Colors.border} s={s}>Amical</CardTag>;
  return <CardTag bg={Colors.brand} fg={Colors.textOnBrand} s={s}>Compétitif</CardTag>;
}

function EloFitPill({ fit, s = 1 }: { fit: EloFit; s?: number }) {
  if (fit === 'fit')   return <CardTag bg={Colors.bgCard} fg={pillAccent('success')} border="rgba(16,185,129,0.45)" s={s}>✓ Mon niveau</CardTag>;
  if (fit === 'close') return <CardTag bg={Colors.bgCard} fg={pillAccent('warning')} border="rgba(245,158,11,0.50)" s={s}>Limite</CardTag>;
  return <CardTag bg={Colors.bgCard} fg={pillAccent('danger')} border="rgba(239,68,68,0.45)" s={s}>Hors niveau</CardTag>;
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
      if (idx !== undefined && !slots[idx]) { slots[idx] = sp; return; }
      // Fallback : rester dans la MÊME équipe (A→0/1, B→2/3), jamais traverser
      // vers l'autre équipe (un binôme A ne doit jamais apparaître côté B).
      const teamStart = String(p.team_side ?? '').startsWith('B') ? 2 : 0;
      const free = [teamStart, teamStart + 1].find(i => slots[i] === null);
      if (free !== undefined) slots[free] = sp;
    });
  return slots;
}

// ─── Slot theme ───────────────────────────────────────────────
// Thème slot NEUTRE, identique quel que soit le type de jeu : le fond des
// emplacements vides (joignables / à changer) reste blanc, bordure et accent
// gris. La couleur par type a été retirée pour alléger la card — le type est
// porté par la pastille (TypePill) seule. `game` conservé pour la signature.
function getSlotTheme(_game: OpenGame) {
  return { accent: Colors.textSecondary, bg: Colors.bgCard, border: Colors.border };
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

  // Un défi ne se rejoint JAMAIS en solo depuis le lobby : on le relève à deux
  // (binôme désigné) via le hub Défi. Les créneaux restent visibles mais non cliquables.
  const canJoin = !isCreator && !alreadyIn && !isFull && !!onApply && !game.is_challenge;
  // Dans un défi, les équipes sont fixes (binôme A vs binôme B) → aucun changement d'équipe.
  const canChange = !game.is_challenge && !isFull && (isCreator ? !!onCreatorChangeSide : (isAccepted && !!onChangeSide));

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
          <Icon name="plus" size={11} color={Colors.textMuted} stroke={2.5} />
        </View>
      ))}
    </View>
  );
}

// ─── Footer action ────────────────────────────────────────────
// Bouton du pied de carte : icône + libellé (Voir détails · Discussion · Partager).
function FooterAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={(e) => { e.stopPropagation?.(); onPress(); }}
      style={{
        flex: 1, height: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 4, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
        borderRadius: 10, paddingHorizontal: 4,
      }}
      activeOpacity={0.7}
      accessibilityLabel={label}
    >
      <Icon name={icon} size={12} color={Colors.textPrimary} stroke={2.2} />
      <Text
        numberOfLines={1}
        style={{
          fontSize: 9, fontFamily: Fonts.uiBlack, color: Colors.textPrimary,
          letterSpacing: 0.2, textTransform: 'uppercase', flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
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
  // Libellé partagé (lib/games) : jamais « Complet » si des invitations sont
  // encore en attente de réponse — cf. spotsLabel.
  const spotsText = spotsLabel(game);
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
export function GameCard({ game, variant, myElo, playerId, onPress, onApply, onChangeSide, onCreatorChangeSide, hideActions, scorable, onScorePress, onAcceptInvitation, onDeclineInvitation, footerSlot }: {
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
  footerSlot?: React.ReactNode;   // contenu additionnel rendu DANS la carte (ex. actions défi)
}) {
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  // Échelle des pastilles : 1 dès 392 dp (iPhone), réduite proportionnellement
  // sur les écrans plus étroits (Android 360) pour tenir 4 pastilles par ligne.
  const ps = Math.min(1, Math.max(0.85, winW / 392));
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
    ? `${fmtLevel(game.min_elo ?? 0)} – ${fmtLevel(game.max_elo ?? 9999)}`
    : null;
  const dt = game.match_date ? splitDate(game.match_date) : null;

  const showInlineSlots = variant !== 'history' && !!playerId;

  // Statut des places en pastille — jamais « Complet » tant que des invitations
  // attendent une réponse (cf. spotsLabel / freeSpots).
  // Style contour ambre partagé par les pastilles de statut « en cours ».
  const warnTag = { bg: Colors.bgCard, fg: pillAccent('warning'), border: 'rgba(245,158,11,0.50)' };

  const placesPill = variant !== 'history' ? (
    spotsLeft > 0 ? <CardTag bg={Colors.brand} fg={Colors.textOnBrand} s={ps}>{spotsLeft} place{spotsLeft > 1 ? 's' : ''}</CardTag>
    : pendingInviteCount(game) > 0 ? <CardTag {...warnTag} s={ps}>En attente</CardTag>
    : <CardTag bg={Colors.bgCard} fg={Colors.textSecondary} border={Colors.border} s={ps}>Complet</CardTag>
  ) : null;

  // Pastille de MON statut (À venir) : demandes à traiter, candidature en cours,
  // invitation, liste d'attente. « ✓ Inscrit » n'apporte rien dans À venir
  // (on y est forcément) → on affiche plutôt l'état des places à côté.
  // Libellés courts et sans emoji : 4 pastilles max doivent tenir sur la ligne.
  const myStatusPill = (() => {
    if (variant !== 'upcoming') return null;
    if ((game.is_creator || game.my_status === 'accepted') && (game.pending_count ?? 0) > 0) {
      return <CardTag {...warnTag} s={ps}>{game.pending_count} demande{(game.pending_count ?? 0) > 1 ? 's' : ''}</CardTag>;
    }
    if (game.my_status === 'pending') {
      const mine = (game.participants ?? []).find((p: any) => p.player_id === playerId);
      const got = (mine as any)?.approvals?.length ?? 0;
      const acceptedCount = (game.participants ?? []).filter((p: any) => p.status === 'accepted').length;
      const required = Math.min(1 + acceptedCount, 3);
      return <CardTag {...warnTag} s={ps}>Attente {got}/{required}</CardTag>;
    }
    if (game.my_status === 'invited') {
      // Défi : invité en Team A = binôme du créateur ; Team B = adversaire défié.
      const mine = (game.participants ?? []).find((p: any) => p.player_id === playerId && p.status === 'invited');
      const isBinome = game.is_challenge && String((mine as any)?.team_side ?? '').startsWith('A');
      return <CardTag {...warnTag} s={ps}>{isBinome ? 'Binôme invité' : game.is_challenge ? 'Défi reçu' : 'Invité'}</CardTag>;
    }
    if (game.my_status === 'waitlist') {
      const wl = (game.participants ?? [])
        .filter((p: any) => p.status === 'waitlist')
        .sort((a: any, b: any) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
      const idx = wl.findIndex((p: any) => p.player_id === playerId);
      const pos = idx >= 0 ? idx + 1 : null;
      return <CardTag {...warnTag} s={ps}>{pos ? `${pos === 1 ? '1ʳᵉ' : `${pos}ᵉ`} en attente` : "Liste d'attente"}</CardTag>;
    }
    return null;
  })();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.88} style={cs.card}>
      {/* En-tête : ruban date + heure (colonne gauche) | pills, club, niveau (droite) */}
      <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
        {dt && (
          <>
            {/* Colonne date + heure : compacte, date en noir sans fond. */}
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, gap: 2 }}>
              <Text style={{ fontSize: 8.5 * ps, fontFamily: Fonts.uiBlack, letterSpacing: 0.3 * ps, color: Colors.textPrimary, textTransform: 'uppercase' }}>
                {dt.label}
              </Text>
              <Text style={{ fontSize: 18, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, lineHeight: 22 }}>
                {dt.time}
              </Text>
            </View>
            {/* Trait vertical heure | détails — en retrait pour ne pas toucher les traits horizontaux. */}
            <View style={{ width: 1, backgroundColor: Colors.border, marginVertical: 12 }} />
          </>
        )}
        <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 10, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <TypePill game={game} s={ps} />
          {game.is_challenge && Number((game as any).stake_multiplier) > 1 && (
            <CardTag bg={Colors.brand} fg={Colors.textOnBrand} s={ps}
              icon={<Icon name="zap" size={10 * ps} color={Colors.textOnBrand} fill={Colors.textOnBrand} stroke={2} />}>
              ×{(+(game as any).stake_multiplier).toFixed(1)}
            </CardTag>
          )}
          {isUrgent && <CardTag bg={Colors.bgCard} fg={pillAccent('danger')} border="rgba(239,68,68,0.45)" s={ps}>🔥 {hoursLeft}h</CardTag>}
          {(game as any).gender_pref === 'men'   && <CardTag bg={Colors.bgCard} fg={Colors.textPrimary} border={Colors.border} s={ps}>Hommes</CardTag>}
          {(game as any).gender_pref === 'women' && <CardTag bg={Colors.bgCard} fg={Colors.textPrimary} border={Colors.border} s={ps}>Femmes</CardTag>}
          {(game as any).gender_pref === 'mixed' && <CardTag bg={Colors.bgCard} fg={Colors.textPrimary} border={Colors.border} s={ps}>Mixte</CardTag>}
          <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {myStatusPill}
            {placesPill}
          </View>
          </View>

          {game.location ? (
            <TouchableOpacity
              onPress={(e) => { e.stopPropagation?.(); openInMaps(game.location); }}
              activeOpacity={0.6}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              accessibilityLabel="Itinéraire vers le terrain"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <View style={{ width: 17, height: 17, borderRadius: 9, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="mapPin" size={10} color={Colors.textOnDark} stroke={2.4} />
              </View>
              <Text style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, flex: 1 }} numberOfLines={1}>
                {game.location}
              </Text>
            </TouchableOpacity>
          ) : null}
          {levelRange ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 17, height: 17, borderRadius: 9, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="signal" size={10} color={Colors.textOnDark} stroke={2.4} />
              </View>
              <Text
                style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.3, flexShrink: 1 }}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {levelRange}
              </Text>
              {variant === 'explore' && (
                <View style={{ marginLeft: 'auto' }}><EloFitPill fit={fit} s={ps} /></View>
              )}
            </View>
          ) : null}
        </View>
      </View>

      {/* Trait de section : en-tête / joueurs (en retrait des bords) */}
      <View style={{ height: 1, backgroundColor: Colors.border, marginHorizontal: 14 }} />

      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 }}>
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
            <View style={{ height: 1, backgroundColor: Colors.border, marginTop: 10, marginBottom: 8 }} />
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
          const isBinome = game.is_challenge && String((myPart as any).team_side ?? '').startsWith('A');
          return (
            <>
              <View style={{ height: 1, backgroundColor: Colors.border, marginTop: 10, marginBottom: 8 }} />
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
                    {isBinome ? 'Rejoindre le binôme' : game.is_challenge ? '⚡ Relever le défi' : '✓ Accepter'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}
        {!hideActions && game.match_date && variant !== 'history' && (() => {
          const isParticipant = variant === 'upcoming' && (game.is_creator || game.my_status === 'accepted');
          return (
            <>
              <View style={{ height: 1, backgroundColor: Colors.border, marginTop: 10, marginBottom: 8 }} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <FooterAction icon="calendar" label="Calendrier" onPress={() => openCalendar(game)} />
                {isParticipant && (
                  <FooterAction icon="message" label="Discussion" onPress={() => router.push(`/chat/${game.id}` as any)} />
                )}
                <FooterAction icon="share" label="Partager" onPress={() => shareGame(game)} />
              </View>
            </>
          );
        })()}
        {footerSlot ? (
          <View style={{ marginTop: 10, gap: 8 }}>
            <View style={{ height: 1, backgroundColor: Colors.border, marginBottom: 2 }} />
            {footerSlot}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}


// Miroir LOCAL de l'UPDATE de handleResolveAccept : adopte le contre-score
// (score_text + vainqueurs/perdants, ids ET jointures) sur l'objet en mémoire.
// Sans ça, la carte bascule dans « Matchs passés » avec l'ancien score_text
// jusqu'au prochain refetch (score contesté affiché avec les mauvais sets).
function applyCounterLocally(m: Match): Match {
  if (!m.counter_score_text) return { ...m, status: 'validated' };
  const players = [m.winner, m.winner_2, m.loser, m.loser_2].filter(Boolean) as NonNullable<Match['winner']>[];
  const byId = (pid?: string) => players.find(p => p.id === pid);
  return {
    ...m,
    status: 'validated',
    score_text: m.counter_score_text,
    winner_id: m.counter_winner_id, winner_id_2: m.counter_winner_id_2,
    loser_id: m.counter_loser_id, loser_id_2: m.counter_loser_id_2,
    winner: byId(m.counter_winner_id), winner_2: byId(m.counter_winner_id_2),
    loser: byId(m.counter_loser_id), loser_2: byId(m.counter_loser_id_2),
  };
}

// ─── Pending validation bottom sheet ──────────────────────────
function PendingValidationSheet({ matches, playerId, onClose, onValidated, onContest, onOpenVote, onResolved }: {
  matches: Match[];
  playerId: string;
  onClose: () => void;
  onValidated: (matchId: string) => void;
  onContest: (matchId: string) => void;
  onOpenVote: () => void;
  onResolved: (matchId: string, status: 'validated' | 'disputed') => void;
}) {
  const insets = useSafeAreaInsets();
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [validatedIds, setValidatedIds] = useState<Set<string>>(new Set());
  // Litige : matchId dont le champ « motif » est déroulé + son texte.
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [disputeReason, setDisputeReason] = useState('');

  // Affiche tout ce qui attend une action de ma part (validate OU resolve), plus
  // les lignes que je viens de traiter (feedback visuel avant fermeture).
  const visible = matches.filter(m => matchNeedsMyAction(m, playerId) !== null || validatedIds.has(m.id));

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

  // Résolution d'un score contesté (counter_proposed) que J'AI soumis.
  const handleResolveAccept = async (m: Match) => {
    if (validatingId) return;
    setValidatingId(m.id);
    // On adopte le résultat COMPLET du contestataire → le trigger ELO se base
    // sur le bon vainqueur au passage 'validated'.
    const { error } = await supabase
      .from('matches')
      .update({
        status: 'validated',
        score_text: m.counter_score_text ?? m.score_text,
        winner_id: m.counter_winner_id ?? null,
        winner_id_2: m.counter_winner_id_2 ?? null,
        loser_id: m.counter_loser_id ?? null,
        loser_id_2: m.counter_loser_id_2 ?? null,
      })
      .eq('id', m.id);
    setValidatingId(null);
    if (error) { Alert.alert('Erreur', "Impossible d'accepter ce score."); return; }
    if (m.counter_by) {
      notifyPlayers({
        playerIds: [m.counter_by],
        title: '✅ Score accepté',
        body: 'Ton score corrigé a été accepté.',
        data: { type: 'match', matchId: m.id },
      });
    }
    setValidatedIds(prev => new Set(prev).add(m.id));
    onResolved(m.id, 'validated');
  };

  const handleResolveDispute = async (m: Match) => {
    if (validatingId) return;
    setValidatingId(m.id);
    const { error } = await supabase
      .from('matches')
      .update({ status: 'disputed', dispute_reason: disputeReason.trim() || null })
      .eq('id', m.id);
    setValidatingId(null);
    if (error) { Alert.alert('Erreur', 'Impossible de signaler le litige.'); return; }
    setDisputingId(null);
    setDisputeReason('');
    if (m.counter_by) {
      notifyPlayers({
        playerIds: [m.counter_by],
        title: '⚖️ Litige signalé',
        body: 'Désaccord sur le score — un administrateur tranchera.',
        data: { type: 'match', matchId: m.id },
      });
    }
    setValidatedIds(prev => new Set(prev).add(m.id));
    onResolved(m.id, 'disputed');
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
              <Icon name="x" size={14} color={Colors.textSecondary} stroke={2.5} />
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

              // Contexte du match (lieu · date) — pour savoir QUELLE partie on valide.
              const loc = m.game?.location;
              const md = m.game?.match_date;
              const metaLine = (loc || md) ? (
                <Text style={{ fontSize: 11, fontWeight: '600', color: Colors.textMuted, marginBottom: 10 }} numberOfLines={1}>
                  {loc ? `📍 ${loc}` : ''}{loc && md ? '  ·  ' : ''}{md ? `📅 ${formatDate(md)}` : ''}
                </Text>
              ) : null;

              // ── Score contesté que J'AI soumis : résolution (accepter / litige) ──
              if (!isValidated && matchNeedsMyAction(m, playerId) === 'resolve') {
                const iWonCounter = m.counter_winner_id === playerId || m.counter_winner_id_2 === playerId;
                return (
                  <View key={m.id} style={{
                    backgroundColor: Colors.bgCard,
                    borderWidth: 1, borderColor: 'rgba(245,158,11,0.55)',
                    borderRadius: 14, padding: 14, marginBottom: 10,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                      <Pill variant="warning">⚠️ Score contesté</Pill>
                    </View>
                    {metaLine}
                    <View style={{ gap: 8, marginBottom: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textSecondary }}>Ton score</Text>
                        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: won ? '#047857' : '#B91C1C' }}>
                          {m.score_text} · {won ? 'victoire' : 'défaite'}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textSecondary }}>Leur version</Text>
                        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: iWonCounter ? '#047857' : '#B91C1C' }}>
                          {m.counter_score_text} · {iWonCounter ? 'victoire' : 'défaite'}
                        </Text>
                      </View>
                      {!!m.counter_reason && (
                        <View style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginBottom: 2 }}>Motif de la contestation</Text>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textPrimary, fontStyle: 'italic' }}>
                            « {m.counter_reason} »
                          </Text>
                        </View>
                      )}
                    </View>
                    {disputingId === m.id ? (
                      /* Motif du litige déroulé → confirmation */
                      <View>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginBottom: 6 }}>
                          Explique le désaccord — un administrateur tranchera
                        </Text>
                        <TextInput
                          value={disputeReason}
                          onChangeText={t => setDisputeReason(t.slice(0, 200))}
                          placeholder="Ex. : on a bien gagné 6-4, 6-3"
                          placeholderTextColor={Colors.textMuted}
                          multiline
                          style={{
                            backgroundColor: Colors.bgCardAlt, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border,
                            paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, fontWeight: '600',
                            color: Colors.textPrimary, minHeight: 56, textAlignVertical: 'top',
                          }}
                        />
                        <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600', textAlign: 'right', marginTop: 4, marginBottom: 8 }}>
                          {disputeReason.length}/200 · optionnel
                        </Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            onPress={() => { setDisputingId(null); setDisputeReason(''); }}
                            disabled={isValidating}
                            activeOpacity={0.85}
                            style={{ flex: 1, backgroundColor: Colors.bgCardAlt, borderRadius: 12, paddingVertical: 11, alignItems: 'center' }}
                          >
                            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>Annuler</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => handleResolveDispute(m)}
                            disabled={isValidating}
                            activeOpacity={0.85}
                            style={{
                              flex: 1, backgroundColor: '#B91C1C', borderRadius: 12,
                              paddingVertical: 11, alignItems: 'center', opacity: isValidating ? 0.6 : 1,
                            }}
                          >
                            {isValidating
                              ? <ActivityIndicator color={Colors.textOnDark} />
                              : <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>⚖️ Confirmer le litige</Text>}
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => handleResolveAccept(m)}
                          disabled={isValidating}
                          activeOpacity={0.85}
                          style={{
                            flex: 1, backgroundColor: Colors.success, borderRadius: 12,
                            paddingVertical: 12, alignItems: 'center', opacity: isValidating ? 0.6 : 1,
                          }}
                        >
                          {isValidating
                            ? <ActivityIndicator color={Colors.textOnDark} />
                            : <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>✅ Accepter leur score</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => { setDisputingId(m.id); setDisputeReason(''); }}
                          disabled={isValidating}
                          activeOpacity={0.85}
                          style={{
                            flex: 1, backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: 'rgba(220,38,38,0.50)',
                            borderRadius: 12, paddingVertical: 11, alignItems: 'center', opacity: isValidating ? 0.6 : 1,
                          }}
                        >
                          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: '#B91C1C' }}>⚖️ Maintenir (litige)</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              }

              // ── Score en attente : MÊME carte que l'historique (source unique
              // matchToView + <MatchCard>), statut + actions dans le footer.
              return (
                <View key={m.id} style={{ marginBottom: 10 }}>
                  <MatchScoreCard
                    m={matchToView(m, playerId)}
                    showDelta={false}
                    footer={
                      <View style={{ gap: 10, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Pill variant={isValidated ? 'success' : 'warning'}>
                            {isValidated ? '✓ Validé' : '⏳ Score à valider'}
                          </Pill>
                          {!isValidated && (
                            <Text style={{ flex: 1, fontSize: 10, fontWeight: '600', color: Colors.textMuted }} numberOfLines={1}>
                              Valide ou conteste ce score
                            </Text>
                          )}
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
                            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: '#4338ca' }}>🏅 Distribue tes badges</Text>
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
                    }
                  />
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
function MatchDetailSheet({ match, playerId, onClose, onValidated, onContest, onRematch, onShare, delta }: {
  match: Match; playerId: string; onClose: () => void;
  onValidated?: (matchId: string) => void;
  onContest?: (matchId: string) => void;
  onRematch?: (matchId: string) => void;
  delta?: number;
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
      // Seuls les badges encore définis ET actifs dans badge_defs sont montrés.
      .then(({ data }) => setBadges(((data ?? []) as any[]).filter(b => isBadgeVisible(b.badge_type)) as any));
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
            <MatchScoreCard m={{ ...matchToView(match, playerId), delta: delta ?? 0 }} showDelta={delta != null} showActions={false} onPlayerPress={(id) => { onClose(); router.push(`/player/${id}` as any); }} />
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
                    <BadgePill badge={b.badge_type} size={24} />
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
                  <Icon name="repeat" size={16} color={Colors.textOnDark} stroke={2} />
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark, letterSpacing: 0.3 }}>
                    Rejouer avec la même équipe
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
                  <Icon name="camera" size={16} color={Colors.textPrimary} stroke={2} />
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.3 }}>
                    Partager en story
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

// Pending matches the player must validate (source unique lib/matches).
function needsMyValidation(m: Match, playerId: string): boolean {
  return matchNeedsMyAction(m, playerId) === 'validate';
}

// ─── Match card (history) ─────────────────────────────────────
function MatchCard({ match, playerId, onPress, onRematch, onShare, delta }: {
  match: Match;
  playerId: string;
  onPress: () => void;
  onRematch?: (matchId: string) => void;
  onShare?: () => void;
  delta?: number;
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
          <Icon name="repeat" size={14} color={Colors.textPrimary} stroke={2} />
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.3 }}>Rejouer</Text>
        </TouchableOpacity>
      )}
      {onShare && (
        <TouchableOpacity
          onPress={(e) => { (e as any).stopPropagation?.(); onShare(); }}
          activeOpacity={0.85}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }}
        >
          <Icon name="share" size={14} color={Colors.textPrimary} stroke={2} />
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 0.3 }}>Partager</Text>
        </TouchableOpacity>
      )}
    </View>
  ) : undefined;
  return (
    <MatchScoreCard m={{ ...matchToView(match, playerId), delta: delta ?? 0 }} onPress={onPress} showDelta={delta != null} showActions={false} footer={footer} onPlayerPress={(id) => router.push(`/player/${id}` as any)} />
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
function ExploreTab({ games, myElo, filterMode, setFilterMode, typeFilter, setTypeFilter, search, setSearch, onOpenGame, playerId, onApply, onChangeSide, onCreatorChangeSide, onCreate, onRelever, appliedDefiIds }: {
  games: EnrichedGame[]; myElo: number;
  filterMode: FilterMode; setFilterMode: (v: FilterMode) => void;
  typeFilter: TypeFilter; setTypeFilter: (v: TypeFilter) => void;
  search: string; setSearch: (v: string) => void; onOpenGame: (g: EnrichedGame) => void;
  playerId: string;
  onApply: (gameId: string, side: string) => void;
  onChangeSide: (participantId: string, side: string) => void;
  onCreatorChangeSide: (gameId: string, side: string) => void;
  onCreate: () => void;
  onRelever: (gameId: string) => void;
  appliedDefiIds: Set<string>;
}) {
  // Un défi ne se rejoint pas en solo : sa carte porte un CTA « Relever (à deux) »
  // qui ouvre le flux binôme dans le hub Défi. Si j'ai DÉJÀ candidaté, on affiche
  // « Déjà postulé » (toucher rouvre le sélecteur pour changer de binôme).
  const defiFooter = (g: EnrichedGame) => {
    if (!g.is_challenge) return undefined;
    const applied = appliedDefiIds.has(g.id);
    return (
      <TouchableOpacity onPress={(e) => { e.stopPropagation?.(); onRelever(g.id); }} activeOpacity={0.85}
        style={{ backgroundColor: applied ? Colors.bgCardAlt : Colors.brand, borderWidth: applied ? 1 : 0, borderColor: Colors.border, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
        <Text style={{ color: applied ? Colors.textSecondary : Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 13 }}>
          {applied ? '⏳ Déjà postulé — changer'
            : (g as any).status === 'confirmed' ? 'Rejoindre la file (à deux)' : 'Relever le défi (à deux)'}
        </Text>
      </TouchableOpacity>
    );
  };
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
        <Icon name="search" size={16} color={Colors.textMuted} stroke={2.2} />
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
          icon={<Icon name="flame" size={12} color={filterMode === 'urgent' ? Colors.textOnDark : Colors.danger} fill={filterMode === 'urgent' ? Colors.textOnDark : Colors.danger} />}>
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
                onPress={() => onOpenGame(g)} footerSlot={defiFooter(g)} />
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
                : (
                    <View style={{
                      paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center',
                      backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
                      borderStyle: 'dashed', borderRadius: 18,
                    }}>
                      <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary, fontSize: 14, textAlign: 'center' }}>
                        Aucune partie pour l'instant
                      </Text>
                      <Text style={{ color: Colors.textMuted, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
                        Sois le premier à lancer une partie aujourd'hui
                      </Text>
                      <TouchableOpacity onPress={onCreate} activeOpacity={0.85}
                        style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11 }}>
                        <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontSize: 14 }}>＋ Créer une partie</Text>
                      </TouchableOpacity>
                    </View>
                  ))
            : <View style={{ gap: 10 }}>
                {mainList.map(g => (
                  <GameCard key={g.id} game={g} variant="explore" myElo={myElo} playerId={playerId}
                    onApply={onApply} onChangeSide={onChangeSide} onCreatorChangeSide={onCreatorChangeSide}
                    onPress={() => onOpenGame(g)} footerSlot={defiFooter(g)} />
                ))}
              </View>
          }
        </View>
      )}
    </View>
  );
}

// ─── Upcoming tab ─────────────────────────────────────────────
function UpcomingTab({ games, myElo, roleFilter, setRoleFilter, onOpenGame, playerId, onChangeSide, onCreatorChangeSide, onAcceptInvitation, onDeclineInvitation, binomeInvites, onAcceptBinome, onDeclineBinome, myDefiApps, otherBinomeCounts, onWithdrawApp }: {
  games: EnrichedGame[]; myElo: number;
  roleFilter: RoleFilter; setRoleFilter: (v: RoleFilter) => void;
  onOpenGame: (g: EnrichedGame) => void;
  playerId: string;
  onChangeSide: (participantId: string, side: string) => void;
  onCreatorChangeSide: (gameId: string, side: string) => void;
  onAcceptInvitation: (participantId: string, gameId: string) => void;
  onDeclineInvitation: (participantId: string, gameId: string) => void;
  binomeInvites: DefiApplication[];
  onAcceptBinome: (app: DefiApplication) => void;
  onDeclineBinome: (app: DefiApplication) => void;
  myDefiApps: DefiApplication[];
  otherBinomeCounts: Record<string, number>;
  onWithdrawApp: (app: DefiApplication) => void;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const byType = (g: EnrichedGame) => typeFilter === 'all' || getGameType(g) === typeFilter;

  // Tri par date croissante : le match le plus proche en premier. Les parties
  // sans date (rare) sont rejetées en fin de liste.
  const byDateAsc = (a: EnrichedGame, b: EnrichedGame) => {
    const ta = a.match_date ? new Date(a.match_date).getTime() : Infinity;
    const tb = b.match_date ? new Date(b.match_date).getTime() : Infinity;
    return ta - tb;
  };

  const created = games.filter(g => g.is_creator).filter(byType);
  const accepted = games.filter(g => !g.is_creator && g.my_status === 'accepted').filter(byType);
  const invited  = games.filter(g => !g.is_creator && g.my_status === 'invited').filter(byType).sort(byDateAsc);
  const pending  = games.filter(g => !g.is_creator && g.my_status === 'pending').filter(byType).sort(byDateAsc);
  const waitlisted = games.filter(g => !g.is_creator && g.my_status === 'waitlist').filter(byType).sort(byDateAsc);

  // Liste plate « mes parties » : j'organise + je joue fusionnés (classification
  // de rôle retirée), triés par date croissante. Seules les invitations à
  // répondre restent en haut, et l'attente/approbation + liste d'attente en bas.
  const mine = [...created, ...accepted].sort(byDateAsc);

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

      {/* Invitations binôme défi : j'ai été choisi comme partenaire pour relever
          un défi → carte COMPLÈTE du défi (adversaires / lieu / date) + accepter / refuser. */}
      {binomeInvites.length > 0 && (
        <Section title="Invitations binôme" count={binomeInvites.length} color={Colors.brand} icon={<Icon name="users" size={14} color={Colors.textOnBrand} stroke={2.2} />}>
          {binomeInvites.map(app => app.game ? (
            <View key={app.id} style={{ marginBottom: 10 }}>
              <GameCard
                game={{ ...app.game, is_creator: false } as any}
                variant="upcoming" myElo={myElo} playerId={playerId} onPress={() => onOpenGame(app.game as any)}
                footerSlot={
                  <View style={{ gap: 8 }}>
                    <Text style={{ fontSize: 12, color: Colors.textSecondary }}>
                      <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>{app.initiator?.name ?? 'Quelqu\'un'}</Text> t'invite à relever ce défi avec lui.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity onPress={() => onDeclineBinome(app)}
                        style={{ flex: 1, backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>Refuser</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => onAcceptBinome(app)}
                        style={{ flex: 1, backgroundColor: Colors.brand, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnBrand }}>Accepter</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                }
              />
            </View>
          ) : null)}
        </Section>
      )}

      {/* Mes candidatures à relever : mon binôme (moi + partenaire invité) en
          transparent sur Team B, tant que la place n'est pas verrouillée. */}
      {myDefiApps.length > 0 && (
        <Section title="Mes candidatures" count={myDefiApps.length} color={Colors.brand} icon={<Icon name="swords" size={14} color={Colors.textOnBrand} stroke={2.2} />}>
          {myDefiApps.map(a => {
            const g = defiGameWithMyBinome(a);
            if (!g) return null;
            const mate = a.initiator_id === playerId ? a.partner : a.initiator;
            const others = (a.game_id && otherBinomeCounts[a.game_id]) || 0;
            return (
              <View key={'app-' + a.id} style={{ marginBottom: 10 }}>
                <GameCard game={g as any} variant="upcoming" myElo={myElo} playerId={playerId} onPress={() => onOpenGame(g as any)}
                  footerSlot={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Pill variant="warning">{a.status === 'queued' ? '⏳ En file' : '⏳ Candidature'}</Pill>
                      {others > 0 && <Pill variant="neutral">+{others} binôme{others > 1 ? 's' : ''}</Pill>}
                      <Text style={{ flex: 1, fontSize: 11.5, color: Colors.textSecondary }} numberOfLines={1}>
                        avec <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>{mate?.name ?? '?'}</Text>
                      </Text>
                      <TouchableOpacity onPress={(e) => { (e as any).stopPropagation?.(); onWithdrawApp(a); }}
                        style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 9, borderWidth: 1, borderColor: Colors.border }}>
                        <Text style={{ fontSize: 11, fontWeight: '800', color: Colors.danger }}>Retirer</Text>
                      </TouchableOpacity>
                    </View>
                  }
                />
              </View>
            );
          })}
        </Section>
      )}

      {/* En haut : invitations à répondre (action requise). */}
      {invited.length > 0 && (
        <Section title="À répondre" count={invited.length} color={Colors.brand} icon={<Icon name="mail" size={14} color={Colors.textOnBrand} stroke={2.2} />}>
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
      {/* Liste plate : mes parties (organisées + jointes), triées par date,
          sans bannière de rôle. Chaque carte porte déjà sa pastille de statut. */}
      {mine.length > 0 && (
        <View style={{ gap: 10, marginBottom: 18 }}>
          {mine.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </View>
      )}
      {/* En bas : statuts non confirmés. */}
      {pending.length > 0 && (
        <Section title="En attente d'approbation" count={pending.length} color={Colors.warning} icon={<Icon name="hourglass" size={14} color={Colors.textOnDark} stroke={2.2} />}>
          {pending.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {waitlisted.length > 0 && (
        <Section title="Liste d'attente" count={waitlisted.length} color={Colors.textMuted} icon={<Icon name="clock" size={14} color={Colors.textOnDark} stroke={2.2} />}>
          {waitlisted.map(g => <GameCard key={g.id} game={g} variant="upcoming" myElo={myElo} onPress={() => onOpenGame(g)} {...cardProps} />)}
        </Section>
      )}
      {created.length + accepted.length + invited.length + pending.length + waitlisted.length + binomeInvites.length === 0 && (
        <EmptyState text="Aucune partie à venir" sub={typeFilter !== 'all' ? 'Aucun match de ce type' : 'Explore le lobby ou crée la tienne'} />
      )}
    </View>
  );
}

// ─── History tab ──────────────────────────────────────────────
function HistoryTab({ matches, playerId, onOpenMatch, pastCompleteGames, onOpenGame, onScoreGame, onRematch, onShare, eloDeltaByMatch }: {
  matches: Match[]; playerId: string; onOpenMatch: (m: Match) => void;
  pastCompleteGames: EnrichedGame[]; onOpenGame: (g: EnrichedGame) => void;
  onScoreGame: (gameId: string) => void;
  onRematch: (matchId: string) => void;
  onShare: (m: Match) => void;
  eloDeltaByMatch: Record<string, number>;
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
        <Icon name="search" size={16} color={Colors.textMuted} stroke={2.2} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Rechercher un joueur, un lieu…"
          placeholderTextColor={Colors.textMuted}
          style={{ flex: 1, fontSize: 13, color: Colors.textPrimary }}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="x" size={14} color={Colors.textMuted} stroke={2.5} />
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
              <MatchCard match={m} playerId={playerId} onPress={() => onOpenMatch(m)} onRematch={onRematch} onShare={() => onShare(m)} delta={eloDeltaByMatch[m.id]} />
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
  const { create, tab: tabParam, challenge, 'with': withId, pname, pelo, pside, openValidation, gameId: gameIdParam, backToDefi, rematch: rematchParam, targeted, b0, b0n, b0e, b1, b1n, b1e } = useLocalSearchParams<{ create?: string; tab?: string; challenge?: string; with?: string; pname?: string; pelo?: string; pside?: string; openValidation?: string; gameId?: string; backToDefi?: string; rematch?: string; targeted?: string; b0?: string; b0n?: string; b0e?: string; b1?: string; b1n?: string; b1e?: string }>();
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
  // Gain/perte de niveau par match (depuis elo_history) — cartes Historique + fiche match.
  const [eloDeltaByMatch, setEloDeltaByMatch] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  const [noteSheet, setNoteSheet] = useState<{ gameId: string; side?: string } | null>(null);
  const [openMatch, setOpenMatch] = useState<Match | null>(null);
  const [pendingSheetOpen, setPendingSheetOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [challengeWith, setChallengeWith] = useState<{ id: string; name: string; elo_score: number; court_side?: string } | null>(null);
  // Ouverture du wizard directement en mode Défi 2v2 (depuis le hub Défi, sans cible).
  const [openDefiMode, setOpenDefiMode] = useState(false);
  const [rematchInvites, setRematchInvites] = useState<Partial<Record<'A1' | 'B0' | 'B1', { id: string; name: string; elo_score: number }>> | null>(null);
  const [rematchGameType, setRematchGameType] = useState<'Compétitif' | 'Amical' | 'Défi' | undefined>(undefined);
  const [targetedInvites, setTargetedInvites] = useState<Partial<Record<'B0' | 'B1', { id: string; name: string; elo_score: number }>> | null>(null);
  const [targetedMode, setTargetedMode] = useState(false);
  const [storyMatch, setStoryMatch] = useState<StoryMatchData | null>(null);
  const [storyComposerOpen, setStoryComposerOpen] = useState(false);
  const [binomeInvites, setBinomeInvites] = useState<DefiApplication[]>([]);
  // Défis où j'ai DÉJÀ une candidature en attente (initiateur) → pas de « Relever » à nouveau.
  const [appliedDefiIds, setAppliedDefiIds] = useState<Set<string>>(new Set());
  // Mes candidatures défi (pour les afficher dans « À venir » avec mon binôme transparent).
  const [myDefiApps, setMyDefiApps] = useState<DefiApplication[]>([]);
  const [otherBinomeCounts, setOtherBinomeCounts] = useState<Record<string, number>>({});
  // Détail d'une partie ABSENTE des listes (défi « à relever » / invitation à
  // relever) : chargée à la demande par id pour le GameDetailsSheet.
  const [detailGame, setDetailGame] = useState<EnrichedGame | null>(null);
  // Si le détail a été ouvert depuis le hub Défi (?backToDefi=<onglet>), on y
  // RETOURNE à la fermeture au lieu de laisser l'utilisateur dans le lobby.
  const returnToDefiRef = useRef<string | null>(null);

  // Derived: always reflects latest fetched data — no stale snapshots
  const openGame = useMemo(
    () => [...games, ...upcomingGames, ...pastCompleteGames].find(g => g.id === openGameId)
      ?? (detailGame?.id === openGameId ? detailGame : null),
    [openGameId, games, upcomingGames, pastCompleteGames, detailGame],
  );

  // Ouvre le détail d'une partie par id, en la chargeant si elle n'est pas déjà
  // dans les listes (cas des défis non rejoints : à relever, invitation).
  const openGameById = useCallback(async (id: string) => {
    const inList = [...games, ...upcomingGames, ...pastCompleteGames].some(g => g.id === id);
    if (!inList) {
      const { data } = await supabase
        .from('open_games')
        .select('*, creator:creator_id(id, name, elo_score, win_count, loss_count), participants:game_participants(id, player_id, status, team_side, approvals, application_note, created_at, invite_expires_at, player:player_id(id, name, elo_score, win_count, loss_count))')
        .eq('id', id)
        .single();
      if (data) setDetailGame({ ...(data as any), is_creator: (data as any).creator_id === player?.id });
      else return;
    }
    setOpenGameId(id);
  }, [games, upcomingGames, pastCompleteGames, player?.id]);

  const myElo = player?.elo_score ?? 1000;

  const fetchData = useCallback(async () => {
    if (!player) return;

    const GAME_SELECT = '*, creator:creator_id(id, name, elo_score, win_count, loss_count), participants:game_participants(id, player_id, status, team_side, approvals, application_note, created_at, invite_expires_at, player:player_id(id, name, elo_score, win_count, loss_count))';
    const MATCH_SELECT = '*, winner:winner_id(id, name, deleted_at, elo_score), winner_2:winner_id_2(id, name, deleted_at, elo_score), loser:loser_id(id, name, deleted_at, elo_score), loser_2:loser_id_2(id, name, deleted_at, elo_score), game:game_id(location, match_date, creator_id)';
    const myMatchOr = `winner_id.eq.${player.id},loser_id.eq.${player.id},winner_id_2.eq.${player.id},loser_id_2.eq.${player.id}`;
    const scoreWindowAgo = new Date(Date.now() - SCORE_WINDOW_MS).toISOString();

    const [explorerRes, createdRes, matchesActionRes, matchesHistoryRes, scoredRecentRes, binomeInvitesRes, myAppsRes, eloHistRes] = await Promise.all([
      supabase
        .from('open_games')
        .select(GAME_SELECT)
        // Parties ouvertes + défis CONFIRMÉS (leur file d'attente reste
        // rejoignable — filtrée par fenêtre plus bas). Jamais de 'draft'.
        .or('status.eq.open,and(status.eq.confirmed,is_challenge.eq.true)')
        .neq('creator_id', player.id)
        // Les défis (non ciblés) SONT visibles dans l'explorer, mais on ne les
        // rejoint PAS en solo : la carte propose « Relever le défi (à deux) »
        // qui ouvre le flux binôme. On exclut seulement les défis CIBLÉS
        // (adversaires nommés, jamais ouverts au public).
        .or('is_targeted.is.null,is_targeted.eq.false')
        // Pas de limit : la liste alimente le badge « Explorer ».
        .order('created_at', { ascending: false }),
      supabase
        .from('open_games')
        .select(GAME_SELECT)
        .eq('creator_id', player.id)
        // 'draft' inclus : mon défi en attente que mon binôme accepte doit
        // apparaître dans « À venir » (créneau du partenaire = avatar « invité »).
        // 'confirmed' inclus : un défi que j'ai créé passe 'confirmed' quand le
        // binôme adverse verrouille (defi_accept) — sans lui, le match disparaissait
        // du lobby pour le créateur alors que l'accueil le comptait.
        // Pas de limit : la liste alimente le badge « À venir ».
        .in('status', ['draft', 'open', 'closed', 'confirmed'])
        .order('created_at', { ascending: false }),
      // Scores demandant une action (validation/litige) : COMPLET, sans limit —
      // tronqué, un score à valider deviendrait invisible (section + compteur).
      supabase
        .from('matches')
        .select(MATCH_SELECT)
        .or(myMatchOr)
        .in('status', ['pending', 'counter_proposed'])
        .order('created_at', { ascending: false }),
      // Historique validé : troncature d'affichage assumée (20 derniers).
      supabase
        .from('matches')
        .select(MATCH_SELECT)
        .or(myMatchOr)
        .eq('status', 'validated')
        .order('created_at', { ascending: false })
        .limit(20),
      // Complément pour scoredGameIds : ids de TOUS mes matchs de la fenêtre
      // 48 h, sans limit — sinon une partie scorée au-delà des 20 derniers
      // validés réapparaîtrait dans « à scorer ».
      supabase
        .from('matches')
        .select('game_id')
        .or(myMatchOr)
        .gte('created_at', scoreWindowAgo),
      fetchBinomeInvitations(player.id),
      fetchMyApplications(player.id),
      // Mon gain/perte par match (en-tête des cartes Historique) — même
      // calcul que le profil : elo_history avant/après converti en niveau.
      supabase
        .from('elo_history')
        .select('match_id, elo_score, elo_change')
        .eq('player_id', player.id),
    ]);
    setBinomeInvites(binomeInvitesRes);
    setAppliedDefiIds(new Set((myAppsRes ?? []).map(a => a.game_id).filter(Boolean)));
    setMyDefiApps(myAppsRes ?? []);
    // « X autres binômes » par défi candidaté (RLS → RPC).
    (async () => {
      const counts: Record<string, number> = {};
      await Promise.all((myAppsRes ?? []).map(async a => {
        if (a.game_id) counts[a.game_id] = await defiOtherBinomeCount(a.game_id);
      }));
      setOtherBinomeCounts(counts);
    })();

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
    // Défi confirmé : visible seulement tant que sa file d'attente est ouverte
    // (hors fenêtre de promotion — dedans, y entrer serait inutile).
    const promoWin = await getPromotionWindowMinutes();
    setGames((explorerRes.data ?? []).filter((g: any) =>
      !alreadyInIds.has(g.id) && genderAllowed(g) && notExpired(g) && !hidden.has(g.creator_id)
      && (!g.is_challenge || isDefiQueueOpen(g, promoWin))) as EnrichedGame[]);

    const allUpcoming = [...creatorGames, ...participantGames];
    const now = new Date();
    // Actions d'abord (tri created_at desc préservé par section), historique ensuite.
    const matchRows = [
      ...(matchesActionRes.data ?? []),
      ...(matchesHistoryRes.data ?? []),
    ] as Match[];
    const scoredGameIds = new Set(
      [
        ...matchRows.map((m: any) => m.game_id),
        ...(scoredRecentRes.data ?? []).map((r: any) => r.game_id),
      ].filter(Boolean) as string[]
    );
    // Point de vérité unique partagé avec badge / notifications / score-entry
    // (lib/games.isGameReadyToScore) : full DÉRIVÉ des participants (plus de
    // dépendance à spots_available), ni close/cancel, dans la fenêtre 48 h,
    // pas déjà scoré, et j'y ai joué (créateur ou accepté).
    const readyToScore = (g: EnrichedGame) => isGameReadyToScore(g, player.id, scoredGameIds);

    setUpcomingGames(allUpcoming.filter(g =>
      (g as any).status !== 'cancelled' &&
      !readyToScore(g) &&
      (!g.match_date || new Date(g.match_date) >= now)
    ));
    setPastCompleteGames(allUpcoming.filter(readyToScore));
    const deltas: Record<string, number> = {};
    ((eloHistRes.data ?? []) as { match_id: string | null; elo_score: number; elo_change: number | null }[]).forEach(h => {
      if (!h.match_id) return;
      deltas[h.match_id] = eloToLevel(h.elo_score) - eloToLevel(h.elo_score - (h.elo_change ?? 0));
    });
    setEloDeltaByMatch(deltas);
    setMatches(matchRows);
    setLoading(false);
  }, [player]);

  useFocusEffect(useCallback(() => { fetchData(); }, [fetchData]));

  useEffect(() => {
    if (create === '1') {
      if (targeted === '1' && b0 && b1) {
        // Défi ciblé (« Défier ce binôme » depuis la vitrine) → wizard en mode Défi + invites pré-remplies
        setTargetedInvites({
          B0: { id: b0, name: decodeURIComponent(b0n ?? ''), elo_score: Number(b0e ?? 0) },
          B1: { id: b1, name: decodeURIComponent(b1n ?? ''), elo_score: Number(b1e ?? 0) },
        });
        setTargetedMode(true);
        setOpenDefiMode(true);
        router.setParams({ create: undefined, challenge: undefined, targeted: undefined, b0: undefined, b0n: undefined, b0e: undefined, b1: undefined, b1n: undefined, b1e: undefined });
      } else if (challenge === '1' && withId) {
        setChallengeWith({
          id: withId,
          name: decodeURIComponent(pname ?? ''),
          elo_score: Number(pelo ?? 0),
          court_side: pside || undefined,
        });
        router.setParams({ create: undefined, challenge: undefined, with: undefined, pname: undefined, pelo: undefined, pside: undefined });
      } else if (challenge === '1') {
        // Défi 2v2 sans cible (depuis le hub) → wizard en mode Défi
        setOpenDefiMode(true);
        router.setParams({ create: undefined, challenge: undefined, with: undefined, pname: undefined, pelo: undefined, pside: undefined });
      } else {
        router.setParams({ create: undefined, challenge: undefined, with: undefined, pname: undefined, pelo: undefined, pside: undefined });
      }
      setShowCreate(true);
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

  // Auto-ouvre le GameDetailsSheet quand on arrive depuis une notif ou une carte
  // défi (lien ?gameId=). Charge la partie par id si elle n'est pas dans les listes.
  useEffect(() => {
    if (!gameIdParam || loading) return;
    returnToDefiRef.current = backToDefi ?? null;   // retour au hub à la fermeture ?
    setTab('upcoming');
    openGameById(gameIdParam);
    router.setParams({ gameId: undefined, backToDefi: undefined });
  }, [gameIdParam, loading, openGameById, backToDefi]);

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
          '⚠️ Conflit de créneau',
          'Tu es déjà sur une autre partie au même créneau (±2h). Annule-la ou quitte-la avant de rejoindre celle-ci.',
        );
      } else {
        console.warn('[lobby] candidature refusée:', error);
        Alert.alert('Impossible de rejoindre', 'Une erreur est survenue, réessaie dans un instant.');
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
    const nowMs = Date.now();
    const joinedConflicts = (myJoined ?? []).filter((p: any) => {
      const g = p.game;
      if (!g || g.status === 'cancelled') return false;
      if (!g.match_date) return false;
      // Invitation expirée → plus un engagement, pas un conflit.
      if (p.status === 'invited' && !isInviteActive(p)) return false;
      const t = new Date(g.match_date).getTime();
      // Engagement non confirmé (candidature/invité/liste d'attente) sur une partie
      // déjà commencée → elle s'est faite (ou non) sans moi, plus un conflit.
      if (p.status !== 'accepted' && t <= nowMs) return false;
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

    // Défi NON ciblé : seule l'invitation du binôme (Team A) est valide —
    // Team B se remplit par candidature (defi_apply/defi_accept). Des invites
    // B arrivaient ici par « Défier » depuis un profil ou un vieux « Rejouer »
    // (état invisible du wizard) et cassaient le cycle de vie ; le serveur
    // les refuse aussi désormais (trg_defi_no_b_invite).
    const isOpenDefi = data.gameType === 'Défi' && data.isTargeted !== true;
    const invitedPlayers = data.confirmedPlayers
      .filter(p => !isOpenDefi || String(p.team_side ?? 'A_GAU').startsWith('A'));

    const { data: game, error } = await supabase
      .from('open_games')
      .insert({
        creator_id: player.id,
        creator_side: data.creatorSide,
        game_format: data.gameType === 'Amical' ? 'friendly' : 'competitive',
        is_challenge: data.gameType === 'Défi',
        is_targeted: data.isTargeted === true,
        stake_multiplier: data.gameType === 'Défi' ? data.stakeMultiplier : 1.0,
        gender_pref: data.genre,
        match_date: matchDateIso,
        location: data.location,
        has_reservation: data.hasReservation,
        min_elo: data.isTargeted ? null : padelLevelToElo(data.minLevel),
        max_elo: data.isTargeted ? null : padelLevelToElo(data.maxLevel),
        status: data.gameType === 'Défi' ? (data.isTargeted ? 'open' : 'draft') : 'open',
        spots_available: 3 - invitedPlayers.length,
      })
      .select('id')
      .single();

    if (error || !game) { Alert.alert('Erreur', error?.message ?? 'Création échouée'); throw error; }

    const invites = invitedPlayers.map(p => ({
      game_id: game.id,
      player_id: p.id,
      status: 'invited' as const,
      team_side: p.team_side ?? 'A_GAU',
    }));

    console.log('[handlePublish] game created', { gameId: game.id, isChallenge: data.gameType === 'Défi', invites });
    if (invites.length > 0) {
      const { error: partErr } = await supabase.from('game_participants').insert(invites);
      if (partErr) {
        // Ne pas avaler : sans cette ligne, le partenaire n'est jamais invité
        // (défi créé mais binôme fantôme, ni notif ni visibilité pour l'invité).
        console.log('[handlePublish] invite insert FAILED', partErr);
        // Best-effort : ne pas laisser une partie orpheline sans invités.
        try {
          if (data.gameType === 'Défi') await cancelDefi(game.id);
          else await supabase.from('open_games').update({ status: 'cancelled' }).eq('id', game.id);
        } catch { /* la partie orpheline reste annulable à la main */ }
        Alert.alert('Invitation échouée', `Le partenaire n'a pas pu être invité : ${partErr.message}`);
        throw partErr;
      }
      const isChallenge = data.gameType === 'Défi';
      notifyPlayers({
        playerIds: invites.map(i => i.player_id),
        title: isChallenge ? 'Invitation binôme' : '⚡ Invitation reçue',
        body: isChallenge
          ? `${player.name} t'invite comme binôme pour un défi 2v2`
          : `${player.name} t'invite à une partie de padel`,
        data: { type: 'lobby', gameId: game.id },
      });

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
          '⚠️ Conflit de créneau',
          'Ce joueur est déjà engagé sur une autre partie au même créneau (±2h) — sa candidature ne peut pas être acceptée.',
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
            // Défi : ne PAS appeler — le départ atomique (trg_defi_teammate_leave)
            // gère tout ; cet appel ressuscitait en 'open' un défi annulé.
            if (!game?.is_challenge) {
              await supabase.rpc('free_spot_and_promote', { p_game_id: gameId });
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
            // Défi : passer par cancel_defi (candidatures/file annulées + chat vidé
            // + push aux binômes en file). Partie normale : update simple.
            if (game.is_challenge) {
              try { await cancelDefi(gameId); }
              catch (e: any) { Alert.alert('Erreur', e?.message ?? 'Annulation impossible.'); return; }
            } else {
              const { error } = await supabase
                .from('open_games')
                .update({ status: 'cancelled' })
                .eq('id', gameId);
              if (error) { Alert.alert('Erreur', error.message); return; }
            }

            const targetIds = (game.participants ?? [])
              .filter((p: any) =>
                ['accepted', 'pending', 'waitlist'].includes(p.status)
                || (p.status === 'invited' && isInviteActive(p)))
              .map((p: any) => p.player_id)
              .filter((id: string) => id && id !== player.id);

            // Défi : le push part de cancel_defi (serveur) — pas de doublon client.
            if (!game.is_challenge && targetIds.length > 0) {
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

    // Rejouer un DÉFI : Team B ne s'invite pas sur un défi ouvert (elle se
    // remplit par candidature de binôme). Les deux adversaires sont encore
    // là → défi CIBLÉ (les 4 nommés, chacun accepte, confirmé à 4/4).
    // Sinon → défi ouvert classique, sans invites B.
    if (gameType === 'Défi') {
      if (invites.B0 && invites.B1) {
        setTargetedMode(true);
      } else {
        delete invites.B0;
        delete invites.B1;
      }
    }

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
          '⚠️ Conflit de créneau',
          'Tu es déjà sur une autre partie au même créneau (±2h). Annule-la ou quitte-la avant de rejoindre celle-ci.',
        );
      } else {
        console.warn('[lobby] acceptation invitation refusée:', error);
        Alert.alert('Impossible de rejoindre', 'Une erreur est survenue, réessaie dans un instant.');
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

    // Free the spot that was held by the invitation
    if (game) {
      await supabase.from('open_games')
        .update({ spots_available: Math.min(3, (game.spots_available ?? 0) + 1) })
        .eq('id', gameId);
      if (game.creator_id && game.creator_id !== player.id) {
        notifyPlayers({
          playerIds: [game.creator_id],
          title: '❌ Invitation refusée',
          body: game.is_challenge
            ? `${player.name} a refusé de jouer le défi avec toi`
            : `${player.name} a refusé ton invitation`,
          data: { type: 'lobby', gameId },
        });
      }
    }
    setOpenGameId(null);
    fetchData();
    reloadNotifs();
  };

  const binomeAcceptingRef = useRef<Set<string>>(new Set());
  const acceptBinomeFromLobby = async (app: DefiApplication) => {
    // Anti double-submit : deux taps concurrents → le 2e verrait le verrou du 1er
    // et renverrait « too_late » alors que c'est toi qui as verrouillé.
    if (binomeAcceptingRef.current.has(app.id)) return;
    binomeAcceptingRef.current.add(app.id);
    try {
      const res = await acceptBinomeInvitation(app.id);
      if (res === 'locked') {
        notifyDefiConfirmed(app, player?.id ?? '');
        Alert.alert('✅ Binôme verrouillé', 'Le défi est confirmé — rendez-vous sur le terrain !');
      } else if (res === 'queued') {
        if (app.initiator_id && player) notifyBinomeQueued(app.initiator_id, player.name);
        Alert.alert('⏳ En file d\'attente', 'La place est déjà prise, mais vous êtes en file : vous serez promus si un binôme se retire.');
      } else {
        Alert.alert('⏳ Trop tard', 'Un autre binôme a pris la place.');
      }
      await fetchData();
      reloadNotifs();
    } catch (e: any) {
      if (isCreatorConflict(e)) {
        Alert.alert('⚠️ Conflit de créneau', 'Toi ou ton binôme êtes déjà engagés sur une autre partie au même créneau (±2h).');
      } else {
        Alert.alert('Erreur', e?.message ?? 'Action impossible.');
      }
    } finally {
      binomeAcceptingRef.current.delete(app.id);
    }
  };

  // Retirer ma candidature / sortir de la file (toute la paire sort).
  const withdrawAppFromLobby = (app: DefiApplication) => {
    Alert.alert(
      app.status === 'queued' ? 'Quitter la file ?' : 'Retirer la candidature ?',
      app.status === 'queued'
        ? 'Votre binôme perdra sa place dans la file d\'attente.'
        : 'Ta proposition à ton binôme sera annulée.',
      [
        { text: 'Garder', style: 'cancel' },
        {
          text: 'Retirer', style: 'destructive',
          onPress: async () => {
            try {
              const otherId = await withdrawApplication(app.id);
              if (app.status === 'queued' && otherId && player) notifyBinomeWithdrawn(otherId, player.name);
              await fetchData();
              reloadNotifs();
            } catch (e: any) {
              Alert.alert('Erreur', e?.message ?? 'Action impossible.');
            }
          },
        },
      ],
    );
  };

  const declineBinomeFromLobby = async (app: DefiApplication) => {
    if (binomeAcceptingRef.current.has(app.id)) return;
    binomeAcceptingRef.current.add(app.id);
    try {
      await declineBinomeInvitation(app.id);
      if (app.initiator_id && player) notifyReleverDeclined(app.initiator_id, player.name);
      await fetchData();
      reloadNotifs();
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Action impossible.');
    } finally {
      binomeAcceptingRef.current.delete(app.id);
    }
  };

  if (!player) return null;

  // Badge « À venir » = matchs où je suis CONFIRMÉ (créateur ou accepté), même
  // incomplets — aligné sur la carte « À Venir » de l'accueil via isConfirmedInGame.
  // Les invitations reçues / candidatures / listes d'attente restent visibles
  // dans l'onglet mais ne comptent pas dans le badge.
  const upcomingBadge = upcomingGames.filter(g => isConfirmedInGame(g, player.id)).length;
  // Badge Explorer = nombre de parties APRÈS application des filtres (Option A).
  const exploreBadge = useMemo(
    () => filterExploreGames(games, filterMode, typeFilter, search).length,
    [games, filterMode, typeFilter, search],
  );
  const scoresToValidate = matches.filter(m => matchNeedsMyAction(m, player.id) !== null).length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── Header ── */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>
        <HeaderActions top={insets.top + 8} right={16} tint="light" />

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
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
              style={{ fontSize: 26, lineHeight: 34, fontFamily: Fonts.welcome, color: Colors.textOnDark, includeFontPadding: false, textAlign: 'center', paddingRight: 5 }}>
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
              search={search} setSearch={setSearch} onOpenGame={(g) => openGameById(g.id)}
              playerId={player.id}
              onApply={(gameId, side) => handleApply(gameId, false, side)}
              onChangeSide={handleChangeSide}
              onCreatorChangeSide={handleCreatorChangeSide}
              onCreate={() => setShowCreate(true)}
              onRelever={(id) => router.push((`/(tabs)/matchmaking?tab=relever&relever=${id}`) as any)}
              appliedDefiIds={appliedDefiIds}
            />
          )}
          {tab === 'upcoming' && (
            <UpcomingTab
              games={upcomingGames} myElo={myElo}
              roleFilter={roleFilter} setRoleFilter={setRoleFilter}
              onOpenGame={(g) => openGameById(g.id)}
              playerId={player.id}
              onChangeSide={handleChangeSide}
              onCreatorChangeSide={handleCreatorChangeSide}
              onAcceptInvitation={handleAcceptInvitation}
              onDeclineInvitation={handleDeclineInvitation}
              binomeInvites={binomeInvites}
              onAcceptBinome={acceptBinomeFromLobby}
              onDeclineBinome={declineBinomeFromLobby}
              myDefiApps={myDefiApps}
              otherBinomeCounts={otherBinomeCounts}
              onWithdrawApp={withdrawAppFromLobby}
            />
          )}
          {tab === 'history' && (
            <HistoryTab matches={matches} playerId={player.id} onOpenMatch={setOpenMatch}
              pastCompleteGames={pastCompleteGames} onOpenGame={(g) => openGameById(g.id)}
              onScoreGame={(gameId) => router.push(('/score-entry?gameId=' + gameId) as any)}
              onRematch={handleRematch} onShare={shareMatch} eloDeltaByMatch={eloDeltaByMatch} />
          )}
        </ScrollView>
      )}

      {/* FAB retiré : la création se fait via l'onglet « Créer » de la barre d'onglets. */}

      {openGame && (
        <GameDetailsSheet
          game={openGame}
          myElo={myElo}
          playerId={player.id}
          onClose={() => {
            const back = returnToDefiRef.current;
            returnToDefiRef.current = null;
            setOpenGameId(null); setDetailGame(null);
            if (back) router.replace((`/(tabs)/matchmaking?tab=${back}`) as any);
          }}
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
          onRelever={(id) => {
            returnToDefiRef.current = null;
            setOpenGameId(null); setDetailGame(null);
            router.replace((`/(tabs)/matchmaking?tab=relever&relever=${id}`) as any);
          }}
          hasAppliedDefi={!!openGame && appliedDefiIds.has(openGame.id)}
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
        onClose={() => { setShowCreate(false); setChallengeWith(null); setOpenDefiMode(false); setRematchInvites(null); setRematchGameType(undefined); setTargetedInvites(null); setTargetedMode(false); }}
        onPublishedDone={() => { setShowCreate(false); setChallengeWith(null); setOpenDefiMode(false); setRematchInvites(null); setRematchGameType(undefined); setTargetedInvites(null); setTargetedMode(false); setTab('upcoming'); }}
        onPublish={handlePublish}
        player={player}
        initialGameType={rematchGameType ?? (challengeWith || openDefiMode ? 'Défi' : undefined)}
        initialInvite={challengeWith ?? undefined}
        initialInvites={targetedInvites ?? rematchInvites ?? undefined}
        targeted={targetedMode}
      />

      {openMatch && (
        <MatchDetailSheet
          match={openMatch}
          playerId={player.id}
          delta={eloDeltaByMatch[openMatch.id]}
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
          onResolved={(matchId, status) => {
            // 'validated' = contre-score accepté → adopter TOUT le résultat du
            // contestataire localement (comme l'UPDATE DB), pas juste le statut.
            setMatches(prev => prev.map(m => m.id !== matchId ? m
              : status === 'validated' ? applyCounterLocally(m) : { ...m, status }));
            reloadNotifs();
          }}
        />
      )}
    </View>
  );
}
