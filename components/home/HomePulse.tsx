// components/home/HomePulse.tsx — « Ça bouge chez les PAGUISTES ».
//
// Deux cartes côte à côte, à la fin de l'accueil : qui est libre ce soir, et
// sur quel match le club est en train de se prononcer.
//
// Elles ne REFONT pas l'onglet Activité, elles y emmènent — et pas au hasard :
// chaque bouton pointe la chose précise qu'il montre. « Voter » ouvre LE match
// affiché, pas la liste. Un raccourci qui dépose ailleurs qu'à l'endroit promis
// oblige à chercher, et on ne s'en sert plus.
//
// Chaque carte se tait quand elle n'a rien à dire, plutôt que d'afficher un
// zéro : deux encarts vides côte à côte donnent l'impression d'une app morte.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import { availabilitySlots, fetchAvailableOnSlot, slotShortLabel, type AvailabilityRow } from '../../lib/availability';
import { MERCATO_LEVEL_BAND } from '../../lib/mercato';
import {
  predictionWindow, fetchClashCandidates, clashesToPredict, withoutMyGames,
  tightestClashId, type Clash,
} from '../../lib/weekendClash';

const CARTE = {
  flex: 1, backgroundColor: Colors.bgCard, borderRadius: 18,
  borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 10,
} as const;

/**
 * Le milieu ELASTIQUE d'une carte : les photos, et rien d'autre.
 *
 * C'est ce qui rend la carte increvable. L'en-tete garde sa taille en haut,
 * le bouton la sienne en bas, et tout ce qui reste revient au milieu — qui
 * peut valoir zero. Le bouton ne peut donc JAMAIS etre pousse hors de la
 * carte, quelle que soit la place accordee.
 *
 * Et il ne DEVINE pas sa hauteur, il la mesure : elle lui est imposee par le
 * dessus, jamais deduite de son contenu, donc la mesure est stable. En
 * dessous de la taille d'un visage, il n'affiche rien plutot que des ronds
 * coupes. Toutes les estimations de hauteur ont fini par etre fausses au
 * moins une fois ; celle-ci n'en est pas une.
 */
function Haut({ entete, photos, serre }: { entete: (sous: boolean) => ReactNode; photos: (taille?: number) => ReactNode; serre: boolean }) {
  const [h, setH] = useState(0);
  // Mesuree, jamais deduite du contenu : cette zone recoit ce que la carte lui
  // laisse une fois le bouton servi. Les seuils ne decident plus que du
  // CONFORT — se tromper coute une ligne de texte ou des visages, plus jamais
  // un bouton.
  //
  // ORDRE DE SACRIFICE : la phrase d'abord, les visages en dernier. Ce sont
  // eux qui donnent envie de toucher — une carte sans photo est un pave de
  // texte. Sur Android, ou tout est un peu plus grand, ils disparaissaient en
  // premier parce que les deux seuils etaient trop proches.
  const avecPhrase = h === 0 || h >= 96;
  const avecPhotos = h === 0 || h >= 50;
  // Derniers points a gratter avant de les perdre : des visages plus petits.
  const taillePhoto = h > 0 && h < 62 ? 28 : undefined;
  return (
    <View
      onLayout={e => { const v = e.nativeEvent.layout.height; setH(p => (Math.abs(p - v) > 0.5 ? v : p)); }}
      style={{ flex: 1, minHeight: 0, overflow: 'hidden', gap: serre ? 8 : 10 }}
    >
      {entete(avecPhrase)}
      {avecPhotos ? photos(taillePhoto) : null}
    </View>
  );
}

const BOUTON = {
  backgroundColor: Colors.brand, borderRadius: 999,
  // Plus bas et plus discret qu'avant : chaque point rendu ici revient aux
  // visages juste au-dessus, qui sont ce qui donne envie de toucher.
  paddingVertical: 7, alignItems: 'center', justifyContent: 'center',
  flexDirection: 'row', gap: 5,
} as const;

function Bouton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={BOUTON}>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 11.5, color: Colors.primary }}>{label}</Text>
      <Icon name="chevronRight" size={11} color={Colors.primary} stroke={2.6} />
    </TouchableOpacity>
  );
}

