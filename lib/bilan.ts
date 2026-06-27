// Données du Bilan Mensuel (Wrapped). Cœur depuis la vue monthly_recap ;
// compléments (ELO, partenaire, best match, badges) assemblés ici.
// Dégrade proprement : un mois sans données → recap vide.
import { supabase } from './supabase';
import { eloToLevel, getLeague, getLeagueLabel } from './theme';
import { ACHIEVEMENT_DEFS } from './achievements';
import type { League } from '../types';

export type RecapPartner = { userId: string; name: string; matchesTogether: number; winsTogether: number };
export type RecapBestMatch = {
  date: string; sets: [number, number][]; partnerName?: string;
  opponents: string[]; venue: string;
};
export type RecapBadge = { key: string; name: string; glyph: string };

export type MonthlyRecap = {
  month: string;        // "2026-06"
  label: string;        // "JUIN"
  matches: number; wins: number; losses: number; winRate: number;
  eloDelta: number;     // somme elo_change du mois (interne, jamais affiché)
  levelDelta: number;   // variation de NIVEAU (toLvl - fromLvl) — affiché à la place de l'ELO
  fromLvl: number; toLvl: number;
  topPartner: RecapPartner | null;
  bestMatch: RecapBestMatch | null;
  badges: RecapBadge[];
  eloTimeline: { i: number; elo: number }[];
  barChart6: { label: string; matches: number }[];
  monthTrend: string | null; // ex "+58% vs mai" (vs mois précédent), null si N/A
  shortLabel: string;        // label minuscule ("juin")
  nextLeagueLabel: string | null; // ligue au-dessus (depuis l'ELO courant)
  nextLeague: League | null;      // clé de la ligue au-dessus (pour sa couleur)
  nextLeagueGap: number | null;   // distance EN NIVEAU jusqu'à la prochaine ligue
  lowActivity: boolean; // < 3 matchs (frame C, sous-projet C)
};

