import { describe, it, expect } from 'vitest';
import { buildExploreMapHtml } from '../exploreMapHtml';

// components/lobby/ExploreMap.tsx dépend de ces noms : les changer d'un côté
// sans l'autre laisserait une carte muette, sans aucune erreur.
describe('carte de l Explorer : contrat avec l écran', () => {
  const html = buildExploreMapHtml();

  it('expose setMarkers et setOrigin', () => {
    expect(html).toContain('window.setMarkers = function(MARKERS)');
    expect(html).toContain('window.setOrigin = function(ORIGIN, RADIUS_KM)');
  });

  it('annonce ready, le toucher d un repère et l état du fond de carte', () => {
    expect(html).toContain("post({ type: 'ready' })");
    expect(html).toContain("post({ type: 'marker', key: m.key })");
    expect(html).toContain("post({ type: 'tiles', ok: true })");
    expect(html).toContain("post({ type: 'tiles', ok: false })");
  });

  it('échappe les noms de clubs avant de les écrire dans la page', () => {
    // Un nom de club contenant < ou & ne doit jamais devenir du HTML actif.
    expect(html).toContain('function esc(s)');
    expect(html).toContain('esc(m.label)');
  });

  it('les repères de ville sont atténués : nombre + nom de ville seulement (« emplacement exact inconnu » reste dans le panneau, pas dans le cercle)', () => {
    expect(html).toContain('.ville');
    expect(html).toContain("<b>' + n + '</b>");
    expect(html).not.toContain('emplacement exact inconnu');
  });

  it('recadre quand le point de départ revient ou que le rayon change', () => {
    expect(html).toContain('cadreSurDepart = false; return;');
    expect(html).toContain('!== rayonCadre');
  });
});
