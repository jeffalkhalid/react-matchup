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

export function parseSetsLocal(text: string | null | undefined): [number, number][] {
  if (!text) return [];
  return text.trim().split(/[\s,]+/).flatMap(s => {
    const p = s.split('-').map(Number);
    return p.length === 2 && !p.some(isNaN) ? [[p[0], p[1]] as [number, number]] : [];
  });
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
  const myTeam = [
    { id: meP?.id ?? undefined, name: displayName(meP ?? null, 'player'), me: markMe, lvl: lvlOf(meP) },
    ...(partner ? [{ id: partner.id ?? undefined, name: displayName(partner, 'partner'), lvl: lvlOf(partner) }] : []),
  ];
  const oppTeam = opp.map(p => ({ id: p.id ?? undefined, name: displayName(p, 'opponent'), lvl: lvlOf(p) }));
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
  };
}
