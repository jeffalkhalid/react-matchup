// components/PlayerAvatar.tsx — le rond d'un joueur : sa photo si elle existe,
// ses initiales sinon.
//
// Chaque écran dessinait son propre rond (huit variantes : rond ou carré
// arrondi, couleur d'équipe, couronne du créateur, anneau « c'est toi »). Ce
// composant ne remplace pas ces styles : il les REÇOIT, et se charge seulement
// de la partie commune — aller chercher l'adresse signée de la photo, la
// montrer quand elle arrive, retomber sur les initiales sinon.
//
// Repli volontaire sur les initiales dans TOUS les cas douteux : pas de photo,
// adresse pas encore signée, image illisible, hors ligne. Un rond vide serait
// pire que des initiales.
import { useState, type ReactNode } from 'react';
import { View, Text, Image, type StyleProp, type ViewStyle } from 'react-native';
import { useAvatarUrl } from '../hooks/useAvatarUrl';

/** « Jean-Marc Dupont » → « JD » ; « kenza » → « K ». */
export function initialsOf(name: string | null | undefined, max = 2): string {
  return (name || '?')
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .slice(0, max)
    .join('')
    .toUpperCase();
}

export function PlayerAvatar({
  name, path, size, radius, backgroundColor, textColor, fontFamily, fontSize,
  ring, ringColor, style, children, initialsMax = 1,
}: {
  name: string | null | undefined;
  /** `players.avatar_path` — absent = initiales. */
  path?: string | null;
  size: number;
  /** Rayon des coins ; par défaut un rond. */
  radius?: number;
  backgroundColor: string;
  textColor: string;
  fontFamily?: string;
  fontSize?: number;
  /** Épaisseur de l'anneau (ex. « c'est toi »). */
  ring?: number;
  ringColor?: string;
  style?: StyleProp<ViewStyle>;
  /** Badge posé par-dessus (couronne du créateur, etc.). */
  children?: ReactNode;
  initialsMax?: number;
}) {
  const url = useAvatarUrl(path);
  const [echec, setEchec] = useState(false);
  const r = radius ?? size / 2;
  const montrePhoto = !!url && !echec;

  return (
    // Deux boîtes : la photo est cadrée (overflow caché) dans la première, et
    // le badge posé par-dessus vit dans la seconde — sinon la couronne du
    // créateur, qui déborde du rond, serait rognée avec l'image.
    <View style={[{ width: size, height: size }, style]}>
      <View
        style={{
          width: size, height: size, borderRadius: r,
          backgroundColor,
          alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          borderWidth: ring ?? 0,
          borderColor: ringColor ?? 'transparent',
        }}
      >
        {montrePhoto ? (
          <Image
          source={{ uri: url! }}
          style={{ width: size, height: size, borderRadius: r }}
          resizeMode="cover"
          // Adresse expirée, réseau coupé, fichier illisible : on repasse aux
          // initiales plutôt que de laisser un trou.
          onError={() => setEchec(true)}
        />
      ) : (
        <Text
          numberOfLines={1}
          style={{
            color: textColor,
            fontFamily,
            fontSize: fontSize ?? Math.round(size * 0.4),
            fontWeight: '900',
          }}
        >
          {initialsOf(name, initialsMax)}
        </Text>
      )}
      </View>
      {children}
    </View>
  );
}
