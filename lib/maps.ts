// lib/maps.ts — ouverture du terrain d'une partie dans une appli de cartes.
import { Linking } from 'react-native';
import { supabase } from './supabase';

type Coords = { lat: number; lng: number };
let clubCache: Map<string, Coords> | null = null;
let loading: Promise<Map<string, Coords>> | null = null;

const norm = (s: string) => s.trim().toLowerCase();

async function loadClubCoords(): Promise<Map<string, Coords>> {
  if (clubCache) return clubCache;
  if (!loading) {
    loading = (async () => {
      const map = new Map<string, Coords>();
      // On ne fait confiance qu'aux coords précises ('exact', et les corrections
      // manuelles passées en 'exact'). Les clubs 'city' (centre-ville approximatif)
      // retombent volontairement sur la recherche texte par nom, que Google résout
      // mieux qu'un faux repère au centre-ville.
      const { data, error } = await supabase
        .from('clubs')
        .select('name, latitude, longitude')
        .eq('geo_confidence', 'exact')
        .not('latitude', 'is', null);
      if (error) { loading = null; return map; } // n'empoisonne pas le cache : on réessaiera au prochain appel
      for (const c of data ?? []) {
        if (c.name && c.latitude != null && c.longitude != null) {
          map.set(norm(c.name), { lat: c.latitude as number, lng: c.longitude as number });
        }
      }
      clubCache = map;
      return map;
    })();
  }
  return loading;
}

export function hasMapTarget(location: string | null | undefined): boolean {
  return !!location && location.trim().length > 0;
}

export async function openInMaps(location: string | null | undefined): Promise<void> {
  if (!hasMapTarget(location)) return;
  const loc = (location as string).trim();
  const cache = await loadClubCoords();
  const coords = cache.get(norm(loc));
  const query = coords ? `${coords.lat},${coords.lng}` : `${loc}, Maroc`;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  await Linking.openURL(url).catch(() => {});
}
