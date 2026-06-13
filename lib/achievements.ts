import { supabase } from './supabase';
import type { Achievement, AchievementDef, PlayerAchievementRow } from '../types';

// Catalogue statique — repris de la maquette PALMARES (pm-data.jsx).
// Les `key` DOIVENT correspondre à supabase/migrations/player_achievements.sql.
export const ACHIEVEMENT_DEFS: AchievementDef[] = [
  { key: 'first_match',  name: 'Premier service',     desc: 'Jouer ton 1er match',         glyph: 'ball',      target: 1,   order: 0 },
  { key: 'regular',      name: 'Habitué',             desc: 'Jouer 5 matchs',              glyph: 'paddle',    target: 5,   order: 1 },
  { key: 'veteran',      name: 'Vétéran',             desc: 'Jouer 25 matchs',             glyph: 'medal',     target: 25,  order: 2 },
  { key: 'centurion',    name: 'Centurion',           desc: 'Jouer 100 matchs',            glyph: 'stadium',   target: 100, order: 3 },
  { key: 'globetrotter', name: 'Globe-trotter',       desc: 'Jouer sur 5 terrains',        glyph: 'map',       target: 5,   order: 4 },
  { key: 'on_fire',      name: 'En feu',              desc: '5 victoires de suite',        glyph: 'flame',     target: 5,   order: 5 },
  { key: 'bagel',        name: 'Boulanger',           desc: 'Infliger un 6-0',             glyph: 'bagel',     target: 1,   order: 6 },
  { key: 'clutch',       name: 'Clutch',              desc: 'Gagner un tie-break',         glyph: 'target',    target: 1,   order: 7 },
  { key: 'marathon',     name: 'Marathonien',         desc: 'Gagner un match en 3 sets',   glyph: 'hourglass', target: 1,   order: 8 },
  { key: 'mvp_x5',       name: 'Incontournable',      desc: 'Être élu MVP 5 fois',         glyph: 'crown',     target: 5,   order: 9 },
  { key: 'rise_7',       name: 'En pleine ascension', desc: 'Atteindre le niveau 7.0',     glyph: 'rise',      target: 7.0, order: 10 },
  { key: 'fairplay_10',  name: 'Esprit sportif',      desc: 'Récolter 10 votes Fair-Play', glyph: 'handshake', target: 10,  order: 11 },
  { key: 'popular_50',   name: 'Populaire',           desc: 'Atteindre 50 abonnés',        glyph: 'star',      target: 50,  order: 12 },
  { key: 'night_owl',    name: 'Noctambule',          desc: 'Jouer un match après 22h',    glyph: 'moon',      target: 1,   order: 13 },
  { key: 'early_bird',   name: 'Lève-tôt',            desc: 'Jouer un match avant 9h',     glyph: 'sun',       target: 1,   order: 14 },
];

// Recalcule + lit les réalisations du joueur. Dégrade en « tout verrouillé »
// si la migration/RPC n'est pas (encore) appliquée.
export async function getPlayerAchievements(playerId: string): Promise<Achievement[]> {
  let rows: PlayerAchievementRow[] = [];
  try {
    const { data, error } = await supabase.rpc('get_player_achievements', { p_id: playerId });
    if (!error && Array.isArray(data)) rows = data as PlayerAchievementRow[];
  } catch {
    rows = [];
  }
  const byKey = new Map(rows.map(r => [r.key, r]));
  return ACHIEVEMENT_DEFS.map(def => {
    const row = byKey.get(def.key);
    return {
      ...def,
      progress: row?.progress ?? 0,
      unlocked: !!row?.unlocked_at,
    };
  });
}
