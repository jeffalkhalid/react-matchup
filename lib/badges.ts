// Source des badges achievements — pilotée par la base (table `badge_defs`),
// avec un DÉFAUT EMBARQUÉ pour marcher offline / au premier lancement.
//
// `badge_defs` est la SOURCE UNIQUE : liste votable, comptages et fil Communauté
// passent par isBadgeVisible / getActiveVoteBadges. Un badge DÉSACTIVÉ (active=false)
// ou SUPPRIMÉ (ligne absente) disparaît partout ; les votes restant en base, la
// réactivation restaure l'historique. L'ancienne table `badges` n'est plus lue.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export interface BadgeDef { label: string; iconKey: string; color: string }
export interface VoteBadge extends BadgeDef { key: string }

interface BadgeRow { key: string; label: string; icon_key: string; color: string; active: boolean; sort: number }

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

// Alias (codes back-end, variantes, anciens labels de la table `badges`) -> clé canonique.
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
// v2 : le cache stocke TOUTES les lignes (active + sort inclus), plus seulement les actives.
const CACHE_KEY = 'badge_defs_v2';

// Défaut sous forme de lignes (tous actifs, ordre d'insertion). Sert tant que la
// base n'a pas répondu (offline / premier lancement).
const DEFAULT_ROWS: BadgeRow[] = Object.entries(DEFAULT_BADGES).map(([key, d], i) => (
  { key, label: d.label, icon_key: d.iconKey, color: d.color, active: true, sort: i }
));

// Registre runtime : démarre sur le défaut, REMPLACÉ par la base dès qu'elle répond
// (pas de fusion : un badge supprimé en base ne doit pas ressusciter via le défaut).
let rows: BadgeRow[] = DEFAULT_ROWS;
let registry: Record<string, BadgeDef> = { ...DEFAULT_BADGES };

/** Résout une clé/alias vers sa clé canonique (ou undefined si inconnue). */
function canonKey(key: string): string | undefined {
  if (registry[key]) return key;
  const alias = ALIASES[key];
  return alias && registry[alias] ? alias : undefined;
}

/** Résout n'importe quelle clé/alias vers sa def. Synchrone (lit le registre en mémoire). */
export function getBadge(key: string): BadgeDef {
  if (!key) return { ...FALLBACK };
  const canon = canonKey(key);
  return canon ? registry[canon] : { ...FALLBACK, label: key };
}

/**
 * Un badge est VISIBLE s'il existe dans `badge_defs` ET est actif (alias résolus).
 * À appliquer partout où des badges sont listés ou comptés : écrans de vote,
 * compteur accueil, onglet Badges du profil, fiche match, fil Communauté.
 */
export function isBadgeVisible(key: string | null | undefined): boolean {
  if (!key) return false;
  const canon = canonKey(key);
  if (!canon) return false;
  return rows.some(r => r.key === canon && r.active);
}

/** Badges proposables au vote : actifs, triés par `sort`. */
export function getActiveVoteBadges(): VoteBadge[] {
  return rows
    .filter(r => r.active)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map(r => ({ key: r.key, label: r.label ?? r.key, iconKey: r.icon_key || FALLBACK.iconKey, color: r.color || COLORS.slate }));
}

function applyRows(fetched: BadgeRow[]) {
  const clean = (fetched ?? []).filter(r => r?.key);
  if (clean.length === 0) return; // base vide/illisible → on garde le défaut
  rows = clean;
  const next: Record<string, BadgeDef> = {};
  for (const r of clean) {
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
      .select('key, label, icon_key, color, active, sort')
      .order('sort');
    if (error || !data) return;
    applyRows(data as BadgeRow[]);
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* réseau KO → cache/défaut conservés */ }
}
