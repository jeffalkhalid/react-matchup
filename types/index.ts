export type Gender = 'male' | 'female' | 'mixed';
export type CourtSide = 'left' | 'right' | 'both';
export type Handedness = 'right' | 'left';
export type MatchStatus = 'pending' | 'counter_proposed' | 'validated' | 'disputed';
export type GameFormat = 'singles' | 'doubles';
export type ChallengeStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'played';
export type OpenGameStatus = 'open' | 'closed' | 'cancelled';
export type ParticipantStatus = 'pending' | 'accepted' | 'declined';
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
  frmt_rank?: string;
  frmt_verified?: boolean;
  is_admin?: boolean;
  clubs?: string[];
  playing_days?: string[];
  preferred_court?: string;
  techniques?: string[];
  avatar_url?: string;
  season_points?: number;
  push_token?: string | null;
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
  game_format?: GameFormat;
  game_id?: string;
  created_at: string;
  winner?: Player;
  loser?: Player;
  winner_2?: Player;
  loser_2?: Player;
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
}

export interface Message {
  id: string;
  game_id: string;
  player_id: string;
  player_name: string;
  content: string;
  created_at: string;
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
