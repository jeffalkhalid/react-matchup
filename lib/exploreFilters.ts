// lib/exploreFilters.ts — les filtres de l'Explorer.
//
// L'Explorer filtrait sur quatre dimensions, en pastilles posées à même
// l'écran. Ce fichier porte les neuf du volet : date, plage horaire, club,
// ville, type, niveau, genre, places libres, urgent.
//
// TOUT EST PUR ET TESTÉ, pour une raison apprise ici même : la règle
// « urgent » était écrite TROIS fois dans l'écran — la liste, le compteur, la
// carte — et les trois copies portaient le même défaut sans que rien ne le
// signale. Un filtre qui se trompe ne lève pas d'erreur : il montre une liste
// plausible, simplement fausse.
//
// Les valeurs des colonnes ne sont pas supposées, elles ont été relevées en
// base : `gender_pref` vaut men / women / mixed, `game_format` vaut
// competitive / friendly, et le défi se lit sur `is_challenge`.

export type DatePreset = 'any' | 'today' | 'tomorrow' | 'week' | 'weekend';
export type TimeSlot = 'any' | 'morning' | 'afternoon' | 'evening' | 'night';
export type TypeFilter = 'all' | 'competitive' | 'friendly' | 'challenge';
export type LevelFilter = 'all' | 'mine' | 'outside';
export type GenderFilter = 'all' | 'men' | 'women' | 'mixed';

export interface ExploreFilters {
  date: DatePreset;
  slot: TimeSlot;
  /** Noms de clubs retenus. Vide = tous. */
  clubs: string[];
  /** Villes retenues. Vide = toutes. */
  cities: string[];
  type: TypeFilter;
  level: LevelFilter;
  gender: GenderFilter;
  /** Nombre exact de places libres exigé. `null` = indifférent. */
  spots: number | null;
  urgentOnly: boolean;
  search: string;
}

export const NO_EXPLORE_FILTERS: ExploreFilters = {
  date: 'any', slot: 'any', clubs: [], cities: [],
  type: 'all', level: 'all', gender: 'all',
  spots: null, urgentOnly: false, search: '',
};

/** Combien de filtres sont actifs — le chiffre de la pastille « Filtres ». */
export function activeExploreFilterCount(f: ExploreFilters): number {
  let n = 0;
  if (f.date !== 'any') n++;
  if (f.slot !== 'any') n++;
  if (f.clubs.length > 0) n++;
  if (f.cities.length > 0) n++;
  if (f.type !== 'all') n++;
  if (f.level !== 'all') n++;
  if (f.gender !== 'all') n++;
  if (f.spots !== null) n++;
  if (f.urgentOnly) n++;
  if (f.search.trim()) n++;
  return n;
}

const jourEgal = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * La date de la partie tombe-t-elle dans la période choisie ?
 *
 * « Cette semaine » est une fenêtre GLISSANTE de sept jours à partir
 * d'aujourd'hui, pas la semaine civile : le mercredi, « cette semaine » qui
 * s'arrêterait au dimanche ne montrerait que quatre jours, et l'utilisateur
 * n'a pas demandé un calendrier, il a demandé « bientôt ».
 *
 * « Week-end » est le PROCHAIN samedi-dimanche, celui en cours compris. Un
 * dimanche soir, il désigne encore ce dimanche-là — pas celui d'après.
 */
export function matchesDatePreset(iso: string | null | undefined, preset: DatePreset, now: Date = new Date()): boolean {
  if (preset === 'any') return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;

  if (preset === 'today') return jourEgal(d, now);
  if (preset === 'tomorrow') return jourEgal(d, new Date(now.getTime() + 86_400_000));
  if (preset === 'week') {
    const fin = new Date(now.getTime() + 7 * 86_400_000);
    return d.getTime() >= now.getTime() && d.getTime() <= fin.getTime();
  }
  // weekend : LE samedi-dimanche a venir, celui en cours compris. Calcule
  // explicitement plutot que par un delta en jours — un delta laissait passer
  // le week-end SUIVANT selon l'heure a laquelle on regardait.
  const [samedi, dimanche] = weekendDates(now);
  return jourEgal(d, samedi) || jourEgal(d, dimanche);
}

/**
 * Le samedi et le dimanche du week-end courant ou a venir.
 *
 * Un samedi, c'est aujourd'hui et demain. Un dimanche, c'est hier et
 * aujourd'hui — un dimanche soir, « week-end » designe encore CE dimanche, pas
 * celui d'apres. Les autres jours, on avance jusqu'au prochain samedi.
 */
