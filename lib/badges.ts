// Source des badges achievements — pilotée par la base (table `badge_defs`),
// avec un DÉFAUT EMBARQUÉ pour marcher offline / au premier lancement.
//
// AJOUTER / RETIRER / RECOLORER un badge qui réutilise une icône déjà livrée
// (cf. components/profile/badgeIcons.tsx) = une ligne dans la table `badge_defs`,
// AUCUNE mise à jour de l'app. Le défaut ci-dessous n'est qu'un filet de sécurité.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export interface BadgeDef { label: string; iconKey: string; color: string }

const COLORS = {
  gold: '#E6A21A', red: '#E5484D', orange: '#F2750A', slate: '#5B6B82',
  cyan: '#1FA8B0', purple: '#7C5CD6', green: '#16A34A', amber: '#D98A1A',
} as const;

// Défaut embarqué (clé canonique -> def). iconKey = clé dans BADGE_ICONS.
const DEFAULT_BADGES: Record<string, BadgeDef> = {
  'MVP':            { label: 'MVP',            iconKey: 'crown',              color: COLORS.gold },
  'Le Capitaine':   { label: 'Le Capitaine',   iconKey: 'star',               color: COLORS.gold },
  'La Bombe':       { label: 'La Bombe',       iconKey: 'bomb',               color: COLORS.red },
  'Le Smash':       { label: 'Le Smash',       iconKey: 'lightning',          color: COLORS.red },
  'Le Phénix':      { label: 'Le Phénix',      iconKey: 'flame',              color: COLORS.orange },
  'Le Mur':         { label: 'Le Mur',         iconKey: 'wall',               color: COLORS.slate },
  'Roi du Filet':   { label: 'Roi du Filet',   iconKey: 'racquet',            color: COLORS.slate },
  "L'Essuie-glace": { label: "L'Essuie-glace", iconKey: 'person-simple-run',  color: COLORS.cyan },
  'Le Cerveau':     { label: 'Le Cerveau',     iconKey: 'brain',              color: COLORS.purple },
  'Fair-Play':      { label: 'Fair-Play',      iconKey: 'handshake',          color: COLORS.green },
  'Ponctuel':       { label: 'Ponctuel',       iconKey: 'clock',              color: COLORS.green },
  'Bonne Ambiance': { label: 'Bonne Ambiance', iconKey: 'smiley',             color: COLORS.green },
  '3e Mi-temps':    { label: '3e Mi-temps',    iconKey: 'beer-stein',         color: COLORS.green },
};

// Alias (codes back-end, variantes) -> clé canonique.
const ALIASES: Record<string, string> = {
  CANNON: 'La Bombe', 'El Cañón': 'La Bombe',
  SMASH: 'Le Smash',
  COMEBACK: 'Le Phénix',
  WALL: 'Le Mur',
  RUNNER: "L'Essuie-glace", 'Essuie-glace': "L'Essuie-glace",
  NET_KING: 'Roi du Filet',
  BRAIN: 'Le Cerveau',
  CAPTAIN: 'Le Capitaine',
  FAIR_PLAY: 'Fair-Play',
  GOOD_VIBES: 'Bonne Ambiance', 'Bon Délire': 'Bonne Ambiance',
  DRINKS: '3e Mi-temps',
  PUNCTUAL: 'Ponctuel',
};

const FALLBACK: BadgeDef = { label: '', iconKey: 'medal', color: COLORS.slate };
const CACHE_KEY = 'badge_defs_v1';

// Registre runtime mutable : démarre sur le défaut, fusionné par la base au boot.
let registry: Record<string, BadgeDef> = { ...DEFAULT_BADGES };

/** Résout n'importe quelle clé/alias vers sa def. Synchrone (lit le registre en mémoire). */
export function getBadge(key: string): BadgeDef {
  if (!key) return { ...FALLBACK };
  const canon = registry[key] ? key : ALIASES[key];
  return registry[canon] ?? { ...FALLBACK, label: key };
}

function applyRows(rows: Array<{ key: string; label: string; icon_key: string; color: string }>) {
  const next: Record<string, BadgeDef> = { ...DEFAULT_BADGES };
  for (const r of rows) {
    if (!r?.key) continue;
    next[r.key] = { label: r.label ?? r.key, iconKey: r.icon_key || FALLBACK.iconKey, color: r.color || COLORS.slate };
  }
  registry = next;
}

/**
 * Charge les définitions depuis `badge_defs` : d'abord le cache (instantané),
 * puis le réseau (qui ré-écrit le cache). À appeler au démarrage de l'app.
 * Ne jette jamais : en cas d'échec, le défaut embarqué reste en place.
 */
export async function loadBadgeDefs(): Promise<void> {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) applyRows(JSON.parse(cached));
  } catch { /* cache illisible → on garde le défaut */ }

  try {
    const { data, error } = await supabase
      .from('badge_defs')
      .select('key, label, icon_key, color')
      .eq('active', true);
    if (error || !data) return;
    applyRows(data as any);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* réseau KO → cache/défaut conservés */ }
}
