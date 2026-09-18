// lib/exploreMapHtml.ts — la carte des parties de l'Explorer (Leaflet embarqué).
//
// Page STATIQUE : l'app pousse les repères et le point de départ par
// injectJavaScript, la page répond par postMessage. La page n'est jamais
// rechargée : changer un filtre redessine les repères, sans refaire la carte.
//
// Distincte de lib/clubsMapHtml.ts (carte de l'assistant de création) pour que
// l'assistant ne change pas d'un octet ; elle réutilise le même asset Leaflet.
// Contrat vérifié par lib/__tests__/exploreMapHtml.test.ts.
import { LEAFLET_JS, LEAFLET_CSS } from '../assets/leaflet/leaflet.bundle';

export function buildExploreMapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${LEAFLET_CSS}
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e9eef2}
    .club{display:flex;align-items:center;justify-content:center;width:32px;height:32px;
      border-radius:50% 50% 50% 0;background:#0A0A0A;transform:rotate(-45deg);
      border:2px solid #FFC11A;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .club b{transform:rotate(45deg);color:#FFC11A;font:800 12px system-ui}
    .ville{display:flex;flex-direction:column;align-items:center;justify-content:center;
      width:56px;height:56px;border-radius:50%;background:rgba(10,10,10,.35);
      border:2px dashed rgba(255,255,255,.9);color:#fff;text-align:center}
    .ville b{font:800 14px system-ui}
    .ville small{font:600 10px system-ui;opacity:.95;line-height:1.2;white-space:nowrap;
      overflow:hidden;text-overflow:ellipsis;max-width:52px}
    .gps{width:16px;height:16px;border-radius:50%;background:#1f6feb;border:3px solid #fff;
      box-shadow:0 0 0 6px rgba(31,111,235,.25)}
    .zone{width:22px;height:22px;border-radius:50% 50% 50% 0;background:#1f6feb;
      transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>${LEAFLET_JS}</script>
  <script>
    function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
    function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]; }); }

    var map = L.map('map', { zoomControl: true, attributionControl: true });
    var tuiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    var tuileOk = false, tuileKo = false;
    tuiles.on('tileload', function(){ if (!tuileOk) { tuileOk = true; post({ type: 'tiles', ok: true }); } });
    tuiles.on('tileerror', function(){ if (!tuileOk && !tuileKo) { tuileKo = true; post({ type: 'tiles', ok: false }); } });
    map.setView([31.7, -7.1], 5); // Maroc, le temps que les données arrivent

    var reperes = L.layerGroup().addTo(map);
    var depart = L.layerGroup().addTo(map);
    var cercle = null, pointDepart = null, points = [];
    var cadreSurDepart = false, cadreSurReperes = false;
    var rayonCadre = null;

    // Centrée sur le point de départ ; sinon cadrée sur les repères. Une seule
    // fois : ensuite la carte reste là où le joueur l'a laissée.
    function cadrer(){
      if (cadreSurDepart) return;
      if (pointDepart) {
        if (cercle) map.fitBounds(cercle.getBounds(), { padding: [24, 24] });
        else map.setView(pointDepart, 12);
        cadreSurDepart = true;
        return;
      }
      if (cadreSurReperes || points.length === 0) return;
      if (points.length === 1) map.setView(points[0], 13);
      else map.fitBounds(points, { padding: [40, 40] });
      cadreSurReperes = true;
    }

    window.setMarkers = function(MARKERS){
      reperes.clearLayers();
      points = [];
      MARKERS.forEach(function(m){
        var n = m.gameIds.length;
        var html = m.kind === 'club'
          ? '<div class="club" title="' + esc(m.label) + '"><b>' + n + '</b></div>'
          : '<div class="ville" title="' + esc(m.label) + '"><b>' + n + '</b><small>' + esc(m.label) + '</small></div>';
        var taille = m.kind === 'club' ? [32, 32] : [56, 56];
        var ancre = m.kind === 'club' ? [16, 32] : [28, 28];
        var icone = L.divIcon({ html: html, className: '', iconSize: taille, iconAnchor: ancre });
        L.marker([m.lat, m.lng], { icon: icone })
          .on('click', function(){ post({ type: 'marker', key: m.key }); })
          .addTo(reperes);
        points.push([m.lat, m.lng]);
      });
      cadrer();
    };

    window.setOrigin = function(ORIGIN, RADIUS_KM){
      depart.clearLayers();
      cercle = null;
      pointDepart = null;
      if (!ORIGIN) { cadreSurDepart = false; return; }
      pointDepart = [ORIGIN.lat, ORIGIN.lng];
      var classe = ORIGIN.source === 'gps' ? 'gps' : 'zone';
      var taille = ORIGIN.source === 'gps' ? [16, 16] : [22, 22];
      var ancre = ORIGIN.source === 'gps' ? [8, 8] : [11, 22];
      L.marker(pointDepart, {
        icon: L.divIcon({ html: '<div class="' + classe + '"></div>', className: '', iconSize: taille, iconAnchor: ancre }),
        interactive: false,
      }).addTo(depart);
      if (RADIUS_KM) {
        cercle = L.circle(pointDepart, {
          radius: RADIUS_KM * 1000, color: '#1f6feb', weight: 2, fillColor: '#1f6feb', fillOpacity: 0.08,
          interactive: false,
        }).addTo(depart);
      }
      if ((RADIUS_KM || null) !== rayonCadre) { cadreSurDepart = false; rayonCadre = RADIUS_KM || null; }
      cadrer();
    };

    post({ type: 'ready' });
  </script>
</body>
</html>`;
}
