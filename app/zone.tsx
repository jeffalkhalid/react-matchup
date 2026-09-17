// app/zone.tsx — « Ma zone » : un point sur la carte et un rayon.
//
// Sert de point de départ aux distances quand le GPS est refusé, absent ou
// trop lent. Le point est arrondi (~500 m) avant d'être enregistré, et reste
// visible du joueur seul (supabase/migrations/player_zones.sql).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Colors, Fonts } from '../lib/theme';
import { Icon } from '../components/community/icons';
import { useOrigin } from '../hooks/useOrigin';
import { buildZoneMapHtml } from '../lib/zoneMapHtml';
import { initialZoneCenter, ZONE_RADII_KM, DEFAULT_RADIUS_KM, type LatLng } from '../lib/geo';

export default function ZoneScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { ready, zone, zoneAvailable, gps, gpsAvailable, requestGps, saveZone, removeZone } = useOrigin();

  const webref = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(zone?.radiusKm ?? DEFAULT_RADIUS_KM);
  const [busy, setBusy] = useState<null | 'gps' | 'save' | 'delete'>(null);
  const source = useMemo(() => ({ html: buildZoneMapHtml(), baseUrl: 'https://localhost' }), []);

  // Première position de l'épingle : la zone enregistrée, sinon la position
  // connue, sinon Casablanca.
  useEffect(() => {
    if (!ready || point) return;
    setPoint(initialZoneCenter(zone, gps));
    if (zone) setRadiusKm(zone.radiusKm);
  }, [ready, zone, gps, point]);

  const pousser = useCallback((p: LatLng, r: number, recentrer: boolean) => {
    webref.current?.injectJavaScript(
      `window.setZone && window.setZone(${p.lat}, ${p.lng}, ${r}, ${recentrer}); true;`,
    );
  }, []);

  const posee = useRef(false);
  useEffect(() => {
    if (webReady && point && !posee.current) {
      posee.current = true;
      pousser(point, radiusKm, true);
    }
  }, [webReady, point, radiusKm, pousser]);

  const onMessage = useCallback((e: WebViewMessageEvent) => {
    const brut = e.nativeEvent.data;
    try {
      const msg = JSON.parse(brut);
      if (msg.type === 'ready') setWebReady(true);
      if (msg.type === 'moved' && Number.isFinite(msg.lat) && Number.isFinite(msg.lng)) {
        setPoint({ lat: msg.lat, lng: msg.lng });
      }
    } catch { /* message illisible : ignoré */ }
  }, []);

  const choisirRayon = (r: number) => {
    setRadiusKm(r);
    if (point) pousser(point, r, true);
  };

  const placerSurMaPosition = async () => {
    setBusy('gps');
    try {
      const fix = await requestGps();
      if (!fix) {
        Alert.alert('Position indisponible', "Autorise la localisation dans les réglages du téléphone, ou place l'épingle à la main.");
        return;
      }
      const p = { lat: fix.lat, lng: fix.lng };
      setPoint(p);
      pousser(p, radiusKm, true);
    } finally {
      setBusy(null);
    }
  };

  const enregistrer = async () => {
    if (!point) return;
    setBusy('save');
    try {
      await saveZone({ lat: point.lat, lng: point.lng, radiusKm });
      router.back();
    } catch {
      Alert.alert('Zone non enregistrée', "Ta zone n'a pas pu être enregistrée. Ton ancienne zone est conservée. Vérifie ta connexion et réessaie.");
    } finally {
      setBusy(null);
    }
  };

  const supprimer = () => {
    Alert.alert('Supprimer ma zone ?', 'Les distances ne seront plus calculées depuis cette zone.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await removeZone();
            router.back();
          } catch {
            Alert.alert('Zone non supprimée', "Ta zone n'a pas pu être supprimée. Vérifie ta connexion et réessaie.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: insets.top + 8, paddingHorizontal: 14, paddingBottom: 12 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} accessibilityLabel="Retour">
          <Icon name="chevronLeft" size={24} color={Colors.textPrimary} stroke={2.4} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Ma zone</Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
            Place l'épingle là où tu joues d'habitude.
          </Text>
        </View>
      </View>

      {!zoneAvailable ? (
        <Text style={{ margin: 18, fontSize: 13, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 19 }}>
          Les zones ne sont pas encore disponibles. Réessaie un peu plus tard.
        </Text>
      ) : (
        <>
          <View style={{ flex: 1 }}>
            <WebView
              ref={webref}
              source={source}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              onMessage={onMessage}
              style={{ flex: 1, backgroundColor: '#e9eef2' }}
            />
            {!webReady && (
              <ActivityIndicator color={Colors.primary} style={{ position: 'absolute', top: 20, alignSelf: 'center' }} />
            )}
          </View>

          <View style={{ padding: 16, paddingBottom: insets.bottom + 16, gap: 12, backgroundColor: Colors.bg }}>
            <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Rayon</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {ZONE_RADII_KM.map(r => {
                const on = r === radiusKm;
                return (
                  <TouchableOpacity
                    key={r}
                    onPress={() => choisirRayon(r)}
                    activeOpacity={0.8}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12,
                      backgroundColor: on ? Colors.primary : Colors.bgCard,
                      borderWidth: 1, borderColor: on ? Colors.primary : Colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: on ? Colors.textOnDark : Colors.textSecondary }}>
                      {r} km
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {gpsAvailable && (
              <TouchableOpacity
                onPress={placerSurMaPosition}
                disabled={busy !== null}
                activeOpacity={0.85}
                style={{
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.bgCard,
                  borderWidth: 1, borderColor: Colors.border, opacity: busy && busy !== 'gps' ? 0.5 : 1,
                }}
              >
                {busy === 'gps'
                  ? <ActivityIndicator color={Colors.textPrimary} />
                  : <>
                      <Icon name="radar" size={15} color={Colors.textPrimary} stroke={2.3} />
                      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Placer l'épingle sur ma position</Text>
                    </>}
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={enregistrer}
              disabled={!point || busy !== null}
              activeOpacity={0.85}
              style={{
                alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12,
                backgroundColor: Colors.brand, opacity: !point || (busy && busy !== 'save') ? 0.5 : 1,
              }}
            >
              {busy === 'save'
                ? <ActivityIndicator color={Colors.textOnBrand} />
                : <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnBrand }}>Enregistrer ma zone</Text>}
            </TouchableOpacity>

            {zone && (
              <TouchableOpacity onPress={supprimer} disabled={busy !== null} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: 4 }}>
                <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiExtraBold, color: Colors.danger }}>Supprimer ma zone</Text>
              </TouchableOpacity>
            )}

            <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted, lineHeight: 16 }}>
              Ta zone est arrondie à environ 500 m et reste visible de toi seul.
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
