import { useEffect, useState, type ReactNode } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert,
  ActivityIndicator, StyleSheet, Share, Linking, Image, BackHandler,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { Colors, formatPadelLevel, Fonts, Radius } from '../../lib/theme';
import { buildGameShareMessage } from '../../lib/community';
import { isInviteActive, isConfirmedInGame, spotsLabel, freeSpots, gameEloRange, courtBooking } from '../../lib/games';
import { fetchQueuedBinomes, targetedOpponentsLine, stakeTone, type QueuedBinome } from '../../lib/defis';
import { fetchPlayersTotals, type PlayerTotals } from '../../lib/playerStats';
import { FitTitle } from '../../components/DisplayTitle';
import { openInMaps, hasMapTarget } from '../../lib/maps';
import { CreatorCrownBadge } from '../../components/CreatorCrownBadge';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { Icon } from '../../components/community/icons';
import { LiveLobbyBlock } from '../../components/live/LiveLobbyBlock';
import { getLiveScoringEnabled, fetchLiveSession, type LiveSession } from '../../lib/liveSession';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { useHideTabBar } from '../../components/TabBarVisibility';
import { useOrigin } from '../../hooks/useOrigin';
import { distanceSentence } from '../../lib/geo';
import type { OpenGame } from '../../types';

// ─── Types ────────────────────────────────────────────────────
interface SlotPlayer {
  id: string; name: string; elo: number;
  /** `players.avatar_path` — sa photo, si elle existe. */
  avatarPath?: string | null;
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
// Durée d'une partie : sert à l'événement agenda ET à « Durée estimée ».
const MATCH_DURATION_MIN = 90;
const DURATION_LABEL = `${Math.floor(MATCH_DURATION_MIN / 60)}h${String(MATCH_DURATION_MIN % 60).padStart(2, '0')}`;

// Couleurs de la fiche (maquette) : équipe A = jaune doux, équipe B = violet.
const VIOLET      = '#7C3AED';
const VIOLET_SOFT = '#EDE9FE';
const TEAM_A_SOFT = '#FFF3D1';
const TILE        = '#F6F6F5';

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
    avatarPath: (game.creator as any)?.avatar_path ?? null,
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
        avatarPath: (p.player as any)?.avatar_path ?? null,
        wins: p.player?.win_count,
        losses: p.player?.loss_count,
        isMe: p.player_id === myId,
        isInvited: p.status === 'invited',
      };
      const idx = SIDE_TO_IDX[p.team_side ?? ''];
      if (idx !== undefined && !slots[idx]) {
        slots[idx] = sp;
      } else {
        // Rester dans la MÊME équipe (A→0/1, B→2/3), jamais traverser.
        const teamStart = String(p.team_side ?? '').startsWith('B') ? 2 : 0;
        const free = [teamStart, teamStart + 1].find(i => !slots[i]);
        if (free !== undefined) slots[free] = sp;
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
function Avatar({ name, size = 36, ring, team, creator, path }: {
  name: string; size?: number; ring?: string; team?: 'A' | 'B'; creator?: boolean;
  /** Photo du joueur ; initiales si absente (components/PlayerAvatar). */
  path?: string | null;
}) {
  const tone = hashTone(name);
  const bg = team ? TEAM_BG[team] : tone.bg;
  const fg = team ? TEAM_FG[team] : tone.fg;
  return (
    <PlayerAvatar
      name={name} path={path} size={size}
      backgroundColor={bg} textColor={fg}
      ring={ring ? 2 : undefined} ringColor={ring}
    >
      {creator ? <CreatorCrownBadge avatarSize={size} /> : null}
    </PlayerAvatar>
  );
}

// ─── Court slot ───────────────────────────────────────────────
function CourtSlot({
  player, side, selected, canClick, mode, onPress, theme,
}: {
  player: SlotPlayer | null; side: string; selected: boolean;
  canClick: boolean; mode?: 'join' | 'change'; onPress: () => void; theme: GameTheme;
}) {
  if (!player) {
    const isChange = mode === 'change';
    const active = selected || isChange;
    return (
      <TouchableOpacity
        onPress={canClick ? onPress : undefined}
        activeOpacity={canClick ? 0.7 : 1}
        style={[sty.slot, {
          borderWidth: 1.5, borderStyle: 'dashed',
          borderColor: selected ? theme.accentHex : isChange ? theme.eloBorder : '#D4D4D8',
          backgroundColor: active ? theme.eloBg : Colors.bgCard,
        }]}
      >
        <View style={{
          width: 54, height: 54, borderRadius: 27, borderWidth: 1.5,
          borderStyle: selected ? 'solid' : 'dashed',
          borderColor: selected ? theme.accentHex : '#C4C4C8',
          alignItems: 'center', justifyContent: 'center',
        }}>
          {selected
            ? <Icon name="check" size={18} color={theme.accentHex} stroke={2.6} />
            : isChange
              ? <Icon name="repeat" size={16} color={theme.accentHex} stroke={2.2} />
              : <Icon name="plus" size={18} color={Colors.textSecondary} stroke={2} />}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiSemi, color: active ? theme.accentHex : Colors.textSecondary, marginTop: 8 }}>
          {selected ? 'Ta place' : isChange ? 'Changer' : 'Libre'}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
          {SIDE_POS[side]}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[sty.slot, {
      backgroundColor: TILE,
      borderWidth: player.isMe ? 1.5 : 0,
      borderColor: player.isMe ? Colors.brand : 'transparent',
      opacity: player.isInvited ? 0.7 : 1,
    }]}>
      <Avatar name={player.name} path={player.avatarPath} size={58} team={SIDE_TEAM[side] as 'A' | 'B'} creator={player.isCreator} />
      <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, marginTop: 8 }}>
        {player.isMe ? 'Toi' : player.name.split(' ')[0]}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 11, color: Colors.textSecondary, marginTop: 1 }}>
        {player.isInvited ? '⏳ Invité' : `Niv. ${formatPadelLevel(player.elo)}`}
      </Text>
    </View>
  );
}

