import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Fonts } from '../../../lib/theme';
import type { MonthlyRecap } from '../../../lib/bilan';

const initials = (n: string) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const firstName = (n: string) => (n || '').split(' ')[0];

// Slide 6 — Recap + partage IN-APP (post dans le fil) + export image. Fond jaune->brun (conteneur).
export function SlidePartage({ recap, playerName, level, posted, busy, onPost }: {
  recap: MonthlyRecap; playerName: string; level: number; posted: boolean; busy: boolean; onPost: () => void;
}) {
  const cardRef = useRef<View>(null);
  const [exporting, setExporting] = useState(false);
  const badgeCount = recap.badges.length;

  const captureCard = async (): Promise<string> => {
    return await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
  };

  const shareImg = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const uri = await captureCard();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager mon bilan' });
      } else {
        Alert.alert('Partage indisponible', "Le partage de fichiers n'est pas disponible sur cet appareil.");
      }
    } catch {
      Alert.alert('Oups', "Impossible de partager l'image.");
    } finally {
      setExporting(false);
    }
  };

  const saveImg = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const uri = await captureCard();
      const p = await MediaLibrary.requestPermissionsAsync();
      if (p.granted) {
        await MediaLibrary.saveToLibraryAsync(uri);
        Alert.alert('Enregistre', 'Image ajoutee a ta galerie.');
      } else {
        Alert.alert('Permission refusee', "Autorise l'acces a la galerie pour enregistrer l'image.");
      }
    } catch {
      Alert.alert('Oups', "Impossible d'enregistrer l'image.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 26, paddingTop: 12, paddingBottom: 34 }}>
      {/* Label */}
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#0A0A0A', letterSpacing: 2, textTransform: 'uppercase' }}>Recap {recap.shortLabel}</Text>

      {/* Title */}
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 42, color: '#0A0A0A', lineHeight: 40, marginTop: 4 }}>
        Tu as fait <Text style={{ color: '#FFFFFF' }}>un mois</Text> de feu 🔥
      </Text>

      {/* Recap card noire — wrapped in ref for capture */}
      <View ref={cardRef} collapsable={false} style={{ marginTop: 20, backgroundColor: '#0A0A0A', borderRadius: 18, padding: 18 }}>
        {/* Player header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <View style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: '#0A0A0A', borderWidth: 2, borderColor: '#FFC11A', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#FFC11A' }}>{initials(playerName)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#FFFFFF' }} numberOfLines={1}>{playerName}</Text>
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 10.5, color: '#A1A1AA' }}>Niv. {level.toFixed(2)}</Text>
          </View>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: '#FFC11A', letterSpacing: 1 }}>{recap.label} {recap.month.slice(0, 4)}</Text>
        </View>

        {/* 2x2 stats grid */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Cell n={recap.matches} l="Matchs" c="#FFFFFF" bg="rgba(255,255,255,0.04)" lc="#A1A1AA" />
          <Cell n={`${recap.winRate}%`} l="Winrate" c="#FFC11A" bg="rgba(255,193,26,0.12)" lc="#FFC11A" />
          <Cell n={`${recap.levelDelta >= 0 ? '+' : ''}${recap.levelDelta.toFixed(2)}`} l="Niveau" c="#FFC11A" bg="rgba(255,193,26,0.12)" lc="#FFC11A" />
          <Cell n={`+${badgeCount}`} l="Badge" c="#FFFFFF" bg="rgba(255,255,255,0.04)" lc="#A1A1AA" />
        </View>

        {/* Best duo footer */}
        <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 10, color: '#A1A1AA' }}>Meilleur duo</Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#FFFFFF', marginTop: 2 }}>
              {recap.topPartner ? `avec ${firstName(recap.topPartner.name)} · ${recap.topPartner.winsTogether}/${recap.topPartner.matchesTogether}` : '—'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Svg width={14} height={14} viewBox="0 0 24 24">
              <Circle cx={9} cy={9} r={6} stroke="#FFC11A" strokeWidth={2} fill="none" />
              <Circle cx={9} cy={9} r={2} fill="#FFC11A" />
              <Path d="M13 13 L20 20" stroke="#FFC11A" strokeWidth={2} strokeLinecap="round" />
            </Svg>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: '#FFC11A', letterSpacing: 0.5 }}>PAGMATCH</Text>
          </View>
        </View>
      </View>

      {/* Share section */}
      <View style={{ marginTop: 24, paddingTop: 14 }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: '#0A0A0A', letterSpacing: 1.5, textTransform: 'uppercase', textAlign: 'center', marginBottom: 10 }}>
          Partage ton bilan
        </Text>

        {/* In-app post button */}
        <TouchableOpacity
          onPress={onPost}
          disabled={busy || posted}
          activeOpacity={0.85}
          style={{ backgroundColor: '#0A0A0A', borderRadius: 13, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}
        >
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: '#FFC11A' }}>
            {posted ? '✓ Publie dans ton fil' : busy ? 'Publication…' : 'Partager mon bilan'}
          </Text>
        </TouchableOpacity>

        {/* 3-button row: Story IG / WhatsApp / Plus */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {(['Story IG', 'WhatsApp', 'Plus…'] as const).map(label => (
            <TouchableOpacity
              key={label}
              onPress={shareImg}
              disabled={exporting}
              activeOpacity={0.8}
              style={{ flex: 1, backgroundColor: '#0A0A0A', borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#FFC11A' }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Save to gallery button */}
        <TouchableOpacity
          onPress={saveImg}
          disabled={exporting}
          activeOpacity={0.85}
          style={{ backgroundColor: '#FFFFFF', borderRadius: 13, paddingVertical: 14, alignItems: 'center' }}
        >
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: '#0A0A0A' }}>
            {exporting ? 'Export…' : "Enregistrer l'image"}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Cell({ n, l, c, bg, lc }: { n: number | string; l: string; c: string; bg: string; lc: string }) {
  return (
    <View style={{ width: '47%', flexGrow: 1, backgroundColor: bg, borderRadius: 11, padding: 10 }}>
      <Text style={{ fontFamily: Fonts.display, fontSize: 28, color: c, lineHeight: 28 }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: lc, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 3 }}>{l}</Text>
    </View>
  );
}
