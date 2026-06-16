import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, Alert,
  ActivityIndicator, StyleSheet, Share, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { Colors, formatPadelLevel, Fonts } from '../../lib/theme';
import { lobbyGameLink } from '../../lib/community';
import { isInviteActive } from '../../lib/games';
import type { OpenGame } from '../../types';

// ─── Types ────────────────────────────────────────────────────
interface SlotPlayer {
  id: string; name: string; elo: number;
  wins?: number; losses?: number;
  isCreator?: boolean; isMe?: boolean; isInvited?: boolean;
}

interface GameTheme {
  accentHex: string; stripColor: string;
  courtBg: string; courtLine: string; courtLabel: string;
  btnColor: string; heroBg: string;
  eloBg: string; eloColor: string; eloBorder: string;
}

interface EnrichedGame extends OpenGame {
  is_creator?: boolean;
  my_status?: 'accepted' | 'pending' | 'invited' | 'waitlist';
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
    accentHex: Colors.brandDeep, stripColor: Colors.brand,
    courtBg: 'rgba(255,193,26,0.14)', courtLine: 'rgba(255,193,26,0.55)', courtLabel: Colors.brandDeep,
    btnColor: Colors.brand, heroBg: Colors.heroBg,
    eloBg: 'rgba(255,193,26,0.14)', eloColor: Colors.brandDeep, eloBorder: 'rgba(255,193,26,0.55)',
  };
  if ((game.game_format as string) === 'friendly') return {
    accentHex: '#047857', stripColor: '#10b981',
    courtBg: 'rgba(16,185,129,0.10)', courtLine: 'rgba(16,185,129,0.45)', courtLabel: '#047857',
    btnColor: '#10b981', heroBg: Colors.heroBg,
    eloBg: 'rgba(16,185,129,0.10)', eloColor: '#047857', eloBorder: 'rgba(16,185,129,0.45)',
  };
  return {
    accentHex: Colors.textPrimary, stripColor: Colors.primary,
    courtBg: Colors.bgCardAlt, courtLine: Colors.border, courtLabel: Colors.textPrimary,
    btnColor: Colors.primary, heroBg: Colors.heroBg,
    eloBg: Colors.bgCardAlt, eloColor: Colors.textPrimary, eloBorder: Colors.border,
  };
}

