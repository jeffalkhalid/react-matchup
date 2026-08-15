// Texte adaptatif du Bilan Mensuel : le ton est dérivé des stats du mois,
// chaque slide pioche ses phrases ici (source unique, fonctions pures).
import type { MonthlyRecap } from './bilan';

export type BilanTone = 'feu' | 'solide' | 'combat';

// 🔥 feu : winrate ≥ 60 % et niveau stable/en hausse.
// 💪 solide : winrate ≥ 45 % ou niveau en hausse.
// 🥊 combat : le reste — on valorise la persévérance, sans mentir.
export function bilanTone(r: Pick<MonthlyRecap, 'winRate' | 'levelDelta'>): BilanTone {
  if (r.winRate >= 60 && r.levelDelta >= 0) return 'feu';
  if (r.winRate >= 45 || r.levelDelta >= 0) return 'solide';
  return 'combat';
}

// Slide Partage — titre découpé pour le <Text> imbriqué (accent = partie blanche).
export function partageTitle(tone: BilanTone): { pre: string; accent: string; post: string } {
  switch (tone) {
    case 'feu': return { pre: 'Tu as fait ', accent: 'un mois de feu', post: ' 🔥' };
    case 'solide': return { pre: 'Tu as fait ', accent: 'un mois solide', post: ' 💪' };
    case 'combat': return { pre: "Tu n'as ", accent: 'rien lâché', post: ' 🥊' };
  }
}

// Slide Forme — phrase de la carte du bas.
export function formeCardLine(tone: BilanTone): string {
  switch (tone) {
    case 'feu': return 'Un mois qui gagne 🥇';
    case 'solide': return 'Du solide.';
    case 'combat': return 'Le niveau se construit dans ces matchs-là.';
  }
}

// Slide Progression — titre selon le sens de la variation.
export function progressionTitle(levelDelta: number): string {
  return levelDelta >= 0 ? 'Ton niveau a grimpé…' : 'Ça a tangué…';
}
