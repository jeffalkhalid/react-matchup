// lib/clubsMapHtml.ts — génère le HTML Leaflet (asset local) pour la carte des clubs.
import { LEAFLET_JS, LEAFLET_CSS } from '../assets/leaflet/leaflet.bundle';

export type ClubMarker = {
  lat: number;
  lng: number;
  clubs: { name: string; partiesCount: number }[];
  partiesCount: number; // somme des partie ouvertes des clubs de cette position
};

// HTML STATIQUE : la carte + les tuiles se chargent immédiatement (sans attendre
// la requête DB des clubs). Les marqueurs sont poussés APRÈS via `window.setMarkers`
// (injectJavaScript côté RN), donc le WebView ne se recharge jamais → tuiles
// téléchargées une seule fois, en parallèle du fetch des clubs.
export function buildClubsMapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${LEAFLET_CSS}
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e9eef2}
    .pin{display:flex;align-items:center;justify-content:center;width:30px;height:30px;
      border-radius:50% 50% 50% 0;background:#1f6feb;transform:rotate(-45deg);
      border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}
    .pin b{transform:rotate(45deg);color:#fff;font:700 12px system-ui}
    .pin.multi{background:#0b3d91}
    .games{position:absolute;top:-4px;right:-4px;min-width:14px;height:14px;border-radius:7px;
      background:#22c55e;border:1.5px solid #fff;color:#fff;font:700 9px system-ui;
      display:flex;align-items:center;justify-content:center;padding:0 2px}
  </style>
</head>
<body>
  <div id="map"></div>
  <script>${LEAFLET_JS}</script>
  <script>
    function post(o){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
    var map = L.map('map', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    map.setView([31.7, -7.1], 5); // Maroc par défaut — affiché tout de suite
    var markerLayer = L.layerGroup().addTo(map);

    // Appelé par RN via injectJavaScript une fois les clubs chargés.
    window.setMarkers = function(MARKERS){
      markerLayer.clearLayers();
      var pts = [];
      MARKERS.forEach(function(m, i){
        var multi = m.clubs.length > 1;
        var games = m.partiesCount > 0
          ? '<span class="games">' + m.partiesCount + '</span>' : '';
        var html = '<div style="position:relative">'
          + '<div class="pin' + (multi ? ' multi' : '') + '"><b>' + (multi ? m.clubs.length : '') + '</b></div>'
          + games + '</div>';
        var icon = L.divIcon({ html: html, className: '', iconSize: [30,30], iconAnchor: [15,30] });
        L.marker([m.lat, m.lng], { icon: icon })
          .on('click', function(){ post({ type:'marker', index: i }); })
          .addTo(markerLayer);
        pts.push([m.lat, m.lng]);
      });
      if (pts.length === 1) map.setView(pts[0], 13);
      else if (pts.length > 1) map.fitBounds(pts, { padding: [40,40] });
    };

    // Signale à RN que la carte est prête à recevoir les marqueurs.
    post({ type: 'ready' });
  </script>
</body>
</html>`;
}