// Temps restant avant expiration d'une invitation (lecture de invite_expires_at).
function inviteCountdown(p: { invite_expires_at?: string | null }): string | null {
  if (!p.invite_expires_at) return null;
  const ms = new Date(p.invite_expires_at).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `expire dans ${h} h` : `expire dans ${Math.max(1, Math.floor(ms / 60_000))} min`;
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
    .filter((p: any) => p.status === 'accepted' || (p.status === 'invited' && isInviteActive(p)))
    .forEach((p: any) => {
      if (p.player_id === game.creator_id) return;
      const sp: SlotPlayer = {
        id: p.player_id,
        name: p.player?.name ?? '?',
        elo: p.player?.elo_score ?? 0,
        wins: p.player?.win_count,
        losses: p.player?.loss_count,
        isMe: p.player_id === myId,
        isInvited: p.status === 'invited',
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
const TEAM_BG = { A: Colors.primary,    B: Colors.brand };
const TEAM_FG = { A: Colors.textOnDark, B: Colors.textOnBrand };
function Avatar({ name, size = 36, ring, team }: { name: string; size?: number; ring?: string; team?: 'A' | 'B' }) {
  const tone = hashTone(name);
  const bg = team ? TEAM_BG[team] : tone.bg;
  const fg = team ? TEAM_FG[team] : tone.fg;
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
      borderWidth: ring ? 2 : 0, borderColor: ring ?? 'transparent',
    }}>
      <Text style={{ color: fg, fontSize: Math.round(size * 0.4), fontWeight: '900' }}>
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
    const borderCol = selected ? theme.accentHex : isChange ? theme.eloBorder : Colors.border;
    const bgCol = selected ? theme.eloBg : isChange ? theme.eloBg : Colors.bg;
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
      borderStyle: 'solid',
      borderColor: player.isMe ? Colors.warning : Colors.border,
      backgroundColor: player.isInvited ? Colors.bgCardAlt : Colors.bg,
      opacity: player.isInvited ? 0.7 : 1,
    }]}>
      <Avatar name={player.name} size={30} ring={player.isMe ? Colors.warning : undefined} team={SIDE_TEAM[side] as 'A' | 'B'} />
      <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textPrimary, marginTop: 3 }} numberOfLines={1}>
        {player.isMe ? 'Toi' : player.name.split(' ')[0]}
      </Text>
      <Text style={{ fontSize: 7.5, color: Colors.textSecondary }}>
        {player.isInvited ? `⏳ Invité` : `${SIDE_SHORT[side]} · ${formatPadelLevel(player.elo)}`}
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
  onAcceptInvitation: (participantId: string, gameId: string) => Promise<void>;
  onDeclineInvitation: (participantId: string, gameId: string) => Promise<void>;
  onWithdrawInvitation?: (gameId: string, playerId: string) => Promise<void> | void;
  onLeave: (gameId: string, participantId: string, wasAccepted: boolean) => void;
  onCancelGame: (gameId: string) => void;
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
  // Places dérivées des vrais joueurs (créateur + acceptés/invités, sur 4),
  // comme l'UI de la fiche (3 - heldCount) — le compteur stocké peut dériver.
  const heldCount = (game.participants ?? []).filter(
    (p: any) => (p.status === 'accepted' || (p.status === 'invited' && isInviteActive(p))) && p.player_id !== game.creator_id,
  ).length;
  const spots = Math.max(0, 3 - heldCount);
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
  const url = lobbyGameLink(game.id);
  const msg = `Match Padel – ${typeLabel}\n👤 Organisé par ${creatorLabel}${playersLine}\n📅 ${dateStr} à ${timeStr}\n📍 ${game.location ?? ''}\n📊 Niveau : ${minLv} – ${maxLv}\n🟢 ${spotsText}\n🔗 ${url}`;
  try { await Share.share({ message: msg }); } catch { /* cancelled */ }
}

