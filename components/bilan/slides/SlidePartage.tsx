import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { Fonts } from '../../../lib/theme';
import { Icon, type IconName } from '../../community/icons';
import type { MonthlyRecap } from '../../../lib/bilan';
import { bilanTone, partageTitle } from '../../../lib/bilanCopy';
import { RecapCard } from '../RecapCard';

// Slide 6 — Recap + partage IN-APP (publié dans le fil d'activité) + export de
// la carte en image. Maquette « Partager mon bilan » (2026-09-19). Fond
// jaune → brun (conteneur).
export function SlidePartage({ recap, playerName, avatarPath, level, posted, busy, onPost }: {
  recap: MonthlyRecap; playerName: string; avatarPath?: string | null; level: number;
  posted: boolean; busy: boolean; onPost: () => void;
}) {
  const cardRef = useRef<View>(null);
  const [exporting, setExporting] = useState(false);
  const title = partageTitle(bilanTone(recap));

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
        Alert.alert('Enregistré', 'Image ajoutée à ta galerie.');
      } else {
        Alert.alert('Permission refusée', "Autorise l'accès à la galerie pour enregistrer l'image.");
      }
    } catch {
      Alert.alert('Oups', "Impossible d'enregistrer l'image.");
    } finally {
      setExporting(false);
    }
  };

  // Story IG et WhatsApp passent par le partage du téléphone (où Instagram et
  // WhatsApp apparaissent) tant que l'APK n'embarque pas de module de partage
  // direct vers ces applications.
  const sorties: [string, IconName][] = [['Story IG', 'camera'], ['WhatsApp', 'message'], ['Plus…', 'share']];

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 30 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Label + titre (la phrase dépend du mois : lib/bilanCopy) */}
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#0A0A0A', letterSpacing: 2.4, textTransform: 'uppercase' }}>Recap {recap.shortLabel}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: Fonts.welcome, fontSize: 42, color: '#0A0A0A', lineHeight: 55, marginTop: 4, paddingRight: 5 }}>
        {title.pre}<Text style={{ color: '#FFFFFF' }}>{title.accent}</Text>{title.post}
      </Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10.5, color: '#0A0A0A', letterSpacing: 2, textTransform: 'uppercase', marginTop: 2, lineHeight: 16 }}>
        {"Des matchs aujourd'hui,\nun meilleur toi demain."}
      </Text>

      {/* La carte — c'est elle qui est capturée en image */}
      <View style={{ marginTop: 16 }}>
        <RecapCard ref={cardRef} recap={recap} playerName={playerName} avatarPath={avatarPath} level={level} />
      </View>

      {/* Partage */}
      <View style={{ marginTop: 18 }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: '#0A0A0A', letterSpacing: 2.2, textTransform: 'uppercase', textAlign: 'center', marginBottom: 10 }}>
          Partage ton bilan
        </Text>

        {/* Dans l'app : publié dans le fil d'activité (les amis le voient en slides) */}
        <TouchableOpacity
          onPress={onPost}
          disabled={busy || posted}
          activeOpacity={0.85}
          style={{ backgroundColor: '#0A0A0A', borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}
        >
          <Icon name={posted ? 'check' : 'share'} size={17} color="#FFC11A" stroke={2.2} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15, color: '#FFC11A' }}>
            {posted ? 'Publié dans ton fil d’activité' : busy ? 'Publication…' : 'Partager mon bilan'}
          </Text>
        </TouchableOpacity>

        {/* Hors de l'app : l'image de la carte */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
          {sorties.map(([label, ic]) => (
            <TouchableOpacity
              key={label}
              onPress={shareImg}
              disabled={exporting}
              activeOpacity={0.8}
              style={{ flex: 1, backgroundColor: '#0A0A0A', borderRadius: 13, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <Icon name={ic} size={15} color="#FFC11A" stroke={2.2} />
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#FFC11A' }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={saveImg}
          disabled={exporting}
          activeOpacity={0.85}
          style={{ backgroundColor: '#FFFFFF', borderRadius: 14, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          <Icon name="download" size={17} color="#0A0A0A" stroke={2.2} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15, color: '#0A0A0A' }}>
            {exporting ? 'Export…' : "Enregistrer l'image"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
