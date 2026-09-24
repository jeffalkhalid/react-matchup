// lib/courtAlarmStorage.ts — la mémoire des sonneries de terrain, SURVIT à
// l'app tuée par l'OS.
//
// `syncCourtAlarms` (lib/courtAlarm.ts) reçoit sa mémoire en argument — une
// Map tenue par l'écran. Un `useRef` fait l'affaire tant que l'écran vit,
// mais PAS si l'app est tuée entre le départ du chrono et la sonnerie : les
// notifications programmées par expo-notifications, elles, survivent. Au
// relancement, une mémoire vide referait poser une DEUXIÈME paire de
// sonneries par-dessus la première déjà en attente — un téléphone qui sonne
// pendant la rotation suivante, pire que pas de sonnerie du tout (voir
// l'en-tête de lib/courtAlarm.ts). D'où : une ligne par match dans
// `AsyncStorage`, relue au montage de l'écran, réécrite à chaque changement,
// et purgée dès qu'on change de match (rotation suivante, ou match quitté).
//
// Chaque lecture et chaque écriture est encapsulée : le stockage peut être
// indisponible (mode privé, quota plein, première ouverture), et cela doit
// dégrader vers « pas de mémoire retrouvée », jamais vers un plantage — même
// règle que pour les sonneries elles-mêmes.
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'courtAlarm:';

/** La clé de stockage d'un match — une ligne par match, jamais un blob
 *  unique : purger une rotation passée ne doit jamais risquer d'effacer
 *  celle en cours. */
export function alarmStorageKey(matchId: string): string {
  return `${PREFIX}${matchId}`;
}

/** Les identifiants de notifications d'un match, tels qu'écrits par
 *  `setItem`. Rend `[]` sur n'importe quelle valeur absente ou illisible —
 *  jamais une exception qui remonte jusqu'à l'écran. */
export function parseAlarmIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Parmi toutes les clés du stockage, celles à effacer parce qu'elles ne
 * concernent plus le match courant — la rotation précédente, un match
 * rouvert ailleurs, ou un abandon. `keepMatchId` à `null` (je ne joue pas
 * cette rotation, ou aucune sonnerie n'est due) purge tout ce qui est à moi.
 *
 * Ne touche jamais aux clés d'un autre usage de l'app : seules celles au
 * préfixe `courtAlarm:` sont concernées.
 */
export function alarmKeysToPurge(allKeys: string[], keepMatchId: string | null): string[] {
  const garder = keepMatchId ? alarmStorageKey(keepMatchId) : null;
  return allKeys.filter(k => k.startsWith(PREFIX) && k !== garder);
}

/**
 * Relit toute la mémoire posée sur CE téléphone, sous la forme que
 * `syncCourtAlarms` attend. À appeler une fois, au montage de l'écran —
 * avant sa première synchronisation, pour ne jamais reposer une sonnerie déjà
 * en attente.
 */
export async function loadAlarmMemory(): Promise<Map<string, string[]>> {
  const memoire = new Map<string, string[]>();
  try {
    const toutes = await AsyncStorage.getAllKeys();
    const mines = toutes.filter(k => k.startsWith(PREFIX));
    if (mines.length === 0) return memoire;
    const paires = await AsyncStorage.multiGet(mines);
    for (const [k, v] of paires) {
      const ids = parseAlarmIds(v);
      if (ids.length > 0) memoire.set(k.slice(PREFIX.length), ids);
    }
  } catch {
    // Stockage indisponible : mémoire vide, donc « pas d'alarme retrouvée »
    // plutôt qu'un plantage à l'ouverture de l'écran.
  }
  return memoire;
}

/** Écrit la mémoire d'UN match — l'efface si elle est vide (aucune sonnerie
 *  encore posée, ou toutes annulées entre-temps). */
export async function saveAlarmMemory(matchId: string, ids: string[]): Promise<void> {
  try {
    if (ids.length === 0) await AsyncStorage.removeItem(alarmStorageKey(matchId));
    else await AsyncStorage.setItem(alarmStorageKey(matchId), JSON.stringify(ids));
  } catch {
    // Pas grave pour cette session (la mémoire en RAM reste correcte) ; au
    // pire, un relancement plus tard reposera une sonnerie en double — le
    // même risque qu'un `useRef` sans persistance du tout.
  }
}

/**
 * Persiste les changements faits à `memoire` par `syncCourtAlarms` : les
 * clés encore présentes sont réécrites, celles qui ont disparu (sonneries
 * annulées) sont effacées. `avant` est l'instantané des clés PRISES avant
 * l'appel à `syncCourtAlarms` — sans lui on ne verrait jamais une annulation.
 */
export async function persistAlarmMemory(
  avant: Iterable<string>, memoire: Map<string, string[]>,
): Promise<void> {
  const concernes = new Set<string>([...avant, ...memoire.keys()]);
  for (const matchId of concernes) {
    await saveAlarmMemory(matchId, memoire.get(matchId) ?? []);
  }
}

/**
 * Purge les clés d'une rotation passée. Appelée à chaque changement de match
 * (rotation suivante, ou sortie du tournoi) pour ne jamais laisser grossir le
 * stockage d'une soirée à l'autre.
 */
export async function purgeAlarmMemory(keepMatchId: string | null): Promise<void> {
  try {
    const toutes = await AsyncStorage.getAllKeys();
    const aEffacer = alarmKeysToPurge([...toutes], keepMatchId);
    if (aEffacer.length > 0) await AsyncStorage.multiRemove(aEffacer);
  } catch {
    // Stockage indisponible : rien à purger, l'app continue normalement.
  }
}
