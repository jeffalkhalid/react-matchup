// Charge les définitions de badges (table badge_defs) au démarrage et déclenche
// un re-render des badges quand la base répond. Les composants lisent un badge
// via le hook useBadge(key) pour rester à jour sans rechargement de l'app.
import React, { createContext, useContext, useEffect, useState } from 'react';
import { getBadge, loadBadgeDefs, type BadgeDef } from '../../lib/badges';

// La valeur = un compteur de version, incrémenté quand les defs changent.
const BadgeDefsContext = createContext(0);

export function BadgeDefsProvider({ children }: { children: React.ReactNode }) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    loadBadgeDefs().then(() => { if (active) setVersion(v => v + 1); });
    return () => { active = false; };
  }, []);
  return <BadgeDefsContext.Provider value={version}>{children}</BadgeDefsContext.Provider>;
}

/** Résout un badge et re-render quand les defs (base) sont chargées/mises à jour. */
export function useBadge(key: string): BadgeDef {
  useContext(BadgeDefsContext); // s'abonne aux changements de version
  return getBadge(key);
}
