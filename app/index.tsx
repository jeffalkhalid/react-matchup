import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Image,
  StyleSheet, Dimensions,
} from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { usePlayer } from '../hooks/usePlayer';
import { Colors, Spacing, FontSize, Radius, Fonts } from '../lib/theme';
import AnimatedSplash from '../components/AnimatedSplash';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function IndexScreen() {
  const { player, loading } = usePlayer();
  const router = useRouter();
  const segments = useSegments();
  const [splashDone, setSplashDone] = useState(false);

  const videoPlayer = useVideoPlayer(require('../assets/padel-mobile.mp4'), p => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (loading || !splashDone) return;
    // Ne rediriger que si l'index est réellement la route active (segments
    // vides). Sinon, sur un cold start via deep link (ex. reset-password),
    // l'index monté « dessous » arracherait l'utilisateur de l'écran ouvert.
    if (player && (segments as string[]).length === 0) router.replace('/(tabs)/lobby');
  }, [player, loading, splashDone, segments]);

  if (loading || !splashDone) {
    return <AnimatedSplash onFinish={() => setSplashDone(true)} />;
  }

  // Utilisateur connecté : le useEffect ci-dessus va rediriger vers /(tabs).
  // On NE rend PAS le hero marketing entre-temps, sinon son image fallback
  // (padel.png — la raquette violette/rose) flashe en plein écran le temps
  // d'une frame avant la navigation. On garde un fond sombre neutre.
  if (player && (segments as string[]).length === 0) {
    return <View style={{ flex: 1, backgroundColor: Colors.bgDark }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bgDark }}>
      {/* HERO */}
      <View style={{ height: SCREEN_HEIGHT, position: 'relative' }}>
        {/* Fallback (le temps que la vidéo démarre) : fond sombre + logo de
            l'app, au lieu de l'ancienne image padel.png (raquette violette
            off-brand qui flashait au démarrage). */}
        <View style={[StyleSheet.absoluteFillObject, {
          backgroundColor: Colors.bgDark,
          alignItems: 'center', justifyContent: 'center',
        }]}>
          <Image
            source={require('../assets/pagmatch-logo.png')}
            style={{ width: 160, height: 160 }}
            resizeMode="contain"
          />
        </View>
        {/* Vidéo de fond */}
        <VideoView
          player={videoPlayer}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          nativeControls={false}
          allowsFullscreen={false}
        />
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.60)' }]} />

        {/* Header — logo + wordmark (aligné sur le splash) */}
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          paddingTop: 56, paddingHorizontal: Spacing.lg,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          zIndex: 10,
        }}>
          <Image
            source={require('../assets/auth/splash-racket.png')}
            style={{ width: 26, height: 26 }}
            resizeMode="contain"
          />
          <Image
            source={require('../assets/auth/splash-wordmark.png')}
            style={{ width: 118, height: 26, marginLeft: -8 }}
            resizeMode="contain"
          />
        </View>

        {/* Hero content */}
        <View style={{
          flex: 1, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: Spacing.lg, zIndex: 10,
        }}>
          <View style={{
            borderWidth: 1, borderColor: 'rgba(255,193,26,0.35)',
            backgroundColor: 'rgba(255,193,26,0.10)',
            paddingHorizontal: 16, paddingVertical: 6, borderRadius: Radius.full,
            marginBottom: Spacing.lg,
          }}>
            <Text style={{ color: Colors.brand, fontSize: FontSize.xs, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 2 }}>
              La nouvelle ère du Padel
            </Text>
          </View>

          <Text style={{
            color: Colors.textOnDark, fontSize: 42,
            textAlign: 'center', lineHeight: 48, marginBottom: Spacing.md,
            fontFamily: Fonts.welcome, includeFontPadding: false,
          }}>
            Le Padel.{'\n'}
            <Text style={{ color: Colors.brand }}>Niveau Supérieur.</Text>
          </Text>

          <Text style={{
            color: '#CBD5E1', fontSize: FontSize.base,
            textAlign: 'center', lineHeight: 24, fontWeight: '500',
            marginBottom: Spacing.xl, maxWidth: 320,
          }}>
            Trouvez des partenaires à votre niveau, enregistrez vos matchs et grimpez au classement de votre club.
          </Text>

          <View style={{ width: '100%', gap: Spacing.md }}>
            <TouchableOpacity
              onPress={() => router.push('/(auth)/signup')}
              style={{
                backgroundColor: Colors.brand, borderRadius: Radius.full,
                paddingVertical: 16, alignItems: 'center',
                shadowColor: Colors.brand, shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
                elevation: 8,
              }}
            >
              <Text style={{ color: Colors.textOnBrand, fontSize: FontSize.md, fontWeight: '900' }}>
                Commencer maintenant
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/(auth)/login')}
              style={{
                borderRadius: Radius.full, paddingVertical: 16, alignItems: 'center',
                borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)',
                backgroundColor: 'rgba(255,255,255,0.08)',
              }}
            >
              <Text style={{ color: Colors.textOnDark, fontSize: FontSize.md, fontWeight: '700' }}>
                Se connecter
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}
