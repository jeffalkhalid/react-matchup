import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, Alert,
  ActivityIndicator, StyleSheet, Share, Linking,
} from 'react-native';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { formatPadelLevel } from '../../lib/theme';
import type { OpenGame } from '../../types';

// ─── Types ────────────────────────────────────────────────────
interface SlotPlayer {
  id: string; name: string; elo: number;
  wins?: number; losses?: number;
  isCreator?: boolean; isMe?: boolean;
}

interface GameTheme {
  accentHex: string; stripColor: string;
  courtBg: string; courtLine: string; courtLabel: string;
  btnColor: string; heroBg: string;
  eloBg: string; eloColor: string; eloBorder: string;
}

interface EnrichedGame extends OpenGame {
  is_creator?: boolean;
  my_status?: 'accepted' | 'pending';
  pending_count?: number;
}

// ─── Constants ────────────────────────────────────────────────
const SIDE_TO_IDX: Record<string, number> = { A_GAU: 0, A_DRO: 1, B_GAU: 2, B_DRO: 3 };
const SIDE_TEAM:  Record<string, string>  = { A_GAU: 'A', A_DRO: 'A', B_GAU: 'B', B_DRO: 'B' };
const SIDE_SHORT: Record<string, string>  = { A_GAU: 'GAU', A_DRO: 'DRO', B_GAU: 'GAU', B_DRO: 'DRO' };
const SIDE_POS:   Record<string, string>  = { A_GAU: 'Gauche', A_DRO: 'Droite', B_GAU: 'Gauche', B_DRO: 'Droite' };
const ALL_SIDES = ['A_GAU', 'A_DRO', 'B_GAU', 'B_DRO'] as const;

// ─── Helpers ──────────────────────────────────────────────────
function getGameTheme(game: any): GameTheme {
  if (game.is_challenge) return {
    accentHex: '#d97706', stripColor: '#f59e0b',
    courtBg: '#fffbeb', courtLine: 'rgba(217,119,6,0.25)', courtLabel: '#92400e',
    btnColor: '#f59e0b', heroBg: '#78350f',
    eloBg: '#fef3c7', eloColor: '#92400e', eloBorder: '#fde68a',
  };
  if ((game.game_format as string) === 'friendly') return {
    accentHex: '#059669', stripColor: '#10b981',
    courtBg: '#f0fdf4', courtLine: 'rgba(5,150,105,0.25)', courtLabel: '#065f46',
    btnColor: '#10b981', heroBg: '#064e3b',
    eloBg: '#d1fae5', eloColor: '#065f46', eloBorder: '#6ee7b7',
  };
  return {
    accentHex: '#4f46e5', stripColor: '#4f46e5',
    courtBg: '#eef2ff', courtLine: 'rgba(79,70,229,0.2)', courtLabel: '#3730a3',
    btnColor: '#4f46e5', heroBg: '#1e1b4b',
    eloBg: '#e0e7ff', eloColor: '#3730a3', eloBorder: '#c7d2fe',
  };
}

function buildSlots(game: any, myId?: string): (SlotPlayer | null)[] {
  const slots: (SlotPlayer | null)[] = [null, null, null, null];
  const creatorIdx = SIDE_TO_IDX[game.creator_side ?? 'A_GAU'] ?? 0;
  slots[creatorIdx] = {
    id: game.creator_id,
    name: game.creator?.name ?? '?',
    elo: game.creator?.elo_score ?? 0,
    wins: (game.creator as any)?.win_count,
    losses: (game.creator as any)?.loss_count,
    isCreator: true,
    isMe: game.creator_id === myId,
  };
  (game.participants ?? [])
    .filter((p: any) => p.status === 'accepted')
    .forEach((p: any) => {
      if (p.player_id === game.creator_id) return;
      const sp: SlotPlayer = {
        id: p.player_id,
        name: p.player?.name ?? '?',
        elo: p.player?.elo_score ?? 0,
        wins: p.player?.win_count,
        losses: p.player?.loss_count,
        isMe: p.player_id === myId,
      };
      const idx = SIDE_TO_IDX[p.team_side ?? ''];
      if (idx !== undefined && !slots[idx]) {
        slots[idx] = sp;
      } else {
        const free = slots.findIndex(s => s === null);
        if (free !== -1) slots[free] = sp;
      }
    });
  return slots;
}

