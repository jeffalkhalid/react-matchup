/* components/StoryComposerV2.tsx
 * Composer de partage : segmented Profil / Match / Photo + aperçu live + sélecteur de style
 * + capture 1080×1920 → partage natif. Port de l'existant components/StoryComposer.tsx.
 *
 * Dépendances : react-native-view-shot, expo-image-picker, expo-sharing,
 * expo-media-library, react-native-safe-area-context, react-native-qrcode-svg. */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Dimensions } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../lib/theme';
import StoryCardV2, { STORY_REGISTRY, StoryMode } from './story/StoryStyles';
import type { StoryPlayer, StoryMatchData, InviteData } from './story/storyTheme';

interface Props {
  visible: boolean;
  player: StoryPlayer;
  match: StoryMatchData | null;     // requis en mode "match" (via StoryMatchPicker)
  invite: InviteData;               // { cta, link, appUrl, qrValue, ... }
  onClose: () => void;
  onRequestMatch?: () => void;      // ouvre StoryMatchPicker si match manquant
  initialMode?: StoryMode;          // mode à l'ouverture (défaut: 'profil')
}

const MODES: Array<{ k: StoryMode; label: string }> = [
  { k: 'profil', label: 'Profil' }, { k: 'match', label: 'Match' }, { k: 'photo', label: 'Photo' },
];

export default function StoryComposerV2({ visible, player, match, invite, onClose, onRequestMatch, initialMode = 'profil' }: Props) {
  const insets = useSafeAreaInsets();
  const canvasRef = useRef<View>(null);
  const [mode, setMode] = useState<StoryMode>(initialMode);
  const [styleId, setStyleId] = useState(STORY_REGISTRY[initialMode][0].id);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);

  // À chaque ouverture, (ré)initialise le mode demandé.
  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setStyleId(STORY_REGISTRY[initialMode][0].id);
  }, [visible, initialMode]);

  const previewW = Math.min(Dimensions.get('window').width * 0.62, 250);
  const exportW = 1080;
  const list = STORY_REGISTRY[mode];

  const switchMode = (m: StoryMode) => {
    setMode(m);
    setStyleId(STORY_REGISTRY[m][0].id);
    if (m === 'match' && !match) onRequestMatch?.();
    if (m === 'photo' && !photoUri) choosePhotoSource();
  };

  // Laisse le choix Caméra / Galerie (au lieu d'ouvrir directement la galerie).
  const choosePhotoSource = () => {
    Alert.alert('Ajouter une photo', 'Prends une photo ou choisis-en une dans ta galerie.', [
      { text: '📸 Prendre une photo', onPress: () => pickPhoto(true) },
      { text: '🖼️ Galerie', onPress: () => pickPhoto(false) },
      { text: 'Annuler', style: 'cancel' },
    ]);
  };

  const pickPhoto = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission refusée', 'Active l’accès à la caméra/galerie.'); return; }
    const r = fromCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.85, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!r.canceled && r.assets?.[0]?.uri) setPhotoUri(r.assets[0].uri);
  };

  const capture = () => captureRef(canvasRef, { format: 'png', quality: 1, width: exportW, height: (exportW * 16) / 9, result: 'tmpfile' });

  const handleShare = async () => {
    if (busy) return; setBusy('share');
    try {
      const uri = await capture();
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager ma story' });
    } catch (e: any) { console.warn(e?.message); } finally { setBusy(null); }
  };
  const handleSave = async () => {
    if (busy) return; setBusy('save');
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission refusée', 'Active l’accès à la galerie.'); return; }
      await MediaLibrary.saveToLibraryAsync(await capture());
      Alert.alert('✅ Sauvegardé', 'Ta story est dans la galerie.');
    } catch (e: any) { Alert.alert('Erreur', e?.message ?? 'Échec.'); } finally { setBusy(null); }
  };

  const matchData: StoryMatchData = match ?? { result: 'win', sets: [], winners: [player.name], losers: ['—'] };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>
        {/* header */}
        <View style={{ paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.bgCard }}>
          <TouchableOpacity onPress={onClose} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 18, color: Colors.textSecondary }}>✕</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>📸 Ma story</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* segmented */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 12, backgroundColor: Colors.bgCard, borderBottomWidth: 1, borderBottomColor: Colors.bgCardAlt }}>
          <View style={{ flexDirection: 'row', backgroundColor: Colors.bg, borderRadius: 12, padding: 4, borderWidth: 1, borderColor: Colors.border }}>
            {MODES.map(({ k, label }) => {
              const on = mode === k;
              return (
                <TouchableOpacity key={k} onPress={() => switchMode(k)} style={{ flex: 1, paddingVertical: 9, borderRadius: 9, backgroundColor: on ? Colors.primary : 'transparent', alignItems: 'center' }}>
                  <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: on ? Colors.textOnDark : Colors.textSecondary }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* preview */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgCard }}>
          <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border }}>
            <StoryCardV2 ref={canvasRef} width={previewW} mode={mode} styleId={styleId} player={player} match={matchData} invite={invite} photoUri={photoUri} />
          </View>
        </View>

        {/* style selector */}
        <View style={{ backgroundColor: Colors.bgCard, paddingTop: 12 }}>
          <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 2, paddingHorizontal: 16, paddingBottom: 8 }}>
            STYLE{mode === 'photo' ? ' · choisis ta photo' : ''}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 14 }}>
            {mode === 'photo' && (
              <>
                <TouchableOpacity onPress={() => pickPhoto(true)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: Colors.brand, backgroundColor: 'rgba(255,193,26,0.14)' }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.brandDeep }}>📸 Caméra</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => pickPhoto(false)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: Colors.border, backgroundColor: Colors.bg }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>🖼️ Galerie</Text>
                </TouchableOpacity>
              </>
            )}
            {list.map((st) => {
              const active = st.id === styleId;
              return (
                <TouchableOpacity key={st.id} onPress={() => setStyleId(st.id)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12, borderWidth: 2, borderColor: active ? Colors.brand : Colors.border, backgroundColor: active ? 'rgba(255,193,26,0.14)' : Colors.bg }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: active ? Colors.brandDeep : Colors.textPrimary }}>{st.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* CTA */}
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: Colors.bgCardAlt }}>
          <TouchableOpacity onPress={handleSave} disabled={!!busy} style={{ flex: 1, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
            {busy === 'save' ? <ActivityIndicator color={Colors.textPrimary} /> : <Text style={{ fontSize: 15 }}>💾</Text>}
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Sauver</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} disabled={!!busy} style={{ flex: 1.4, paddingVertical: 13, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }}>
            {busy === 'share' ? <ActivityIndicator color={Colors.textOnDark} /> : <Text style={{ fontSize: 15 }}>📤</Text>}
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>Partager</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
