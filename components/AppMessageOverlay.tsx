// components/AppMessageOverlay.tsx — la fenêtre d'accueil (information,
// nouveauté, ou « mets ton app à jour »).
//
// CE N'EST PAS UNE <Modal> : c'est un CALQUE posé à la racine, au-dessus de la
// navigation. Une <Modal> native rend l'écran du dessous inatteignable et
// casse la navigation qu'on déclenche depuis elle (deux fois le piège, cf. la
// fiche de match et les clubs favoris). Un calque n'a aucun de ces défauts.
//
// L'AFFICHE PASSE AVANT LE DÉCOR. Le cas courant, c'est une affiche déjà
// composée (tournoi, partenariat) : elle occupe la largeur entière de la
// fenêtre, bord à bord, et tout ce qui l'entoure s'efface. Une information ne
// porte donc PAS d'étiquette « INFORMATION » — le mot ne disait rien que
// l'affiche ne dise déjà, et il volait une ligne en haut. Les deux autres
// niveaux la gardent : « Nouveauté » et « Mise à jour requise » annoncent
// quelque chose que l'image, elle, ne dit pas.
//
// QUAND ELLE SE TAIT — et c'est le plus important, parce qu'une fenêtre qui
// tombe au mauvais moment fait désinstaller l'app :
//   • pendant la visite guidée d'un nouveau joueur ;
//   • sur les écrans où l'on est en train de FAIRE quelque chose (saisir un
//     score, suivre un match en direct, lire son bilan) ;
//   • pendant la première seconde, le temps qu'un tap sur une notification
//     ait emmené le joueur là où il voulait aller.
import { useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Image, Linking, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useAppMessage } from '../hooks/useAppMessage';
import { isBlocking, showsPoster, imageRatio, estLienExterne, type AppMessageLevel } from '../lib/appMessages';
import { useTourInfo } from '../lib/tourAnchors';
import { Icon, type IconName } from './community/icons';
import { Colors, Fonts } from '../lib/theme';

/** Le temps qu'un tap sur une notification ait fini d'ouvrir son écran. */
const DELAI_AVANT_AFFICHAGE_MS = 900;

/** Écrans où l'on est en train de faire quelque chose : on n'interrompt pas. */
const ECRANS_OCCUPES = ['/score-entry', '/live/', '/bilan/', '/welcome-photo', '/ambassador-welcome', '/legal/'];

/** Marge autour de la fenêtre, et largeur maximale de la carte. */
const MARGE = 14;
const LARGEUR_MAX = 560;

/**
 * Part de la hauteur d'écran que l'image peut prendre.
 *
 * Plus généreux en mode affiche — c'est elle, le message — mais jamais la
 * totalité : le bouton doit rester visible sans avoir à faire défiler quoi que
 * ce soit, sinon on ne sait plus comment sortir.
 */
const PART_HAUTEUR_AFFICHE = 0.72;
const PART_HAUTEUR_CARTE = 0.46;

const PARURE: Record<AppMessageLevel, { icone: IconName; teinte: string; fond: string; etiquette: string }> = {
  info:    { icone: 'megaphone', teinte: Colors.info,      fond: 'rgba(59,130,246,0.12)',  etiquette: 'Information' },
  feature: { icone: 'star',      teinte: Colors.brandDeep, fond: 'rgba(255,193,26,0.18)',  etiquette: 'Nouveauté' },
  update:  { icone: 'download',  teinte: Colors.danger,    fond: 'rgba(239,68,68,0.12)',   etiquette: 'Mise à jour requise' },
};

