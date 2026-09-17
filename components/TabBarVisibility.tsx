// components/TabBarVisibility.tsx — masquer la barre d'onglets depuis un écran.
//
// La fiche d'une partie était une fenêtre modale NATIVE (<Modal>). Sur iPhone,
// cette fenêtre disparaissait juste après s'être affichée, alors que l'app la
// croyait toujours ouverte : invisible, elle continuait d'avaler les touches et
// l'écran paraissait figé (constaté le 2026-09-17 grâce à un repère à l'écran :
// fiche « ouverte » pour l'app, absente à l'écran).
//
// La fiche est donc dessinée DANS l'écran, en calque plein écran. Un calque ne
// peut pas passer par-dessus la barre d'onglets, qui vit à côté des écrans :
// c'est la mise en page des onglets qui la masque, sur demande.
import { createContext, useContext, useEffect } from 'react';

export const TabBarHiddenContext = createContext<(hidden: boolean) => void>(() => {});

/** Masque la barre d'onglets tant que `hidden` est vrai ; la rétablit au démontage. */
export function useHideTabBar(hidden: boolean): void {
  const setHidden = useContext(TabBarHiddenContext);
  useEffect(() => {
    setHidden(hidden);
    return () => setHidden(false);
  }, [hidden, setHidden]);
}
