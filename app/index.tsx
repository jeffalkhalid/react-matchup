import { useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator,
  StyleSheet, Dimensions, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../hooks/usePlayer';
import { Colors, Spacing, FontSize, Radius } from '../lib/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function IndexScreen() {
  const { player, loading } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const videoPlayer = useVideoPlayer(require('../assets/padel-mobile.mp4'), p => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (loading) return;
    if (player) router.replace('/(tabs)');
  }, [player, loading]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#102820', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  // If a player exists, the useEffect above will trigger a redirect to (tabs).
  // We should not return null here, just let it render the background/video until the transition happens.
  // Returning null blocks the screen from mounting correctly during quick state flips.

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#102820' }} contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom }}>

      {/* HERO */}
      <View style={{ height: SCREEN_HEIGHT, position: 'relative' }}>
        {/* Video background */}
        <VideoView
          player={videoPlayer}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          nativeControls={false}
          allowsFullscreen={false}
        />
        {/* Dark overlay — pointerEvents none so touches reach content below */}
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.60)' }]} />

        {/* Header — logo only */}
        <View style={{
          position: 'absolute', top: 0, left: 0, right: 0,
          paddingTop: 56, paddingHorizontal: Spacing.lg,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          gap: 14,
          zIndex: 10,
        }}>
          <Image
            source={require('../assets/icon.png')}
            style={{ width: 60, height: 60, borderRadius: 16 }}
            resizeMode="cover"
          />
          <View>
            <Text style={{ color: '#fff', fontSize: 26, fontWeight: '900', letterSpacing: -0.5, lineHeight: 28 }}>
              <Text style={{ color: '#FACC15' }}>PAG</Text> Match
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: '700', letterSpacing: 1.4, textTransform: 'uppercase', marginTop: 2 }}>
              by PadelActiveGame
            </Text>
          </View>
        </View>

        {/* Hero content */}
        <View style={{
          flex: 1, alignItems: 'center', justifyContent: 'center',
          paddingHorizontal: Spacing.lg, zIndex: 10,
        }}>
          <View style={{
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
            backgroundColor: 'rgba(255,255,255,0.1)',
            paddingHorizontal: 16, paddingVertical: 6, borderRadius: Radius.full,
            marginBottom: Spacing.lg,
          }}>
            <Text style={{ color: '#6EE7B7', fontSize: FontSize.xs, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 2 }}>
              La nouvelle ère du Padel
            </Text>
          </View>

          <Text style={{
            color: '#fff', fontSize: 42, fontWeight: '900',
            textAlign: 'center', lineHeight: 48, marginBottom: Spacing.md,
          }}>
            Le Padel.{'\n'}
            <Text style={{ color: '#34D399' }}>Niveau Supérieur.</Text>
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
                backgroundColor: '#10B981', borderRadius: Radius.full,
                paddingVertical: 16, alignItems: 'center',
                shadowColor: '#10B981', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
                elevation: 8,
              }}
            >
              <Text style={{ color: '#0A0F1E', fontSize: FontSize.md, fontWeight: '900' }}>
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
              <Text style={{ color: '#fff', fontSize: FontSize.md, fontWeight: '700' }}>
                Se connecter
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* FEATURES */}
      <View style={{ paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.lg, gap: Spacing.md }}>
        {[
          { emoji: '🎯', title: 'Matchmaking', text: 'Trouve des partenaires de ton niveau en 2 clics. Le Lobby centralise toutes les parties ouvertes du club.', color: '#818CF8' },
          { emoji: '📈', title: 'Classement ELO', text: 'Un moteur ATP-style qui calcule tes points selon la force réelle de tes adversaires. Jouer contre plus fort rapporte.', color: '#34D399' },
          { emoji: '👥', title: 'Communauté', text: 'Vote pour le MVP, distribue des trophées et gagne des badges de réputation sur le terrain.', color: '#FB923C' },
        ].map(f => (
          <View key={f.title} style={{
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
            borderRadius: Radius.xl, padding: Spacing.lg,
          }}>
            <View style={{
              width: 52, height: 52, borderRadius: Radius.md,
              backgroundColor: `${f.color}20`, borderWidth: 1, borderColor: `${f.color}40`,
              alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md,
            }}>
              <Text style={{ fontSize: 24 }}>{f.emoji}</Text>
            </View>
            <Text style={{ color: '#fff', fontSize: FontSize.md, fontWeight: '900', marginBottom: Spacing.xs }}>{f.title}</Text>
            <Text style={{ color: '#94A3B8', fontSize: FontSize.sm, lineHeight: 20 }}>{f.text}</Text>
          </View>
        ))}
      </View>

    </ScrollView>
  );
}