export function weekendDates(now: Date = new Date()): [Date, Date] {
  const j = now.getDay(); // 0 = dimanche, 6 = samedi
  const versSamedi = j === 0 ? -1 : 6 - j;
  const samedi = new Date(now.getTime() + versSamedi * 86_400_000);
  const dimanche = new Date(samedi.getTime() + 86_400_000);
  return [samedi, dimanche];
}

/**
 * L'heure de la partie tombe-t-elle dans la tranche ?
 *
 * Les bornes sont FERMÉES à gauche et OUVERTES à droite : midi pile est de
 * l'après-midi, 18 h pile est du soir, minuit pile est de la nuit. Sans cette
 * règle, une partie à midi appartiendrait à deux tranches et se compterait
 * deux fois.
 */
export function matchesTimeSlot(iso: string | null | undefined, slot: TimeSlot): boolean {
  if (slot === 'any') return true;
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const h = d.getHours();
  if (slot === 'morning') return h >= 6 && h < 12;
  if (slot === 'afternoon') return h >= 12 && h < 18;
  if (slot === 'evening') return h >= 18;          // 18 h → minuit
  return h < 6;                                     // nuit : minuit → 6 h
}

/** Le type d'une partie, même règle que la pastille des cartes. */
export function gameType(g: { is_challenge?: boolean | null; game_format?: string | null }): Exclude<TypeFilter, 'all'> {
  if (g.is_challenge) return 'challenge';
  return (g.game_format === 'friendly') ? 'friendly' : 'competitive';
}

/** Ce qui a écarté une partie, ou `null` si elle passe. */
export type ExploreReason =
  | 'date' | 'slot' | 'club' | 'city' | 'type' | 'level' | 'gender' | 'spots' | 'urgent' | 'search';

export interface ExploreGame {
  location?: string | null;
  match_date?: string | null;
  gender_pref?: string | null;
  game_format?: string | null;
  is_challenge?: boolean | null;
  creator?: { name?: string | null } | null;
}

export interface ExploreContext {
  /** now, injecté pour que les tests ne dépendent pas de l'horloge. */
  now: Date;
  /** Ville d'un club, par NOM de club — les parties portent le nom, pas l'id. */
  cityOfClub: (clubName: string) => string | null;
  /** `freeSpots` du jeu — passé en argument pour garder ce module pur. */
  freeSpots: (g: ExploreGame) => number;
  /** Le prédicat urgent partagé (lib/games). */
  isUrgent: (g: ExploreGame) => boolean;
  /** « mine » / « outside » : le verdict de niveau, déjà calculé par l'écran. */
  levelFit: (g: ExploreGame) => 'fit' | 'outside';
}

/**
 * La partie passe-t-elle tous les filtres ? Rend la PREMIÈRE raison de refus.
 *
 * Nommer la raison plutôt que rendre un booléen permet de dire à l'écran ce
 * qu'il cache et quel filtre retirer — la leçon des tournois, où « aucun
 * résultat » était un cul-de-sac sans issue.
 */
export function exploreRefusal(g: ExploreGame, f: ExploreFilters, ctx: ExploreContext): ExploreReason | null {
  if (!matchesDatePreset(g.match_date, f.date, ctx.now)) return 'date';
  if (!matchesTimeSlot(g.match_date, f.slot)) return 'slot';

  const lieu = (g.location ?? '').trim();
  if (f.clubs.length > 0 && !f.clubs.includes(lieu)) return 'club';
  if (f.cities.length > 0) {
    const ville = lieu ? ctx.cityOfClub(lieu) : null;
    if (!ville || !f.cities.includes(ville)) return 'city';
  }

  if (f.type !== 'all' && gameType(g) !== f.type) return 'type';
  if (f.level === 'mine' && ctx.levelFit(g) !== 'fit') return 'level';
  if (f.level === 'outside' && ctx.levelFit(g) === 'fit') return 'level';
  if (f.gender !== 'all' && (g.gender_pref ?? '') !== f.gender) return 'gender';
  if (f.spots !== null && ctx.freeSpots(g) !== f.spots) return 'spots';
  if (f.urgentOnly && !ctx.isUrgent(g)) return 'urgent';

  const q = f.search.trim().toLowerCase();
  if (q) {
    const dans = lieu.toLowerCase().includes(q)
      || (g.creator?.name ?? '').toLowerCase().includes(q);
    if (!dans) return 'search';
  }
  return null;
}

