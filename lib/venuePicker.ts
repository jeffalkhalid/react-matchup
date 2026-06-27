// lib/venuePicker.ts — passe le club choisi sur la carte au CreateWizard,
// sans param de navigation (router.back() ne porte pas de valeur) et sans
// remonter le wizard (son state de formulaire est préservé).
let pendingVenue: string | null = null;

export function setPickedVenue(name: string): void {
  pendingVenue = name;
}

/** Lit la sélection en attente puis l'efface (consommation one-shot). */
export function consumePickedVenue(): string | null {
  const v = pendingVenue;
  pendingVenue = null;
  return v;
}
