// components/tournaments/DateTimeSheets.tsx — choisir la date et l'heure d'un
// tournoi sans les taper.
//
// Deux feuilles remontantes, sur le moule exact du sélecteur de club de
// l'écran d'organisation : fond assombri, coins arrondis en haut, poignée
// grise. Rien d'inventé, et surtout aucune dépendance native ajoutée — un
// sélecteur système ne sait pas proposer « une liste de créneaux », et en
// ajouter un en pleine montée de SDK aurait été un risque pour rien.
//
// Le calcul de la grille et des créneaux vit dans `lib/tournaments.ts`, avec
// ses tests : un décalage d'un jour ou un février à 28 jours ne se voit pas à
// l'œil, contrairement au rendu.
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { monthMatrix, isoDay, timeSlots } from '../../lib/tournaments';

const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
              'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function Feuille({ visible, onClose, children }: {
  visible: boolean; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
        <View style={{
          backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '70%', borderWidth: 1, borderColor: Colors.border,
        }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
            <View style={{ width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2 }} />
          </View>
          {children}
        </View>
      </View>
    </Modal>
  );
}

/** Calendrier d'un mois. `value` et le retour sont au format `AAAA-MM-JJ`. */
export function DateSheet({ visible, value, onPick, onClose }: {
  visible: boolean;
  value: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const [y, m, d] = value.split('-').map(Number);
  const [an, setAn] = useState(y || new Date().getFullYear());
  const [mois, setMois] = useState((m || 1) - 1);

  const grille = useMemo(() => monthMatrix(an, mois), [an, mois]);

  // Hier à minuit : on n'organise pas une soirée dans le passé, mais la
  // journée en cours reste choisissable jusqu'à son dernier instant.
  const minuitAujourdhui = new Date(); minuitAujourdhui.setHours(0, 0, 0, 0);

  const glisser = (pas: number) => {
    const nm = mois + pas;
    if (nm < 0) { setMois(11); setAn(an - 1); }
    else if (nm > 11) { setMois(0); setAn(an + 1); }
    else setMois(nm);
  };

  return (
    <Feuille visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
          <TouchableOpacity onPress={() => glisser(-1)} hitSlop={10} style={{ padding: 6 }}>
            <Icon name="chevronLeft" size={20} color={Colors.textPrimary} stroke={2.4} />
          </TouchableOpacity>
          <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
            {MOIS[mois]} {an}
          </Text>
          <TouchableOpacity onPress={() => glisser(1)} hitSlop={10} style={{ padding: 6, transform: [{ scaleX: -1 }] }}>
            <Icon name="chevronLeft" size={20} color={Colors.textPrimary} stroke={2.4} />
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row' }}>
          {JOURS.map((j, i) => (
            <Text key={i} style={{
              flex: 1, textAlign: 'center', fontSize: 11, fontFamily: Fonts.uiBlack,
              color: Colors.textMuted, paddingBottom: 6,
            }}>{j}</Text>
          ))}
        </View>

        {grille.map((ligne, li) => (
          <View key={li} style={{ flexDirection: 'row' }}>
            {ligne.map((jour, ji) => {
              if (jour === null) return <View key={ji} style={{ flex: 1, height: 42 }} />;
              const iso = isoDay(an, mois, jour);
              const choisi = iso === value;
              const passe = new Date(an, mois, jour) < minuitAujourdhui;
              return (
                <TouchableOpacity
                  key={ji}
                  disabled={passe}
                  onPress={() => { onPick(iso); onClose(); }}
                  style={{ flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' }}
                >
                  <View style={{
                    width: 34, height: 34, borderRadius: 12,
                    backgroundColor: choisi ? Colors.brand : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{
                      fontSize: 13.5,
                      fontFamily: choisi ? Fonts.uiBlack : Fonts.uiBold,
                      color: passe ? Colors.textMuted : choisi ? Colors.textOnBrand : Colors.textPrimary,
                      opacity: passe ? 0.35 : 1,
                    }}>
                      {jour}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    </Feuille>
  );
}

/** Liste des créneaux. `value` et le retour sont au format `HH:MM`. */
export function TimeSheet({ visible, value, onPick, onClose }: {
  visible: boolean;
  value: string;
  onPick: (hhmm: string) => void;
  onClose: () => void;
}) {
  const creneaux = useMemo(() => timeSlots(), []);
  return (
    <Feuille visible={visible} onClose={onClose}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        {creneaux.map(c => {
          const choisi = c === value;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => { onPick(c); onClose(); }}
              style={{
                paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 4,
                backgroundColor: choisi ? 'rgba(255,193,26,0.16)' : 'transparent',
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <Text style={{
                fontSize: 15,
                fontFamily: choisi ? Fonts.uiBlack : Fonts.uiBold,
                color: choisi ? Colors.brandDeep : Colors.textPrimary,
              }}>
                {c}
              </Text>
              {choisi && <Icon name="check" size={17} color={Colors.brandDeep} stroke={2.6} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </Feuille>
  );
}
