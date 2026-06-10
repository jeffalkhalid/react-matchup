// Bus d'événements ultra-léger pour la bannière de notification in-app.
// Le realtime (NotificationProvider) émet un BannerItem ; <InAppBanner/> monté à
// la racine l'affiche. Pas de dépendance externe, pas de contexte : un simple
// set de listeners, suffisant pour un signal éphémère « par-dessus tout ».

export interface BannerItem {
  /** Clé de déduplication — évite d'empiler deux fois le même événement. */
  id: string;
  emoji: string;
  title: string;
  body: string;
  /** Cible de navigation au tap (route expo-router). */
  route: string;
}

type Listener = (b: BannerItem) => void;

const listeners = new Set<Listener>();

export function showBanner(banner: BannerItem) {
  listeners.forEach(l => l(banner));
}

export function onBanner(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
