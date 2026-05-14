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