// ─── Blocs de présentation ────────────────────────────────────
// Titre de carte. Le TITRE ne se coupe jamais : quand la place manque (police
// du téléphone agrandie), le texte de droite passe à la ligne suivante, et un
// titre trop long s'écrit sur deux lignes. Pas d'adjustsFontSizeToFit : sur
// Android il ne réduit pas cette police, il tronquait au mot (« LES »).
function SectionHeader({ icon, title, aside }: { icon: ReactNode; title: string; aside?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      {icon}
      {/* FitTitle mesure la place disponible et calcule la taille : sur Android,
          un titre comprimé dans cette police est coupé (« LES » pour
          « LES JOUEURS »), jamais rétréci ni mis à la ligne. */}
      <FitTitle max={20} min={13} uppercase color={Colors.textPrimary}>{title}</FitTitle>
      {aside ? (
        <Text numberOfLines={2} style={{ flexShrink: 0, maxWidth: '44%', textAlign: 'right', fontSize: 11.5, lineHeight: 14, fontFamily: Fonts.ui, color: Colors.textSecondary }}>
          {aside}
        </Text>
      ) : null}
    </View>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 2 }}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 10, color: Colors.textSecondary }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 16, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, marginTop: 2 }}>
        {value}{unit ? <Text style={{ fontSize: 10, color: Colors.textSecondary }}>{unit}</Text> : null}
      </Text>
    </View>
  );
}

function InfoCell({ icon, label, value }: { icon: 'trophy' | 'clock' | 'users'; label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
      <Icon name={icon} size={20} color={Colors.textPrimary} stroke={1.8} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 10.5, color: Colors.textSecondary }}>{label}</Text>
        <Text numberOfLines={2} style={{ fontSize: 12, fontFamily: Fonts.uiSemi, color: Colors.textPrimary, marginTop: 1 }}>{value}</Text>
      </View>
    </View>
  );
}

function UserPlusIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <Circle cx="9" cy="7" r="4" />
      <Line x1="19" y1="8" x2="19" y2="14" />
      <Line x1="22" y1="11" x2="16" y2="11" />
    </Svg>
  );
}

// ─── Props ────────────────────────────────────────────────────
interface Props {
  /** Fermeture PROPRE : la fiche reste montée et la fenêtre s'efface d'elle-même.
   *  La démonter d'un coup pendant qu'elle est à l'écran laisse, sur iPhone, une
   *  fenêtre fantôme qui avale les touches — l'écran semble figé alors que la
   *  navigation répond encore (constaté le 2026-09-16). */
  visible?: boolean;
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
  onRelever?: (gameId: string) => void;   // défi : relève à deux (flux binôme)
  hasAppliedDefi?: boolean;                // défi : j'ai déjà une candidature en attente
}

// ─── Calendar + Share helpers ─────────────────────────────────
function openCalendar(game: EnrichedGame) {
  if (!game.match_date) return;
  const start = new Date(game.match_date);
  const end = new Date(start.getTime() + MATCH_DURATION_MIN * 60 * 1000);
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
  const creatorObj = game.creator as any;
  // Confirmés (hors doublon créateur) puis invitations en cours (⏳ nominatif).
  const accepted = (game.participants ?? [])
    .filter((p: any) => p.status === 'accepted' && p.player_id !== game.creator_id)
    .map((p: any) => ({ name: (p.player as any)?.name, elo: (p.player as any)?.elo_score }));
  const invited = (game.participants ?? [])
    .filter((p: any) => isInviteActive(p) && p.player_id !== game.creator_id)
    .map((p: any) => ({ name: (p.player as any)?.name, elo: (p.player as any)?.elo_score, pending: true }));
  const msg = buildGameShareMessage({
    gameId: game.id,
    location: game.location,
    matchDate: new Date(game.match_date),
    kind: game.is_challenge ? 'challenge' : (game as any).game_format === 'friendly' ? 'friendly' : 'competitive',
    stake: (game as any).stake_multiplier,
    players: [{ name: creatorObj?.name, elo: creatorObj?.elo_score }, ...accepted, ...invited],
    freeSpots: freeSpots(game),
    // Même fourchette que les cartes/fiche (gameEloRange) — jamais de faux 1.0–6.0.
    eloRange: gameEloRange(game),
  });
  try { await Share.share({ message: msg }); } catch { /* cancelled */ }
}

// ─── Main component ───────────────────────────────────────────
// Filet : si le rendu de la fiche lève une exception, on affiche le message au
// lieu de laisser un écran blanc qui emporte toute l'app.
export default function GameDetailsSheet(props: Props) {
  return (
    <ErrorBoundary quoi="la fiche de la partie" onClose={props.onClose} modal>
      <GameDetailsSheetContenu {...props} />
    </ErrorBoundary>
  );
}

