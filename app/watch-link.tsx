// Écran « Connecter ma montre » : génère un code à 6 chiffres valable 5 min,
// et liste les montres déjà liées (avec possibilité de les délier).
import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts, FontSize, Radius, Spacing } from '../lib/theme';
import { createPairingCode, listWatchLinks, revokeWatchLink, formatCode, type WatchLink } from '../lib/watchLink';

const VALIDITY_MS = 5 * 60 * 1000;

export default function WatchLinkScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState<string | null>(null);
  const [codeAt, setCodeAt] = useState<number>(0);
  const [links, setLinks] = useState<WatchLink[]>([]);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const reload = useCallback(async () => {
    try { setLinks(await listWatchLinks()); } catch { /* liste non bloquante */ }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Tick seconde : fait vivre le compte à rebours de validité du code.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [code]);

  const remaining = code ? Math.max(0, VALIDITY_MS - (Date.now() - codeAt)) : 0;
  const expired = !!code && remaining === 0;

  const onGenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const c = await createPairingCode();
      setCode(c);
      setCodeAt(Date.now());
    } catch (e: any) {
      Alert.alert('Erreur', String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const onRevoke = (l: WatchLink) => {
    Alert.alert('Délier cette montre ?', 'Elle ne pourra plus marquer de points tant que tu ne la reconnecteras pas.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Délier', style: 'destructive',
        onPress: async () => {
          try { await revokeWatchLink(l.id); await reload(); }
          catch (e: any) { Alert.alert('Erreur', String(e?.message ?? e)); }
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.75}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: Colors.textPrimary }}>‹</Text>
        </TouchableOpacity>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{ flex: 1, fontFamily: Fonts.uiBlack, fontSize: 17, color: Colors.textPrimary, paddingRight: 6 }}>
          Connecter ma montre
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + 40, gap: Spacing.md }}>
        <Text style={{ fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 }}>
          Ouvre PagMatch sur ta montre, puis saisis le code ci-dessous. Une seule fois :
          ensuite ta montre retrouvera tes matchs toute seule.
        </Text>

        <View style={{ backgroundColor: Colors.bgCard, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm }}>
          {code && !expired ? (
            <>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 40, letterSpacing: 4, color: Colors.textPrimary }}>
                {formatCode(code)}
              </Text>
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>
                Valable encore {Math.ceil(remaining / 1000)} s
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' }}>
              {expired ? 'Code expiré — génères-en un nouveau.' : 'Aucun code en cours.'}
            </Text>
          )}
          <TouchableOpacity onPress={onGenerate} disabled={busy} activeOpacity={0.85}
            style={{ backgroundColor: Colors.brand, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: Spacing.lg, opacity: busy ? 0.6 : 1 }}>
            {busy
              ? <ActivityIndicator color={Colors.textOnBrand} size="small" />
              : <Text style={{ fontFamily: Fonts.uiBlack, fontSize: FontSize.sm, color: Colors.textOnBrand }}>
                  {code ? 'Générer un nouveau code' : 'Générer un code'}
                </Text>}
          </TouchableOpacity>
        </View>

        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: FontSize.sm, color: Colors.textPrimary }}>
          Montres connectées
        </Text>
        {links.length === 0 ? (
          <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>Aucune montre pour l'instant.</Text>
        ) : links.map(l => (
          <View key={l.id} style={{ backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: FontSize.sm, fontWeight: '800', color: Colors.textPrimary }}>
                {l.device_label ?? 'Montre'}
              </Text>
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>
                {l.last_seen_at ? `Vue le ${new Date(l.last_seen_at).toLocaleDateString('fr-FR')}` : 'Jamais utilisée'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => onRevoke(l)} activeOpacity={0.75}>
              <Text style={{ fontSize: FontSize.xs, fontWeight: '900', color: Colors.danger }}>Délier</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
