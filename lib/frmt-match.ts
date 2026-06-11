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
// On n'affiche QUE le VRAI classement scrapé : joueur lié au scraper (vérifié)
// AVEC une position connue → « #position · points pts ». On n'affiche JAMAIS le
// bracket auto-déclaré au signup (`frmt_rank`, type « P100 »), pas fiable.
// Renvoie null s'il n'y a pas de vrai classement vérifié à afficher.
export function formatFrmtRanking(p: {
  frmt_verified?: boolean | null;
  frmt_position?: number | null;
  frmt_points?: number | null;
  frmt_rank?: string | null;
}): { text: string; verified: boolean } | null {
  if (!p.frmt_verified || p.frmt_position == null) return null;
  const pts = p.frmt_points != null ? ` · ${p.frmt_points} pts` : '';
  return { text: `#${p.frmt_position}${pts}`, verified: true };
}
