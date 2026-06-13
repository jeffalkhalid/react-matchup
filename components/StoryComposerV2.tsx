/* components/StoryComposerV2.tsx
 * Composer de partage : segmented Profil / Match / Photo + aperçu live + sélecteur de style
 * + capture 1080×1920 → partage natif. Port de l'existant components/StoryComposer.tsx.
 *
 * Dépendances : react-native-view-shot, expo-image-picker, expo-sharing,
 * expo-media-library, react-native-safe-area-context, react-native-qrcode-svg. */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Dimensions, TextInput } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../lib/theme';
import StoryCardV2, { STORY_REGISTRY, StoryMode } from './story/StoryStyles';
import type { StoryPlayer, StoryMatchData, InviteData, StoryToggles, StoryMatchOpts } from './story/storyTheme';
import { STORY_ACCENTS, DEFAULT_TOGGLES } from './story/storyTheme';

interface Props {
  visible: boolean;
  player: StoryPlayer;
  match: StoryMatchData | null;     // requis en mode "match" (via StoryMatchPicker)
  invite: InviteData;               // { cta, link, appUrl, qrValue, ... }
  onClose: () => void;
  onRequestMatch?: () => void;      // ouvre StoryMatchPicker si match manquant
  initialMode?: StoryMode;          // mode à l'ouverture (défaut: 'profil')
  lockMode?: boolean;               // verrouille sur initialMode (masque le sélecteur Profil/Match/Photo)
}

const MODES: Array<{ k: StoryMode; label: string }> = [
  { k: 'profil', label: 'Profil' }, { k: 'match', label: 'Match' }, { k: 'photo', label: 'Photo' },
];