const MONTHS_FR = ['JANV', 'FÉVR', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUIL', 'AOÛT', 'SEPT', 'OCT', 'NOV', 'DÉC'];
function labelOf(key: string): string { const m = parseInt(key.slice(5, 7), 10) - 1; return MONTHS_FR[m] ?? key; }
function monthKey(d: Date): string { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; }

type PRef = { name: string; deleted_at?: string | null } | null;
type MatchRow = {
  id: string; created_at: string; score_text: string | null;
  winner_id: string | null; loser_id: string | null; winner_id_2: string | null; loser_id_2: string | null;
  winner: PRef; loser: PRef; winner_2: PRef; loser_2: PRef;
  game: { location: string | null; match_date: string | null } | null;
};

function parseSets(text: string | null): [number, number][] {
  if (!text) return [];
  return text.split(/[ ,]+/).map(s => s.split(/[-/]/).map(n => parseInt(n, 10)))
    .filter(p => p.length === 2 && !isNaN(p[0]) && !isNaN(p[1])) as [number, number][];
}

// Liste des mois disponibles (clé + label), du plus récent au plus ancien.
export async function getRecapMonths(uid: string): Promise<{ key: string; label: string }[]> {
  try {
    const { data } = await supabase.from('monthly_recap')
      .select('month').eq('user_id', uid).order('month', { ascending: false }).limit(12);
    // Mois courant exclu : le bilan d'un mois en cours n'est pas « prêt ».
    const currentKey = new Date().toISOString().slice(0, 7);
    return (data ?? [])
      .map((r: any) => { const key = String(r.month).slice(0, 7); return { key, label: labelOf(key) }; })
      .filter(m => m.key !== currentKey);
  } catch { return []; }
}

// Recap complet d'un mois ("YYYY-MM"). Renvoie null si aucune donnée.
export async function getMonthlyRecap(uid: string, month: string): Promise<MonthlyRecap | null> {
  try {
    const start = new Date(`${month}-01T00:00:00Z`);
    const end = new Date(start); end.setMonth(end.getMonth() + 1);
    const startISO = start.toISOString(), endISO = end.toISOString();

    // 1) Core depuis la vue (12 mois pour le bar chart + le mois courant).
    const { data: recapRows } = await supabase.from('monthly_recap')
      .select('*').eq('user_id', uid).order('month', { ascending: false }).limit(12);
    const rows = (recapRows ?? []) as any[];
    const cur = rows.find(r => String(r.month).slice(0, 7) === month);

    // 2) Matches du mois (date via game.match_date sinon created_at).
    const { data: matchData } = await supabase.from('matches').select(`
      id, created_at, score_text, winner_id, loser_id, winner_id_2, loser_id_2,
      winner:winner_id(name, deleted_at), loser:loser_id(name, deleted_at), winner_2:winner_id_2(name, deleted_at), loser_2:loser_id_2(name, deleted_at),
      game:game_id(location, match_date)`)
      .or(`winner_id.eq.${uid},loser_id.eq.${uid},winner_id_2.eq.${uid},loser_id_2.eq.${uid}`)
      .order('created_at', { ascending: true });
    const allMine = (matchData ?? []) as unknown as MatchRow[];
    const monthMatches = allMine.filter(m => {
      const d = new Date(m.game?.match_date ?? m.created_at).toISOString();
      return d >= startISO && d < endISO;
    });

    const matches = cur?.matches ?? monthMatches.length;
    const wins = cur?.wins ?? monthMatches.filter(m => m.winner_id === uid || m.winner_id_2 === uid).length;
    const losses = cur?.losses ?? (monthMatches.length - wins);
    const winRate = cur?.win_rate ?? (matches ? Math.round((100 * wins) / matches) : 0);

    if (matches === 0) return null;

    // 3) ELO du mois (elo_history) → delta + timeline + niveaux from/to.
    const { data: eloRows } = await supabase.from('elo_history')
      .select('elo_score, elo_change, created_at')
      .eq('player_id', uid).gte('created_at', startISO).lt('created_at', endISO)
      .order('created_at', { ascending: true });
    const elo = (eloRows ?? []) as { elo_score: number; elo_change: number; created_at: string }[];
    const eloDelta = elo.reduce((s, h) => s + (h.elo_change ?? 0), 0);
    const eloTimeline = elo.map((h, i) => ({ i, elo: h.elo_score }));
    const fromLvl = elo.length ? eloToLevel(elo[0].elo_score - (elo[0].elo_change ?? 0)) : 0;
    const toLvl = elo.length ? eloToLevel(elo[elo.length - 1].elo_score) : fromLvl;

    // 4) Top partenaire (doubles) du mois. On exclut les COMPTES SUPPRIMÉS :
    //    si le meilleur partenaire est supprimé, on prend le suivant ; sinon skip.
    const partnerStat = new Map<string, { name: string; n: number; w: number; deleted: boolean }>();
    for (const m of monthMatches) {
      const iWon = m.winner_id === uid || m.winner_id_2 === uid;
      const partner = iWon
        ? (m.winner_id === uid ? m.winner_2 : m.winner)
        : (m.loser_id === uid ? m.loser_2 : m.loser);
      if (!partner?.name) continue;
      const cur2 = partnerStat.get(partner.name) ?? { name: partner.name, n: 0, w: 0, deleted: !!partner.deleted_at };
      cur2.n += 1; if (iWon) cur2.w += 1; cur2.deleted = cur2.deleted || !!partner.deleted_at;
      partnerStat.set(partner.name, cur2);
    }
    const bestPartner = [...partnerStat.values()].filter(p => !p.deleted).sort((a, b) => b.n - a.n)[0];
    const topPartner: RecapPartner | null = bestPartner
      ? { userId: '', name: bestPartner.name, matchesTogether: bestPartner.n, winsTogether: bestPartner.w }
      : null;

    // 5) Best match : la victoire avec le plus gros écart de jeux.
    const wonMatches = monthMatches.filter(m => m.winner_id === uid || m.winner_id_2 === uid);
    const scoreOf = (m: MatchRow) => parseSets(m.score_text).reduce((s, [a, b]) => s + (a - b), 0);
    const best = wonMatches.sort((a, b) => scoreOf(b) - scoreOf(a))[0];
    const bestMatch: RecapBestMatch | null = best ? {
      date: (best.game?.match_date ?? best.created_at).slice(0, 10),
      sets: parseSets(best.score_text),
      partnerName: best.winner_id === uid ? best.winner_2?.name ?? undefined : best.winner?.name ?? undefined,
      opponents: [best.loser?.name, best.loser_2?.name].filter(Boolean) as string[],
      venue: best.game?.location ?? 'Match',
    } : null;

    // 6) Badges débloqués (catalogue côté client, débloquage daté côté serveur).
    let badges: RecapBadge[] = [];
    try {
      const defMap = new Map(ACHIEVEMENT_DEFS.map(d => [d.key, d]));
      const { data: ach } = await supabase.rpc('get_player_achievements', { p_id: uid });
      badges = ((ach ?? []) as any[])
        .filter(a => a.unlocked_at && String(a.unlocked_at) >= startISO && String(a.unlocked_at) < endISO)
        .map(a => { const def = defMap.get(a.key); return { key: a.key, name: def?.name ?? a.key, glyph: def?.glyph ?? 'ball' }; });
    } catch { badges = []; }

    // 7) Bar chart : 6 mois SE TERMINANT au mois sélectionné (chronologique).
    //    La dernière barre (mise en avant) = le mois affiché, pas « le plus récent ».
    const barChart6 = rows
      .filter(r => String(r.month).slice(0, 7) <= month)
      .slice(0, 6).reverse()
      .map(r => { const key = String(r.month).slice(0, 7); return { label: labelOf(key).slice(0, 3), matches: r.matches ?? 0 }; });

    // 8) Tendance vs mois précédent (sur le nb de matchs).
    const prevMonthDate = new Date(start); prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevKey = monthKey(prevMonthDate);
    const prevRow = rows.find(r => String(r.month).slice(0, 7) === prevKey);
    let monthTrend: string | null = null;
    if (prevRow && (prevRow.matches ?? 0) > 0) {
      const pct = Math.round((100 * (matches - prevRow.matches)) / prevRow.matches);
      monthTrend = `${pct >= 0 ? '+' : ''}${pct}% vs ${labelOf(prevKey).toLowerCase()}`;
    }

    // 9) Prochaine ligue + distance EN NIVEAU (depuis l'ELO le plus récent du mois).
    const order: League[] = ['discovery', 'bronze', 'silver', 'gold', 'diamond'];
    const NEXT_THRESHOLD_ELO: Record<League, number | null> = {
      discovery: 800, bronze: 1000, silver: 1200, gold: 1400, diamond: null,
    };
    const lastElo = elo.length ? elo[elo.length - 1].elo_score : null;
    let nextLeagueLabel: string | null = null;
    let nextLeague: League | null = null;
    let nextLeagueGap: number | null = null; // en niveau (1.0–8.0)
    if (lastElo != null) {
      const cur = getLeague(lastElo);
      const next = order[Math.min(order.length - 1, order.indexOf(cur) + 1)];
      nextLeagueLabel = getLeagueLabel(next);
      nextLeague = next;
      const threshold = NEXT_THRESHOLD_ELO[cur];
      if (threshold != null) nextLeagueGap = Math.max(0, Math.round((eloToLevel(threshold) - eloToLevel(lastElo)) * 100) / 100);
    }

    return {
      month, label: labelOf(month), shortLabel: labelOf(month).toLowerCase(),
      matches, wins, losses, winRate,
      eloDelta: Math.round(eloDelta), levelDelta: Math.round((toLvl - fromLvl) * 100) / 100, fromLvl, toLvl,
      topPartner, bestMatch, badges, eloTimeline, barChart6, monthTrend, nextLeagueLabel, nextLeague, nextLeagueGap,
      lowActivity: matches < 3,
    };
  } catch {
    return null;
  }
}

// Résout le mois le plus récent disponible (pour /bilan/last et la notif).
export async function getLatestRecapMonth(uid: string): Promise<string | null> {
  const months = await getRecapMonths(uid);
  return months[0]?.key ?? null;
}
