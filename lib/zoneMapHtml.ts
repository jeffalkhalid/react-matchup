// lib/zoneMapHtml.ts — carte Leaflet (asset local) pour placer sa zone.
//
// Même principe que lib/clubsMapHtml.ts : page statique, l'écran pousse la
// zone par injectJavaScript et reçoit les déplacements par postMessage.
// Contrat vérifié par lib/__tests__/zoneMapHtml.test.ts.
import { LEAFLET_JS, LEAFLET_CSS } from '../assets/leaflet/leaflet.bundle';

export function buildZoneMapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>${LEAFLET_CSS}
    html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#e9eef2}
    .pin{width:26px;height:26px;border-radius:50% 50% 50% 0;background:#0A0A0A;
      transform:rotate(-45deg);border:3px solid #FFC11A;box-shadow:0 1px 4px rgba(0,0,0,.4)}
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
    map.setView([33.5731, -7.5898], 11);
    var icon = L.divIcon({ html: '<div class="pin"></div>', className: '', iconSize: [26,26], iconAnchor: [13,26] });
    var pin = null, cercle = null;

    function envoyer(){ var p = pin.getLatLng(); post({ type: 'moved', lat: p.lat, lng: p.lng }); }

    window.setZone = function(lat, lng, radiusKm, recentrer){
      if (!pin) {
        pin = L.marker([lat, lng], { icon: icon, draggable: true }).addTo(map);
        cercle = L.circle([lat, lng], {
          radius: radiusKm * 1000, color: '#0A0A0A', weight: 2, fillColor: '#FFC11A', fillOpacity: 0.15
        }).addTo(map);
        pin.on('drag', function(){ cercle.setLatLng(pin.getLatLng()); });
        pin.on('dragend', envoyer);
      } else {
        pin.setLatLng([lat, lng]);
        cercle.setLatLng([lat, lng]);
        cercle.setRadius(radiusKm * 1000);
      }
      if (recentrer) map.fitBounds(cercle.getBounds(), { padding: [24, 24] });
    };

    // Toucher la carte déplace l'épingle : plus simple que de la faire glisser.
    map.on('click', function(e){
      if (!pin) return;
      pin.setLatLng(e.latlng);
      cercle.setLatLng(e.latlng);
      envoyer();
    });

    post({ type: 'ready' });
  </script>
</body>
</html>`;
}
