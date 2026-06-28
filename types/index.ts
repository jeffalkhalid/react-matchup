// NB: la colonne players.gender stocke 'other' (pas 'mixed'). 'mixed' reste utilisé
// par OpenGame.gender_pref (dette de typage connue — domaines confondus).
export type Gender = 'male' | 'female' | 'mixed' | 'other';
export type CourtSide = 'left' | 'right' | 'both';
export type Handedness = 'right' | 'left';
// Côté/place sur le terrain tel que stocké en DB (game_participants.team_side, open_games.creator_side).
export type TeamSide = 'A_GAU' | 'A_DRO' | 'B_GAU' | 'B_DRO';
export type MatchStatus = 'pending' | 'counter_proposed' | 'validated' | 'disputed';
export type GameFormat = 'singles' | 'doubles';
export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'played';
export type OpenGameStatus = 'open' | 'closed' | 'cancelled';
export type ParticipantStatus = 'pending' | 'accepted' | 'declined' | 'invited' | 'waitlist';
export type League = 'diamond' | 'gold' | 'silver' | 'bronze' | 'discovery';

export interface Player {
  id: string;
  user_id: string;
  name: string;
  email?: string;
  elo_score: number;
  peak_elo?: number;
  win_count: number;
  loss_count: number;
  last_match_at?: string;
  fiability_pct: number;
  gender?: Gender;
  birth_year?: number;
  handedness?: Handedness;
  court_side?: CourtSide;
  level?: number;
  frmt_rank?: string;        // rang auto-déclaré au signup (joueur non lié/non vérifié)
  frmt_verified?: boolean;
  frmt_position?: number | null; // vraie position au classement FRMT (joueur lié)
  frmt_points?: number | null;   // vrais points FRMT (joueur lié)
  is_admin?: boolean;
  clubs?: string[];
  playing_days?: string[];
  preferred_court?: string;
  techniques?: string[];
  avatar_url?: string;
  season_points?: number;
  push_token?: string | null;
  deleted_at?: string | null;
  created_at: string;
}

export interface Match {
  id: string;
  winner_id?: string;
  loser_id?: string;
  winner_id_2?: string;
  loser_id_2?: string;
  score_text: string;
  status: MatchStatus;
  is_challenge?: boolean;
  game_format?: string;
  game_id?: string;
  created_by?: string;
  counter_score_text?: string;
  counter_reason?: string;
  dispute_reason?: string;
  counter_by?: string;
  counter_proposed_at?: string;
  counter_winner_id?: string;
  counter_winner_id_2?: string;
  counter_loser_id?: string;
  counter_loser_id_2?: string;
  created_at: string;
  winner?: Player;
  loser?: Player;
  winner_2?: Player;
  loser_2?: Player;
  game?: { location: string | null; match_date: string | null; creator_id?: string | null } | null;
}

export interface OpenGame {
  id: string;
  creator_id: string;
  location?: string;
  match_date?: string;
  spots_available: number;
  min_elo?: number;
  max_elo?: number;
  status: OpenGameStatus;
  is_challenge?: boolean;
  game_format: GameFormat;
  gender_pref?: Gender;
  notes?: string;
  creator_side?: TeamSide;
  created_at: string;
  creator?: Player;
  participants?: GameParticipant[];
}

export interface GameParticipant {
  id: string;
  game_id: string;
  player_id: string;
  status: ParticipantStatus;
  team_side?: 'A' | 'B';
  player?: Player;
}

export interface Challenge {
  id: string;
  challenger_id: string;
  challenged_id: string;
  status: ChallengeStatus;
  compat_score?: number;
  shared_clubs?: string[];
  shared_days?: string[];
  message?: string;
  expires_at?: string;
  game_id?: string;
  created_at: string;
  challenger?: Player;
  challenged?: Player;
  game?: OpenGame | null;
}

export interface Message {
  id: string;
  game_id: string;
  player_id: string;
  player_name: string;
  content: string;
  created_at: string;
  reactions?: Record<string, string[]>;
}

export interface EloHistory {
  id: string;
  player_id: string;
  match_id?: string;
  elo_score: number;
  elo_change: number;
  created_at: string;
}

