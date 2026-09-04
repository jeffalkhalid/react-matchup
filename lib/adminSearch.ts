// lib/adminSearch.ts — la recherche globale du Panel Arbitre.
//
// Implémente `design_handoff_panel_arbitre`, barre de recherche.
//
// Le panel obligeait à savoir DANS QUEL ONGLET chercher avant de chercher :
// un joueur dans Joueurs, une soirée dans Tournois, une partie dans Parties.
// Quand on arrive avec un nom en tête — celui d'un joueur qui vient
// d'écrire — c'est la mauvaise question.
//
// LE PIÈGE, ET LA RAISON POUR LAQUELLE LE FILTRAGE EST ICI ET PAS EN BASE :
// les accents. `ILIKE` de PostgreSQL les distingue, donc « mehdi » ne
// ramènerait jamais « Méhdi », et « anfa » raterait « Anfá ». Sur une base
// franco-marocaine, où le même prénom s'écrit avec ou sans accent selon qui
// a rempli le formulaire, c'est la moitié des recherches qui échouent en
// silence — le pire des échecs, celui qui ressemble à « ce joueur n'existe
// pas ». On replie donc les accents des deux côtés, en mémoire, sur des
// listes que le panel a déjà chargées.

export type SearchKind = 'player' | 'game' | 'tournament';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  /** Plus haut = plus pertinent. Sert au tri, jamais à l'affichage. */
  score: number;
}

/**
 * Réduit un texte à sa forme comparable : minuscules, sans accents, espaces
 * normalisés. « Méhdi  EL Amrani » et « mehdi el amrani » deviennent la même
 * chaîne.
 */
export function fold(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    // On retire les signes diacritiques combinants (U+0300–U+036F) : c'est ce
    // que la décomposition NFD sépare de la lettre de base.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * À quel point `text` répond à `query`. `null` = pas de correspondance.
 *
 * L'échelle sépare quatre cas parce qu'ils n'ont pas la même valeur pour
 * celui qui cherche : « anfa » doit remonter « Anfa » avant « Club Anfa »,
 * et « Club Anfa » avant « Tournoi du dimanche à Anfa ».
 */
export function matchScore(query: string, text: string): number | null {
  const q = fold(query);
  const t = fold(text);
  if (!q || !t) return null;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  // Début d'un MOT, pas seulement du texte : un nom de famille se cherche
  // aussi souvent que le prénom.
  if (t.split(' ').some(w => w.startsWith(q))) return 60;
  if (t.includes(q)) return 40;
  return null;
}

/** En dessous de deux caractères, toute la base répondrait. */
export const MIN_QUERY = 2;

export interface SearchSources {
  players?: { id: string; name?: string | null; frmt_full_name?: string | null }[];
  games?: { id: string; location?: string | null; match_date?: string | null }[];
  tournaments?: { id: string; name?: string | null; club?: { name?: string | null } | null }[];
}

/**
 * Cherche dans tout ce que le panel a en mémoire.
 *
 * Un joueur est cherché sur son nom d'usage ET sur son nom FRMT : les deux
 * diffèrent souvent, et c'est justement quand ils diffèrent qu'on a besoin
 * de le retrouver.
 */
export function searchAll(query: string, src: SearchSources, limit = 12): SearchHit[] {
  if (fold(query).length < MIN_QUERY) return [];
  const hits: SearchHit[] = [];

  for (const p of src.players ?? []) {
    const s = best([matchScore(query, p.name ?? ''), matchScore(query, p.frmt_full_name ?? '')]);
    if (s !== null) {
      hits.push({
        kind: 'player', id: p.id,
        title: p.name || p.frmt_full_name || 'Joueur',
        subtitle: p.frmt_full_name && p.frmt_full_name !== p.name ? `FRMT : ${p.frmt_full_name}` : 'Joueur',
        score: s,
      });
    }
  }

  for (const g of src.games ?? []) {
    const s = matchScore(query, g.location ?? '');
    if (s !== null) {
      hits.push({
        kind: 'game', id: g.id,
        title: g.location || 'Partie',
        subtitle: dateLabel(g.match_date) || 'Partie',
        score: s,
      });
    }
  }

  for (const t of src.tournaments ?? []) {
    const s = best([matchScore(query, t.name ?? ''), matchScore(query, t.club?.name ?? '')]);
    if (s !== null) {
      hits.push({
        kind: 'tournament', id: t.id,
        title: t.name || 'Tournoi',
        subtitle: t.club?.name || 'Tournoi',
        score: s,
      });
    }
  }

  // Tri STABLE : à score égal on classe par titre, pour que deux recherches
  // identiques ne donnent jamais deux ordres différents.
  return hits
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'fr'))
    .slice(0, limit);
}

function best(scores: (number | null)[]): number | null {
  const vals = scores.filter((n): n is number => n !== null);
  return vals.length ? Math.max(...vals) : null;
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export const KIND_LABEL: Record<SearchKind, string> = {
  player: 'JOUEUR',
  game: 'PARTIE',
  tournament: 'TOURNOI',
};
