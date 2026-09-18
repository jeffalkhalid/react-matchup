// Écran « Ta photo de profil » — proposé UNE fois, à la première connexion
// après la création du compte (lib/welcomePhoto.ts). Même envoi que depuis le
// profil (lib/avatars) : espace privé, visible des joueurs connectés seulement.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Icon } from '../components/community/icons';
import { usePlayer } from '../hooks/usePlayer';
import { pickAvatarFromLibrary, takeAvatarWithCamera, pendingAvatarPick, uploadAvatar, type PickedImage } from '../lib/avatars';
import { Colors, Fonts } from '../lib/theme';
import { WELCOME_PHOTO_SEEN_KEY, emitWelcomePhotoDone } from '../lib/welcomePhoto';

export default function WelcomePhotoScreen() {
  const { player, refresh } = usePlayer();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [envoyee, setEnvoyee] = useState(false);
  const fini = useRef(false);

  // Vu dès l'affichage : « Plus tard » ou un retour arrière ne le reproposent pas.
  useEffect(() => {
    if (player?.id) AsyncStorage.setItem(WELCOME_PHOTO_SEEN_KEY(player.id), '1').catch(() => {});
  }, [player?.id]);

  // Quel que soit le chemin de sortie (bouton, geste retour), la suite du
  // premier lancement reprend.
  useEffect(() => () => { if (!fini.current) { fini.current = true; emitWelcomePhotoDone(); } }, []);

  const fermer = () => {
    if (!fini.current) { fini.current = true; emitWelcomePhotoDone(); }
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const envoyer = async (image: PickedImage) => {
    if (!player) return;
    await uploadAvatar(player.id, image, (player as any).avatar_path);
    await refresh();
    setEnvoyee(true);
  };

  // Android peut détruire l'écran pendant que la galerie est ouverte : le choix
  // revient ici, au lieu d'être perdu.
  useEffect(() => {
    if (!player?.id) return;
    let vivant = true;
    (async () => {
      const image = await pendingAvatarPick();
      if (!image || !vivant) return;
      setBusy(true);
      try { await envoyer(image); }
      catch (e: any) { Alert.alert('Photo non envoyée', e?.message ?? 'Réessaie dans un instant.'); }
      finally { if (vivant) setBusy(false); }
    })();
    return () => { vivant = false; };
  }, [player?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const choisir = async (source: 'library' | 'camera') => {
    if (busy) return;
    setBusy(true);
    try {
      const choix = source === 'camera' ? await takeAvatarWithCamera() : await pickAvatarFromLibrary();
      if (!choix.ok) {
        if (choix.raison === 'permission') {
          Alert.alert(
            source === 'camera' ? 'Accès à l’appareil photo refusé' : 'Accès aux photos refusé',
            'Autorise l’accès dans les réglages du téléphone, à la rubrique Autorisations de l’application, puis réessaie.',
          );
        }
        return;
      }
      await envoyer(choix.image);
    } catch (e: any) {
      Alert.alert('Photo non envoyée', e?.message ?? 'Réessaie dans un instant.');
    } finally {
      setBusy(false);
    }
  };

  const prenom = (player?.name ?? '').trim().split(/\s+/)[0];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20, paddingHorizontal: 24 }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <Text
          numberOfLines={2}
          style={{ alignSelf: 'stretch', textAlign: 'center', fontFamily: Fonts.welcome, fontSize: 30, lineHeight: 38, color: Colors.textPrimary, paddingRight: 5 }}
        >
          {envoyee ? 'Belle photo' : 'Ta photo'} <Text style={{ color: Colors.brand }}>{envoyee ? '!' : 'de profil'}</Text>
        </Text>
        <Text style={{ fontSize: 14, fontFamily: Fonts.ui, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, maxWidth: 320 }}>
          {envoyee
            ? 'Tes partenaires te reconnaîtront sur les parties, dans les classements et dans les chats.'
            : `${prenom ? `${prenom}, a` : 'A'}joute une photo : tes partenaires te reconnaîtront plus facilement sur le terrain.`}
        </Text>

        <TouchableOpacity
          onPress={() => { void choisir('library'); }}
          activeOpacity={0.85}
          disabled={busy}
          accessibilityLabel="Choisir ma photo de profil"
          style={{ marginTop: 8 }}
        >
          <View style={{ padding: 5, borderRadius: 999, borderWidth: 2.5, borderStyle: envoyee ? 'solid' : 'dashed', borderColor: Colors.brand }}>
            <PlayerAvatar
              name={player?.name ?? '?'}
              path={(player as any)?.avatar_path}
              size={150}
              backgroundColor={Colors.primary}
              textColor={Colors.brand}
              fontFamily={Fonts.uiBlack}
              fontSize={52}
            />
          </View>
          {busy ? (
            <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
              <ActivityIndicator color={Colors.brand} size="large" />
            </View>
          ) : (
            <View style={{
              position: 'absolute', right: 6, bottom: 6, width: 44, height: 44, borderRadius: 22,
              backgroundColor: Colors.brand, borderWidth: 3, borderColor: Colors.bg,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name={envoyee ? 'pencil' : 'camera'} size={19} color="#0A0A0A" stroke={2.3} />
            </View>
          )}
        </TouchableOpacity>

        <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textMuted, textAlign: 'center', lineHeight: 16, maxWidth: 300 }}>
          Visible uniquement par les joueurs connectés à l’app. Tu pourras la changer à tout moment depuis ton profil.
        </Text>
      </View>

      <View style={{ gap: 10 }}>
        {envoyee ? (
          <TouchableOpacity onPress={fermer} activeOpacity={0.85}
            style={{ backgroundColor: Colors.brand, borderRadius: 16, paddingVertical: 16, alignItems: 'center' }}>
            <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: '#0A0A0A' }}>C’est parti</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity onPress={() => { void choisir('library'); }} disabled={busy} activeOpacity={0.85}
              style={{ backgroundColor: Colors.brand, borderRadius: 16, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, opacity: busy ? 0.6 : 1 }}>
              <Icon name="image" size={18} color="#0A0A0A" stroke={2.3} />
              <Text style={{ fontSize: 15.5, fontFamily: Fonts.uiBlack, color: '#0A0A0A' }}>Choisir dans mes photos</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { void choisir('camera'); }} disabled={busy} activeOpacity={0.85}
              style={{ backgroundColor: Colors.bgCard, borderRadius: 16, paddingVertical: 15, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderColor: Colors.border, opacity: busy ? 0.6 : 1 }}>
              <Icon name="camera" size={18} color={Colors.textPrimary} stroke={2.3} />
              <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Prendre une photo</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={fermer} disabled={busy} hitSlop={10} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>Plus tard</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}
