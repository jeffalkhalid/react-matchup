import { describe, it, expect } from 'vitest';
import { buildZoneMapHtml } from '../zoneMapHtml';

// L'écran app/zone.tsx dépend de ces noms : les changer d'un côté sans l'autre
// laisserait une carte muette, sans aucune erreur.
describe('carte de zone : contrat avec l écran', () => {
  const html = buildZoneMapHtml();
  it('expose setZone et annonce ready / moved', () => {
    expect(html).toContain('window.setZone = function(lat, lng, radiusKm, recentrer)');
    expect(html).toContain("post({ type: 'ready' })");
    expect(html).toContain("post({ type: 'moved', lat: p.lat, lng: p.lng })");
  });
  it('épingle déplaçable et cercle du rayon', () => {
    expect(html).toContain('draggable: true');
    expect(html).toContain('L.circle(');
  });
});