export interface ExploreOutcome<T> {
  kept: T[];
  hidden: { item: T; reason: ExploreReason }[];
}

export function filterExplore<T extends ExploreGame>(
  games: T[], f: ExploreFilters, ctx: ExploreContext,
): ExploreOutcome<T> {
  const kept: T[] = [];
  const hidden: { item: T; reason: ExploreReason }[] = [];
  for (const g of games) {
    const r = exploreRefusal(g, f, ctx);
    if (r) hidden.push({ item: g, reason: r }); else kept.push(g);
  }
  return { kept, hidden };
}

export const REASON_LABEL: Record<ExploreReason, string> = {
  date: 'Date',
  slot: 'Plage horaire',
  club: 'Club',
  city: 'Ville',
  type: 'Type de match',
  level: 'Niveau',
  gender: 'Genre',
  spots: 'Places libres',
  urgent: 'Urgent',
  search: 'Recherche',
};

/**
 * Le filtre dont le retrait révèle le plus de parties — et combien.
 *
 * Même principe que sur les tournois : plutôt qu'un « aucun résultat » sans
 * issue, on nomme la sortie la plus rentable. `null` quand aucun retrait ne
 * révèle rien.
 */
export function bestExploreFilterToDrop<T extends ExploreGame>(
  games: T[], f: ExploreFilters, ctx: ExploreContext,
): { reason: ExploreReason; unlocked: number } | null {
  const { hidden } = filterExplore(games, f, ctx);
  const compte = new Map<ExploreReason, number>();
  for (const h of hidden) compte.set(h.reason, (compte.get(h.reason) ?? 0) + 1);
  let best: { reason: ExploreReason; unlocked: number } | null = null;
  // Ordre déterministe : à égalité, le premier de REASON_LABEL gagne, pour que
  // deux appels identiques ne proposent jamais deux sorties différentes.
  for (const reason of Object.keys(REASON_LABEL) as ExploreReason[]) {
    const n = compte.get(reason) ?? 0;
    if (n > 0 && (!best || n > best.unlocked)) best = { reason, unlocked: n };
  }
  return best;
}

// ─── Mixité : une RÈGLE, pas un filtre ───────────────────────────────────────
//
// `gender_pref` n'était qu'une étiquette : rien ne l'appliquait, et un homme
// pouvait rejoindre une partie annoncée « Femmes ». Le verrou est côté serveur
// (gender_access.sql) — c'est le seul passage obligatoire.
//
// Ce qui suit ne verrouille rien : ça évite de MONTRER une partie qu'on ne
// pourra pas rejoindre. Un filtre se contourne ; il ne remplace pas la règle,
// il l'accompagne. C'est pour ça que cette fonction est séparée de
// `exploreRefusal` : une partie écartée ici ne doit JAMAIS être proposée
// comme « retire ce filtre pour la voir ».

export type PlayerGender = 'male' | 'female' | null | undefined;

/**
 * Ce joueur peut-il voir cette partie ?
 *
 * Les parties mixtes et sans préférence sont ouvertes à tous. Une partie
 * genrée ne se montre qu'aux joueurs du genre correspondant — y compris pour
 * un joueur qui n'a pas déclaré le sien : le serveur le refuserait, la lui
 * montrer serait une promesse en l'air.
 */
export function canPlayerSee(g: { gender_pref?: string | null }, me: PlayerGender): boolean {
  const p = g.gender_pref;
  if (p !== 'men' && p !== 'women') return true;
  if (!me) return false;
  return (p === 'men' && me === 'male') || (p === 'women' && me === 'female');
}

/** Les parties que ce joueur a le droit de voir. */
export function visibleGames<T extends { gender_pref?: string | null }>(
  games: T[], me: PlayerGender,
): T[] {
  return games.filter(g => canPlayerSee(g, me));
}

/**
 * Les valeurs du filtre Genre que ce joueur peut choisir.
 *
 * Proposer « Femmes » à un homme afficherait une liste vide en permanence —
 * un filtre qui ne peut rien rendre n'est pas un filtre, c'est un piège.
 */
export function allowedGenderFilters(me: PlayerGender): GenderFilter[] {
  if (me === 'male') return ['all', 'men', 'mixed'];
  if (me === 'female') return ['all', 'women', 'mixed'];
  // Genre non déclaré : seules les parties ouvertes à tous sont accessibles.
  return ['all', 'mixed'];
}
