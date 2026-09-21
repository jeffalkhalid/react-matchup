// react-matchup/lib/defis.ts
// Couche données UNIQUE du hub Défi 2v2 (modèle ouvert : open_games is_challenge
// + defi_applications + RPC defi_apply/defi_accept). Tout accès Supabase lié aux
// défis passe par ici — les écrans ne font pas de requête défi en direct.
import { supabase } from './supabase';
import { getHiddenPlayerIds } from './moderation';
import { isInvitationVisible } from './games';

// ─── La fourchette de niveau d'un défi ──────────────────────────────────────
//
// Un défi ne se relève pas tout seul : la MOYENNE du binôme candidat doit
// tomber dans la fourchette [min_elo, max_elo] (vérifié par le serveur, RPC
// defi_apply / defi_accept).
//
// Piège vu sur device (2026-09-16) : l'assistant laissait descendre le maximum
// jusqu'au minimum. Une fourchette de largeur NULLE exige une moyenne au
// centième près — personne ne peut relever, et le refus tombait en anglais
// (« binome out of level band ») au moment d'accepter. D'où cette largeur
// minimale, partagée par l'assistant de création et ses tests.
export const DEFI_BAND_MIN_LEVEL = 0.5;

/** Le maximum le plus bas acceptable pour un défi dont le minimum vaut `min`. */
export function defiMinimumMaxLevel(min: number): number {
  return Math.min(8, +(min + DEFI_BAND_MIN_LEVEL).toFixed(2));
}

/** La fourchette est-elle assez large pour qu'un binôme puisse y entrer ? */
export function isDefiBandWideEnough(min: number, max: number): boolean {
  return +(max - min).toFixed(2) >= DEFI_BAND_MIN_LEVEL;
}

export interface DefiPlayer { id: string; name: string; elo_score: number; avatar_path?: string | null; win_count?: number; loss_count?: number; }
export interface DefiParticipant {
  id: string; player_id: string; status: string; team_side: string | null;
  approvals?: string[] | null; created_at?: string | null; invite_expires_at?: string | null;
  player?: DefiPlayer | null;
}
export interface DefiGame {
  id: string; creator_id: string; creator_side?: string | null; status: string;
  is_challenge: boolean; is_targeted?: boolean; stake_multiplier: number | null;
  game_format?: string | null; gender_pref?: string | null;
  spots_available?: number | null; has_reservation?: boolean | null;
  min_elo: number | null; max_elo: number | null;
  match_date: string | null; location: string | null;
  creator?: DefiPlayer | null;
  participants?: DefiParticipant[] | null;
}
export interface DefiApplication {
  id: string; game_id: string; initiator_id: string; partner_id: string;
  status: string; created_at: string;
  initiator?: DefiPlayer | null; partner?: DefiPlayer | null;
  game?: DefiGame | null;
}

const GAME_COLS =
  'id, creator_id, creator_side, status, is_challenge, is_targeted, game_format, gender_pref, ' +
  'spots_available, has_reservation, stake_multiplier, min_elo, max_elo, match_date, location, ' +
  'creator:creator_id(id, name, elo_score, avatar_path, win_count, loss_count), ' +
  'participants:game_participants(id, player_id, status, team_side, approvals, created_at, invite_expires_at, player:player_id(id, name, elo_score, avatar_path, win_count, loss_count))';

// ── Helpers d'éligibilité (moyenne du binôme dans la bande du défi) ──
export function binomeAvg(eloA: number, eloB: number): number {
  return (eloA + eloB) / 2;
}
export function isBinomeEligible(eloA: number, eloB: number, minElo: number | null, maxElo: number | null): boolean {
  const avg = binomeAvg(eloA, eloB);
  return avg >= (minElo ?? 0) && avg <= (maxElo ?? 999999);
}
/** Moyenne du binome d'une candidature, ou null si un ELO manque. */
export function applicationPairAverage(app: DefiApplication): number | null {
  const a = app.initiator?.elo_score;
  const b = app.partner?.elo_score;
  return a != null && b != null ? binomeAvg(a, b) : null;
}

