// Statut Ambassadeur « Cercle des 100 » : les 100 premiers inscrits.
// Source de vérité unique du prédicat et des formats — ne jamais tester
// member_number à la main dans les écrans.
import { supabase } from './supabase';

export const AMBASSADOR_LIMIT = 100;

// Clé AsyncStorage de la révélation « Cercle des 100 » (Task 8) — posée une
// seule fois par joueur, dès l'affichage de l'écran. Source de vérité unique
// du format (même pattern que GUIDE_KEY dans lib/guideTheme.ts).
export const AMB_REVEAL_SEEN_KEY = (playerId: string) => `amb_reveal_seen:${playerId}`;

// Teintes propres au concept Ambassadeur (prototype design_handoff_ambassadeur).
// L'or de base reste Colors.brand / brandDeep / brandBright.
export const AMB = {
  gold: '#FFC11A',
  goldDeep: '#E8A906',
  goldBright: '#FFD23F',
  goldDark: '#C98F08',   // bas du dégradé du numéro de carte
  chipText: '#B8860B',   // texte du chip N°xxx sur fond clair
  inkWarm: '#16110A',    // noir chaud des fonds ambassadeur
  inkCard: '#1C1C1E',    // haut du dégradé de la carte membre
  inkCardWarm: '#1C1710',// haut du dégradé de la carte Stats
  inkDeep: '#060607',    // bas des dégradés sombres
  medallionBg: '#141010',// fond du cercle central du médaillon
  line35: 'rgba(255,193,26,0.35)',
  line45: 'rgba(255,193,26,0.45)',
} as const;

export function isAmbassador(p?: { member_number?: number | null } | null): boolean {
  return p?.member_number != null && p.member_number >= 1 && p.member_number <= AMBASSADOR_LIMIT;
}

/** « N°042 » — carte, pill, chip, overlay. */
export function formatMemberNumber(n: number): string {
  return 'N°' + String(n).padStart(3, '0');
}

/** « N°42 » — plaque sous l'avatar, sceau accueil. */
export function formatMemberNumberShort(n: number): string {
  return 'N°' + n;
}

/** « mars 2026 » */
export function memberSinceLabel(createdAt?: string | null): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/** « ÉMISE 03.2026 » */
export function issuedLabel(createdAt?: string | null): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `ÉMISE ${mm}.${d.getFullYear()}`;
}

/** Nombre de places attribuées (null si indisponible — migration pas appliquée, offline…). */
export async function fetchAmbassadorsCount(): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .not('member_number', 'is', null);
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}
