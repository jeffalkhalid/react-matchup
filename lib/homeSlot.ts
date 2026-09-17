// lib/homeSlot.ts — qui occupe l'emplacement du milieu de l'accueil.
//
// L'accueil a UN emplacement sous les deux boutons, et trois occupants
// possibles selon ce qui est vrai :
//
//   1. un match programmé            → la carte « Prochain match » ;
//   2. rien de programmé, mais des tournois ouverts → personne (les tournois
//      remplissent déjà l'écran, en remettre une couche le surchargerait) ;
//   3. rien du tout                  → « Ça se joue bientôt », c'est-à-dire
//      jusqu'à TROIS vraies parties ouvertes, rendues par la carte du lobby
//      (`GameCard`) dans un carrousel — et s'il n'y en a aucune, « Pas encore
//      de match. Crée le tien. »
//
// POURQUOI PAS UN BOUTON. L'accueil portait déjà, à cet endroit, une carte
// « Aucun match programmé · explore les parties ouvertes » avec une flèche
// vers le lobby — soit mot pour mot le bouton « Trouver un match » situé juste
// au-dessus. Un bouton demande un acte de foi : il faut croire qu'il y a
// quelque chose derrière. Une partie avec son club, son heure, son niveau et
// ses quatre créneaux ne promet rien qui n'existe pas.
//
// LE DERNIER ÉTAGE COMPTE AUTANT QUE LES AUTRES. Le jour du lancement il n'y
// aura pas encore de parties ouvertes ; sans « crée le tien », l'écran d'un
// nouveau joueur serait vide au moment précis où il faut lui donner un geste.

import { freeSpots, isUrgentGame, eloFitsGame } from './games';
import { canPlayerSee } from './exploreFilters';
import type { PlayerGender } from './exploreFilters';

/** Le minimum qu'une partie doit porter pour qu'on sache si on peut la proposer. */
export interface SuggestibleGame {
  id: string;
  creator_id: string;
  match_date?: string | null;
  status?: string | null;
  gender_pref?: string | null;
  spots_available?: number | null;
  participants?: { player_id: string; status: string; invite_expires_at?: string | null }[] | null;
  /** Le NOM du club — c'est ce que référencent les clubs favoris. */
  location?: string | null;
  min_elo?: number | null;
  max_elo?: number | null;
}

/** Ce qu'on affiche dans l'emplacement. */
export type HomeSlot<G> =
  | { kind: 'nextMatch' }
  | { kind: 'openGames'; games: G[] }
  | { kind: 'createFirst' }
  | { kind: 'none' };

/**
 * Combien de parties on propose sur l'accueil.
 *
 * TROIS, demandé par l'utilisateur (2026-09-14). La carte du lobby est dense —
 * date, club, niveau, pastilles, quatre créneaux — et deux empilées ne
 * tiennent déjà pas sur un accueil qui ne défile pas. Les trois sont donc
 * côte à côte dans un carrousel qu'on fait glisser : la hauteur reste celle
 * d'une seule carte. « Tout voir » mène au reste, qui est le métier du lobby.
 */
export const MAX_SUGGESTIONS = 3;

/** Qui regarde : de quoi filtrer ET classer. */
export interface SuggestionViewer {
  id: string;
  gender?: string | null;
  /** Mon ELO. Absent → aucune priorité de niveau (rien n'est « dans ma fourchette »). */
  elo?: number | null;
  /** Mes clubs favoris, par NOM (lib/clubFavorites). */
  favoriteClubs?: string[];
}