function GameDetailsSheetContenu({
  visible = true, game, myElo, playerId, onClose, onApply, onChangeSide, onCreatorChangeSide, onApprovePending, onDeclinePending, onAcceptInvitation, onDeclineInvitation, onWithdrawInvitation, onLeave, onCancelGame, onRelever, hasAppliedDefi,
}: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Calque plein écran (plus de fenêtre modale native, cf. components/
  // TabBarVisibility) : la barre d'onglets se masque tant que la fiche est
  // ouverte, et le bouton retour d'Android la ferme — ce que <Modal> faisait
  // tout seul.
  useHideTabBar(visible);
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [visible, onClose]);

  // Distance jusqu'au club, même source que les cartes (hooks/useOrigin).
  const { distanceOf, origin } = useOrigin();
  const phraseDistance = distanceSentence(distanceOf(game.location), origin);

  // La fiche est une Modal NATIVE : une navigation lancée dessous reste
  // invisible tant qu'elle est ouverte. On ferme donc la fiche AVANT de
  // pousser le profil du joueur.
  const openProfile = (id: string) => {
    onClose();
    router.push(`/player/${id}` as any);
  };
  const [mySlot, setMySlot] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isWaitlisted, setIsWaitlisted] = useState(false);
  // Hauteur réelle de la barre CTA (varie selon l'état : 1 bouton vs bandeau + boutons
  // dans les états « en attente / invité »). Sert à réserver le bon espace bas dans le
  // ScrollView pour que la dernière section (Les joueurs) ne reste pas sous la barre.
  const [ctaH, setCtaH] = useState(0);
  // Score en direct : désignation du scoreur (colonne non typée dans OpenGame,
  // comme gender_pref/stake_multiplier plus bas) + session live éventuelle.
  const [liveScorerId, setLiveScorerId] = useState<string | null>((game as any).live_scorer_id ?? null);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);
  const [liveScoringEnabled, setLiveScoringEnabled] = useState(false);
  // Défi complet : on attend par BINÔME (defi_applications), pas par joueur.
  // Même source que l'onglet Défi et que la carte « À venir ».
  const [queuedBinomes, setQueuedBinomes] = useState<QueuedBinome[]>([]);
  // Matchs joués / victoires de chaque joueur : TOUS les matchs validés,
  // amicaux compris (lib/playerStats). Les colonnes win_count/loss_count
  // reçues avec la partie sont les compteurs CLASSÉS — elles affichaient
  // moins de matchs que la liste du profil pour le même joueur.
  const [totalsById, setTotalsById] = useState<Map<string, PlayerTotals>>(new Map());

  useEffect(() => { setMySlot(null); }, [game.id]);


  useEffect(() => {
    if (!game.is_challenge) { setQueuedBinomes([]); return; }
    let cancelled = false;
    fetchQueuedBinomes([game.id])
      .then(m => { if (!cancelled) setQueuedBinomes(m.get(game.id) ?? []); })
      .catch(() => { if (!cancelled) setQueuedBinomes([]); });
    return () => { cancelled = true; };
  }, [game.id, game.is_challenge]);

  useEffect(() => { setLiveScorerId((game as any).live_scorer_id ?? null); }, [game.id, (game as any).live_scorer_id]);

  // Refetch ciblé (juste la colonne live_scorer_id) après désignation/désistement
  // du scoreur par le bloc — pas besoin de recharger toute la fiche pour ça.
  const refetchLiveScorer = async () => {
    const { data } = await supabase.from('open_games').select('live_scorer_id').eq('id', game.id).maybeSingle();
    setLiveScorerId((data as any)?.live_scorer_id ?? null);
  };

  const theme = getGameTheme(game);

  // Derived state

  const slots = buildSlots(game, playerId);
  const emptySlots = ALL_SIDES.filter((_, i) => !slots[i]);
  const filled = ALL_SIDES
    .map((s, i) => slots[i] ? { player: slots[i]!, side: s } : null)
    .filter(Boolean) as { player: SlotPlayer; side: string }[];
  const filledIds = filled.map(f => f.player.id).join(',');
  useEffect(() => {
    const ids = filledIds ? filledIds.split(',') : [];
    if (ids.length === 0) { setTotalsById(new Map()); return; }
    let cancelled = false;
    fetchPlayersTotals(ids)
      .then(m => { if (!cancelled) setTotalsById(m); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filledIds]);

  const isCreator    = game.creator_id === playerId;
  // Défi ciblé en brouillon : phrase visible au créateur ET à son partenaire
  // invité — les adversaires notés (target_players) ne sont invités/notifiés
  // qu'à l'acceptation du binôme (fn_publish_defi_on_partner_accept).
  const targetedLine = targetedOpponentsLine(game, isCreator ? 'creator' : 'partner');
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
  // Un défi ne se rejoint JAMAIS en solo depuis ici (slots non tappables) : on le
  // relève à deux via le CTA dédié.
  const canParticipate = !isCreator && !alreadyIn && !game.is_challenge;

  const pendingPlayers = (game.participants ?? []).filter((p: any) => p.status === 'pending');
  const invitedPlayers = (game.participants ?? []).filter((p: any) => p.status === 'invited' && isInviteActive(p));
  const waitlistPlayers = (game.participants ?? [])
    .filter((p: any) => p.status === 'waitlist')
    .sort((a: any, b: any) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime());
  const acceptedCount  = (game.participants ?? []).filter((p: any) => p.status === 'accepted').length;
  const heldCount      = acceptedCount + invitedPlayers.length;
  const isFull         = 1 + heldCount >= 4;
  // « Complet » AFFICHÉ seulement quand les 4 joueurs sont tous confirmés :
  // une place tenue par une invitation en cours peut encore se libérer.
  // isFull continue de bloquer la jonction (anti-overbooking), lui seul.
  const confirmedFull  = isFull && invitedPlayers.length === 0;
  // Score en direct — je ne suis concerné que si la partie est complète (4
  // confirmés) et que j'y participe : évite toute requête live_match_sessions
  // superflue (visiteurs, parties incomplètes) et respecte le flag admin
  // AVANT de taper la table (jamais de requête quand le flag est éteint).
  const liveEligible = confirmedFull && isConfirmedInGame(game, playerId);
  useEffect(() => {
    if (!liveEligible) { setLiveScoringEnabled(false); setLiveSession(null); return; }
    let cancelled = false;
    getLiveScoringEnabled().then(enabled => {
      if (cancelled) return;
      setLiveScoringEnabled(enabled);
      if (enabled) fetchLiveSession(game.id).then(s => { if (!cancelled) setLiveSession(s); });
    });
    return () => { cancelled = true; };
  }, [game.id, liveEligible]);
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
  // minLvl/maxLvl = contrainte EXPLICITE (avertissement « hors fourchette »,
  // jamais atteint quand la contrainte est absente : fit vaut alors 'fit').
  const minLvl   = formatPadelLevel(game.min_elo ?? 0);
  const maxLvl   = formatPadelLevel(game.max_elo ?? 1750);
  // Fourchette AFFICHÉE : source unique gameEloRange — défi ciblé sans
  // contrainte → dérivée des joueurs confirmés, pas de faux « 1.0 – 6.0 ».
  const eloRange = gameEloRange(game);
  const rangeLabel = eloRange
    ? (formatPadelLevel(eloRange.min) === formatPadelLevel(eloRange.max)
        ? `Niv. ${formatPadelLevel(eloRange.min)}`
        : `Niv. ${formatPadelLevel(eloRange.min)} – ${formatPadelLevel(eloRange.max)}`)
    : null;
  const typeLabel = game.is_challenge ? 'Défi' : (game.game_format as string) === 'friendly' ? 'Amical' : 'Compétitif';

  // Ce que dit la pastille des places. Sur un DÉFI complet, la file se compte
  // en binômes (queuedBinomes) : « 0 en attente » y était toujours faux.
  const spotsFree = 3 - heldCount;
  const placesText = confirmedFull
    ? (game.is_challenge
        ? (queuedBinomes.length > 0
            ? `Complet · ${queuedBinomes.length} binôme${queuedBinomes.length > 1 ? 's' : ''} en file`
            : 'Complet')
        : waitlistCount > 0 ? `Complet · ${waitlistCount} en attente` : 'Complet')
    : isFull ? `${invitedPlayers.length} en attente de réponse`
    : `${spotsFree} place${spotsFree > 1 ? 's' : ''} libre${spotsFree > 1 ? 's' : ''}`;
  const placesTone = confirmedFull ? Colors.danger
    : isFull || spotsFree <= 1 ? Colors.warning
    : Colors.success;

  const courtHint = confirmedFull
    ? `🔒 Complet · ${waitlistCount} en attente`
    : isFull ? `⏳ ${invitedPlayers.length} invitation${invitedPlayers.length > 1 ? 's' : ''} en attente de réponse`
    : mySlot ? `✓ Éq. ${SIDE_TEAM[mySlot]} · ${SIDE_SHORT[mySlot]}`
    : (isCreator || isAccepted) ? '↔ Touchez un slot libre pour changer'
    : outOfLevel ? '⚠ Tapez un slot pour demander'
    : canParticipate ? 'Tapez un slot pour rejoindre'
    : '';

  // Emplacement du terrain : même logique de clic qu'avant, pour les deux équipes.
  const renderSlot = (side: (typeof ALL_SIDES)[number]) => {
    const isEmpty = !slots[SIDE_TO_IDX[side]];
    const joinMode = isEmpty && canParticipate && !isFull;
    // Défi : équipes fixes (binôme A vs B) → pas de changement d'équipe.
    const changeMode = !game.is_challenge && isEmpty && !isFull && (isCreator || isAccepted);
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
  };

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
            style={[sty.ctaBtn, sty.ctaDanger]}
          >
            <Icon name="trash" size={18} color={Colors.danger} stroke={2.2} />
            <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>Annuler la partie</Text>
          </TouchableOpacity>
        );
      }
      if (isAccepted && myParticipant) {
        return (
          <TouchableOpacity
            onPress={() => onLeave(game.id, (myParticipant as any).id, true)}
            style={[sty.ctaBtn, sty.ctaDanger]}
          >
            <Icon name="trash" size={18} color={Colors.danger} stroke={2.2} />
            <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>Quitter la partie</Text>
          </TouchableOpacity>
        );
      }
      return null;
    }
    if (alreadyIn) {
      if (isInvited && myParticipant) {
        const isChallenge = !!game.is_challenge;
        // Invité côté A d'un défi = le créateur me demande d'être son BINÔME
        // (« Tu as été défié » n'avait pas de sens) ; côté B = on me défie.
        const isBinome = isChallenge && String((myParticipant as any).team_side ?? '').startsWith('A');
        const createur = ((game as any).creator?.name ?? '').trim().split(/\s+/)[0] || 'Le créateur';
        return (
          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,193,26,0.14)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.55)' }}>
              <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.brandDeep }}>
                {isBinome ? `${createur} t'invite comme binôme` : isChallenge ? '⚡ Tu as été défié !' : '✉️ Tu es invité'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => onDeclineInvitation((myParticipant as any).id, game.id)}
                style={[sty.ctaBtn, { backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border }]}
              >
                <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>Refuser</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onAcceptInvitation((myParticipant as any).id, game.id)}
                style={[sty.ctaBtn, { backgroundColor: Colors.primary, elevation: 6, shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }]}
              >
                <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>
                  {isBinome ? 'Rejoindre le binôme' : isChallenge ? 'Relever le défi' : 'Accepter'}
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
            <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: '#B45309' }}>
              {isPending
                ? `⏳ Demande envoyée · ${((myParticipant as any)?.approvals?.length ?? 0)}/${requiredVotes} vote${requiredVotes > 1 ? 's' : ''}`
                : `⏳ Liste d'attente${myWaitlistPosition ? ` · ${ordinal(myWaitlistPosition)} position` : ''}`}
            </Text>
          </View>
          {myParticipant && (
            <TouchableOpacity
              onPress={() => onLeave(game.id, (myParticipant as any).id, false)}
              style={[sty.ctaBtn, sty.ctaDanger]}
            >
              <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>
                {isPending ? 'Retirer ma candidature' : "Quitter la liste d'attente"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    // Défi (je n'y suis pas) : pas de join solo → CTA « Relever à deux » (flux binôme).
    // 'open' → relever ; 'confirmed' → rejoindre la FILE D'ATTENTE ; sinon indisponible.
    // Si j'ai déjà candidaté, on affiche « Déjà postulé » (toucher = changer de binôme).
    if (game.is_challenge) {
      const st = (game as any).status;
      if (st !== 'open' && st !== 'confirmed') {
        return (
          <View style={[sty.ctaBtn, { backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }]}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textMuted }}>Défi indisponible</Text>
          </View>
        );
      }
      if (onRelever) {
        return (
          <TouchableOpacity onPress={() => onRelever(game.id)}
            style={[sty.ctaBtn, hasAppliedDefi
              ? { backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }
              : { backgroundColor: Colors.brand, elevation: 6, shadowColor: Colors.brand, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }]}>
            <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: hasAppliedDefi ? Colors.textSecondary : Colors.textOnBrand }}>
              {hasAppliedDefi ? '⏳ Déjà postulé — changer de binôme'
                : st === 'confirmed' ? 'Rejoindre la file d\'attente (à deux)' : 'Relever le défi (à deux)'}
            </Text>
          </TouchableOpacity>
        );
      }
    }
    if (isFull) return isWaitlisted
      ? (
        <View style={[sty.ctaBtn, { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' }]}>
          <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.success }}>✓ Sur la liste d'attente</Text>
        </View>
      ) : (
        <TouchableOpacity onPress={handleWaitlist} style={[sty.ctaBtn, { backgroundColor: Colors.primary, elevation: 6, shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }]}>
          <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnDark }}>⏳ Rejoindre la liste d'attente</Text>
        </TouchableOpacity>
      );
    if (mySlot) return (
      <TouchableOpacity onPress={confirmJoin} disabled={isJoining} style={[sty.ctaBtn, {
        backgroundColor: Colors.brand, opacity: isJoining ? 0.7 : 1,
        elevation: 6, shadowColor: Colors.brand, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
      }]}>
        {isJoining
          ? <ActivityIndicator color={Colors.textOnBrand} />
          : <>
              <UserPlusIcon size={20} color={Colors.textOnBrand} />
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flexShrink: 1, fontSize: 15, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnBrand }}>
                {outOfLevel
                  ? `Demander à rejoindre · Éq. ${SIDE_TEAM[mySlot]} ${SIDE_POS[mySlot]}`
                  : `Rejoindre · Éq. ${SIDE_TEAM[mySlot]} ${SIDE_POS[mySlot]}`}
              </Text>
            </>
        }
      </TouchableOpacity>
    );
    return (
      <View style={[sty.ctaBtn, { backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border }]}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textMuted }}>
          ↑ Choisissez un emplacement{outOfLevel ? ' (demande)' : ''}
        </Text>
      </View>
    );
  }

  // Fermée : rien à l'écran. La fiche reste montée (état conservé, cf. lobby).
  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100, elevation: 100 }]}>
      <View style={sty.sheet}>
          {/* ── Hero sombre ── */}
          <View style={{ backgroundColor: Colors.heroBg, paddingHorizontal: 18, paddingTop: insets.top + 8, paddingBottom: 40, overflow: 'hidden' }}>
            {/* Halos jaunes (décor) */}
            <View pointerEvents="none" style={{ position: 'absolute', top: -120, right: -90, width: 250, height: 250, borderRadius: 125, backgroundColor: 'rgba(255,193,26,0.10)' }} />
            <View pointerEvents="none" style={{ position: 'absolute', bottom: -160, left: -120, width: 270, height: 270, borderRadius: 135, backgroundColor: 'rgba(255,193,26,0.07)' }} />
            {/* Nav : retour · logo · agenda · partage · type */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, marginBottom: 16 }}>
              <TouchableOpacity onPress={onClose} style={sty.heroBtn}>
                <Icon name="chevronLeft" size={20} color="rgba(255,255,255,0.9)" stroke={2.4} />
              </TouchableOpacity>
              <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 22, height: 22 }} resizeMode="contain" />
                <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 96, height: 20, marginLeft: -6, flexShrink: 1 }} resizeMode="contain" />
              </View>
              {game.match_date && (isCreator || isAccepted) && (
                <TouchableOpacity onPress={() => openCalendar(game)} style={sty.heroBtn}>
                  <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <Rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <Line x1="16" y1="2" x2="16" y2="6" />
                    <Line x1="8" y1="2" x2="8" y2="6" />
                    <Line x1="3" y1="10" x2="21" y2="10" />
                  </Svg>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => shareGame(game)} style={sty.heroBtn}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <Path d="M16 6l-4-4-4 4" />
                  <Line x1="12" y1="2" x2="12" y2="15" />
                </Svg>
              </TouchableOpacity>
              <View style={{ backgroundColor: Colors.brand, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ color: Colors.textOnBrand, fontFamily: Fonts.uiBlack, fontSize: 11, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' }}>
                  {typeLabel}
                </Text>
              </View>
            </View>

            {/* Date + état des places SUR LA MÊME LIGNE : la grosse pastille
                sous le niveau mangeait une ligne entière pour trois mots. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', letterSpacing: 1.5 }}>
                {dateStr}
              </Text>
              {/* « N places libres » se lit déjà dans « Les joueurs » (confirmés ·
                  libres) : la pastille ne s'affiche que pour ce qui n'y est pas —
                  complet (et sa file), ou places tenues par des invitations. */}
              {(confirmedFull || isFull) && (
                <View style={{ flexShrink: 0, backgroundColor: placesTone, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
                  <Text numberOfLines={1} style={{ color: confirmedFull ? Colors.textOnDark : Colors.textPrimary, fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900' }}>
                    {placesText}
                  </Text>
                </View>
              )}
            </View>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ alignSelf: 'stretch', fontSize: 52, lineHeight: 62, fontFamily: Fonts.welcome, color: Colors.textOnDark, paddingRight: 8 }}>{timeStr || '—'}</Text>

            {/* Club — touchable → Maps */}
            <TouchableOpacity
              activeOpacity={0.7}
              disabled={!hasMapTarget(game.location)}
              onPress={() => openInMaps(game.location)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
            >
              <Icon name="mapPin" size={18} color="rgba(255,255,255,0.85)" />
              <Text style={{ flex: 1, fontSize: 15.5, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textOnDark }} numberOfLines={1}>{game.location}</Text>
              {hasMapTarget(game.location) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Icon name="mapPin" size={14} color="rgba(255,255,255,0.6)" />
                  <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.8)' }}>Itinéraire</Text>
                  <Icon name="chevronRight" size={14} color="rgba(255,255,255,0.8)" stroke={2.4} />
                </View>
              )}
            </TouchableOpacity>

            {/* « 4,2 km depuis ta position », ou « ~12 km … (position
                approximative du club) » quand le club est placé au centre de
                sa ville. Rien sans point de départ : cf. lib/geo. */}
            {phraseDistance && (
              <Text numberOfLines={2} style={{ fontSize: 12.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.7)', marginTop: 2, marginLeft: 26 /* icône 18 + écart 8 : aligné sous le nom du club */ }}>
                {phraseDistance}
              </Text>
            )}

            {/* Niveau · mise · mixité · places */}
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {rangeLabel && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="signal" size={15} color="rgba(255,255,255,0.7)" stroke={2.4} />
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, fontFamily: Fonts.uiSemi }}>{rangeLabel}</Text>
                </View>
              )}
              {game.is_challenge && Number((game as any).stake_multiplier) > 1 && (
                <View style={{ backgroundColor: stakeTone(+(game as any).stake_multiplier).bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
                  <Text style={{ color: stakeTone(+(game as any).stake_multiplier).fg, fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900' }}>
                    ⚡ Défi ×{+(game as any).stake_multiplier}
                  </Text>
                </View>
              )}
              {(game as any).gender_pref && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: 'rgba(255,255,255,0.8)', fontFamily: Fonts.uiBlack, fontSize: 10, fontWeight: '900' }}>
                    {(game as any).gender_pref === 'men' ? '♂ Hommes' : (game as any).gender_pref === 'women' ? '♀ Femmes' : '⚧ Mixte'}
                  </Text>
                </View>
              )}
              {/* Terrain réservé ou non — même règle que la carte du lobby
                  (lib/games.courtBooking), en version longue : ici la place
                  ne manque pas. */}
              {(() => {
                const b = courtBooking(game as any);
                if (!b) return null;
                return (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999,
                    paddingHorizontal: 10, paddingVertical: 4,
                    backgroundColor: b.booked ? 'rgba(255,193,26,0.18)' : 'rgba(255,255,255,0.1)',
                  }}>
                    <Icon name={b.booked ? 'check' : 'clock'} size={12}
                      color={b.booked ? Colors.brand : 'rgba(255,255,255,0.8)'} stroke={b.booked ? 3 : 2.4} />
                    <Text style={{ color: b.booked ? Colors.brand : 'rgba(255,255,255,0.8)', fontFamily: Fonts.uiBlack, fontSize: 10, fontWeight: '900' }}>
                      {b.long}
                    </Text>
                  </View>
                );
              })()}
            </View>
          </View>

          {/* ── Corps (feuille claire qui remonte sur le hero) ── */}
          <ScrollView
            style={{ flex: 1, marginTop: -22, backgroundColor: Colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: 14, paddingHorizontal: 12, gap: 14, paddingBottom: (ctaH || insets.bottom) + 16 }}
          >

            {/* Status banners */}
            {(isFull || outOfLevel) && (
              <View style={{ gap: 10 }}>
                {isFull && !isCreator && !alreadyIn && (confirmedFull ? (
                  <View style={{ backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 18, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 18 }}>🔒</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: '#B91C1C' }}>Partie complète</Text>
                      <Text style={{ fontSize: 11, color: Colors.danger, marginTop: 2 }}>Rejoignez la liste d'attente — vous serez prévenu si une place se libère.</Text>
                    </View>
                  </View>
                ) : (
                  <View style={{ backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 18, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                    <Text style={{ fontSize: 18 }}>⏳</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: '#B45309' }}>Places en attente de réponse</Text>
                      <Text style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>Des invitations sont en cours. Rejoignez la liste d'attente — vous serez prévenu si une place se libère.</Text>
                    </View>
                  </View>
                ))}
                {outOfLevel && !isFull && (
                  <View style={{ backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 18, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
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

            {/* Défi ciblé en brouillon : adversaires notés, pas encore invités. */}
            {targetedLine && (
              <View style={{ backgroundColor: VIOLET_SOFT, borderWidth: 1, borderColor: '#DDD6FE', borderRadius: 18, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                <Text style={{ fontSize: 18 }}>⚔️</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: VIOLET }}>Défi ciblé</Text>
                  <Text style={{ fontSize: 11, color: Colors.textSecondary, marginTop: 2 }}>{targetedLine}</Text>
                </View>
              </View>
            )}

            {/* ── Les joueurs (terrain) ── */}
            <View style={sty.card}>
              <SectionHeader
                icon={<Icon name="users" size={22} color={VIOLET} stroke={2.4} />}
                title="Les joueurs"
                aside={`${filled.length} confirmé${filled.length > 1 ? 's' : ''} · ${emptySlots.length} libre${emptySlots.length > 1 ? 's' : ''}`}
              />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                <View style={[sty.teamPill, { backgroundColor: TEAM_A_SOFT }]}>
                  <Text style={[sty.teamPillText, { color: Colors.textPrimary }]}>ÉQUIPE A</Text>
                </View>
                <View style={[sty.teamPill, { backgroundColor: VIOLET_SOFT }]}>
                  <Text style={[sty.teamPillText, { color: VIOLET }]}>ÉQUIPE B</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
                {/* Équipe A : A_GAU, A_DRO */}
                <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                  {(['A_GAU', 'A_DRO'] as const).map(renderSlot)}
                </View>
                {/* Séparateur VS */}
                <View style={{ width: 36, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: Colors.border }} />
                  <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#EFEFEE', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textSecondary }}>VS</Text>
                  </View>
                </View>
                {/* Équipe B : B_DRO (miroir de A_GAU), B_GAU */}
                <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                  {(['B_DRO', 'B_GAU'] as const).map(renderSlot)}
                </View>
              </View>
              {courtHint ? (
                <Text style={{ marginTop: 12, textAlign: 'center', fontSize: 11, fontFamily: Fonts.uiSemi, color: isFull ? Colors.danger : mySlot ? Colors.success : Colors.textMuted }} numberOfLines={1}>
                  {courtHint}
                </Text>
              ) : null}
            </View>

            {/* Pending candidates — creator / accepted only */}
            {pendingPlayers.length > 0 && (isCreator || isAccepted) && (
              <View style={sty.card}>
                <SectionHeader
                  icon={<Icon name="hourglass" size={20} color={Colors.danger} stroke={2.4} />}
                  title="Candidatures"
                  aside={`${pendingPlayers.length} candidature${pendingPlayers.length > 1 ? 's' : ''}`}
                />
                <View style={{ gap: 8 }}>
                  {pendingPlayers.map((p: any) => {
                    const approvals = p.approvals ?? [];
                    const hasVoted  = approvals.includes(playerId);
                    return (
                      <View key={p.id} style={{ backgroundColor: TILE, borderRadius: 16, padding: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                          {/* Identité tappable → profil du candidat (les boutons voter restent à droite) */}
                          <TouchableOpacity
                            onPress={() => openProfile(p.player_id)}
                            activeOpacity={0.75}
                            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                          >
                            <Avatar name={p.player?.name ?? '?'} path={(p.player as any)?.avatar_path} size={50} />
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>{p.player?.name}</Text>
                                <View style={{ backgroundColor: Colors.bgCard, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
                                  <Text style={{ fontSize: 9, fontWeight: '900', color: Colors.textSecondary }}>Niv.{formatPadelLevel(p.player?.elo_score ?? 0)}</Text>
                                </View>
                              </View>
                              <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
                                {approvals.length}/{requiredVotes} approbation{approvals.length > 1 ? 's' : ''}
                              </Text>
                            </View>
                          </TouchableOpacity>
                          {isFull ? (
                            <View style={{ backgroundColor: Colors.bgCard, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
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
                                style={{ width: 36, height: 36, backgroundColor: Colors.brand, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                                <Icon name="check" size={14} color={Colors.textOnBrand} stroke={2.6} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => onDeclinePending(p.id)}
                                style={{ width: 36, height: 36, backgroundColor: Colors.bgCard, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
                                <Icon name="x" size={14} color={Colors.textSecondary} stroke={2.5} />
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                        {p.application_note ? (
                          <View style={{ backgroundColor: Colors.bgCard, borderRadius: 10, padding: 8, marginBottom: 8 }}>
                            <Text style={{ fontSize: 12, fontStyle: 'italic', color: Colors.textSecondary }}>
                              💬 « {p.application_note} »
                            </Text>
                          </View>
                        ) : null}
                        {/* Approval progress bar */}
                        <View style={{ backgroundColor: Colors.bgCard, borderRadius: 99, height: 5, overflow: 'hidden' }}>
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
              <View style={sty.card}>
                <SectionHeader
                  icon={<Icon name="clock" size={20} color={Colors.warning} stroke={2.4} />}
                  title="Liste d'attente"
                  aside={`${waitlistPlayers.length} joueur${waitlistPlayers.length > 1 ? 's' : ''}`}
                />
                <View style={{ gap: 6 }}>
                  {waitlistPlayers.map((p: any, i: number) => {
                    const isMine = p.player_id === playerId;
                    return (
                      <View key={p.id} style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        backgroundColor: isMine ? 'rgba(245,158,11,0.10)' : TILE,
                        borderWidth: 1, borderColor: isMine ? 'rgba(245,158,11,0.40)' : 'transparent',
                        borderRadius: 14, padding: 10,
                      }}>
                        <View style={{
                          width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.bgCard,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>{i + 1}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => openProfile(p.player_id)}
                          activeOpacity={0.75}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                        >
                          <Avatar name={p.player?.name ?? '?'} path={(p.player as any)?.avatar_path} size={38} ring={isMine ? Colors.warning : undefined} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>
                              {isMine ? 'Toi' : p.player?.name}
                            </Text>
                            <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
                              Niv. {formatPadelLevel(p.player?.elo_score ?? 0)} · {i === 0 ? 'Prochain à entrer' : `${i + 1}ᵉ en attente`}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── File d'attente des binômes (défi) ──
                Sur un défi, on n'attend pas à l'unité mais à deux : la file
                vit dans defi_applications, pas dans les participants. Elle ne
                s'affichait que dans l'onglet Défi. Visible par les joueurs du
                défi et par les binômes candidats (RLS). */}
            {game.is_challenge && queuedBinomes.length > 0 && (
              <View style={sty.card}>
                <SectionHeader
                  icon={<Icon name="hourglass" size={20} color={Colors.warning} stroke={2.4} />}
                  title="File d'attente"
                  aside={`${queuedBinomes.length} binôme${queuedBinomes.length > 1 ? 's' : ''}`}
                />
                <View style={{ gap: 6 }}>
                  {queuedBinomes.map((b, i) => {
                    const mine = b.playerIds.includes(playerId);
                    return (
                      <View key={b.id} style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        backgroundColor: mine ? 'rgba(245,158,11,0.10)' : TILE,
                        borderWidth: 1, borderColor: mine ? 'rgba(245,158,11,0.40)' : 'transparent',
                        borderRadius: 14, padding: 10,
                      }}>
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.bgCard, alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>{i + 1}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          {b.playerIds.map((pid, k) => (
                            <TouchableOpacity
                              key={pid}
                              onPress={() => openProfile(pid)}
                              activeOpacity={0.75}
                              style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}
                            >
                              <Avatar name={b.names[k]} path={b.avatarPaths?.[k]} size={42} />
                              <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                                {b.names[k]}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                        <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.warning }}>
                          {mine ? 'Ton binôme' : i === 0 ? 'Prochain' : 'En file'}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted, marginTop: 8 }}>
                  Si un binôme se retire, le premier de la file prend sa place.
                </Text>
              </View>
            )}

            {/* Invitations en attente — créateur uniquement (peut retirer) */}
            {isCreator && invitedPlayers.length > 0 && (
              <View style={sty.card}>
                <SectionHeader
                  icon={<Icon name="mail" size={20} color={Colors.brandDeep} stroke={2.4} />}
                  title="Invitations"
                  aside={`${invitedPlayers.length} en attente`}
                />
                <View style={{ gap: 6 }}>
                  {invitedPlayers.map((p: any) => {
                    const countdown = inviteCountdown(p);
                    return (
                      <View key={p.id} style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        backgroundColor: TILE, borderRadius: 14, padding: 10,
                      }}>
                        <TouchableOpacity
                          onPress={() => openProfile(p.player_id)}
                          activeOpacity={0.75}
                          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}
                        >
                          <Avatar name={p.player?.name ?? '?'} path={(p.player as any)?.avatar_path} size={38} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>
                              {p.player?.name}
                            </Text>
                            <Text style={{ fontSize: 10, color: Colors.textMuted, marginTop: 1 }}>
                              Niv. {formatPadelLevel(p.player?.elo_score ?? 0)}{countdown ? ` · ${countdown}` : ''}
                            </Text>
                          </View>
                        </TouchableOpacity>
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
                          style={{ backgroundColor: Colors.bgCard, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
                          <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textSecondary }}>Retirer</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── Profils des joueurs ── */}
            {filled.length > 0 && (
              <View style={sty.card}>
                <SectionHeader
                  icon={<Icon name="signal" size={20} color={VIOLET} stroke={2.6} />}
                  title="Profils des joueurs"
                  aside="Stats en un coup d'œil"
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {filled.map(({ player: p, side }) => {
                    // Totaux « tous matchs » dès qu'ils sont chargés ; en
                    // attendant, les compteurs classés reçus avec la partie.
                    const t = totalsById.get(p.id);
                    const total   = t ? t.played : (p.wins ?? 0) + (p.losses ?? 0);
                    const winRate = t ? t.winRate
                      : total > 0 ? Math.round((p.wins ?? 0) / total * 100) : 0;
                    return (
                      <TouchableOpacity
                        key={side}
                        onPress={() => openProfile(p.id)}
                        activeOpacity={0.8}
                        style={sty.profileTile}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Avatar name={p.name} path={p.avatarPath} size={44} team={SIDE_TEAM[side] as 'A' | 'B'} creator={p.isCreator} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
                              {p.isMe ? 'Toi' : p.name}
                            </Text>
                            <Text numberOfLines={1} style={{ fontSize: 10, color: Colors.textSecondary, marginTop: 1 }}>
                              {p.isCreator ? 'Créateur' : 'Participant'}
                            </Text>
                          </View>
                          <View style={{ backgroundColor: VIOLET_SOFT, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, alignItems: 'center' }}>
                            <Text style={{ fontSize: 8, fontFamily: Fonts.uiBold, color: '#8B7FB8', textTransform: 'uppercase' }}>Éq. {SIDE_TEAM[side]}</Text>
                            <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', color: VIOLET }}>{SIDE_POS[side]}</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: 'row', backgroundColor: TILE, borderRadius: 12, paddingVertical: 8, marginTop: 10 }}>
                          <Stat label="Niveau" value={formatPadelLevel(p.elo)} />
                          <View style={sty.statDivider} />
                          <Stat label="Matchs" value={String(total)} />
                          <View style={sty.statDivider} />
                          <Stat label="Victoires" value={total > 0 ? String(winRate) : '—'} unit={total > 0 ? '%' : undefined} />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* ── Score en direct — participants confirmés d'une partie complète ── */}
            {/* Session 'finished' ou 'abandoned' : le live est clos, c'est le flux
                d'après-match qui prend le relais. Ni « Suivre », ni lobby live
                (un redémarrage échouerait sur session_already_closed). */}
            {liveEligible && liveScoringEnabled && !(liveSession && liveSession.status !== 'live') && (
              <View>
                {liveSession && liveSession.status === 'live' ? (
                  <TouchableOpacity
                    // La sheet est une <Modal> native : fermer AVANT de pousser,
                    // sinon l'écran live monte DERRIÈRE la modale (même pattern
                    // que openProfile).
                    onPress={() => { onClose(); router.push(`/live/${liveSession.id}` as any); }}
                    activeOpacity={0.8}
                    style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, padding: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontFamily: Fonts.uiBlack }}>▶ Suivre le match en direct</Text>
                  </TouchableOpacity>
                ) : (
                  <LiveLobbyBlock
                    gameId={game.id}
                    meId={playerId}
                    meName={filled.find(f => f.player.id === playerId)?.player.name ?? ''}
                    matchDate={game.match_date ?? null}
                    liveScorerId={liveScorerId}
                    isComplete={confirmedFull}
                    participants={filled.map(({ player }) => ({ id: player.id, name: player.name }))}
                    onChanged={refetchLiveScorer}
                    onCloseSheet={onClose}
                  />
                )}
              </View>
            )}

            {/* ── Informations de la partie ── */}
            <View style={sty.card}>
              <SectionHeader
                icon={<Icon name="racket" size={22} color={Colors.textPrimary} stroke={2} />}
                title="Informations de la partie"
              />
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <InfoCell icon="trophy" label="Format" value={eloRange ? 'Double' : 'Double · Tous niveaux'} />
                <View style={sty.infoDivider} />
                <InfoCell icon="clock" label="Durée estimée" value={`~ ${DURATION_LABEL}`} />
                <View style={sty.infoDivider} />
                <InfoCell icon="users" label="Joueurs" value="4 joueurs" />
              </View>
            </View>

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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const sty = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: Colors.bg,
    overflow: 'hidden',
  },
  heroBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 12,
    width: 38, height: 38, alignItems: 'center', justifyContent: 'center',
  },
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 20, padding: 14,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  teamPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  teamPillText: { fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', letterSpacing: 0.3 },
  slot: {
    flex: 1, minHeight: 130, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, paddingHorizontal: 4,
  },
  profileTile: {
    flexGrow: 1, flexBasis: 140,
    borderWidth: 1, borderColor: '#EDEDEC', borderRadius: 16, padding: 10,
  },
  statDivider: { width: 1, marginVertical: 4, backgroundColor: Colors.border },
  infoDivider: { width: 1, alignSelf: 'stretch', backgroundColor: Colors.border, marginHorizontal: 4 },
  ctaBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingHorizontal: 14, paddingBottom: 22, paddingTop: 10,
    backgroundColor: 'rgba(245,245,244,0.97)',
    flexDirection: 'row', gap: 8,
  },
  ctaBack: {
    width: 50, height: 50, borderRadius: 14, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.bgCard,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaBtn: {
    flex: 1, height: 54, borderRadius: 27,
    flexDirection: 'row', gap: 10, paddingHorizontal: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaDanger: {
    backgroundColor: '#FFF5F5', borderWidth: 1.5, borderColor: '#FCA5A5',
  },
});