// ─── Main component ───────────────────────────────────────────
export default function GameDetailsSheet({
  game, myElo, playerId, onClose, onApply, onChangeSide, onCreatorChangeSide, onApprovePending, onDeclinePending, onAcceptInvitation, onDeclineInvitation, onWithdrawInvitation, onLeave, onCancelGame,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [mySlot, setMySlot] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isWaitlisted, setIsWaitlisted] = useState(false);
  // Hauteur réelle de la barre CTA (varie selon l'état : 1 bouton vs bandeau + boutons
  // dans les états « en attente / invité »). Sert à réserver le bon espace bas dans le
  // ScrollView pour que la dernière section (Les joueurs) ne reste pas sous la barre.
  const [ctaH, setCtaH] = useState(0);

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
  const myStatus     = (myParticipant as any)?.status;
  // Une invitation expirée (cron pas encore passée) ne « réserve » plus la place :
  // on la traite comme non-occupante pour rouvrir le chemin de candidature.
  const myInviteActive = !!myParticipant && isInviteActive(myParticipant as any);
  const alreadyIn    = !!myParticipant && (
    ['accepted', 'pending', 'waitlist'].includes(myStatus) ||
    (myStatus === 'invited' && myInviteActive)
  );
  const isAccepted   = myStatus === 'accepted';
  const isInvited    = myStatus === 'invited' && myInviteActive;
  const canParticipate = !isCreator && !alreadyIn;

  const pendingPlayers = (game.participants ?? []).filter((p: any) => p.status === 'pending');
  const invitedPlayers = (game.participants ?? []).filter((p: any) => p.status === 'invited' && isInviteActive(p));
  const waitlistPlayers = (game.participants ?? [])
    .filter((p: any) => p.status === 'waitlist')
    .sort((a: any, b: any) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
  const acceptedCount  = (game.participants ?? []).filter((p: any) => p.status === 'accepted').length;
  const heldCount      = acceptedCount + invitedPlayers.length;
  const isFull         = 1 + heldCount >= 4;
  const waitlistCount  = (game.participants ?? []).filter((p: any) => p.status === 'waitlist').length;
  const requiredVotes  = Math.min(1 + acceptedCount, 3);

  // Ma position dans la file d'attente (FIFO sur created_at), 1-indexée.
  const myWaitlistPosition = myStatus === 'waitlist'
    ? (() => {
        const wl = (game.participants ?? [])
          .filter((p: any) => p.status === 'waitlist')
          .sort((a: any, b: any) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
        const idx = wl.findIndex((p: any) => p.player_id === playerId);
        return idx >= 0 ? idx + 1 : null;
      })()
    : null;
  const ordinal = (n: number) => (n === 1 ? '1ʳᵉ' : `${n}ᵉ`);

  const fit       = (() => { const min = game.min_elo ?? 0, max = game.max_elo ?? 9999; if (myElo >= min && myElo <= max) return 'fit'; const m = Math.min(Math.abs(myElo - min), Math.abs(myElo - max)); return m <= 100 ? 'close' : 'outside'; })();
  // Le « niveau hors fourchette » n'a de sens que pour qui peut encore rejoindre.
  // Si je suis déjà dans la partie (créateur ou participant), on ne l'affiche pas.
  const outOfLevel = fit === 'outside' && canParticipate;

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
      if (isCreator) {
        return (
          <TouchableOpacity
            onPress={() => onCancelGame(game.id)}
            style={[sty.ctaBtn, { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca' }]}
          >
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>Annuler la partie</Text>
          </TouchableOpacity>
        );
      }
      if (isAccepted && myParticipant) {
        return (
          <TouchableOpacity
            onPress={() => onLeave(game.id, (myParticipant as any).id, true)}
            style={[sty.ctaBtn, { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca' }]}
          >
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>Quitter la partie</Text>
          </TouchableOpacity>
        );
      }
      return null;
    }
    if (alreadyIn) {
      if (isInvited && myParticipant) {
        const isChallenge = !!game.is_challenge;
        return (
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,193,26,0.14)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.55)' }}>
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.brandDeep }}>
                {isChallenge ? '⚡ Tu as été défié !' : '✉️ Tu es invité'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => onDeclineInvitation((myParticipant as any).id, game.id)}
                style={[sty.ctaBtn, { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca' }]}
              >
                <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>Refuser</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onAcceptInvitation((myParticipant as any).id, game.id)}
                style={[sty.ctaBtn, { backgroundColor: Colors.success, elevation: 6, shadowColor: Colors.success, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }]}
              >
                <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>
                  {isChallenge ? '⚡ Relever le défi' : '✓ Accepter'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }
      const isPending = myStatus === 'pending';
      return (
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a' }}>
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: '#B45309' }}>
              {isPending
                ? `⏳ Demande envoyée · ${((myParticipant as any)?.approvals?.length ?? 0)}/${requiredVotes} vote${requiredVotes > 1 ? 's' : ''}`
                : `⏳ Liste d'attente${myWaitlistPosition ? ` · ${ordinal(myWaitlistPosition)} position` : ''}`}
            </Text>
          </View>
          {myParticipant && (
            <TouchableOpacity
              onPress={() => onLeave(game.id, (myParticipant as any).id, false)}
              style={[sty.ctaBtn, { backgroundColor: '#fff5f5', borderWidth: 1, borderColor: '#fecaca' }]}
            >
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>
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
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.success }}>✓ Sur la liste d'attente</Text>
        </View>
      ) : (
        <TouchableOpacity onPress={handleWaitlist} style={[sty.ctaBtn, { backgroundColor: Colors.danger, elevation: 6, shadowColor: Colors.danger, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }]}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>⏳ Rejoindre la liste d'attente</Text>
        </TouchableOpacity>
      );
    if (mySlot) return (
      <TouchableOpacity onPress={confirmJoin} disabled={isJoining} style={[sty.ctaBtn, {
        backgroundColor: theme.btnColor, opacity: isJoining ? 0.7 : 1,
        elevation: 6, shadowColor: theme.btnColor, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
      }]}>
        {isJoining
          ? <ActivityIndicator color={Colors.textOnDark} />
          : <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>
              {outOfLevel
                ? `Envoyer une demande — Éq. ${SIDE_TEAM[mySlot]} ${SIDE_SHORT[mySlot]}`
                : `✓ Confirmer — Éq. ${SIDE_TEAM[mySlot]} ${SIDE_SHORT[mySlot]}`}
            </Text>
        }
      </TouchableOpacity>
    );
    return (
      <View style={[sty.ctaBtn, { backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }]}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: Colors.textMuted }}>
          ↑ Choisissez un emplacement{outOfLevel ? ' (demande)' : ''}
        </Text>
      </View>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={sty.sheet}>
          {/* ── Dark hero ── */}
          <View style={{ backgroundColor: Colors.heroBg, paddingHorizontal: 16, paddingTop: insets.top + 8, paddingBottom: 14, position: 'relative', overflow: 'hidden' }}>
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
                  <Text style={{ color: 'rgba(255,255,255,0.9)', fontFamily: Fonts.uiBlack, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase' }}>
                    {typeLabel}
                  </Text>
                </View>
              </View>
            </View>
            {/* Date + time */}
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 2 }}>{dateStr}</Text>
            <Text style={{ fontSize: 36, fontFamily: Fonts.welcome, color: Colors.textOnDark, letterSpacing: 0.2, marginBottom: 6 }}>{timeStr || '—'}</Text>
            {/* Location + gender */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Svg width={12} height={12} viewBox="0 0 24 24" fill="none">
                <Path stroke={Colors.textMuted} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" d="M20 10c0 7-8 13-8 13S4 17 4 10a8 8 0 0 1 16 0Z" />
                <Circle cx={12} cy={10} r={3} stroke={Colors.textMuted} strokeWidth={2.2} />
              </Svg>
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.border, flex: 1 }} numberOfLines={1}>{game.location}</Text>
              {(game as any).gender_pref && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: Fonts.uiBlack, fontSize: 10, fontWeight: '900' }}>
                    {(game as any).gender_pref === 'men' ? '♂ Hommes' : (game as any).gender_pref === 'women' ? '♀ Femmes' : '⚧ Mixte'}
                  </Text>
                </View>
              )}
            </View>
            {/* Meta strip */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.success }} />
                <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '600' }}>Niv. {minLvl} – {maxLvl}</Text>
              </View>
              <View style={{
                marginLeft: 'auto',
                backgroundColor: isFull ? Colors.danger : (3 - heldCount) <= 1 ? Colors.warning : Colors.success,
                borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4,
              }}>
                <Text style={{ color: isFull ? Colors.textOnDark : Colors.textPrimary, fontSize: 10, fontWeight: '900' }}>
                  {isFull ? `Complet · ${waitlistCount} en attente` : `${3 - heldCount} place${(3 - heldCount) > 1 ? 's' : ''} libre${(3 - heldCount) > 1 ? 's' : ''}`}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Scrollable body ── */}
          <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: (ctaH || insets.bottom) + 16 }}>

            {/* Status banners */}
            {(isFull || outOfLevel) && (
              <View style={{ paddingHorizontal: 14, paddingTop: 14, gap: 10 }}>
                {isFull && !isCreator && !alreadyIn && (
                  <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 16, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 18 }}>🔒</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: '#B91C1C' }}>Partie complète</Text>
                      <Text style={{ fontSize: 11, color: Colors.danger, marginTop: 2 }}>Rejoignez la liste d'attente — vous serez prévenu si une place se libère.</Text>
                    </View>
                  </View>
                )}
                {outOfLevel && !isFull && (
                  <View style={{ backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 16, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 18 }}>⚠️</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: '#B45309' }}>Niveau hors fourchette</Text>
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
              <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 18, padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, textTransform: 'uppercase', letterSpacing: 1 }}>Les joueurs</Text>
                  {courtHint ? (
                    <Text style={{ fontSize: 10, fontWeight: '700', color: isFull ? Colors.danger : mySlot ? Colors.success : Colors.textMuted, flexShrink: 1, marginLeft: 8 }} numberOfLines={1}>
                      {courtHint}
                    </Text>
                  ) : null}
                </View>

                {/* Vue joueurs épurée : Équipe A | séparateur | Équipe B (sans fond terrain) */}
                <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
                  {/* Équipe A : A_GAU, A_DRO */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: theme.courtLabel, letterSpacing: 0.5, marginBottom: 8 }}>ÉQUIPE A</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
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
                  </View>

                  {/* Séparateur */}
                  <View style={{ width: 1, backgroundColor: Colors.border, marginHorizontal: 12, alignSelf: 'stretch' }} />

                  {/* Équipe B : B_DRO (miroir de A_GAU), B_GAU */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: theme.courtLabel, letterSpacing: 0.5, marginBottom: 8, textAlign: 'right' }}>ÉQUIPE B</Text>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
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

            {/* Pending candidates — creator / accepted only */}
            {pendingPlayers.length > 0 && (isCreator || isAccepted) && (
              <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.danger }} />
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
                    {pendingPlayers.length} candidature{pendingPlayers.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={{ gap: 8 }}>
                  {pendingPlayers.map((p: any) => {
                    const approvals = p.approvals ?? [];
                    const hasVoted  = approvals.includes(playerId);
                    return (
                      <View key={p.id} style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          <Avatar name={p.player?.name ?? '?'} size={40} />
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{p.player?.name}</Text>
                              <View style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary }}>Niv.{formatPadelLevel(p.player?.elo_score ?? 0)}</Text>
                              </View>
                            </View>
                            <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
                              {approvals.length}/{requiredVotes} approbation{approvals.length > 1 ? 's' : ''}
                            </Text>
                          </View>
                          {isFull ? (
                            <View style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                              <Text style={{ fontSize: 10, fontWeight: '700', color: Colors.textMuted }}>En attente</Text>
                            </View>
                          ) : hasVoted ? (
                            <View style={{ backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
                              <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.success }}>Voté ✓</Text>
                            </View>
                          ) : (
                            <View style={{ flexDirection: 'row', gap: 6 }}>
                              <TouchableOpacity
                                onPress={() => onApprovePending(p.id, game.id, p.player_id, approvals)}
                                style={{ width: 36, height: 36, backgroundColor: Colors.success, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 14 }}>✓</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => onDeclinePending(p.id)}
                                style={{ width: 36, height: 36, backgroundColor: Colors.bgCardAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: Colors.textSecondary, fontWeight: '900' }}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                        {p.application_note ? (
                          <View style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 10, padding: 8, marginBottom: 8 }}>
                            <Text style={{ fontSize: 12, fontStyle: 'italic', color: Colors.textSecondary }}>
                              💬 « {p.application_note} »
                            </Text>
                          </View>
                        ) : null}
                        {/* Approval progress bar */}
                        <View style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 99, height: 5, overflow: 'hidden' }}>
                          <View style={{
                            height: '100%', backgroundColor: Colors.success, borderRadius: 99,
                            width: `${Math.min(approvals.length / requiredVotes * 100, 100)}%`,
                          }} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Waitlist — visible par tous (créateur, acceptés, et autres) pour transparence */}
            {waitlistPlayers.length > 0 && (
              <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.warning }} />
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
                    Liste d'attente · {waitlistPlayers.length}
                  </Text>
                </View>
                <View style={{ gap: 6 }}>
                  {waitlistPlayers.map((p: any, i: number) => {
                    const isMine = p.player_id === playerId;
                    return (
                      <View key={p.id} style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        backgroundColor: isMine ? 'rgba(245,158,11,0.10)' : Colors.bgCard,
                        borderWidth: 1, borderColor: isMine ? 'rgba(245,158,11,0.40)' : Colors.border,
                        borderRadius: 12, padding: 10,
                      }}>
                        <View style={{
                          width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.bgCardAlt,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>{i + 1}</Text>
                        </View>
                        <Avatar name={p.player?.name ?? '?'} size={30} ring={isMine ? Colors.warning : undefined} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>
                            {isMine ? 'Toi' : p.player?.name}
                          </Text>
                          <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
                            Niv. {formatPadelLevel(p.player?.elo_score ?? 0)} · {i === 0 ? 'Prochain à entrer' : `${i + 1}ᵉ en attente`}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Invitations en attente — créateur uniquement (peut retirer) */}
            {isCreator && invitedPlayers.length > 0 && (
              <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.brandDeep }} />
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
                    {invitedPlayers.length} invitation{invitedPlayers.length > 1 ? 's' : ''} en attente
                  </Text>
                </View>
                <View style={{ gap: 6 }}>
                  {invitedPlayers.map((p: any) => {
                    const countdown = inviteCountdown(p);
                    return (
                      <View key={p.id} style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
                        borderRadius: 12, padding: 10,
                      }}>
                        <Avatar name={p.player?.name ?? '?'} size={30} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>
                            {p.player?.name}
                          </Text>
                          <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
                            Niv. {formatPadelLevel(p.player?.elo_score ?? 0)}{countdown ? ` · ${countdown}` : ''}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            Alert.alert(
                              "Retirer l'invitation ?",
                              `${p.player?.name ?? 'Ce joueur'} ne pourra plus rejoindre via cette invitation.`,
                              [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Retirer', style: 'destructive', onPress: () => onWithdrawInvitation?.(game.id, p.player_id) },
                              ],
                            );
                          }}
                          style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                          <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textSecondary }}>Retirer</Text>
                        </TouchableOpacity>
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
                  <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>Les joueurs</Text>
                  <Text style={{ fontSize: 10, color: Colors.textMuted, fontWeight: '600' }}>
                    {filled.length} confirmé{filled.length > 1 ? 's' : ''} · {emptySlots.length} libre{emptySlots.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <View style={{ gap: 10 }}>
                  {filled.map(({ player: p, side }) => {
                    const total   = (p.wins ?? 0) + (p.losses ?? 0);
                    const winRate = total > 0 ? Math.round((p.wins ?? 0) / total * 100) : 0;
                    const isTeamA = SIDE_TEAM[side] === 'A';
                    return (
                      <TouchableOpacity
                        key={side}
                        onPress={() => router.push(`/player/${p.id}` as any)}
                        activeOpacity={0.8}
                        style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.bgCardAlt, borderRadius: 18, padding: 14 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: total > 0 ? 10 : 0 }}>
                          <Avatar name={p.name} size={44} ring={p.isMe ? Colors.warning : undefined} team={isTeamA ? 'A' : 'B'} />
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{p.isMe ? 'Toi' : p.name}</Text>
                              <View style={{ backgroundColor: Colors.bgCardAlt, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                                <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary }}>Niv.{formatPadelLevel(p.elo)}</Text>
                              </View>
                            </View>
                            <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
                              {p.isCreator ? '👑 Créateur' : 'Participant'}
                            </Text>
                          </View>
                          <View style={{
                            backgroundColor: isTeamA ? '#eef2ff' : '#f5f3ff',
                            borderWidth: 1, borderColor: isTeamA ? '#c7d2fe' : '#ddd6fe',
                            borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, alignItems: 'center',
                          }}>
                            <Text style={{ fontSize: 8, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.4 }}>Éq. {SIDE_TEAM[side]}</Text>
                            <Text style={{ fontSize: 10, fontWeight: '900', color: isTeamA ? '#4338ca' : '#6d28d9' }}>{SIDE_POS[side]}</Text>
                          </View>
                        </View>
                        {total > 0 && (
                          <View style={{ flexDirection: 'row', gap: 8 }}>
                            <View style={{ flex: 1, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.bgCardAlt, borderRadius: 10, padding: 8, alignItems: 'center' }}>
                              <Text style={{ fontSize: 8, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase' }}>Matchs</Text>
                              <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{total}</Text>
                            </View>
                            <View style={{ flex: 1, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.bgCardAlt, borderRadius: 10, padding: 8, alignItems: 'center' }}>
                              <Text style={{ fontSize: 8, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase' }}>Victoires</Text>
                              <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
                                {winRate}<Text style={{ fontSize: 10, color: Colors.textMuted }}>%</Text>
                              </Text>
                            </View>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

          </ScrollView>

          {/* ── Sticky CTA — only when there is an action ── */}
          {(() => {
            const cta = renderCTA();
            if (!cta) return null;
            return (
              <View
                style={[sty.ctaBar, { paddingBottom: insets.bottom + 10 }]}
                onLayout={e => setCtaH(e.nativeEvent.layout.height)}
              >
                {cta}
              </View>
            );
          })()}
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const sty = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: Colors.bg,
    overflow: 'hidden',
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
    borderColor: Colors.border, backgroundColor: Colors.bgCard,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaBtn: {
    flex: 1, height: 50, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
});