// ─── Avatar ───────────────────────────────────────────────────
const AV_COLORS = ['#4f46e5','#10b981','#f59e0b','#ef4444','#06b6d4','#84cc16','#ec4899','#8b5cf6'];
function hashColor(name: string) {
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_COLORS[h % AV_COLORS.length];
}
function Avatar({ name, size = 36, ring }: { name: string; size?: number; ring?: string }) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: hashColor(name), alignItems: 'center', justifyContent: 'center',
      borderWidth: ring ? 2 : 0, borderColor: ring ?? 'transparent',
    }}>
      <Text style={{ color: '#fff', fontSize: Math.round(size * 0.4), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ─── Court slot ───────────────────────────────────────────────
function CourtSlot({
  player, side, selected, canClick, mode, onPress, theme,
}: {
  player: SlotPlayer | null; side: string; selected: boolean;
  canClick: boolean; mode?: 'join' | 'change'; onPress: () => void; theme: GameTheme;
}) {
  const s = StyleSheet.create({
    cell: {
      flex: 1, minHeight: 68, borderRadius: 10, alignItems: 'center',
      justifyContent: 'center', padding: 6,
      borderWidth: 2, borderStyle: 'dashed',
    },
  });

  if (!player) {
    const isChange = mode === 'change';
    const borderCol = selected ? theme.accentHex : isChange ? theme.eloBorder : theme.courtLine;
    const bgCol = selected ? theme.eloBg : isChange ? theme.eloBg : 'rgba(255,255,255,0.55)';
    const icon = selected ? '✓' : isChange ? '↔' : '+';
    const iconColor = theme.accentHex;
    const labelColor = selected || isChange ? theme.accentHex : theme.courtLabel;
    return (
      <TouchableOpacity
        onPress={canClick ? onPress : undefined}
        activeOpacity={canClick ? 0.7 : 1}
        style={[s.cell, { borderColor: borderCol, backgroundColor: bgCol }]}
      >
        <Text style={{ fontSize: selected ? 18 : isChange ? 14 : 20, color: iconColor, fontWeight: isChange ? '900' : '300' }}>
          {icon}
        </Text>
        <Text style={{ fontSize: 8, fontWeight: '900', color: labelColor, marginTop: 2, letterSpacing: 0.5 }}>
          {SIDE_SHORT[side]}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[s.cell, {
      borderStyle: 'solid', borderColor: player.isMe ? '#f59e0b' : 'transparent',
      backgroundColor: 'rgba(255,255,255,0.95)',
    }]}>
      <Avatar name={player.name} size={30} ring={player.isMe ? '#f59e0b' : undefined} />
      <Text style={{ fontSize: 9, fontWeight: '900', color: '#0f172a', marginTop: 3 }} numberOfLines={1}>
        {player.isMe ? 'Toi' : player.name.split(' ')[0]}
      </Text>
      <Text style={{ fontSize: 7.5, color: '#64748b' }}>
        {SIDE_SHORT[side]} · {formatPadelLevel(player.elo)}
      </Text>
    </View>
  );
}

// ─── Props ────────────────────────────────────────────────────
interface Props {
  game: EnrichedGame;
  myElo: number;
  playerId: string;
  onClose: () => void;
  onApply: (gameId: string, joinWaitlist: boolean, teamSide?: string) => Promise<void>;
  onChangeSide: (participantId: string, side: string) => Promise<void>;
  onCreatorChangeSide: (gameId: string, side: string) => Promise<void>;
  onApprovePending: (participantId: string, gameId: string, participantPlayerId: string, currentApprovals: string[]) => Promise<void>;
  onDeclinePending: (participantId: string) => Promise<void>;
  onLeave: (gameId: string, participantId: string, wasAccepted: boolean) => void;
}

// ─── Calendar + Share helpers ─────────────────────────────────
function openCalendar(game: EnrichedGame) {
  if (!game.match_date) return;
  const start = new Date(game.match_date);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const accepted = (game.participants ?? [])
    .filter((p: any) => p.status === 'accepted')
    .map((p: any) => (p.player as any)?.name)
    .filter(Boolean).join(', ');
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
  const minLv = formatPadelLevel(game.min_elo ?? 0);
  const maxLv = formatPadelLevel(game.max_elo ?? 1750);
  const spots = game.spots_available;
  const spotsText = spots === 0 ? 'Complet' : `${spots} place${spots > 1 ? 's' : ''} dispo`;
  const creatorObj = game.creator as any;
  const creatorLv = creatorObj ? ` (Niv. ${formatPadelLevel(creatorObj.elo_score ?? 1000)})` : '';
  const creatorLabel = `${creatorObj?.name ?? ''}${creatorLv}`;
  const others = (game.participants ?? [])
    .filter((p: any) => p.status === 'accepted')
    .map((p: any) => {
      const pl = p.player as any;
      const lv = pl ? ` (Niv. ${formatPadelLevel(pl.elo_score ?? 1000)})` : '';
      return `${pl?.name ?? ''}${lv}`;
    }).filter(Boolean);
  const playersLine = others.length ? `\n👥 ${others.join(', ')}` : '';
  const url = `https://matchup-padel.vercel.app/lobby?game=${game.id}`;
  const msg = `🎾 Match Padel – ${typeLabel}\n👤 Organisé par ${creatorLabel}${playersLine}\n📅 ${dateStr} à ${timeStr}\n📍 ${game.location ?? ''}\n📊 Niveau : ${minLv} – ${maxLv}\n🟢 ${spotsText}\n🔗 ${url}`;
  try { await Share.share({ message: msg }); } catch { /* cancelled */ }
}

// ─── Main component ───────────────────────────────────────────
export default function GameDetailsSheet({
  game, myElo, playerId, onClose, onApply, onChangeSide, onCreatorChangeSide, onApprovePending, onDeclinePending, onLeave,
}: Props) {
  const [mySlot, setMySlot] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isWaitlisted, setIsWaitlisted] = useState(false);

  useEffect(() => { setMySlot(null); }, [game.id]);

  const theme = getGameTheme(game);

  // Derived state
  const slots = buildSlots(game, playerId);
  const emptySlots = ALL_SIDES.filter((_, i) => !slots[i]);
  const filled = ALL_SIDES
    .map((s, i) => slots[i] ? { player: slots[i]!, side: s } : null)
    .filter(Boolean) as { player: SlotPlayer; side: string }[];

  const isCreator    = game.creator_id === playerId;
  const myParticipant = (game.participants ?? []).find((p: any) => p.player_id === playerId);
  const alreadyIn    = !!myParticipant && ['accepted', 'pending', 'waitlist'].includes((myParticipant as any)?.status);
  const isAccepted   = (myParticipant as any)?.status === 'accepted';
  const canParticipate = !isCreator && !alreadyIn;

  const pendingPlayers = (game.participants ?? []).filter((p: any) => p.status === 'pending');
  const acceptedCount  = (game.participants ?? []).filter((p: any) => p.status === 'accepted').length;
  const isFull         = 1 + acceptedCount >= 4;
  const waitlistCount  = (game.participants ?? []).filter((p: any) => p.status === 'waitlist').length;
  const requiredVotes  = Math.min(1 + acceptedCount, 3);

  const fit       = (() => { const min = game.min_elo ?? 0, max = game.max_elo ?? 9999; if (myElo >= min && myElo <= max) return 'fit'; const m = Math.min(Math.abs(myElo - min), Math.abs(myElo - max)); return m <= 100 ? 'close' : 'outside'; })();
  const outOfLevel = fit === 'outside';

  const gameDate = game.match_date ? new Date(game.match_date) : null;
  const dateStr  = gameDate ? gameDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const timeStr  = gameDate ? gameDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
  const minLvl   = formatPadelLevel(game.min_elo ?? 0);
  const maxLvl   = formatPadelLevel(game.max_elo ?? 1750);
  const typeLabel = game.is_challenge ? 'Défi' : (game.game_format as string) === 'friendly' ? 'Amical' : 'Compétitif';

  const courtHint = isFull
    ? `🔒 Complet · ${waitlistCount} en attente`
    : mySlot ? `✓ Éq. ${SIDE_TEAM[mySlot]} · ${SIDE_SHORT[mySlot]}`
    : (isCreator || isAccepted) ? '↔ Touchez un slot libre pour changer'
    : outOfLevel ? '⚠ Tapez un slot pour demander'
    : canParticipate ? 'Tapez un slot pour rejoindre'
    : '';

  async function confirmJoin() {
    if (!mySlot || isJoining) return;
    setIsJoining(true);
    try { await onApply(game.id, false, mySlot); setMySlot(null); }
    finally { setIsJoining(false); }
  }

  async function handleWaitlist() {
    if (isWaitlisted) return;
    setIsWaitlisted(true);
    await onApply(game.id, true);
  }

  // ─── CTA button ───────────────────────────────────────────
  function renderCTA() {
    if (isCreator || isAccepted) {
      const currentSide = isCreator
        ? (game.creator_side ?? 'A_GAU')
        : (myParticipant as any)?.team_side ?? null;
      return (
        <View style={{ gap: 8 }}>
          <View style={[sty.ctaBtn, { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' }]}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b' }}>
              {currentSide
                ? `✓ Éq. ${SIDE_TEAM[currentSide]} · ${SIDE_POS[currentSide]} — touche un slot libre pour changer`
                : '↔ Touche un slot libre pour changer de place'}
            </Text>
          </View>
          {isAccepted && myParticipant && (
            <TouchableOpacity
              onPress={() => onLeave(game.id, (myParticipant as any).id, true)}
              style={[sty.ctaBtn, { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca' }]}
            >
              <Text style={{ fontSize: 13, fontWeight: '900', color: '#dc2626' }}>Quitter la partie</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    if (alreadyIn) {
      const isPending = (myParticipant as any)?.status === 'pending';
      const isWait    = (myParticipant as any)?.status === 'waitlist';
      return (
        <View style={{ gap: 8 }}>
          <View style={[sty.ctaBtn, { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a' }]}>
            <Text style={{ fontSize: 13, fontWeight: '900', color: '#d97706' }}>
              {isPending ? '⏳ Demande envoyée' : "⏳ Liste d'attente"}
            </Text>
          </View>
          {myParticipant && (
            <TouchableOpacity
              onPress={() => onLeave(game.id, (myParticipant as any).id, false)}
              style={[sty.ctaBtn, { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca' }]}
            >
              <Text style={{ fontSize: 13, fontWeight: '900', color: '#dc2626' }}>
                {isPending ? 'Retirer ma candidature' : "Quitter la liste d'attente"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    if (isFull) return isWaitlisted
      ? (
        <View style={[sty.ctaBtn, { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' }]}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#059669' }}>✓ Sur la liste d'attente</Text>
        </View>
      ) : (
        <TouchableOpacity onPress={handleWaitlist} style={[sty.ctaBtn, { backgroundColor: '#ef4444', elevation: 6, shadowColor: '#ef4444', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }]}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff' }}>⏳ Rejoindre la liste d'attente</Text>
        </TouchableOpacity>
      );
    if (mySlot) return (
      <TouchableOpacity onPress={confirmJoin} disabled={isJoining} style={[sty.ctaBtn, {
        backgroundColor: theme.btnColor, opacity: isJoining ? 0.7 : 1,
        elevation: 6, shadowColor: theme.btnColor, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
      }]}>
        {isJoining
          ? <ActivityIndicator color="#fff" />
          : <Text style={{ fontSize: 13, fontWeight: '900', color: '#fff' }}>
              {outOfLevel
                ? `Envoyer une demande — Éq. ${SIDE_TEAM[mySlot]} ${SIDE_SHORT[mySlot]}`
                : `✓ Confirmer — Éq. ${SIDE_TEAM[mySlot]} ${SIDE_SHORT[mySlot]}`}
            </Text>
        }
      </TouchableOpacity>
    );
    return (
      <View style={[sty.ctaBtn, { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' }]}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#94a3b8' }}>
          ↑ Choisissez un emplacement{outOfLevel ? ' (demande)' : ''}
        </Text>
      </View>
    );
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(11,17,33,0.6)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />

        <View style={sty.sheet}>
          {/* Drag handle */}
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4, backgroundColor: '#0b1121' }}>
            <View style={{ width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 2 }} />
          </View>

          {/* ── Dark hero ── */}
          <View style={{ backgroundColor: '#0b1121', paddingHorizontal: 16, paddingBottom: 14, position: 'relative', overflow: 'hidden' }}>
            {/* Type strip */}
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, backgroundColor: theme.stripColor }} />
            {/* Nav */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, marginBottom: 14 }}>
              <TouchableOpacity onPress={onClose} style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                <Svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                  <Path stroke="rgba(255,255,255,0.8)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" d="M9 2L4 7l5 5" />
                </Svg>
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {game.match_date && (isCreator || isAccepted) && (
                  <TouchableOpacity onPress={() => openCalendar(game)} style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <Line x1="16" y1="2" x2="16" y2="6" />
                      <Line x1="8" y1="2" x2="8" y2="6" />
                      <Line x1="3" y1="10" x2="21" y2="10" />
                    </Svg>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => shareGame(game)} style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 10, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <Path d="M16 6l-4-4-4 4" />
                    <Line x1="12" y1="2" x2="12" y2="15" />
                  </Svg>
                </TouchableOpacity>
                <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                    {typeLabel}
                  </Text>
                </View>
              </View>
            </View>
            {/* Date + time */}
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 2 }}>{dateStr}</Text>
            <Text style={{ fontSize: 34, fontWeight: '900', color: '#fff', letterSpacing: -1, marginBottom: 6 }}>{timeStr || '—'}</Text>
            {/* Location + gender */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                <Path stroke="#94a3b8" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" d="M20 10c0 7-8 13-8 13S4 17 4 10a8 8 0 0 1 16 0Z" />
                <Circle cx={12} cy={10} r={3} stroke="#94a3b8" strokeWidth={2.2} />
              </Svg>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#cbd5e1', flex: 1 }} numberOfLines={1}>{game.location}</Text>
              {(game as any).gender_pref && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 10, fontWeight: '900' }}>
                    {(game as any).gender_pref === 'men' ? '♂ Hommes' : (game as any).gender_pref === 'women' ? '♀ Femmes' : '⚧ Mixte'}
                  </Text>
                </View>
              )}
            </View>
            {/* Meta strip */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#34d399' }} />
                <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '600' }}>Niv. {minLvl} – {maxLvl}</Text>
              </View>
              <View style={{
                marginLeft: 'auto',
                backgroundColor: isFull ? '#ef4444' : (3 - acceptedCount) <= 1 ? '#f59e0b' : '#22c55e',
                borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
              }}>
                <Text style={{ color: isFull ? '#fff' : '#111', fontSize: 10, fontWeight: '900' }}>
                  {isFull ? `Complet · ${waitlistCount} en attente` : `${3 - acceptedCount} place${(3 - acceptedCount) > 1 ? 's' : ''} libre${(3 - acceptedCount) > 1 ? 's' : ''}`}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Scrollable body ── */}
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>

            {/* Status banners */}
            {(isFull || outOfLevel) && (
              <View style={{ paddingHorizontal: 14, paddingTop: 14, gap: 10 }}>
                {isFull && !isCreator && !alreadyIn && (
                  <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 16, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 18 }}>🔒</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: '900', color: '#b91c1c' }}>Partie complète</Text>
                      <Text style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>Rejoignez la liste d'attente — vous serez prévenu si une place se libère.</Text>
                    </View>
                  </View>
                )}
                {outOfLevel && !isFull && (
                  <View style={{ backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 16, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 18 }}>⚠️</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12, fontWeight: '900', color: '#92400e' }}>Niveau hors fourchette</Text>
                      <Text style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                        Requis {minLvl}–{maxLvl}, le vôtre est {formatPadelLevel(myElo)}. Vous pouvez quand même envoyer une demande.
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* ── Court visualization ── */}
            <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
              <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 18, padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ fontSize: 11, fontWeight: '900', color: '#0f172a', textTransform: 'uppercase', letterSpacing: 1 }}>Le terrain</Text>
                  {courtHint ? (
                    <Text style={{ fontSize: 10, fontWeight: '700', color: isFull ? '#dc2626' : mySlot ? '#059669' : '#94a3b8', flexShrink: 1, marginLeft: 8 }} numberOfLines={1}>
                      {courtHint}
                    </Text>
                  ) : null}
                </View>

                {/* Court */}
                <View style={{ borderRadius: 14, overflow: 'hidden', backgroundColor: theme.courtBg, minHeight: 120, padding: 10, paddingTop: 26, position: 'relative' }}>
                  {/* Border */}
                  <View style={{ position: 'absolute', top: 10, bottom: 10, left: 10, right: 10, borderWidth: 1.5, borderColor: theme.courtLine, borderRadius: 8 }} />
                  {/* Center line */}
                  <View style={{ position: 'absolute', top: 10, bottom: 10, left: '50%', width: 2, backgroundColor: theme.courtLine }} />
                  {/* VS */}
                  <View style={{ position: 'absolute', top: '42%', alignSelf: 'center', backgroundColor: theme.courtLine, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                    <Text style={{ fontSize: 8, fontWeight: '900', color: theme.courtLabel, letterSpacing: 1 }}>VS</Text>
                  </View>
                  {/* Team labels */}
                  <View style={{ position: 'absolute', top: 6, left: 14 }}>
                    <Text style={{ fontSize: 8, fontWeight: '900', color: theme.courtLabel }}>ÉQ. A</Text>
                  </View>
                  <View style={{ position: 'absolute', top: 6, right: 14 }}>
                    <Text style={{ fontSize: 8, fontWeight: '900', color: theme.courtLabel }}>ÉQ. B</Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {/* Team A: A_GAU, A_DRO */}
                    <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                      {(['A_GAU', 'A_DRO'] as const).map(side => {
                        const isEmpty = !slots[SIDE_TO_IDX[side]];
                        const joinMode = isEmpty && canParticipate && !isFull;
                        const changeMode = isEmpty && !isFull && (isCreator || isAccepted);
                        return (
                          <CourtSlot
                            key={side}
                            player={slots[SIDE_TO_IDX[side]]}
                            side={side}
                            selected={mySlot === side}
                            canClick={joinMode || changeMode}
                            mode={changeMode ? 'change' : 'join'}
                            onPress={() => {
                              if (changeMode) {
                                if (isCreator) onCreatorChangeSide(game.id, side);
                                else if (myParticipant) onChangeSide((myParticipant as any).id, side);
                              } else {
                                setMySlot(mySlot === side ? null : side);
                              }
                            }}
                            theme={theme}
                          />
                        );
                      })}
                    </View>
                    <View style={{ width: 8 }} />
                    {/* Team B: B_DRO first (mirrors A_GAU), then B_GAU */}
                    <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                      {(['B_DRO', 'B_GAU'] as const).map(side => {
                        const isEmpty = !slots[SIDE_TO_IDX[side]];
                        const joinMode = isEmpty && canParticipate && !isFull;
                        const changeMode = isEmpty && !isFull && (isCreator || isAccepted);
                        return (
                          <CourtSlot
                            key={side}
                            player={slots[SIDE_TO_IDX[side]]}
                            side={side}
                            selected={mySlot === side}
                            canClick={joinMode || changeMode}
                            mode={changeMode ? 'change' : 'join'}
                            onPress={() => {
                              if (changeMode) {
                                if (isCreator) onCreatorChangeSide(game.id, side);
                                else if (myParticipant) onChangeSide((myParticipant as any).id, side);
                              } else {
                                setMySlot(mySlot === side ? null : side);
                              }
                            }}
                            theme={theme}
                          />
                        );
                      })}
                    </View>
                  </View>
                </View>
              </View>
            </View>

            {/* Group stats */}
            {filled.length > 0 && (() => {
              const totalMatches = filled.reduce((a, s) => a + (s.player.wins ?? 0) + (s.player.losses ?? 0), 0);
              const avgWin = Math.round(
                filled.reduce((a, s) => {
                  const t = (s.player.wins ?? 0) + (s.player.losses ?? 0);
                  return a + (t > 0 ? (s.player.wins ?? 0) / t * 100 : 0);
                }, 0) / filled.length
              );
              return (
                <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 10 }}>
                  {[
                    { label: 'Win rate', value: `${avgWin}%`, sub: 'moyen' },
                    { label: 'Matchs', value: String(totalMatches), sub: 'cumulés' },
                    { label: 'Inscrits', value: `${filled.length}/4`, sub: 'confirmés' },
                  ].map((s, i) => (
                    <View key={i} style={{ flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 14, padding: 10, alignItems: 'center' }}>
                      <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>{s.label}</Text>
                      <Text style={{ fontSize: 17, fontWeight: '900', color: theme.accentHex, marginTop: 2 }}>{s.value}</Text>
                      <Text style={{ fontSize: 8.5, color: '#94a3b8', marginTop: 1 }}>{s.sub}</Text>
                    </View>
                  ))}
                </View>
              );
            })()}

            {/* Pending candidates — creator / accepted only */}
            {pendingPlayers.length > 0 && (isCreator || isAccepted) && (
              <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' }} />
                  <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a' }}>
                    {pendingPlayers.length} candidature{pendingPlayers.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={{ gap: 8 }}>
                  {pendingPlayers.map((p: any) => {
                    const approvals = p.approvals ?? [];
                    const hasVoted  = approvals.includes(playerId);
                    return (
                      <View key={p.id} style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 16, padding: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <Avatar name={p.player?.name ?? '?'} size={40} />
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={{ fontSize: 13, fontWeight: '900', color: '#0f172a' }}>{p.player?.name}</Text>
                              <View style={{ backgroundColor: '#f1f5f9', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 9, fontWeight: '900', color: '#64748b' }}>Niv.{formatPadelLevel(p.player?.elo_score ?? 0)}</Text>
                              </View>
                            </View>
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                              {approvals.length}/{requiredVotes} approbation{approvals.length > 1 ? 's' : ''}
                            </Text>
                          </View>
                          {isFull ? (
                            <View style={{ backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: '#94a3b8' }}>En attente</Text>
                            </View>
                          ) : hasVoted ? (
                            <View style={{ backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                              <Text style={{ fontSize: 10, fontWeight: '900', color: '#059669' }}>Voté ✓</Text>
                            </View>
                          ) : (
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <TouchableOpacity
                                onPress={() => onApprovePending(p.id, game.id, p.player_id, approvals)}
                                style={{ width: 36, height: 36, backgroundColor: '#22c55e', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>✓</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => onDeclinePending(p.id)}
                                style={{ width: 36, height: 36, backgroundColor: '#f1f5f9', borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: '#64748b', fontWeight: '900' }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                        {/* Approval progress bar */}
                        <View style={{ backgroundColor: '#f1f5f9', borderRadius: 99, height: 5, overflow: 'hidden' }}>
                          <View style={{
                            height: '100%', backgroundColor: '#22c55e', borderRadius: 99,
                            width: `${Math.min(approvals.length / requiredVotes * 100, 100)}%`,
                          }} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── Players section ── */}
            {filled.length > 0 && (
              <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a' }}>Les joueurs</Text>
                  <Text style={{ fontSize: 10, color: '#94a3b8', fontWeight: '600' }}>
                    {filled.length} confirmé{filled.length > 1 ? 's' : ''} · {emptySlots.length} libre{emptySlots.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={{ gap: 10 }}>
                  {filled.map(({ player: p, side }) => {
                    const total   = (p.wins ?? 0) + (p.losses ?? 0);
                    const winRate = total > 0 ? Math.round((p.wins ?? 0) / total * 100) : 0;
                    const isTeamA = SIDE_TEAM[side] === 'A';
                    return (
                      <View key={side} style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 18, padding: 14 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: total > 0 ? 10 : 0 }}>
                          <Avatar name={p.name} size={44} ring={p.isMe ? '#f59e0b' : undefined} />
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <Text style={{ fontSize: 14, fontWeight: '900', color: '#0f172a' }}>{p.isMe ? 'Toi' : p.name}</Text>
                              <View style={{ backgroundColor: '#f1f5f9', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 9, fontWeight: '900', color: '#64748b' }}>Niv.{formatPadelLevel(p.elo)}</Text>
                              </View>
                            </View>
                            <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>
                              {p.isCreator ? '👑 Créateur' : 'Participant'}
                            </Text>
                          </View>
                          <View style={{
                            backgroundColor: isTeamA ? '#eef2ff' : '#f5f3ff',
                            borderWidth: 1, borderColor: isTeamA ? '#c7d2fe' : '#ddd6fe',
                            borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center',
                          }}>
                            <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>Éq. {SIDE_TEAM[side]}</Text>
                            <Text style={{ fontSize: 10, fontWeight: '900', color: isTeamA ? '#4338ca' : '#6d28d9' }}>{SIDE_POS[side]}</Text>
                          </View>
                        </View>
                        {total > 0 && (
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 10, padding: 8, alignItems: 'center' }}>
                              <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase' }}>Matchs</Text>
                              <Text style={{ fontSize: 15, fontWeight: '900', color: '#0f172a' }}>{total}</Text>
                            </View>
                            <View style={{ flex: 1, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', borderRadius: 10, padding: 8, alignItems: 'center' }}>
                              <Text style={{ fontSize: 8, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase' }}>Victoires</Text>
                              <Text style={{ fontSize: 15, fontWeight: '900', color: '#0f172a' }}>
                                {winRate}<Text style={{ fontSize: 10, color: '#94a3b8' }}>%</Text>
                              </Text>
                            </View>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Info note */}
            <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
              <View style={{ backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ fontSize: 14 }}>💡</Text>
                <Text style={{ fontSize: 11, color: '#94a3b8', fontWeight: '600', flex: 1 }}>
                  Annulation gratuite jusqu'à 24h avant la partie.
                </Text>
              </View>
            </View>
          </ScrollView>

          {/* ── Sticky CTA ── */}
          <View style={sty.ctaBar}>
            <TouchableOpacity onPress={onClose} style={sty.ctaBack}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#64748b' }}>←</Text>
            </TouchableOpacity>
            {renderCTA()}
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const sty = StyleSheet.create({
  sheet: {
    backgroundColor: '#f8fafc',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    height: '88%', overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 40,
    shadowOffset: { width: 0, height: -8 }, elevation: 30,
  },
  ctaBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 14, paddingBottom: 22, paddingTop: 12,
    backgroundColor: 'rgba(248,250,252,0.97)',
    borderTopWidth: 1, borderTopColor: '#f1f5f9',
    flexDirection: 'row', gap: 8,
  },
  ctaBack: {
    width: 50, height: 50, borderRadius: 14, borderWidth: 1,
    borderColor: '#e2e8f0', backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center',
  },
  ctaBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
});