export default function StoryComposerV2({ visible, player, match, invite, onClose, onRequestMatch, initialMode = 'profil', lockMode = false }: Props) {
  const insets = useSafeAreaInsets();
  const canvasRef = useRef<View>(null);
  const exportRef = useRef<View>(null); // carte rendue à 1080px (hors-écran) → capture nette
  const [mode, setMode] = useState<StoryMode>(initialMode);
  const [styleId, setStyleId] = useState(STORY_REGISTRY[initialMode][0].id);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState<'share' | 'save' | null>(null);
  // Personnalisation du mode Match
  const [accentId, setAccentId] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [bgUri, setBgUri] = useState<string | null>(null);
  const [toggles, setToggles] = useState<StoryToggles>(DEFAULT_TOGGLES);

  const matchOpts: StoryMatchOpts = {
    accent: accentId ? STORY_ACCENTS.find(a => a.id === accentId)?.color : undefined,
    caption,
    bgUri,
    toggles,
  };

  const TOGGLE_LABELS: Array<{ k: keyof StoryToggles; label: string }> = [
    { k: 'elo', label: 'Δ Niveau' }, { k: 'location', label: 'Lieu' }, { k: 'date', label: 'Date' },
    { k: 'type', label: 'Type' }, { k: 'qr', label: 'QR' }, { k: 'logo', label: 'Logo' },
  ];

  // Choisit une photo de fond (galerie) pour les templates de match.
  const pickBackground = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission refusée', 'Active l’accès à la galerie.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!r.canceled && r.assets?.[0]?.uri) setBgUri(r.assets[0].uri);
  };

  // À chaque ouverture, (ré)initialise le mode demandé et la personnalisation.
  useEffect(() => {
    if (!visible) return;
    setMode(initialMode);
    setStyleId(STORY_REGISTRY[initialMode][0].id);
    setAccentId(null);
    setCaption('');
    setBgUri(null);
    setToggles(DEFAULT_TOGGLES);
  }, [visible, initialMode]);

  // Taille de l'aperçu : on mesure la zone réellement disponible (onLayout) et on
  // remplit au maximum en gardant le ratio 9:16, plutôt que d'estimer la hauteur
  // du chrome (qui sous-dimensionnait fortement la carte en mode Match/verrouillé).
  const win = Dimensions.get('window');
  const [previewBox, setPreviewBox] = useState({ w: 0, h: 0 });
  const previewW = previewBox.w > 0 && previewBox.h > 0
    ? Math.min(previewBox.w * 0.92, (previewBox.h * 0.96 * 9) / 16)
    : Math.min(win.width * 0.7, 272); // fallback avant la 1ère mesure
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

  // Capture la carte rendue à pleine résolution (1080×1920) hors-écran : pas
  // d'upscale depuis l'aperçu → image nette. Pas de width/height forcés.
  const capture = () => captureRef(exportRef, { format: 'png', quality: 1, result: 'tmpfile' });

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
          <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{lockMode ? '📸 Partager le match' : '📸 Ma story'}</Text>
          <View style={{ width: 36 }} />
        </View>

        {/* segmented (masqué quand le mode est verrouillé, ex. partage d'un score précis) */}
        {!lockMode && (
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
        )}

        {/* preview */}
        <View
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setPreviewBox(p => (p.w === width && p.h === height ? p : { w: width, h: height }));
          }}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bgCard, paddingVertical: 8 }}>
          <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border }}>
            <StoryCardV2 ref={canvasRef} width={previewW} mode={mode} styleId={styleId} player={player} match={matchData} invite={invite} photoUri={photoUri} matchOpts={matchOpts} />
          </View>
        </View>

        {/* Carte d'export à pleine résolution (1080px), rendue hors-écran et capturée
            telle quelle → image nette. Non visible, ne reçoit pas les interactions. */}
        <View style={{ position: 'absolute', left: -10000, top: 0 }} pointerEvents="none">
          <StoryCardV2 ref={exportRef} width={exportW} mode={mode} styleId={styleId} player={player} match={matchData} invite={invite} photoUri={photoUri} matchOpts={matchOpts} />
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

        {/* Personnalisation (mode Match) */}
        {mode === 'match' && (
          <View style={{ backgroundColor: Colors.bgCard, paddingTop: 4 }}>
            {/* Accents */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingBottom: 10, alignItems: 'center' }}>
              <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1.5 }}>COULEUR</Text>
              {STORY_ACCENTS.map((a) => {
                const on = accentId === a.id;
                return (
                  <TouchableOpacity key={a.id} onPress={() => setAccentId(on ? null : a.id)}
                    style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: a.color, borderWidth: on ? 3 : 1, borderColor: on ? Colors.textPrimary : Colors.border }} />
                );
              })}
            </ScrollView>
            {/* Toggles */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 10, alignItems: 'center' }}>
              <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1.5 }}>ÉLÉMENTS</Text>
              {TOGGLE_LABELS.map(({ k, label }) => {
                const on = toggles[k];
                return (
                  <TouchableOpacity key={k} onPress={() => setToggles(t => ({ ...t, [k]: !t[k] }))}
                    style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: on ? Colors.brand : Colors.border, backgroundColor: on ? 'rgba(255,193,26,0.14)' : Colors.bg }}>
                    <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: on ? Colors.brandDeep : Colors.textMuted }}>{on ? '✓ ' : ''}{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {/* Légende + photo de fond */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
              <TextInput
                value={caption}
                onChangeText={setCaption}
                placeholder="Ajoute une légende…"
                placeholderTextColor={Colors.textMuted}
                maxLength={80}
                style={{ flex: 1, height: 40, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg, color: Colors.textPrimary, fontSize: 13 }}
              />
              <TouchableOpacity onPress={bgUri ? () => setBgUri(null) : pickBackground}
                style={{ height: 40, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1.5, borderColor: bgUri ? Colors.brand : Colors.border, backgroundColor: bgUri ? 'rgba(255,193,26,0.14)' : Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: bgUri ? Colors.brandDeep : Colors.textPrimary }}>{bgUri ? '✕ Fond' : '🖼️ Fond'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

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
