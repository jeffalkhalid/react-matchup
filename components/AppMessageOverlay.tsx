// components/AppMessageOverlay.tsx — la fenêtre d'accueil (information,
// nouveauté, ou « mets ton app à jour »).
//
// CE N'EST PAS UNE <Modal> : c'est un CALQUE posé à la racine, au-dessus de la
// navigation. Une <Modal> native rend l'écran du dessous inatteignable et
// casse la navigation qu'on déclenche depuis elle (deux fois le piège, cf. la
// fiche de match et les clubs favoris). Un calque n'a aucun de ces défauts.
//
// QUAND ELLE SE TAIT — et c'est le plus important, parce qu'une fenêtre qui
// tombe au mauvais moment fait désinstaller l'app :
//   • pendant la visite guidée d'un nouveau joueur ;
//   • sur les écrans où l'on est en train de FAIRE quelque chose (saisir un
//     score, suivre un match en direct, lire son bilan) ;
//   • pendant la première seconde, le temps qu'un tap sur une notification
//     ait emmené le joueur là où il voulait aller.
import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Linking, Text, TouchableOpacity, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useAppMessage } from '../hooks/useAppMessage';
import { isBlocking, type AppMessageLevel } from '../lib/appMessages';
import { useTourInfo } from '../lib/tourAnchors';
import { Icon, type IconName } from './community/icons';
import { Colors, Fonts } from '../lib/theme';

/** Le temps qu'un tap sur une notification ait fini d'ouvrir son écran. */
const DELAI_AVANT_AFFICHAGE_MS = 900;

/** Écrans où l'on est en train de faire quelque chose : on n'interrompt pas. */
const ECRANS_OCCUPES = ['/score-entry', '/live/', '/bilan/', '/welcome-photo', '/ambassador-welcome', '/legal/'];

const PARURE: Record<AppMessageLevel, { icone: IconName; teinte: string; fond: string; etiquette: string }> = {
  info:    { icone: 'megaphone', teinte: Colors.info,   fond: 'rgba(59,130,246,0.12)',  etiquette: 'Information' },
  feature: { icone: 'star',      teinte: Colors.brandDeep, fond: 'rgba(255,193,26,0.18)', etiquette: 'Nouveauté' },
  update:  { icone: 'download',  teinte: Colors.danger, fond: 'rgba(239,68,68,0.12)',   etiquette: 'Mise à jour requise' },
};

export default function AppMessageOverlay() {
  const { message, dismiss } = useAppMessage();
  const router = useRouter();
  const pathname = usePathname();
  const tourActif = !!useTourInfo('tour-active');
  const [pret, setPret] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;

  const occupe = ECRANS_OCCUPES.some(p => (pathname ?? '').startsWith(p));
  const visible = !!message && pret && !tourActif && !occupe;

  useEffect(() => {
    if (!message) { setPret(false); return; }
    const t = setTimeout(() => setPret(true), DELAI_AVANT_AFFICHAGE_MS);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    if (!visible) return;
    opacity.setValue(0);
    scale.setValue(0.94);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 14 }),
    ]).start();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Le bouton retour d'Android ferme la fenêtre — et ne fait RIEN sur un
  // message bloquant, sinon le blocage se contourne en une touche.
  useEffect(() => {
    if (!visible || !message) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isBlocking(message)) void dismiss();
      return true;
    });
    return () => sub.remove();
  }, [visible, message, dismiss]);

  if (!visible || !message) return null;

  const bloquant = isBlocking(message);
  const parure = PARURE[message.level] ?? PARURE.info;

  const agir = () => {
    const url = message.cta_url;
    if (!url) { void dismiss(); return; }
    // On ferme AVANT de naviguer : une fenêtre encore montée par-dessus l'écran
    // d'arrivée, c'est un écran qu'on croit figé.
    if (!bloquant) void dismiss();
    if (/^https?:|^mailto:|^market:|^itms-/.test(url)) {
      Linking.openURL(url).catch(() => {});
    } else {
      router.push(url as any);
    }
  };

  return (
    <View
      pointerEvents="auto"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9998, elevation: 9998,
        alignItems: 'center', justifyContent: 'center', padding: 24,
      }}>
      {/* Fond sombre : tapable pour fermer, inerte quand le message bloque. */}
      <TouchableOpacity
        activeOpacity={1}
        disabled={bloquant}
        onPress={() => { if (!bloquant) void dismiss(); }}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }}
      />

      <Animated.View
        style={{
          width: '100%', maxWidth: 420, backgroundColor: Colors.bgCard, borderRadius: 24,
          padding: 20, gap: 12, opacity, transform: [{ scale }],
          shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12,
        }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: parure.fond, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={parure.icone} size={17} color={parure.teinte} stroke={2.4} />
          </View>
          <Text style={{ flex: 1, fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase', color: parure.teinte }}>
            {parure.etiquette}
          </Text>
          {!bloquant && (
            <TouchableOpacity
              onPress={() => void dismiss()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Fermer"
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="x" size={15} color={Colors.textSecondary} stroke={2.6} />
            </TouchableOpacity>
          )}
        </View>

        <Text style={{ fontSize: 19, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, lineHeight: 25 }}>
          {message.title}
        </Text>
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, lineHeight: 20 }}>
          {message.body}
        </Text>

        <TouchableOpacity
          onPress={agir}
          activeOpacity={0.85}
          accessibilityRole="button"
          style={{ marginTop: 4, backgroundColor: Colors.primary, borderRadius: 16, paddingVertical: 15, alignItems: 'center' }}>
          <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 15 }}>
            {message.cta_label || (bloquant ? 'Mettre à jour' : 'J’ai compris')}
          </Text>
        </TouchableOpacity>

        {/* Un message bloquant n'offre aucune sortie : c'est tout son intérêt. */}
        {!bloquant && message.cta_url ? (
          <TouchableOpacity onPress={() => void dismiss()} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: 6 }}>
            <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textMuted }}>Plus tard</Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    </View>
  );
}