export default function AppMessageOverlay() {
  const { message, dismiss } = useAppMessage();
  const router = useRouter();
  const pathname = usePathname();
  const { width: largeurEcran, height: hauteurEcran } = useWindowDimensions();
  const tourActif = !!useTourInfo('tour-active');
  const [pret, setPret] = useState(false);
  // Une affiche qui ne charge pas (réseau lent, fichier effacé) ne doit pas
  // laisser une fenêtre vide : on repasse alors en carte, titre et texte visibles.
  const [imageKo, setImageKo] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;

  const occupe = ECRANS_OCCUPES.some(p => (pathname ?? '').startsWith(p));
  const visible = !!message && pret && !tourActif && !occupe;

  useEffect(() => {
    if (!message) { setPret(false); return; }
    setImageKo(false);
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
  const image = message.image_url && !imageKo ? message.image_url : null;
  // Mode affiche : l'image PORTE le message, le titre et le texte s'effacent —
  // mais ils reviennent d'eux-mêmes si l'image n'arrive pas.
  const affiche = !!image && showsPoster(message);
  // Une information laisse toute la place à son affiche : pas d'étiquette.
  const avecEntete = message.level !== 'info';

  // Géométrie calculée ici plutôt que laissée à `aspectRatio` : il faut pouvoir
  // BORNER la hauteur, et les deux réunis se contredisent.
  const largeurCarte = Math.min(largeurEcran - MARGE * 2, LARGEUR_MAX);
  const largeurImage = affiche ? largeurCarte : largeurCarte - 28;
  const hauteurMax = hauteurEcran * (affiche ? PART_HAUTEUR_AFFICHE : PART_HAUTEUR_CARTE);
  const hauteurImage = Math.min(largeurImage / imageRatio(message), hauteurMax);

  const agir = () => {
    const url = message.cta_url;
    if (!url) { void dismiss(); return; }
    // On ferme AVANT de naviguer : une fenêtre encore montée par-dessus l'écran
    // d'arrivée, c'est un écran qu'on croit figé.
    if (!bloquant) void dismiss();
    if (estLienExterne(url)) {
      Linking.openURL(url.trim()).catch(() => {});
    } else {
      router.push(url as any);
    }
  };

  const fermer = () => { if (!bloquant) void dismiss(); };

  return (
    <View
      pointerEvents="auto"
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 9998, elevation: 9998,
        alignItems: 'center', justifyContent: 'center', padding: MARGE,
      }}>
      {/* Fond sombre : tapable pour fermer, inerte quand le message bloque. */}
      <TouchableOpacity
        activeOpacity={1}
        disabled={bloquant}
        onPress={fermer}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)' }}
      />

      <Animated.View
        style={{
          width: largeurCarte, backgroundColor: Colors.bgCard, borderRadius: 24, overflow: 'hidden',
          opacity, transform: [{ scale }],
          shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 12,
        }}>

        {avecEntete && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 16 }}>
            <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: parure.fond, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={parure.icone} size={17} color={parure.teinte} stroke={2.4} />
            </View>
            <Text style={{ flex: 1, fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase', color: parure.teinte }}>
              {parure.etiquette}
            </Text>
            {!bloquant && (
              <TouchableOpacity
                onPress={fermer}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Fermer"
                style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="x" size={15} color={Colors.textSecondary} stroke={2.6} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {image && (
          <TouchableOpacity
            activeOpacity={affiche ? 0.9 : 1}
            disabled={!affiche}
            onPress={affiche ? agir : undefined}
            accessibilityRole={affiche ? 'imagebutton' : 'image'}
            accessibilityLabel={message.title}
            style={{ alignSelf: 'center', marginTop: avecEntete ? 12 : 0 }}>
            <Image
              source={{ uri: image }}
              onError={() => setImageKo(true)}
              // « contain » : une affiche est faite pour être lue en entier.
              // « cover » couperait le titre ou le numéro de téléphone dès que
              // la hauteur disponible borne l'image.
              resizeMode="contain"
              style={{
                width: largeurImage, height: hauteurImage,
                borderRadius: affiche ? 0 : 16,
                backgroundColor: Colors.bg,
              }}
            />
          </TouchableOpacity>
        )}

        {/* Sans étiquette en haut, la croix se pose SUR l'affiche : discrète,
            mais toujours au même endroit, et assez contrastée pour se voir sur
            une image claire comme sur une image sombre. */}
        {!avecEntete && !bloquant && (
          <TouchableOpacity
            onPress={fermer}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel="Fermer"
            style={{
              position: 'absolute', top: 12, right: 12, zIndex: 2,
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center',
            }}>
            <Icon name="x" size={16} color="#FFFFFF" stroke={2.8} />
          </TouchableOpacity>
        )}

        {!affiche && (
          <View style={{ paddingHorizontal: 18, paddingTop: image || avecEntete ? 12 : 18, gap: 10 }}>
            <Text style={{ fontSize: 19, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary, lineHeight: 25 }}>
              {message.title}
            </Text>
            <Text style={{ fontSize: 14, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, lineHeight: 20 }}>
              {message.body}
            </Text>
          </View>
        )}

        <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 2 }}>
          <TouchableOpacity
            onPress={agir}
            activeOpacity={0.85}
            accessibilityRole="button"
            style={{ backgroundColor: Colors.primary, borderRadius: 16, paddingVertical: 15, alignItems: 'center' }}>
            <Text style={{ color: Colors.textOnDark, fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 15 }}>
              {message.cta_label || (bloquant ? 'Mettre à jour' : 'J’ai compris')}
            </Text>
          </TouchableOpacity>

          {/* Un message bloquant n'offre aucune sortie : c'est tout son intérêt. */}
          {!bloquant && message.cta_url ? (
            <TouchableOpacity onPress={fermer} activeOpacity={0.7} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.textMuted }}>Plus tard</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}