export interface Badge {
  id: string;
  label: string;
  icon_url?: string;
  emoji?: string;
  is_active: boolean;
}

export interface ReputationVote {
  id: string;
  match_id: string;
  giver_id: string;
  receiver_id: string;
  badge_type: string;
  created_at: string;
}

export interface Notification {
  id: string;
  type: 'match' | 'challenge' | 'chat' | 'application';
  title: string;
  body: string;
  data?: Record<string, unknown>;
  read: boolean;
  created_at: string;
}

export interface CompatScore {
  total: number;
  elo: number;
  clubs: number;
  days: number;
  sides: number;
}

// ─── Communauté & flux sociaux ───────────────────────────────

// Joueur enrichi pour les listes sociales (suivi, suggestions, recherche).
export interface SocialPlayer extends Player {
  league: League;
  level: number;        // niveau padel 1.0–8.0
  following: boolean;   // est-ce que JE le suis ?
  mutual?: number;      // amis en commun
  reason?: string;      // raison de suggestion ("4 amis en commun", "Joue à …")
}

export type ActivityType = 'match_win' | 'match_loss' | 'badge' | 'promotion' | 'bilan';

export interface ActivityEvent {
  id: string;
  player_id: string;
  type: ActivityType;
  match_id?: string | null;
  payload: {
    partner?: string | null;
    vs?: string | null;
    score?: string | null;
    badge_emoji?: string | null;
    badge_label?: string | null;
    promo_league?: League | null;
    promo_label?: string | null;
    // type 'bilan' (post de bilan mensuel in-app)
    month?: string | null;
    label?: string | null;
    matches?: number | null;
    winRate?: number | null;
    eloDelta?: number | null;
    levelDelta?: number | null;
    topPartner?: string | null;
  };
  caption?: string | null;     // légende libre (Moment partagé)
  is_highlight?: boolean;      // mis en avant dans le rail Moments
  highlighted_at?: string | null; // date de MISE EN AVANT (≠ created_at = date du match)
  reactions: Record<string, string[]>;   // { "🔥": [player_id, ...] }
  created_at: string;
  // Hydraté côté client :
  actor?: Pick<Player, 'id' | 'name' | 'elo_score'>;
  league?: League;
  comment_count?: number;
  match?: Match | null;   // match complet (jointures) pour les events match_win/loss → <MatchCard>
}

export type CommentsPolicy = 'everyone' | 'friends' | 'nobody';

export interface ActivityComment {
  id: string;
  event_id: string;
  player_id: string;
  content: string;
  created_at: string;
  reactions: Record<string, string[]>;   // { "🔥": [player_id, ...] }
  // Hydraté côté client :
  actor?: Pick<Player, 'id' | 'name' | 'elo_score'>;
  league?: League;
}

// ─── Palmarès / réalisations ─────────────────────────────────────
// Métadonnées statiques (catalogue) — vivent côté client, pas en DB.
export interface AchievementDef {
  key: string;
  name: string;
  desc: string;
  glyph: string;   // clé dans GLYPHS (components/profile/glyphs)
  target: number;
  order: number;
}

// Progression renvoyée par get_player_achievements (table player_achievements).
export interface PlayerAchievementRow {
  player_id: string;
  key: string;
  progress: number;
  target: number;
  unlocked_at: string | null;
  updated_at: string;
}

// Vue fusionnée catalogue + progression, prête pour l'UI.
export interface Achievement extends AchievementDef {
  progress: number;
  unlocked: boolean;
}

export interface GameAlert {
  id: string;
  player_id: string;
  days: string[];          // ['Lun','Mar',…]
  slots: string[];         // ['morning','noon','afternoon','evening']
  courts: string[];        // noms de clubs (vide = tous)
  formats: string[];       // ['friendly','competitive'] (vide = tous)
  lvl_min: number;         // niveau padel
  lvl_max: number;
  friend_ids: string[];
  push_on: boolean;
  only_friends: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReferralStats {
  code: string;
  joined: number;          // nombre d'amis parrainés ayant rejoint
  goal: number;            // palier du trophée parrain
}