// ── Fenêtre de promotion (minutes) — app_config, lecture publique, cachée. ──
let _promoWinCache: number | null = null;
export async function getPromotionWindowMinutes(): Promise<number> {
  if (_promoWinCache != null) return _promoWinCache;
  const { data } = await supabase
    .from('app_config').select('value').eq('key', 'defi_promotion_window_minutes').maybeSingle();
  const n = parseInt(String(data?.value ?? '30').replace(/[^0-9]/g, ''), 10);
  _promoWinCache = Number.isFinite(n) ? n : 30;
  return _promoWinCache;
}

// File encore rejoignable ? Un défi 'open' l'est toujours ; un 'confirmed'
// seulement hors fenêtre de promotion (dedans, aucune promotion possible).
export function isDefiQueueOpen(g: { status?: string | null; match_date?: string | null }, winMin: number): boolean {
  if (g.status === 'open') return true;
  if (g.status !== 'confirmed') return false;
  if (!g.match_date) return false;
  return Date.now() < new Date(g.match_date).getTime() - winMin * 60_000;
}

// ── À relever : défis d'autres joueurs où je ne suis pas déjà engagé.
// Inclut les défis CONFIRMÉS dont la file est encore ouverte (on peut y entrer). ──
export async function fetchOpenDefis(playerId: string): Promise<DefiGame[]> {
  const { data, error } = await supabase
    .from('open_games')
    .select(GAME_COLS)
    .eq('is_challenge', true)
    .in('status', ['open', 'confirmed'])
    .eq('is_targeted', false)
    .neq('creator_id', playerId)
    .gte('match_date', new Date().toISOString())   // pas de défis dont le créneau est déjà passé
    .order('match_date', { ascending: true });
  if (error) { console.warn('[defis] fetchOpenDefis', error); return []; }
  const hidden = await getHiddenPlayerIds(playerId);   // modération : masquer les bloqués (2 sens)
  const win = await getPromotionWindowMinutes();
  const rows = (data ?? []) as unknown as DefiGame[];
  // Exclure : créateur bloqué, déjà participant, ou file fermée (match imminent).
  return rows.filter(g =>
    !hidden.has(g.creator_id)
    && isDefiQueueOpen(g, win)
    && !(g.participants ?? []).some(p => p.player_id === playerId));
}

// ── Mes défis : ceux que J'AI créés (draft/open/confirmed) ──
export async function fetchMyDefis(playerId: string): Promise<DefiGame[]> {
  const { data, error } = await supabase
    .from('open_games')
    .select(GAME_COLS)
    .eq('is_challenge', true)
    .eq('creator_id', playerId)
    .in('status', ['draft', 'open', 'confirmed'])
    .gte('match_date', new Date().toISOString())   // ne pas montrer mes défis dont le créneau est passé
    .order('match_date', { ascending: true });
  if (error) { console.warn('[defis] fetchMyDefis', error); return []; }
  return (data ?? []) as unknown as DefiGame[];
}

// ── Mes défis (affichage onglet) : ceux que J'AI créés OU où je joue (participant
// accepté). fetchMyDefis reste créateur-only (utilisé par les candidatures). ──
export async function fetchDefisInvolved(playerId: string): Promise<DefiGame[]> {
  // 1) défis où je suis participant ACCEPTÉ (binôme du créateur ou binôme adverse).
  const { data: parts } = await supabase
    .from('game_participants')
    .select('game_id')
    .eq('player_id', playerId)
    .eq('status', 'accepted');
  const partIds = Array.from(new Set((parts ?? []).map((p: any) => p.game_id).filter(Boolean)));
  // 2) mes défis créés + ceux où je joue, en une requête.
  const orFilter = partIds.length > 0
    ? `creator_id.eq.${playerId},id.in.(${partIds.join(',')})`
    : `creator_id.eq.${playerId}`;
  const { data, error } = await supabase
    .from('open_games')
    .select(GAME_COLS)
    .eq('is_challenge', true)
    .in('status', ['draft', 'open', 'confirmed'])
    .gte('match_date', new Date().toISOString())
    .or(orFilter)
    .order('match_date', { ascending: true });
  if (error) { console.warn('[defis] fetchDefisInvolved', error); return []; }
  return (data ?? []) as unknown as DefiGame[];
}

const APP_COLS =
  'id, game_id, initiator_id, partner_id, status, created_at, ' +
  'initiator:initiator_id(id, name, elo_score, avatar_path), ' +
  'partner:partner_id(id, name, elo_score, avatar_path), ' +
  `game:game_id(${GAME_COLS})`;

