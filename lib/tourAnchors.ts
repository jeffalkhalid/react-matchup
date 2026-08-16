// Registre des ANCRES de la visite guidée (onboarding spotlight).
// Les vrais écrans enregistrent leurs éléments clés sous un nom stable ;
// l'overlay GuidedTour les mesure (measureInWindow) pour placer le spotlight.
// Registre module-level (pas de Context) : les ancres vivent sur des écrans
// différents (Accueil, Lobby, tab bar) et l'overlay est monté ailleurs.
import { useSyncExternalStore } from 'react';
import type { View } from 'react-native';

export type TourAnchorName =
  | 'home-profile'   // Accueil · carte profil (niveau)
  | 'home-ctas'      // Accueil · les 2 CTA (Trouver un match / Match Défi)
  | 'lobby-card'     // Lobby · 1ʳᵉ carte de partie
  | 'lobby-slot'     // Lobby · 1ᵉʳ emplacement libre de la 1ʳᵉ carte
  | 'tab-create'     // Tab bar · bouton ⊕ Créer
  | 'bell-lobby';    // Lobby · cloche de notifications

type AnchorListener = (name: TourAnchorName) => void;

const anchors = new Map<TourAnchorName, View>();
const anchorListeners = new Set<AnchorListener>();

// À passer en callback `ref` (avec collapsable={false} sur les View pures).
// `null` au démontage → désenregistre.
export function registerTourAnchor(name: TourAnchorName, view: View | null) {
  if (view) {
    anchors.set(name, view);
    anchorListeners.forEach(l => l(name));
  } else if (anchors.get(name)) {
    anchors.delete(name);
  }
}

export function getTourAnchor(name: TourAnchorName): View | null {
  return anchors.get(name) ?? null;
}

// Notifie l'overlay quand une ancre (ré)apparaît — ex. cartes du lobby rendues
// après le fetch. Retourne la fonction de désabonnement.
export function onTourAnchorChange(listener: AnchorListener): () => void {
  anchorListeners.add(listener);
  return () => { anchorListeners.delete(listener); };
}

// ── Infos de contexte partagées entre la visite guidée et les écrans ─────────
// Ex. 'tour-active' : true tant que la visite est montée — le lobby s'en sert
// pour afficher une carte d'EXEMPLE quand il n'a aucune partie réelle, afin que
// les étapes « rejoindre » aient toujours une cible.
const infos = new Map<string, unknown>();
const infoListeners = new Set<(key: string) => void>();

export function setTourInfo(key: string, value: unknown) {
  if (infos.get(key) === value) return;
  if (value === undefined) infos.delete(key);
  else infos.set(key, value);
  infoListeners.forEach(l => l(key));
}

export function getTourInfo(key: string): unknown {
  return infos.get(key);
}

export function onTourInfoChange(listener: (key: string) => void): () => void {
  infoListeners.add(listener);
  return () => { infoListeners.delete(listener); };
}

// Version hook (re-render à chaque changement de la clé) — pour les écrans.
export function useTourInfo(key: string): unknown {
  return useSyncExternalStore(
    (onChange) => onTourInfoChange((k) => { if (k === key) onChange(); }),
    () => infos.get(key),
  );
}

// ── Rejouer la visite à la demande (guide « ? » → « Revoir la visite guidée ») ──
const replayListeners = new Set<() => void>();

export function requestTourReplay() {
  replayListeners.forEach(l => l());
}

export function onTourReplay(listener: () => void): () => void {
  replayListeners.add(listener);
  return () => { replayListeners.delete(listener); };
}
