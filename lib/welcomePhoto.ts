// lib/welcomePhoto.ts — l'écran « Ta photo de profil » proposé une fois, à la
// première connexion après la création du compte (demande utilisateur
// 2026-09-19). PUR ET TESTÉ (lib/__tests__/welcomePhoto.test.ts).
//
// Enchaînement du premier lancement (app/(tabs)/_layout.tsx) : visite guidée
// → écran photo → révélation « Cercle des 100 ». Un écran à la fois : la
// révélation attend que l'écran photo soit fermé (onWelcomePhotoDone).

/** Au-delà, un compte n'est plus « nouveau » : on ne relance pas les anciens. */
export const WELCOME_PHOTO_MAX_AGE_DAYS = 7;

/** Proposé une seule fois par joueur, même s'il répond « Plus tard ». */
export const WELCOME_PHOTO_SEEN_KEY = (playerId: string) => `welcome_photo_seen:${playerId}`;

export function shouldOfferWelcomePhoto(p: {
  avatarPath: string | null | undefined;
  createdAt: string | null | undefined;
  seen: boolean;
  now: number;
}): boolean {
  if (p.avatarPath || p.seen || !p.createdAt) return false;
  const cree = Date.parse(p.createdAt);
  if (Number.isNaN(cree)) return false;
  return p.now - cree <= WELCOME_PHOTO_MAX_AGE_DAYS * 86_400_000;
}

// L'écran se ferme → la suite du premier lancement peut s'afficher.
const listeners = new Set<() => void>();
export function emitWelcomePhotoDone() { listeners.forEach(l => l()); }
export function onWelcomePhotoDone(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