// ── Candidatures sur les défis où je suis IMPLIQUÉ (créés OU où je joue) :
// binômes qui postulent pour relever. Visible au créateur ET à son binôme
// (Team A), pour savoir si le match se remplit. RLS élargie aux participants
// acceptés (defi_apps_select_participants.sql). ──
export async function fetchCandidaturesOnMyDefis(playerId: string): Promise<DefiApplication[]> {
  // 1) mes défis (ids) ; 2) candidatures liées. Deux étapes pour éviter un embed
  // filtré complexe côté PostgREST.
  const mine = await fetchDefisInvolved(playerId);
  const ids = mine.map(g => g.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('defi_applications')
    .select(APP_COLS)
    .in('game_id', ids)
    .in('status', ['pending', 'queued', 'locked'])
    .order('created_at', { ascending: true });
  if (error) { console.warn('[defis] fetchCandidaturesOnMyDefis', error); return []; }
  return (data ?? []) as unknown as DefiApplication[];
}

// ── Mes invitations défi (game_participants 'invited' sur un défi) : binôme du
// créateur (Team A) ou adversaire ciblé (Team B). Affichées dans le hub Défi. ──
export interface DefiInvite { participantId: string; team_side: string | null; invite_expires_at: string | null; game: DefiGame; }
export async function fetchMyDefiInvites(playerId: string): Promise<DefiInvite[]> {
  const { data, error } = await supabase
    .from('game_participants')
    .select(`id, team_side, invite_expires_at, game:game_id(${GAME_COLS})`)
    .eq('player_id', playerId)
    .eq('status', 'invited');
  if (error) { console.warn('[defis] fetchMyDefiInvites', error); return []; }
  // Visibilité = prédicat PARTAGÉ lib/games.isInvitationVisible (TTL, partie
  // close/annulée/passée) — même définition que la cloche et le badge Défi.
  // Ne pas re-filtrer à la main ici (cf. bug du badge navbar resté à zéro).
  return (data ?? [])
    .map((r: any) => ({ participantId: r.id, team_side: r.team_side ?? null, invite_expires_at: r.invite_expires_at ?? null, game: r.game as DefiGame }))
    .filter(r => r.game && r.game.is_challenge
      && isInvitationVisible({ invite_expires_at: r.invite_expires_at, game_id: r.game.id, game: r.game }, new Set()));
}

// ── Mes candidatures SORTANTES : défis où J'AI postulé (initiateur), en attente
// que MON partenaire accepte. Sert à montrer « déjà postulé » dans « À relever ». ──
export async function fetchMyApplications(playerId: string): Promise<DefiApplication[]> {
  const { data, error } = await supabase
    .from('defi_applications')
    .select(APP_COLS)
    // Initiateur : candidature en cours OU en file. Partenaire : seulement en file
    // (le 'pending' où je suis partenaire = une invitation, gérée ailleurs).
    .or(`and(initiator_id.eq.${playerId},status.in.(pending,queued)),and(partner_id.eq.${playerId},status.eq.queued)`)
    .order('created_at', { ascending: false });
  if (error) { console.warn('[defis] fetchMyApplications', error); return []; }
  return (data ?? []) as unknown as DefiApplication[];
}

// ── Invitations binôme : on m'a invité comme PARTENAIRE pour relever ──
export async function fetchBinomeInvitations(playerId: string): Promise<DefiApplication[]> {
  const { data, error } = await supabase
    .from('defi_applications')
    .select(APP_COLS)
    .eq('partner_id', playerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) { console.warn('[defis] fetchBinomeInvitations', error); return []; }
  return (data ?? []) as unknown as DefiApplication[];
}

// ── Vue candidat : superpose MON binôme (initiateur + partenaire) sur les
// créneaux Team B en 'invited' (avatars transparents) tant que la place est
// libre (défi 'open' + candidature 'pending'). Pour 'queued', Team B est déjà
// pris par le binôme retenu → pas d'injection. ──
export function defiGameWithMyBinome(app: DefiApplication): DefiGame | null {
  const g = app.game;
  if (!g) return null;
  if (app.status !== 'pending' || g.status !== 'open') return g;
  const inject: DefiParticipant[] = [
    { id: `app-i-${app.id}`, player_id: app.initiator_id, status: 'invited', team_side: 'B_GAU', player: app.initiator ?? null },
    { id: `app-p-${app.id}`, player_id: app.partner_id,   status: 'invited', team_side: 'B_DRO', player: app.partner ?? null },
  ];
  return { ...g, participants: [...(g.participants ?? []), ...inject] };
}

/** Un binôme EN FILE sur un défi complet. */
export interface QueuedBinome {
  id: string;
  gameId: string;
  playerIds: [string, string];
  names: [string, string];
  /** `players.avatar_path` de chacun — sa photo, si elle existe. */
  avatarPaths: [string | null, string | null];
}

// ── Les binômes EN FILE ('queued') de plusieurs défis, en UNE requête. ──
// Même source que l'onglet Défi (defi_applications), pour que la fiche du
// match, la carte « À venir » et le hub disent le même nombre. La RLS fait le
// tri : un joueur du défi et les binômes candidats voient la file, personne
// d'autre (defi_apps_select_participants.sql).
export async function fetchQueuedBinomes(gameIds: string[]): Promise<Map<string, QueuedBinome[]>> {
  const out = new Map<string, QueuedBinome[]>();
  const ids = [...new Set(gameIds.filter(Boolean))];
  if (ids.length === 0) return out;
  const { data, error } = await supabase
    .from('defi_applications')
    .select('id, game_id, initiator_id, partner_id, created_at, initiator:initiator_id(id, name, avatar_path), partner:partner_id(id, name, avatar_path)')
    .in('game_id', ids)
    .eq('status', 'queued')
    .order('created_at', { ascending: true });   // ordre FIFO = ordre de promotion
  if (error) { console.warn('[defis] fetchQueuedBinomes', error); return out; }
  for (const r of (data ?? []) as any[]) {
    const entry: QueuedBinome = {
      id: r.id,
      gameId: r.game_id,
      playerIds: [r.initiator_id, r.partner_id],
      names: [r.initiator?.name ?? '?', r.partner?.name ?? '?'],
      avatarPaths: [r.initiator?.avatar_path ?? null, r.partner?.avatar_path ?? null],
    };
    const list = out.get(r.game_id);
    if (list) list.push(entry); else out.set(r.game_id, [entry]);
  }
  return out;
}

/** Combien de binômes attendent, par défi. */
export async function fetchQueuedBinomeCounts(gameIds: string[]): Promise<Map<string, number>> {
  const byGame = await fetchQueuedBinomes(gameIds);
  return new Map([...byGame].map(([id, list]) => [id, list.length]));
}

// Nombre d'AUTRES binômes ayant postulé sur ce défi (hors le mien) — RPC (RLS).
export async function defiOtherBinomeCount(gameId: string): Promise<number> {
  const { data, error } = await supabase.rpc('defi_other_binome_count', { p_game_id: gameId });
  if (error) { console.warn('[defis] defiOtherBinomeCount', error); return 0; }
  return (data as number) ?? 0;
}

// ── Défi CIBLÉ : les adversaires ne sont prévenus qu'après l'acceptation du
// binôme (« Défier ce binôme » depuis la vitrine). Pendant le brouillon, ils
// sont seulement NOTÉS sur le défi (open_games.target_players, jsonb) —
// aucune ligne game_participants pour eux, donc rien de visible ni de
// notifié tant que le partenaire (Team A) n'a pas accepté. Le serveur
// (fn_publish_defi_on_partner_accept) les invite alors et vide la colonne. ──

export interface DefiCreationPlan {
  status: 'draft' | 'open';
  invites: { player_id: string; team_side: string }[];
  targetPlayers: { player_id: string; team_side: string; name: string }[] | null;
}

/** Ce que `handlePublish` doit enregistrer à la création, selon le type de partie. */
export function defiCreationPlan(input: {
  gameType: string;
  isTargeted: boolean;
  players: { id: string; name: string; team_side?: string | null }[];
}): DefiCreationPlan {
  const withSide = input.players.map(p => ({ ...p, team_side: p.team_side ?? 'A_GAU' }));

  // Partie normale (Amical/Compétitif) : tout le monde est invité, ouverte
  // tout de suite — comportement inchangé.
  if (input.gameType !== 'Défi') {
    return {
      status: 'open',
      invites: withSide.map(p => ({ player_id: p.id, team_side: p.team_side })),
      targetPlayers: null,
    };
  }

  // Défi (ouvert ou ciblé) : brouillon, seul le partenaire (Team A) est
  // invité — l'adversaire ne relève/n'est notifié qu'après son acceptation.
  const aSide = withSide.filter(p => p.team_side.startsWith('A'));
  const bSide = withSide.filter(p => !p.team_side.startsWith('A'));
  return {
    status: 'draft',
    invites: aSide.map(p => ({ player_id: p.id, team_side: p.team_side })),
    targetPlayers: input.isTargeted && bSide.length > 0
      ? bSide.map(p => ({ player_id: p.id, team_side: p.team_side, name: p.name }))
      : null,
  };
}

/**
 * Phrase affichée dans la fiche d'un défi ciblé encore en brouillon —
 * `null` sinon (pas un ciblé, plus un brouillon, ou aucun adversaire noté).
 */
export function targetedOpponentsLine(
  game: { status?: string | null; is_targeted?: boolean | null; target_players?: { name?: string | null }[] | null },
  viewer: 'creator' | 'partner',
): string | null {
  if (game.status !== 'draft' || game.is_targeted !== true) return null;
  const names = (game.target_players ?? [])
    .map(p => p.name)
    .filter((n): n is string => !!n);
  if (names.length === 0) return null;
  const joined = names.join(' & ');
  return viewer === 'creator'
    ? `${joined} seront prévenus dès que ton binôme accepte`
    : `Vous affronterez ${joined} — ils seront prévenus dès que tu acceptes`;
}

// ── Mutations (RPC Phase 1) ──
export async function applyToDefi(gameId: string, partnerId: string): Promise<string> {
  const { data, error } = await supabase.rpc('defi_apply', { p_game_id: gameId, p_partner_id: partnerId });
  if (error) throw error;
  return data as string; // id de la candidature
}
export async function acceptBinomeInvitation(appId: string): Promise<string> {
  const { data, error } = await supabase.rpc('defi_accept', { p_app_id: appId });
  if (error) throw error;
  return data as string; // 'locked' | 'too_late'
}
export async function declineBinomeInvitation(appId: string): Promise<string> {
  const { data, error } = await supabase.rpc('defi_decline', { p_app_id: appId });
  if (error) throw error;
  return data as string; // initiator_id (destinataire du push)
}
// Retrait d'une candidature ('pending') ou sortie de file ('queued') — par
// l'initiateur OU le partenaire ; toute la paire sort.
export async function withdrawApplication(appId: string): Promise<string> {
  const { data, error } = await supabase.rpc('defi_withdraw', { p_app_id: appId });
  if (error) throw error;
  return data as string; // id de l'AUTRE membre (destinataire du push)
}
export async function cancelDefi(gameId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_defi', { p_game_id: gameId });
  if (error) throw error;
}

// ── Couleur d'une MISE de défi — même échelle partout (création, cartes, fiche).
// Soft (×2 et moins) vert · Standard (jusqu'à ×3) jaune · High Stakes rouge.
// Les anciens défis (×1.5, ×2.5) tombent dans le niveau le plus proche.
export interface StakeTone { level: 'soft' | 'standard' | 'high'; bg: string; fg: string; soft: string }
export function stakeTone(stake: number): StakeTone {
  if (stake <= 2) return { level: 'soft', bg: '#10B981', fg: '#FFFFFF', soft: '#047857' };
  if (stake <= 3) return { level: 'standard', bg: '#FFC11A', fg: '#0A0A0A', soft: '#B45309' };
  return { level: 'high', bg: '#EF4444', fg: '#FFFFFF', soft: '#B91C1C' };
}

/**
 * La mise, écrite : « ×3 », « ×2.5 ». `null` quand il n'y a pas de mise —
 * « ×1 » n'apprend rien à personne.
 *
 * L'arrondi était recopié à la main (carte de match, fil d'activité) : deux
 * copies d'une même écriture finissent par diverger.
 */
export function formatStake(stake: number | null | undefined): string | null {
  const n = Number(stake ?? 1) || 1;
  if (n <= 1) return null;
  return `×${n % 1 === 0 ? n : n.toFixed(1)}`;
}