/** L'en-tete d'une carte : l'icone dit d'un coup d'oeil de quoi il s'agit. */
function Entete({ icon, titre, sous }: { icon: IconName; titre: string; sous?: string | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
      <View style={{
        width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,193,26,0.18)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name={icon} size={17} color={Colors.brandDeep} stroke={2.2} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {/* DEUX LIGNES autorisees, et pas de retrecissement automatique.
            Deux cartes cote a cote, ca fait un titre par demi-ecran : sur
            Android, « Votes du moment » s'affichait « Votes du ». J'avais
            d'abord demande au texte de retrecir — c'est la regle habituelle
            des titres Fonts.welcome — mais `adjustsFontSizeToFit` ne tient pas
            ses promesses avec cette police sur Android : il s'arrete a son
            plancher, puis coupe au mot. C'est un piege deja paye dans ce
            projet, et je l'ai quand meme repris.
            Un titre qui a le droit de passer a la ligne n'a plus rien a
            mesurer : il ne peut pas etre coupe. */}
        <Text
          numberOfLines={2}
          style={{ fontFamily: Fonts.welcome, fontSize: 15, lineHeight: 20, color: Colors.textPrimary, paddingRight: 4 }}
        >
          {titre}
        </Text>
        {sous ? (
          <Text numberOfLines={2} style={{ fontFamily: Fonts.uiSemi, fontSize: 11, lineHeight: 15, color: Colors.textSecondary }}>
            {sous}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Photos({ rows, max = 4, taille = 34 }: { rows: { id: string; name: string; path?: string | null }[]; max?: number; taille?: number }) {
  const vus = rows.slice(0, max);
  const reste = rows.length - vus.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {vus.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i > 0 ? -10 : 0 }}>
          <PlayerAvatar name={p.name} path={p.path} size={taille} ring={2} ringColor={Colors.bgCard}
            backgroundColor={Colors.brand} textColor={Colors.primary}
            fontFamily={Fonts.uiBlack} fontSize={13} initialsMax={2} />
        </View>
      ))}
      {reste > 0 && (
        <View style={{
          marginLeft: -10, width: taille, height: taille, borderRadius: taille,
          backgroundColor: Colors.bgCardAlt, borderWidth: 2, borderColor: Colors.bgCard,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11, color: Colors.textSecondary }}>{`+${reste}`}</Text>
        </View>
      )}
    </View>
  );
}

