// components/tournaments/TournamentShareCard.tsx — l'affiche d'une soirée
// terminée, celle qu'on photographie et qu'on envoie dans le groupe.
//
// Elle est RENDUE À L'ÉCRAN, pas cachée puis capturée : ce que le joueur voit
// est exactement ce qu'il partage. C'est aussi ce qui lui donne envie de le
// faire — un podium sombre au milieu d'un écran clair se remarque.
//
// L'export est 100 % LOCAL : `captureRef` écrit un fichier temporaire, puis
// `Sharing` ouvre la feuille de partage du système. Rien ne transite par le
// serveur, aucun média n'est stocké — même règle que les Stories.
//
// Le filigrane reprend celui des Stories (StoryCanvas) : bloc PAGMATCH en tête
// avec la raquette, `pagmatch.com` en pied à faible opacité. Rien d'inventé.
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, ActivityIndicator } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { formatTournamentDate } from '../../lib/tournaments';
import type { FinalStandingRowData } from './FinalStandings';

const OR = ['#D4AF37', '#9CA3AF', '#B87333'];

export function TournamentShareCard({ name, startsAt, clubName, rows, validated }: {
  name: string;
  startsAt: string;
  clubName?: string | null;
  rows: FinalStandingRowData[];
  /** Points crédités (CLASSEMENT_VALIDE) ou encore en attente (TERMINE). */
  validated: boolean;
}) {
  const cardRef = useRef<View>(null);
  const [exporting, setExporting] = useState(false);

  const share = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Partager le classement' });
      } else {
        Alert.alert('Partage indisponible', "Le partage de fichiers n'est pas disponible sur cet appareil.");
      }
    } catch {
      Alert.alert('Oups', "Impossible de partager l'image.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      {/* L'affiche elle-même — c'est ce View qui est capturé. */}
      <View
        ref={cardRef}
        collapsable={false}
        style={{
          backgroundColor: '#0F0D0A', borderRadius: 20, padding: 18, gap: 14,
          borderWidth: 1, borderColor: 'rgba(255,193,26,0.25)',
        }}
      >
        {/* Filigrane de tête */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <View style={{
            width: 32, height: 32, borderRadius: 9,
            backgroundColor: 'rgba(255,193,26,0.13)',
            borderWidth: 1.5, borderColor: 'rgba(255,193,26,0.53)',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 18, height: 18 }} resizeMode="contain" />
          </View>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: 'rgba(255,255,255,0.75)', letterSpacing: 2.5 }}>
            PAGMATCH
          </Text>
        </View>

        <View>
          <Text numberOfLines={2} style={{ fontSize: 19, fontFamily: Fonts.uiBlack, color: '#fff', lineHeight: 24 }}>
            {name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: Fonts.ui, color: 'rgba(255,255,255,0.55)', marginTop: 3 }}>
            {formatTournamentDate(startsAt)}{clubName ? ` · ${clubName}` : ''}
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          {rows.map(r => {
            const podium = r.final_rank <= 3;
            return (
              <View key={r.team_id} style={{
                flexDirection: 'row', alignItems: 'center', gap: 10,
                backgroundColor: podium ? 'rgba(255,193,26,0.09)' : 'rgba(255,255,255,0.05)',
                borderRadius: 12, paddingVertical: 8, paddingHorizontal: 10,
              }}>
                <View style={{
                  width: 26, height: 26, borderRadius: 8,
                  backgroundColor: podium ? OR[r.final_rank - 1] : 'rgba(255,255,255,0.10)',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: podium ? '#0F0D0A' : 'rgba(255,255,255,0.75)' }}>
                    {r.final_rank}
                  </Text>
                </View>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.uiBold, color: '#fff' }}>
                  {r.names[0]} · {r.names[1]}
                </Text>
                <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.brand }}>
                  {r.points}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Filigrane de pied */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 10, fontFamily: Fonts.ui, color: 'rgba(255,255,255,0.35)' }}>
            {validated ? 'Points crédités' : 'Points en attente de validation'}
          </Text>
          <Text style={{ fontSize: 10, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.35)', letterSpacing: 2 }}>
            pagmatch.com
          </Text>
        </View>
      </View>

      <TouchableOpacity
        onPress={share}
        disabled={exporting}
        activeOpacity={0.88}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: Colors.brand, borderRadius: 999, paddingVertical: 12,
          opacity: exporting ? 0.6 : 1,
        }}
      >
        {exporting
          ? <ActivityIndicator size="small" color={Colors.textOnBrand} />
          : <Icon name="share" size={16} color={Colors.textOnBrand} stroke={2.4} />}
        <Text style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textOnBrand }}>
          Partager le classement
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default TournamentShareCard;
