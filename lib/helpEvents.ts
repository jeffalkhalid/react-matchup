// Ouverture du centre d'aide à la demande, depuis n'importe où (pastille « ? »
// de HeaderActions → feuille montée dans app/(tabs)/_layout via components/HelpCenter).
// Même motif module-level que lib/tourAnchors (requestTourReplay) : pas de Context,
// l'émetteur et la feuille vivent dans des arbres différents.
const listeners = new Set<() => void>();

export function requestHelpOpen() {
  listeners.forEach(l => l());
}

export function onHelpOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