export function HomePulse({ myId, myElo, onVisible, hauteur }: {
  myId: string; myElo: number;
  /**
   * Le bloc annonce sa présence à l'accueil.
   *
   * Il se tait quand il n'a rien à dire — l'écran ne peut donc pas savoir s'il
   * occupe de la place, et il ne la réservait pas. Le bloc se faisait couper
   * par la barre d'onglets, ses deux boutons avec (Android, 2026-09-23).
   */
  onVisible?: (visible: boolean) => void;
  /**
   * La hauteur que l'accueil lui accorde, en points.
   *
   * Le bloc s'y tient au lieu de deborder : sous un certain seuil il laisse
   * tomber la phrase sous le titre, puis les photos. Il garde toujours le
   * titre, les noms et le bouton — ce qui permet d'agir. Un bloc a moitie
   * visible, lui, ment sur ce qu'il contient.
   */
  hauteur?: number;
}) {
  const router = useRouter();
  /** La hauteur reelle de la rangee de cartes — imposee par l'accueil. */
  const [rangeeH, setRangeeH] = useState(0);
  const [dispos, setDispos] = useState<AvailabilityRow[]>([]);
  /** Deux au plus : le second prend la place des dispos quand il n'y en a pas. */
  const [clashes, setClashes] = useState<Clash[]>([]);

  const creneau = availabilitySlots()[0] ?? null;

  useFocusEffect(useCallback(() => {
    let vivant = true;
    (async () => {
      if (creneau) {
        const rows = await fetchAvailableOnSlot(creneau, myId);
        if (!vivant) return;
        // « De ton niveau » : la MÊME bande que le mercato, pas un troisième
        // seuil. Un joueur sans niveau connu ne compte pas — on ne peut pas
        // promettre qu'il est à ta hauteur.
        const mien = eloToLevel(myElo);
        setDispos(rows.filter(r => {
          const e = r.player?.elo_score;
          return e != null && Math.abs(eloToLevel(e) - mien) <= MERCATO_LEVEL_BAND;
        }));
      }
      const { start, end } = predictionWindow();
      const parties = await fetchClashCandidates(start, end);
      if (!vivant) return;
      // On ne propose pas de voter sur SON propre match : l'issue dépend de
      // nous, et « 58 % te voient perdre » n'est pas une conversation.
      const liste = withoutMyGames(clashesToPredict(parties), myId);
      // Le plus serré d'abord — c'est celui sur lequel il y a vraiment à dire.
      const choc = tightestClashId(liste);
      const ordonne = choc ? [...liste].sort((a, b) => (a.gameId === choc ? -1 : b.gameId === choc ? 1 : 0)) : liste;
      setClashes(ordonne.slice(0, 2));
    })();
    return () => { vivant = false; };
  }, [myId, myElo, creneau?.key]));

  // Personne de dispo : un DEUXIEME match a voter prend la place libre plutot
  // que de laisser une carte seule au milieu de la ligne.
  const chocsMontres = dispos.length > 0 ? clashes.slice(0, 1) : clashes.slice(0, 2);
  const visible = dispos.length > 0 || chocsMontres.length > 0;
  // Dans un effet, jamais pendant le rendu : prévenir le parent en plein
  // rendu déclencherait sa mise à jour au milieu du nôtre.
  useEffect(() => { onVisible?.(visible); }, [visible, onVisible]);
  if (!visible) return null;

  const quand = creneau ? slotShortLabel(creneau) : 'ce soir';
  // Deux paliers, mesures sur le BLOC ENTIER — titre de section compris, ce
  // que le premier jet avait oublie : il comparait la place accordee a la
  // hauteur de la seule carte, donc il gardait la phrase et les photos dans
  // un bloc trop court, et le bas passait sous la barre d'onglets.
  //
  // Forme complete ~200 points (titre 21 + espace 10 + carte 167), sans la
  // phrase ~170, sans les photos ~124.
  // La hauteur des cartes, MESUREE. Le premier rendu se rabat sur la place
  // annoncee moins le titre de section ; ensuite c'est la vraie valeur.
  const carteH = rangeeH > 0 ? rangeeH : Math.max(0, (hauteur ?? 0) - 31);
  // Seul choix restant : la phrase sous le titre. Les photos, elles, ne se
  // decident plus ici — le milieu elastique s'en charge, lui qui connait sa
  // hauteur reelle.
  const serre = carteH > 0 && carteH < 150;
  const carte = serre ? { ...CARTE, padding: 12, gap: 8 } : CARTE;
  /** Deux cartes cote a cote : chaque titre n'a qu'un demi-ecran. */
  const court = (dispos.length > 0 ? 1 : 0) + chocsMontres.length > 1;

  return (
    <View style={{ gap: 10, flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="users" size={18} color={Colors.textPrimary} stroke={2.2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 19, lineHeight: 25, color: Colors.textPrimary, paddingRight: 6 }}>
          Ça bouge chez les <Text style={{ color: Colors.brandDeep }}>PAGUISTES</Text>
        </Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/activite' as any)} hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textSecondary }}>Voir tout</Text>
          <Icon name="chevronRight" size={12} color={Colors.textSecondary} stroke={2.6} />
        </TouchableOpacity>
      </View>

      <View
        onLayout={e => { const v = e.nativeEvent.layout.height; setRangeeH(p => (Math.abs(p - v) > 0.5 ? v : p)); }}
        style={{ flexDirection: 'row', gap: 10, flex: 1 }}
      >
        {dispos.length > 0 && (
          <View style={carte}>
            <Haut
              serre={serre}
              entete={sous => (
                <Entete
                  icon="users"
                  titre={court ? 'Dispos' : `Dispos ${quand}`}
                  // Phrase COURTE quand deux cartes se partagent la largeur :
                  // « 3 joueurs de ton niveau sont dispos » s'affichait
                  // « 3 joueurs de ton niveau son.. » — la fin, qui porte le
                  // sens, etait justement ce qu'on perdait.
                  sous={sous
                    ? (court
                        ? `${dispos.length} à ton niveau`
                        : `${dispos.length} joueur${dispos.length > 1 ? 's' : ''} de ton niveau ${dispos.length > 1 ? 'sont dispos' : 'est dispo'}`)
                    : null}
                />
              )}
              photos={taille => (
                <Photos taille={taille ?? (serre ? 30 : 34)} rows={dispos.map(r => ({
                  id: r.player?.id ?? r.id ?? '', name: r.player?.name ?? 'Joueur', path: r.player?.avatar_path,
                }))} />
              )}
            />
            <Bouton label={court ? 'Voir' : 'Voir les joueurs'} onPress={() => router.push('/(tabs)/activite?focus=dispo' as any)} />
          </View>
        )}

        {chocsMontres.map((clash, i) => (
          <View key={clash.gameId} style={carte}>
            {/* Deux cartes « Votes du moment » cote a cote se liraient comme
                un doublon : la seconde pose la question directement. */}
            <Haut
              serre={serre}
              entete={sous => (
                <Entete
                  icon="signal"
                  // Titres COURTS quand deux cartes se partagent la largeur :
                  // « Votes du moment » s'affichait « Votes du » sur Android,
                  // ou le retrecissement automatique ne tient pas ses
                  // promesses. Un titre choisi pour la place disponible vaut
                  // mieux qu'un titre coupe.
                  titre={court
                    ? (i === 0 ? 'Les votes' : 'Qui gagne ?')
                    : (i === 0 ? 'Votes du moment' : 'Qui va gagner ?')}
                  sous={sous
                    ? `${clash.teamA.map(p => p.name.split(' ')[0]).join(' / ')} vs ${clash.teamB.map(p => p.name.split(' ')[0]).join(' / ')}`
                    : null}
                />
              )}
              photos={taille => (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Photos taille={taille ?? (serre ? 30 : 34)} rows={clash.teamA.map(p => ({ id: p.id, name: p.name, path: p.avatarPath }))} max={2} />
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10.5, color: Colors.textMuted }}>VS</Text>
                  <Photos taille={taille ?? (serre ? 30 : 34)} rows={clash.teamB.map(p => ({ id: p.id, name: p.name, path: p.avatarPath }))} max={2} />
                </View>
              )}
            />
            {/* Vers CE match précisément, pas vers la liste : l'onglet place la
                carte en tête du rail (cf. app/(tabs)/activite.tsx). */}
            <Bouton label="Voter" onPress={() => router.push(`/(tabs)/activite?focus=${clash.gameId}` as any)} />
          </View>
        ))}
      </View>
    </View>
  );
}
