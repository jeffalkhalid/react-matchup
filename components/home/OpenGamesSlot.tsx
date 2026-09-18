// components/home/OpenGamesSlot.tsx — « Ça se joue bientôt ».
//
// Ce que voit quelqu'un qui n'a ni match programmé ni tournoi ouvert. Avant,
// c'était une carte « Aucun match programmé » avec une flèche vers le lobby —
// c'est-à-dire le bouton « Trouver un match » répété une deuxième fois, dix
// centimètres plus bas.
//
// C'EST LA CARTE DU LOBBY, PAS UNE VIGNETTE MAISON. Une première version
// dessinait une petite tuile qui ne montrait PAS les quatre créneaux — donc
// pas qui est déjà là ni quelle place est libre, qui est justement ce qu'on
// regarde avant de rejoindre. Le dépôt a déjà sa représentation d'une partie
// (`GameCard`, importée telle quelle par matchmaking.tsx).
//
// JUSQU'À TROIS PARTIES, EN CARROUSEL. L'accueil ne défile pas et une carte du
// lobby en occupe déjà toute la place : trois empilées déborderaient. Elles
// sont donc côte à côte, on les fait glisser, et la hauteur reste celle d'une
// seule. Le classement (niveau, proximité, urgence, club favori) vit dans lib/homeSlot.
//
// CHAQUE PAGE A LA LARGEUR EXACTE DE LA CARTE D'AVANT, sans aperçu de la
// suivante. Le carrousel des tournois montre un bout de la carte d'après,
// mais ses cartes sont étroites par construction. `GameCard` dimensionne ses
// quatre pastilles sur la largeur de l'ÉCRAN, pas sur la sienne : la rétrécir
// pour laisser dépasser la suivante les écraserait. Ce qui dit « il y en a
// d'autres », c'est « 1 sur 3 » dans le titre.
//
// LA JONCTION RESTE AU LOBBY. Un créneau libre tapé depuis l'accueil OUVRE la
// partie, il n'inscrit pas : rejoindre met en jeu le côté, les votes, la
// fourchette de niveau et les refus du serveur — tout ça reste à un seul
// endroit.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { GameCard } from '../../app/(tabs)/lobby';
import type { OpenGame } from '../../types';

const GAP = 10;

/** Rien d'ouvert : on le dit, et on propose le geste. */
function CarteCreer({ onCreate }: { onCreate: () => void }) {
  return (
    <TouchableOpacity
      onPress={onCreate}
      activeOpacity={0.85}
      style={{
        flex: 1, backgroundColor: Colors.bgCard, borderRadius: 18,
        borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.borderDark,
        paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12,
      }}
    >
      <View style={{
        width: 38, height: 38, borderRadius: 13,
        backgroundColor: 'rgba(255,193,26,0.16)',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="plus" size={20} color={Colors.brandDeep} stroke={2.6} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
          Pas encore de match
        </Text>
        <Text style={{ fontSize: 11, lineHeight: 15, fontFamily: Fonts.uiSemi, color: Colors.textMuted, marginTop: 3 }}>
          Crée le tien, les autres te rejoignent.
        </Text>
      </View>
      <Icon name="chevronRight" size={14} color={Colors.textMuted} stroke={2.4} />
    </TouchableOpacity>
  );
}

export function OpenGamesSlot({ games, myId, myElo, onOpenGame, onSeeAll, onCreate }: {
  /** Déjà filtrées et classées par `suggestibleGames` — ce composant ne trie rien. */
  games: OpenGame[];
  myId: string;
  myElo: number;
  onOpenGame: (id: string) => void;
  onSeeAll: () => void;
  onCreate: () => void;
}) {
  // La largeur d'une page = la largeur disponible, mesurée : c'est ce qui
  // garde `GameCard` exactement à la taille qu'il avait seul.
  const [largeur, setLargeur] = useState(0);
  const [page, setPage] = useState(0);

  // Les photos prennent le BLANC qui reste sous la carte. La zone du carrousel a
  // une hauteur fixée par l'accueil (qui ne défile pas) ; la carte n'en occupe
  // qu'une partie. On mesure les deux, et on agrandit les photos de la
  // différence (moins 4 px de marge). Une carte grandit d'autant que ses
  // photos : le calcul se stabilise en une étape, et la carte ne dépasse jamais
  // sa zone. La largeur des colonnes plafonne aussi la taille (lobby.InlineSlots).
  const [hauteurZone, setHauteurZone] = useState(0);
  const [hauteursCartes, setHauteursCartes] = useState<Record<string, number>>({});
  const [photo, setPhoto] = useState(42);
  const photoRef = useRef(42);
  useEffect(() => {
    const hauteurs = Object.values(hauteursCartes);
    if (hauteurZone <= 0 || hauteurs.length === 0) return;
    const carte = Math.max(...hauteurs);
    const cible = Math.max(42, Math.min(72, Math.floor(photoRef.current + (hauteurZone - carte) - 4)));
    if (Math.abs(cible - photoRef.current) > 1) {
      photoRef.current = cible;
      setPhoto(cible);
    }
  }, [hauteurZone, hauteursCartes]);

  if (games.length === 0) return <CarteCreer onCreate={onCreate} />;

  const courante = Math.min(page, games.length - 1);

  return (
    <View style={{ flex: 1, gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="zap" size={13} color={Colors.brandDeep} stroke={2.4} />
        <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, letterSpacing: 0.8, color: Colors.textPrimary }}>
          ÇA SE JOUE BIENTÔT
        </Text>
        {games.length > 1 && (
          <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
            {courante + 1} sur {games.length}
          </Text>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onSeeAll} hitSlop={8}>
          <Text style={{ fontSize: 11, fontFamily: Fonts.uiExtraBold, color: Colors.brandDeep }}>
            Tout voir
          </Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }} onLayout={e => { setLargeur(e.nativeEvent.layout.width); setHauteurZone(e.nativeEvent.layout.height); }}>
        {largeur > 0 && (
          <FlatList
            horizontal
            data={games}
            keyExtractor={g => g.id}
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            // S'arrête carte par carte : on voit toujours UNE carte entière.
            snapToInterval={largeur + GAP}
            snapToAlignment="start"
            contentContainerStyle={{ gap: GAP }}
            onMomentumScrollEnd={e =>
              setPage(Math.round(e.nativeEvent.contentOffset.x / (largeur + GAP)))}
            renderItem={({ item }) => (
              <View
                style={{ width: largeur }}
                onLayout={e => {
                  const h = e.nativeEvent.layout.height;
                  setHauteursCartes(prev => (Math.abs((prev[item.id] ?? 0) - h) < 1 ? prev : { ...prev, [item.id]: h }));
                }}
              >
                <GameCard
                  game={item as any}
                  variant="explore"
                  myElo={myElo}
                  playerId={myId}
                  onPress={() => onOpenGame(item.id)}
                  // Un créneau libre ouvre la partie au lieu d'inscrire sur
                  // place : la jonction et ses refus restent au lobby.
                  onApply={(gameId) => onOpenGame(gameId)}
                  // Calendrier / Partager : des gestes pour une partie qu'on a
                  // déjà rejointe, pas pour une découverte.
                  hideActions
                  // Taille calculée sur le blanc disponible (voir plus haut).
                  avatarSize={photo}
                />
              </View>
            )}
          />
        )}
      </View>
    </View>
  );
}

export default OpenGamesSlot;
