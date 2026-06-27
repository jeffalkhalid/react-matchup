// app/clubs-map.tsx — carte plein écran des clubs (WebView + Leaflet local).
import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { loadClubMarkers } from '../lib/clubsMap';
import { buildClubsMapHtml, type ClubMarker } from '../lib/clubsMapHtml';
import { setPickedVenue } from '../lib/venuePicker';
import { openInMaps } from '../lib/maps';

type Sheet = { kind: 'club'; club: { name: string; partiesCount: number } }
           | { kind: 'list'; marker: ClubMarker };

export default function ClubsMapScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [markers, setMarkers] = useState<ClubMarker[]>([]);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try { setMarkers(await loadClubMarkers()); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'marker') {
        const m = markers[msg.index];
        if (!m) return;
        if (m.clubs.length === 1) setSheet({ kind: 'club', club: m.clubs[0] });
        else setSheet({ kind: 'list', marker: m });
      }
    } catch { /* ignore */ }
  }, [markers]);

  const choose = (name: string) => { setPickedVenue(name); router.back(); };

  // Source stable : ne se recalcule QUE si markers change. Sinon chaque setSheet
  // recréerait le HTML → react-native-webview rechargerait la carte (flicker + reset).
  const mapSource = useMemo(
    () => ({ html: buildClubsMapHtml(markers), baseUrl: 'https://localhost' }),
    [markers],
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
        <TouchableOpacity onPress={() => router.back()}><Text style={{ fontSize: 16 }}>‹ Retour</Text></TouchableOpacity>
        <Text style={{ fontSize: 16, fontWeight: '800' }}>Clubs sur la carte</Text>
      </View>

      {loading && <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View>}

      {!loading && error && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
          <Text style={{ textAlign: 'center', color: '#444' }}>Carte indisponible — vérifie ta connexion.</Text>
          <TouchableOpacity onPress={load} style={{ paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#1f6feb', borderRadius: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && (
        <WebView
          source={mapSource}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          onMessage={onMessage}
          onError={() => setError(true)}
          style={{ flex: 1 }}
        />
      )}

      {sheet && (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff',
          borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 10,
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
  );
}
