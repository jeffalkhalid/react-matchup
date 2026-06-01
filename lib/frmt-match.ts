export function rankFromPoints(points: number | null | undefined): string | null {
  if (points == null) return null;
  if (points >= 2000) return 'P2000';
  if (points >= 1000) return 'P1000';
  if (points >= 500)  return 'P500';
  if (points >= 250)  return 'P250';
  if (points >= 100)  return 'P100';
  if (points >= 25)   return 'P25';
  return null;
}

// Affichage du classement FRMT.
// - Joueur lié & vérifié : vrai classement scrapé "#47 · 6500 pts" (verified).
// - Sinon, rang auto-déclaré au signup (frmt_rank), sans le ✓.
// Renvoie null si rien à afficher.
export function formatFrmtRanking(p: {
  frmt_verified?: boolean | null;
  frmt_position?: number | null;
  frmt_points?: number | null;
  frmt_rank?: string | null;
}): { text: string; verified: boolean } | null {
  if (p.frmt_verified && p.frmt_position != null) {
    const pts = p.frmt_points != null ? ` · ${p.frmt_points} pts` : '';
    return { text: `#${p.frmt_position}${pts}`, verified: true };
  }
  if (p.frmt_rank) return { text: p.frmt_rank, verified: !!p.frmt_verified };
  return null;
}
