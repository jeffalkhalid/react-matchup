// components/lobby/ExploreMap.tsx — la carte des parties de l'Explorer.
//
// Une WebView Leaflet (lib/exploreMapHtml.ts) pilotée par messages, et un
// panneau DESSINÉ DANS L'ÉCRAN (pas de <Modal> native) qui liste les parties
// du repère touché. Toucher une partie ouvre sa fiche habituelle.
//
// La page n'est jamais rechargée : un changement de filtre repousse les
// repères, la carte reste là où le joueur l'a laissée.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { buildExploreMapHtml } from '../../lib/exploreMapHtml';
import { panelRows, type MapMarker } from '../../lib/mapMarkers';
import type { DistanceOf, Origin } from '../../lib/geo';

type PanelGame = Parameters<typeof panelRows>[0][number];

export function ExploreMap({ height, markers, unplaced, games, origin, radiusKm, distanceOf, onOpenGame, ready, loadFailed, onRetry, filtersActive, search = '' }: {
  height: number;
  markers: MapMarker[];
  unplaced: number;
  games: PanelGame[];
  origin: Origin | null;
  radiusKm: number | null;
  distanceOf: DistanceOf;
  onOpenGame: (id: string) => void;
  /** Le magasin des positions (zone + clubs) est prêt. */
  ready: boolean;
  /** Le dernier chargement des positions a échoué (réseau) — à réessayer. */
  loadFailed: boolean;
  onRetry: () => void;
  /** Au moins un filtre est actif : change le conseil affiché sur carte vide. */
  filtersActive: boolean;
  /** Texte de la recherche : non vide → la carte se cadre sur les résultats. */
  search?: string;
}) {
  const webref = useRef<WebView>(null);
  // Compteur incrémenté à chaque message 'ready' de la page (pas un booléen) :
  // si le moteur de la WebView redémarre (Android en tâche de fond, etc.), un
  // second 'ready' relance l'injection alors que webReady n'aurait pas bougé.
  const [generation, setGeneration] = useState(0);
  const webReady = generation > 0;
  const [tuiles, setTuiles] = useState<'inconnu' | 'ok' | 'ko'>('inconnu');
  const [selection, setSelection] = useState<string | null>(null);
  const source = useMemo(() => ({ html: buildExploreMapHtml(), baseUrl: 'https://localhost' }), []);

  const injecter = useCallback((code: string) => {
    webref.current?.injectJavaScript(`${code}; true;`);
  }, []);

  // Point de départ d'abord (la carte se centre dessus), puis les repères.
  useEffect(() => {
    if (generation === 0) return;
    injecter(`window.setOrigin && window.setOrigin(${JSON.stringify(origin)}, ${JSON.stringify(radiusKm)})`);
  }, [generation, origin, radiusKm, injecter]);

  useEffect(() => {
    if (generation === 0) return;
    injecter(`window.setMarkers && window.setMarkers(${JSON.stringify(markers)})`);
  }, [generation, markers, injecter]);

  // Recherche (club, ville, joueur) : la carte se cadre sur ce qu'elle
  // trouve, à chaque nouveau résultat. Effacée → retour au cadrage habituel.
  // Placé APRÈS l'envoi des repères : la page les connaît déjà.
  const recherche = search.trim();
  const rechercheAvant = useRef('');
  useEffect(() => {
    if (generation === 0) return;
    if (recherche) injecter('window.focusReperes && window.focusReperes()');
    else if (rechercheAvant.current) injecter('window.recadrer && window.recadrer()');
    rechercheAvant.current = recherche;
  }, [generation, markers, recherche, injecter]);

  // Un repère disparu (filtre changé) ferme son panneau.
  const repere = selection ? markers.find(m => m.key === selection) ?? null : null;
  useEffect(() => {
    if (selection && !repere) setSelection(null);
  }, [selection, repere]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    const brut = e.nativeEvent.data;
    try {
      const msg = JSON.parse(brut);
      if (msg.type === 'ready') setGeneration(g => g + 1);
      else if (msg.type === 'marker' && typeof msg.key === 'string') setSelection(msg.key);
      else if (msg.type === 'tiles') setTuiles(t => (t === 'ok' ? 'ok' : msg.ok ? 'ok' : 'ko'));
    } catch { /* message illisible : ignoré */ }
  }, []);

  // Un seul message à la fois, dans cet ordre : le chargement du magasin des
  // positions passe avant tout ; puis l'échec réseau (si aucun repère n'a pu
  // être placé) ; puis le hors ligne (fond de carte) ; puis les cas vides.
  const chargementEnCours = !webReady || !ready;
  const echecPositions = !chargementEnCours && loadFailed && markers.length === 0 && unplaced > 0;
  const horsLigne = !chargementEnCours && !echecPositions && tuiles === 'ko';
  const carteVide = !chargementEnCours && !echecPositions && !horsLigne && markers.length === 0;
  const auMoinsUneVille = markers.some(m => m.kind === 'city');

  const lignes = useMemo(
    () => (repere ? panelRows(games, repere, distanceOf) : []),
    [repere, games, distanceOf],
  );

  return (
    <View style={{ height, borderRadius: 16, overflow: 'hidden', backgroundColor: '#e9eef2', borderWidth: 1, borderColor: Colors.border }}>
      <WebView
        ref={webref}
        source={source}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        nestedScrollEnabled
        onMessage={onMessage}
        style={{ flex: 1, backgroundColor: '#e9eef2' }}
      />

      {chargementEnCours && (
        <ActivityIndicator color={Colors.primary} style={{ position: 'absolute', top: 16, alignSelf: 'center' }} />
      )}

      {echecPositions && (
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, padding: 12, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Positions des clubs indisponibles</Text>
          <TouchableOpacity onPress={onRetry} activeOpacity={0.85} style={{ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border }}>
            <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Hors ligne : la page est embarquée, mais le fond de carte vient du réseau. */}
      {horsLigne && (
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, padding: 12, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Carte indisponible hors ligne</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
            Repasse en « Liste » pour voir les parties.
          </Text>
        </View>
      )}

      {carteVide && unplaced > 0 && (
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, padding: 12, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Aucune de ces parties n'a de position connue</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
            Retrouve-les en « Liste ».
          </Text>
        </View>
      )}

      {carteVide && unplaced === 0 && (
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, padding: 12, borderRadius: 12, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Aucune partie à placer sur la carte</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
            {filtersActive ? 'Élargis tes filtres, ou repasse en « Liste ».' : 'Aucune partie ouverte pour l\'instant.'}
          </Text>
        </View>
      )}

      {/* Légende du style atténué : seulement s'il existe au moins un repère
          de ville (position approximative, plusieurs clubs regroupés), et pas
          par-dessus le bandeau hors ligne (même coin, plein largeur). */}
      {auMoinsUneVille && !horsLigne && (
        <View style={{ position: 'absolute', top: 12, right: 12, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textSecondary }}>Cercle = club au centre de sa ville</Text>
        </View>
      )}

      {unplaced > 0 && !repere && markers.length > 0 && (
        <View style={{ position: 'absolute', bottom: 12, left: 12, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border }}>
          <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            {unplaced} partie{unplaced > 1 ? 's' : ''} sans position connue
          </Text>
        </View>
      )}

      {/* Panneau du repère touché — dans l'écran, jamais une fenêtre native. */}
      {repere && (
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '60%',
          backgroundColor: Colors.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18,
          borderTopWidth: 1, borderColor: Colors.border, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 10,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{repere.label}</Text>
              <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
                {repere.kind === 'city'
                  ? `Emplacement exact inconnu · ${repere.clubs.length} club${repere.clubs.length > 1 ? 's' : ''}`
                  : `${lignes.length} partie${lignes.length > 1 ? 's' : ''}`}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setSelection(null)} hitSlop={10} accessibilityLabel="Fermer">
              <Icon name="x" size={18} color={Colors.textMuted} stroke={2.4} />
            </TouchableOpacity>
          </View>
          <ScrollView nestedScrollEnabled>
            {lignes.map(l => (
              <TouchableOpacity
                key={l.id}
                onPress={() => onOpenGame(l.id)}
                activeOpacity={0.8}
                style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{l.when}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
                    {[repere.kind === 'city' ? l.club : null, l.level ? `Niv. ${l.level}` : null, l.places, l.distance]
                      .filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Icon name="chevronRight" size={16} color={Colors.textMuted} stroke={2.4} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
