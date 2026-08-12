/* lib/matchView.ts
 * Adaptateur partagé : ligne `matches` (avec jointures winner/loser/game) →
 * `MatchView`, la forme consommée par le composant <MatchCard> du profil.
 * Source unique pour garantir la MÊME représentation des matchs partout
 * (lobby, profil, fil d'activité Communauté).
 *
 * `markMe` : marque l'équipe du joueur de référence comme « moi » (couronne 👑,
 * nom en gras). À laisser à `true` quand le lecteur EST ce joueur (profil, lobby),
 * et à passer à `false` dans un fil social où le lecteur regarde le match d'un autre. */
import { eloToLevel } from './theme';
import { displayName } from './players';
import type { Match } from '../types';
import type { MatchView } from '../components/profile/components';

// Nature d'un match pour la pastille des cartes (défi + mise / classé / amical).
// Source = colonnes copiées sur `matches` à la saisie du score (is_challenge,
// stake_multiplier, game_format) — fallback stake>1 pour les vieilles lignes.
export function matchNature(match: {
  game_format?: string | null; is_challenge?: boolean | null; stake_multiplier?: number | null;
}): { kind: 'defi' | 'competitif' | 'amical'; stake: number } {
  const stake = Number(match.stake_multiplier ?? 1) || 1;
  if (match.game_format === 'friendly') return { kind: 'amical', stake };
  if (match.is_challenge || stake > 1) return { kind: 'defi', stake };
  return { kind: 'competitif', stake };
}

/* Parse « 6-4 3-6 6-2 » → paires [a, b], puis NORMALISE en vainqueur-premier.
 * `score_text` est stocké TEL QUE SAISI (perspective du soumetteur, cf.
 * score-entry) — PAS forcément côté vainqueur : quand un perdant saisit le
 * score, les colonnes sont inversées (bug historique : grille de score
 * retournée sur le profil). Un match validé ayant toujours un vainqueur
 * STRICT en sets, la majorité des sets identifie l'orientation — déterministe,
 * et corrige aussi toutes les lignes historiques sans migration.
 * Parseur PARTAGÉ : profil, bilan et stories importent celui-ci — ne pas
 * recréer de copie locale. */
export function parseSetsLocal(text: string | null | undefined): [number, number][] {
  if (!text) return [];
  const pairs = text.trim().split(/[\s,]+/).flatMap(s => {
    const p = s.split(/[-/]/).map(Number);
    return p.length === 2 && !p.some(isNaN) ? [[p[0], p[1]] as [number, number]] : [];
  });
  const firstWins  = pairs.filter(([a, b]) => a > b).length;
  const secondWins = pairs.filter(([a, b]) => b > a).length;
  return secondWins > firstWins ? pairs.map(([a, b]) => [b, a] as [number, number]) : pairs;
}

export function matchToView(match: Match, playerId: string, markMe = true): MatchView {
  const won = match.winner_id === playerId || match.winner_id_2 === playerId;
  const winners = [match.winner, match.winner_2].filter(Boolean) as NonNullable<typeof match.winner>[];
  const losers  = [match.loser,  match.loser_2 ].filter(Boolean) as NonNullable<typeof match.loser>[];
  const mine = won ? winners : losers;
  const opp  = won ? losers  : winners;
  const meP     = mine.find(p => p.id === playerId);
  const partner = mine.find(p => p.id !== playerId);
  const lvlOf = (p?: { elo_score?: number | null } | null) => (p?.elo_score != null ? eloToLevel(p.elo_score) : undefined);
  // Créateur/organisateur du match → couronne (cohérent lobby/détails/chat).
  const creatorId = (match.game as { creator_id?: string | null } | null | undefined)?.creator_id ?? undefined;
  const isCreator = (id?: string) => !!creatorId && id === creatorId;
  const myTeam = [
    { id: meP?.id ?? undefined, name: displayName(meP ?? null, 'player'), me: markMe, lvl: lvlOf(meP), isCreator: isCreator(meP?.id) },
    ...(partner ? [{ id: partner.id ?? undefined, name: displayName(partner, 'partner'), lvl: lvlOf(partner), isCreator: isCreator(partner.id) }] : []),
  ];
  const oppTeam = opp.map(p => ({ id: p.id ?? undefined, name: displayName(p, 'opponent'), lvl: lvlOf(p), isCreator: isCreator(p.id) }));
  const sets = parseSetsLocal(match.score_text).map(([w, l]) => (won ? [w, l] : [l, w]) as [number, number]);
  const dt = new Date(match.game?.match_date ?? match.created_at);
  const dateStr = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return {
    id: match.id,
    club: match.game?.location ?? 'Match',
    date: dateStr.charAt(0).toUpperCase() + dateStr.slice(1),
    time,
    result: won ? 'Victoire' : 'Défaite',
    delta: 0,
    teams: [myTeam, oppTeam],
    sets,
    winnerRow: won ? 0 : 1,
    creatorId,
    ...matchNature(match),
  };
}
