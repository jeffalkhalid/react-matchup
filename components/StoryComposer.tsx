import { useRef, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView, Alert, Pressable, ActivityIndicator,
  Dimensions, Platform,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../lib/theme';
import StoryCanvas, { type StoryMatch, type ThemeKey, type BgMode, type Layout } from './StoryCanvas';

interface Props {
  visible: boolean;
  match: StoryMatch | null;
  onClose: () => void;
}

const THEME_DOTS: Array<{ key: ThemeKey; label: string; color: string }> = [
  { key: 'midnight', label: 'Midnight', color: '#818cf8' },
  { key: 'ember',    label: 'Ember',    color: '#fb923c' },
  { key: 'brand',    label: 'Brand',    color: '#FFC11A' },
  { key: 'court',    label: 'Court',    color: '#34d399' },
  { key: 'mono',     label: 'Mono',     color: '#ffffff' },
];

const BG_TEMPLATES: Array<{ key: Exclude<BgMode, object>; label: string; emoji: string }> = [
  { key: 'court',  label: 'Court',   emoji: '🟩' },
  { key: 'sombre', label: 'Sombre',  emoji: '🌃' },
  { key: 'brand',  label: 'Brand',   emoji: '🟨' },
  { key: 'amical', label: 'Amical',  emoji: '🟢' },
];

const LAYOUTS: Array<{ key: Layout; label: string }> = [
  { key: 'hero',    label: 'Hero score' },
  { key: 'players', label: 'Joueurs' },
  { key: 'stats',   label: 'Stats' },
];

export default function StoryComposer({ visible, match, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const canvasRef = useRef<View>(null);
  const [bg, setBg] = useState<BgMode>('court');
  const [themeKey, setThemeKey] = useState<ThemeKey>('midnight');
  const [layout, setLayout] = useState<Layout>('hero');
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);

  const screenW = Dimensions.get('window').width;
  const previewW = Math.min(screenW * 0.55, 240);
  const exportW = 1080; // résolution finale

  if (!match) return null;

  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission refusée', `Active l'accès à ${fromCamera ? 'la caméra' : 'la galerie'} dans les réglages.`);
      return;
    }
    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: false, aspect: [9, 16], quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ allowsEditing: false, aspect: [9, 16], quality: 0.8, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    setBg({ photo: result.assets[0].uri });
  };

  const capture = async (): Promise<string> => {
    if (!canvasRef.current) throw new Error('Canvas non prêt');
    const uri = await captureRef(canvasRef, {
      format: 'png',
      quality: 1,
      width: exportW,
      height: (exportW * 16) / 9,
      result: 'tmpfile',
    });
    return uri;
  };

  const handleShare = async () => {
    if (busy) return;
    setBusy('share');
    try {
      const uri = await capture();
      const can = await Sharing.isAvailableAsync();
      if (!can) {
        Alert.alert('Partage indisponible', 'Ton OS ne propose pas le partage natif.');
        return;
      }
      await Sharing.shareAsync(uri, { dialogTitle: 'Partager ta story Padel', mimeType: 'image/png' });
    } catch (e: any) {
      console.warn('share failed', e?.message);
    } finally {
      setBusy(null);
    }
  };

  const handleSave = async () => {
    if (busy) return;
    setBusy('save');
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission refusée', "Active l'accès à la galerie pour sauvegarder l'image.");
        return;
      }
      const uri = await capture();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('✅ Sauvegardé', 'Ta story est dans la galerie.');
    } catch (e: any) {
      Alert.alert('Erreur', e?.message ?? 'Sauvegarde échouée.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>
        {/* Header */}
        <View style={{
          paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 12,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt,
        }}>
          <TouchableOpacity onPress={onClose} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 18, color: Colors.textSecondary }}>✕</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>📸 Story Padel</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}>
          {/* Preview live */}
          <View style={{ alignItems: 'center', paddingVertical: 18, backgroundColor: Colors.bgCard }}>
            <View
              style={{
                width: previewW,
                aspectRatio: 9 / 16,
                borderRadius: 16,
                overflow: 'hidden',
                borderWidth: 1, borderColor: Colors.border,
                shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
              }}
            >
              <StoryCanvas
                ref={canvasRef}
                match={match}
                bg={bg}
                themeKey={themeKey}
                layout={layout}
                width={previewW}
              />
            </View>
          </View>

          {/* FOND */}
          <Section title="FOND">
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              <ActionPill icon="📸" label="Photo" onPress={() => pickPhoto(true)} />
              <ActionPill icon="🖼️" label="Galerie" onPress={() => pickPhoto(false)} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {BG_TEMPLATES.map(tpl => {
                const active = typeof bg === 'string' && bg === tpl.key;
                return (
                  <TouchableOpacity
                    key={tpl.key}
                    onPress={() => setBg(tpl.key)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                      borderWidth: 2, borderColor: active ? Colors.brand : Colors.border,
                      backgroundColor: active ? 'rgba(255,193,26,0.14)' : Colors.bg,
                    }}
                  >
                    <Text style={{ fontSize: 14 }}>{tpl.emoji}</Text>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: active ? Colors.brandDeep : Colors.textSecondary }}>
                      {tpl.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {typeof bg === 'object' && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                  borderWidth: 2, borderColor: Colors.success,
                  backgroundColor: 'rgba(16,185,129,0.10)',
                }}>
                  <Text style={{ fontSize: 14 }}>✅</Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: Colors.success }}>Photo</Text>
                </View>
              )}
            </View>
          </Section>

          {/* THÈME */}
          <Section title="THÈME ACCENT">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {THEME_DOTS.map(t => {
                const active = themeKey === t.key;
                return (
                  <TouchableOpacity
                    key={t.key}
                    onPress={() => setThemeKey(t.key)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                      borderWidth: 2, borderColor: active ? t.color : Colors.border,
                      backgroundColor: active ? t.color + '22' : Colors.bg,
                    }}
                  >
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.color, borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' }} />
                    <Text style={{ fontSize: 12, fontWeight: '800', color: active ? Colors.textPrimary : Colors.textSecondary }}>
                      {t.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>

          {/* LAYOUT */}
          <Section title="LAYOUT">
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {LAYOUTS.map(l => {
                const active = layout === l.key;
                return (
                  <TouchableOpacity
                    key={l.key}
                    onPress={() => setLayout(l.key)}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 12,
                      borderWidth: 2, borderColor: active ? Colors.brand : Colors.border,
                      backgroundColor: active ? 'rgba(255,193,26,0.14)' : Colors.bg,
                      alignItems: 'center',
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '800', color: active ? Colors.brandDeep : Colors.textSecondary }}>
                      {l.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Section>
        </ScrollView>

        {/* CTA bottom */}
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12,
          flexDirection: 'row', gap: 10,
          backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: Colors.bgCardAlt,
        }}>
          <TouchableOpacity
            onPress={handleSave}
            disabled={busy !== null}
            style={{
              flex: 1, paddingVertical: 13, borderRadius: 14,
              borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bg,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
              opacity: busy !== null ? 0.6 : 1,
            }}
          >
            {busy === 'save' ? <ActivityIndicator color={Colors.textPrimary} /> : <Text style={{ fontSize: 15 }}>💾</Text>}
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Sauver</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShare}
            disabled={busy !== null}
            style={{
              flex: 1.4, paddingVertical: 13, borderRadius: 14, backgroundColor: Colors.primary,
              alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6,
              shadowColor: Colors.primary, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5,
              opacity: busy !== null ? 0.6 : 1,
            }}
          >
            {busy === 'share' ? <ActivityIndicator color={Colors.textOnDark} /> : <Text style={{ fontSize: 15 }}>📤</Text>}
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>Partager</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Sous-composants ──────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt }}>
      <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 2, marginBottom: 10 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function ActionPill({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
        paddingVertical: 11, borderRadius: 12,
        backgroundColor: Colors.bgCardAlt, borderWidth: 1, borderColor: Colors.border,
      }}
    >
      <Text style={{ fontSize: 16 }}>{icon}</Text>
      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{label}</Text>
    </TouchableOpacity>
  );
}
