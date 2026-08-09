// components/ClubsMapModal.tsx — carte des clubs présentée en Modal (WebView + Leaflet local).
// Doit être un <Modal> RN et NON une route : le wizard de création est lui-même un
// <Modal>, or un <Modal> RN flotte au-dessus de la navigation. Une route poussée
// s'ouvrirait DERRIÈRE le wizard (invisible tant qu'il est ouvert). Un Modal imbriqué,
// lui, s'empile AU-DESSUS.
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Modal } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadClubMarkers } from '../lib/clubsMap';
import { buildClubsMapHtml, type ClubMarker } from '../lib/clubsMapHtml';
import { openInMaps } from '../lib/maps';

type Sheet = { kind: 'club'; club: { name: string; partiesCount: number } }
           | { kind: 'list'; marker: ClubMarker };

export function ClubsMapModal({ visible, onClose, onPick }: {
  visible: boolean;
  onClose: () => void;
  onPick: (name: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const webref = useRef<WebView>(null);
  const [markers, setMarkers] = useState<ClubMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [webReady, setWebReady] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { setMarkers(await loadClubMarkers()); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  // Charge les clubs à chaque ouverture (comptes de parties frais).
  useEffect(() => { if (visible) load(); }, [visible, load]);

  // Pousse les marqueurs dès que le WebView est prêt ET les clubs chargés — la
  // carte + les tuiles OSM se chargent en parallèle du fetch DB.
  useEffect(() => {
    if (visible && webReady && markers.length) {
      webref.current?.injectJavaScript(
        `window.setMarkers && window.setMarkers(${JSON.stringify(markers)}); true;`,
      );
    }
  }, [visible, webReady, markers]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') { setWebReady(true); return; }
      if (msg.type === 'marker') {
        const m = markers[msg.index];
        if (!m) return;
        if (m.clubs.length === 1) setSheet({ kind: 'club', club: m.clubs[0] });
        else setSheet({ kind: 'list', marker: m });
      }
    } catch { /* ignore */ }
  }, [markers]);

  const choose = (name: string) => { onPick(name); };

  const mapSource = useMemo(
    () => ({ html: buildClubsMapHtml(), baseUrl: 'https://localhost' }),
    [],
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: '#eee' }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={{ fontSize: 16 }}>‹ Retour</Text></TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: '800' }}>Clubs sur la carte</Text>
          {loading && <ActivityIndicator size="small" style={{ marginLeft: 'auto' }} />}
        </View>

        <View style={{ flex: 1 }}>
          <WebView
            ref={webref}
            source={mapSource}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            onMessage={onMessage}
            style={{ flex: 1, backgroundColor: '#e9eef2' }}
          />

          {error && !markers.length && (
            <View style={{ position: 'absolute', bottom: 20, left: 0, right: 0, alignItems: 'center' }}>
              <TouchableOpacity onPress={load} style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#1f6feb', borderRadius: 999, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Clubs indisponibles — Réessayer</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {sheet && (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff',
            borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: insets.bottom + 16, gap: 10,
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 12, maxHeight: '60%' }}>
            <TouchableOpacity onPress={() => setSheet(null)} style={{ alignSelf: 'flex-end' }}><Text>Fermer ✕</Text></TouchableOpacity>

            {sheet.kind === 'list' && (
              <ScrollView>
                <Text style={{ fontWeight: '800', marginBottom: 6 }}>{sheet.marker.clubs.length} clubs ici</Text>
                {sheet.marker.clubs.map((c, i) => (
                  <TouchableOpacity key={i} onPress={() => setSheet({ kind: 'club', club: c })}
                    style={{ paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eee', flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontWeight: '600' }}>{c.name}</Text>
                    {c.partiesCount > 0 && <Text style={{ color: '#16a34a', fontWeight: '700' }}>{c.partiesCount} parties</Text>}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            {sheet.kind === 'club' && (
              <>
                <Text style={{ fontSize: 18, fontWeight: '800' }}>{sheet.club.name}</Text>
                {sheet.club.partiesCount > 0 && <Text style={{ color: '#16a34a', fontWeight: '700' }}>{sheet.club.partiesCount} parties ouvertes</Text>}
                <TouchableOpacity onPress={() => choose(sheet.club.name)}
                  style={{ backgroundColor: '#1f6feb', borderRadius: 12, padding: 14, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '800' }}>Choisir ce club</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => openInMaps(sheet.club.name)}
                  style={{ borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1f6feb' }}>
                  <Text style={{ color: '#1f6feb', fontWeight: '700' }}>Ouvrir dans Maps</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}
      </View>
    </Modal>
  );
}