/**
 * Les parties qu'on a le droit de proposer à ce joueur, les MIEUX CLASSÉES
 * d'abord.
 *
 * Quatre refus, et chacun a coûté quelque chose ailleurs :
 *
 *   * LE GENRE passe par `canPlayerSee`, jamais par un filtre réécrit dans la
 *     requête. La règle « un homme ne voit pas une partie réservée aux
 *     femmes » est verrouillée côté serveur dans `join_game` ; la contourner
 *     ici afficherait sur l'accueil une partie que le serveur refuserait —
 *     une promesse en l'air, et la pire place pour en faire une.
 *   * MES PROPRES PARTIES : si j'y suis déjà, à quelque titre que ce soit, ce
 *     n'est pas une découverte. Et une partie où je suis confirmé est déjà
 *     traitée plus haut par « Prochain match ».
 *   * LES PARTIES PLEINES : `freeSpots` fait foi, PAS `spots_available` — ce
 *     compteur dénormalisé dérive (cf. la carte des places du lobby).
 *   * LE PASSÉ, évidemment. Une partie sans date ne peut pas être située dans
 *     le temps : on ne la propose pas non plus.
 *
 * LE CLASSEMENT, dans cet ordre (demandé par l'utilisateur, 2026-09-14) :
 *
 *   1. DANS MA FOURCHETTE DE NIVEAU — `eloFitsGame`, la même règle que le
 *      lobby. Hors fourchette, rejoindre passe par le vote des joueurs déjà
 *      dedans : c'est une partie qu'on n'aura peut-être pas ;
 *   2. URGENTE — `isUrgentGame`, le même prédicat que le filtre « Urgent » de
 *      l'Explorer (il était écrit trois fois avant de vivre à un seul
 *      endroit) : il manque une personne et ça se joue bientôt ;
 *   3. DANS UN DE MES CLUBS FAVORIS — par nom, comme partout ;
 *   4. à égalité, LA PLUS PROCHE dans le temps.
 *
 * Ce sont des PRIORITÉS, pas des filtres : une partie hors fourchette reste
 * proposable s'il n'y a rien de mieux. Filtrer viderait l'accueil au lancement,
 * quand il y a peu de parties — et renverrait sur « crée le tien » alors
 * qu'une partie existe.
 */
export function suggestibleGames<G extends SuggestibleGame>(
  games: G[], me: SuggestionViewer,
  now: Date = new Date(), max: number = MAX_SUGGESTIONS,
): G[] {
  const favoris = new Set(me.favoriteClubs ?? []);
  // 0 = prioritaire, 1 = non. Comparés dans l'ordre, puis la date départage.
  const rang = (g: G): number[] => [
    me.elo != null && eloFitsGame(g, me.elo) ? 0 : 1,
    isUrgentGame(g, now) ? 0 : 1,
    g.location != null && favoris.has(g.location) ? 0 : 1,
  ];

  return games
    .filter(g => {
      if (g.status && g.status !== 'open') return false;
      if (g.creator_id === me.id) return false;
      if ((g.participants ?? []).some(p => p.player_id === me.id)) return false;
      if (!canPlayerSee(g, (me.gender ?? null) as PlayerGender)) return false;
      if (freeSpots(g) <= 0) return false;
      const t = g.match_date ? new Date(g.match_date).getTime() : NaN;
      return Number.isFinite(t) && t > now.getTime();
    })
    .sort((a, b) => {
      const ra = rang(a);
      const rb = rang(b);
      for (let i = 0; i < ra.length; i++) {
        if (ra[i] !== rb[i]) return ra[i] - rb[i];
      }
      return new Date(a.match_date!).getTime() - new Date(b.match_date!).getTime();
    })
    .slice(0, Math.max(0, max));
}

/**
 * Qui occupe l'emplacement.
 *
 * `suggestions` doit DÉJÀ être passé par `suggestibleGames` — cette fonction
 * ne re-filtre rien, elle arbitre. Séparer les deux permet de tester le tri et
 * les refus sans rejouer tout l'écran.
 */
export function homeSlot<G>(i: {
  hasNextMatch: boolean;
  hasTournaments: boolean;
  suggestions: G[];
}): HomeSlot<G> {
  if (i.hasNextMatch) return { kind: 'nextMatch' };
  if (i.hasTournaments) return { kind: 'none' };
  if (i.suggestions.length > 0) return { kind: 'openGames', games: i.suggestions };
  return { kind: 'createFirst' };
}
