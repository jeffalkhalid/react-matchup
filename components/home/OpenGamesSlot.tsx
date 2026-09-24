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
//
// ── SA HAUTEUR EST MESURÉE, JAMAIS ESTIMÉE ─────────────────────────────────
//
// Ce bloc dessine une carte qui ne lui appartient pas. Sa hauteur dépend du
// match affiché (un compétitif porte une ligne d'enjeu qu'un amical n'a pas),
// de la largeur, ET de la taille de police du téléphone — les textes d'une
// carte sont du CONTENU, ils suivent le réglage système que lib/uiText ne
// couvre pas. Aucune constante ne peut être vraie pour les trois.
//
// lib/homeLayout accordait 120 points à une carte qui en dessine près du
// double. Le bloc recevait donc exactement ce qu'il demandait, se faisait
// couper en plein milieu des visages, et les points qui manquaient restaient
// en blanc sous « Ça bouge ». Le blanc et la coupure étaient le même nombre.
//
// D'où la SONDE ci-dessous : elle dessine le bloc pour de vrai, hors flux et
// invisible, et rend sa hauteur naturelle. Le budget ne connaît plus que ce
// chiffre-là.
//
// L'ANCIENNE PHOTO ADAPTATIVE A DISPARU. Elle rétrécissait les visages pour
// occuper le blanc restant — un vestige de l'époque « remplir l'écran », alors
// que la règle est devenue : un bloc a une taille juste, le reste est du
// blanc. Elle ne pouvait de toute façon pas tenir sa promesse : la carte
// s'écrit `168 + photo`, donc sous 168 points de zone, AUCUNE taille de photo
// ne la fait entrer. Elle ne faisait que descendre jusqu'à son plancher et
// laisser couper le reste, sans rien signaler.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { GameCard } from '../../app/(tabs)/lobby';
import type { OpenGame } from '../../types';

/** L'espace entre deux pages du carrousel (horizontal). */
const GAP = 10;

/**
 * L'espace entre le titre du bloc et la carte.
 *
 * ÉCRIT UNE FOIS, LU DEUX FOIS : par le `gap` du rendu réel et par la somme de
 * la sonde. C'est le SEUL nombre de toute la chaîne de mesure ; s'il change,
 * les deux changent ensemble.
 */
const GAP_TITRE = 7;

/**
 * La taille des photos sur l'accueil.
 *
 * C'est un CHOIX DE DESSIN, comme une taille de police — pas un budget :
 * aucune hauteur n'en est déduite par calcul, elle est mesurée. Sans cette
 * valeur, `GameCard` dimensionne ses photos sur la largeur de la colonne
 * (jusqu'à 72 points) et sa carte devient assez haute pour chasser « Ça
 * bouge » de l'accueil.
 */
const PHOTO = 42;

/** Rien d'ouvert : on le dit, et on propose le geste. */
function CarteCreer({ onCreate }: { onCreate: () => void }) {
  return (
    <TouchableOpacity
      onPress={onCreate}
      activeOpacity={0.85}
      style={{
        // `flexGrow` et non `flex` : `flex: 1` part d'une base de 0 et
        // s'écrase à zéro dans un parent de hauteur automatique — c'est-à-dire
        // dans la sonde, où la carte doit justement révéler sa hauteur.
        // `flexGrow` part de la hauteur du contenu et occupe le reste s'il y
        // en a.
        flexGrow: 1, backgroundColor: Colors.bgCard, borderRadius: 18,
        borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.borderDark,
        // Le rembourrage vertical DONNE sa hauteur naturelle à la carte. Sans
        // lui elle valait ce que valaient ses 38 points d'icône : depuis
        // qu'elle ne s'étire plus pour remplir la zone, c'est ici que se
        // décide sa taille.
        paddingHorizontal: 14, paddingVertical: 18,
        flexDirection: 'row', alignItems: 'center', gap: 12,
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

/**
 * Le titre du bloc.
 *
 * Dessiné par le rendu réel ET par la sonde, depuis ce seul endroit : ce que
 * la sonde mesure est donc, littéralement, ce que l'écran dessine.
 */
function TitreBloc({ total, page, onSeeAll }: {
  total: number; page: number; onSeeAll: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Icon name="zap" size={13} color={Colors.brandDeep} stroke={2.4} />
      <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, letterSpacing: 0.8, color: Colors.textPrimary }}>
        ÇA SE JOUE BIENTÔT
      </Text>
      {total > 1 && (
        <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
          {page + 1} sur {total}
        </Text>
      )}
      <View style={{ flex: 1 }} />
      <TouchableOpacity onPress={onSeeAll} hitSlop={8}>
        <Text style={{ fontSize: 11, fontFamily: Fonts.uiExtraBold, color: Colors.brandDeep }}>
          Tout voir
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/** Une page du carrousel : la carte du lobby, ou l'invitation à créer. */
function PageBloc({ game, myId, myElo, onOpenGame, onCreate }: {
  game: OpenGame | null;
  myId: string; myElo: number;
  onOpenGame: (id: string) => void;
  onCreate: () => void;
}) {
  if (!game) return <CarteCreer onCreate={onCreate} />;
  return (
    <GameCard
      game={game as any}
      variant="explore"
      myElo={myElo}
      playerId={myId}
      onPress={() => onOpenGame(game.id)}
      // Un créneau libre ouvre la partie au lieu d'inscrire sur place : la
      // jonction et ses refus restent au lobby.
      onApply={(gameId) => onOpenGame(gameId)}
      // Calendrier / Partager : des gestes pour une partie qu'on a déjà
      // rejointe, pas pour une découverte.
      hideActions
      avatarSize={PHOTO}
    />
  );
}

/** Ce que la sonde rend à l'écran d'accueil. */
export interface MesureOpenGames {
  /** La hauteur naturelle du bloc entier : titre + espace + la plus haute carte. */
  height: number;
  /** Par partie, pour que le rendu réel puisse se comparer à ce qui a été annoncé. */
  parPartie: Record<string, number>;
}

/**
 * LA SONDE — elle dessine le bloc pour de vrai et rend sa hauteur naturelle.
 *
 * ⚠️ NE LUI AJOUTEZ NI `bottom` NI `height`, ET NE LA PLACEZ PAS DANS UNE
 * BOÎTE À HAUTEUR IMPOSÉE. C'est la seule façon de casser l'absence de
 * boucle, et rien ne le signalerait :
 *
 *   - `position: absolute` avec `top` SEUL (ni `bottom`, ni `height`) : le
 *     moteur de mise en page calcule la hauteur sur le contenu, avec une
 *     hauteur disponible indéfinie. La hauteur du parent n'entre PAS dans le
 *     calcul. C'est ce qui rend la mesure indépendante de la place que
 *     lib/homeLayout accordera ensuite au bloc.
 *   - `left: 0, right: 0` : la largeur est celle de la colonne, résolue dans
 *     la MÊME passe. La sonde n'attend donc pas qu'une largeur transite par un
 *     `useState` — ça économise une passe entière.
 *   - hors flux : elle ne compte pas dans le contenu de la colonne. Et la
 *     colonne tient sa hauteur d'un `flex: 1` venu de l'écran, jamais de son
 *     contenu — deuxième verrou.
 *
 * Le graphe reste donc acyclique :
 *   police, largeur écran → colonne → hauteur du bloc → budget → rendu.
 * Aucune flèche ne revient. Deux passes, puis plus rien ne bouge.
 */
export function OpenGamesProbe({ games, myId, myElo, onGeometry }: {
  games: OpenGame[];
  myId: string; myElo: number;
  onGeometry: (m: MesureOpenGames) => void;
}) {
  const [hTitre, setHTitre] = useState(0);
  const [hCartes, setHCartes] = useState<Record<string, number>>({});
  // Le rapport passe par une référence : l'écran n'a pas à mémoriser son
  // callback pour que la boucle d'effets reste sage.
  const rapport = useRef(onGeometry);
  rapport.current = onGeometry;
  const derniere = useRef('');

  // Sans partie, le bloc dessine l'invitation à en créer une — SANS titre, et
  // la sonde doit s'en souvenir : mesurer un titre que l'écran ne dessine pas,
  // c'est annoncer une hauteur que rien n'occupe. Le titre reviendrait alors
  // en blanc sous la carte, très exactement le défaut qu'on répare.
  const avecTitre = games.length > 0;
  const cles = avecTitre ? games.map(g => g.id) : ['__creer'];
  const signature = cles.join('|');

  useEffect(() => {
    const mesurees = cles.map(k => hCartes[k] ?? 0).filter(h => h > 0);
    if ((avecTitre && hTitre <= 0) || mesurees.length < cles.length) return;
    const height = (avecTitre ? hTitre + GAP_TITRE : 0) + Math.max(...mesurees);
    const parPartie: Record<string, number> = {};
    for (const k of cles) parPartie[k] = hCartes[k];
    // On ne réveille l'écran que si la hauteur OU le détail a bougé.
    const empreinte = `${height.toFixed(1)}#${cles.map(k => hCartes[k].toFixed(1)).join(',')}`;
    if (empreinte === derniere.current) return;
    derniere.current = empreinte;
    rapport.current({ height, parPartie });
  }, [hTitre, hCartes, signature]);

  const mesurer = (cle: string) => (e: any) => {
    // Lire AVANT le setState : l'événement natif est recyclé, un accès différé
    // rend une hauteur nulle.
    const h = e.nativeEvent.layout.height;
    setHCartes(p => (Math.abs((p[cle] ?? 0) - h) < 0.5 ? p : { ...p, [cle]: h }));
  };

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 }}
    >
      {avecTitre && (
        <View
          onLayout={e => {
            const h = e.nativeEvent.layout.height;
            setHTitre(p => (Math.abs(p - h) < 0.5 ? p : h));
          }}
        >
          <TitreBloc total={games.length} page={0} onSeeAll={() => {}} />
        </View>
      )}
      {cles.map((cle, i) => (
        <View key={cle} onLayout={mesurer(cle)}>
          <PageBloc
            game={games[i] ?? null}
            myId={myId}
            myElo={myElo}
            onOpenGame={() => {}}
            onCreate={() => {}}
          />
        </View>
      ))}
    </View>
  );
}

export function OpenGamesSlot({ games, myId, myElo, onOpenGame, onSeeAll, onCreate, annonces }: {
  /** Déjà filtrées et classées par `suggestibleGames` — ce composant ne trie rien. */
  games: OpenGame[];
  myId: string;
  myElo: number;
  onOpenGame: (id: string) => void;
  onSeeAll: () => void;
  onCreate: () => void;
  /** Ce que la sonde a annoncé, par partie. Sert au filet de `__DEV__`. */
  annonces?: Record<string, number>;
}) {
  // La largeur d'une page = la largeur disponible, mesurée : c'est ce qui
  // garde `GameCard` exactement à la taille qu'il avait seul.
  const [largeur, setLargeur] = useState(0);
  const [page, setPage] = useState(0);

  // ── Le filet (__DEV__ seulement) ─────────────────────────────────────────
  //
  // La sonde annonce, le rendu dessine. Rien n'empêche `GameCard` de gagner
  // une ligne dans six mois sans que personne n'y pense — et Jest ne le verra
  // pas : il n'a pas de moteur de mise en page, il ne saurait que remodeler la
  // géométrie à la main. Le contrôle tourne donc dans la VRAIE app, là où le
  // vrai moteur est présent. En production, les `onLayout` ne sont même pas
  // posés : le filet ne coûte rien.
  const reel = useRef<{ racine: number; titre: number; pages: Record<string, number> }>({ racine: 0, titre: 0, pages: {} });
  const deja = useRef<Set<string>>(new Set());
  const controler = () => {
    const { racine, titre, pages } = reel.current;
    if (racine <= 0 || titre <= 0) return;
    for (const [id, h] of Object.entries(pages)) {
      const annonce = annonces?.[id];
      if (annonce != null && Math.abs(h - annonce) > 2 && !deja.current.has(`sonde:${id}`)) {
        deja.current.add(`sonde:${id}`);
        console.warn(
          '[accueil] « Ça se joue bientôt » : la sonde et le rendu divergent.\n'
          + `  partie   ${id}\n`
          + `  annoncée ${annonce.toFixed(1)} pt\n`
          + `  réelle   ${h.toFixed(1)} pt\n`
          + `  écart    ${(h - annonce).toFixed(1)} pt\n`
          + '  → la hauteur mesurée hors flux ne décrit plus ce que le carrousel dessine.',
        );
      }
      const besoin = titre + GAP_TITRE + h;
      if (besoin > racine + 2 && !deja.current.has(`coupe:${id}`)) {
        deja.current.add(`coupe:${id}`);
        console.warn(
          '[accueil] « Ça se joue bientôt » déborde : la carte est coupée.\n'
          + `  partie ${id}\n`
          + `  besoin ${besoin.toFixed(1)} pt (titre ${titre.toFixed(1)} + ${GAP_TITRE} + carte ${h.toFixed(1)})\n`
          + `  reçu   ${racine.toFixed(1)} pt\n`
          + `  écart  ${(besoin - racine).toFixed(1)} pt`,
        );
      }
    }
  };

  if (games.length === 0) return <CarteCreer onCreate={onCreate} />;

  const courante = Math.min(page, games.length - 1);

  return (
    <View
      // `flexGrow` et non `flex` : dans l'accueil le parent impose la hauteur
      // et le bloc la remplit ; ailleurs — le lobby, un essai — il prend
      // simplement la hauteur de son contenu au lieu de s'écraser à zéro.
      style={{ flexGrow: 1, gap: GAP_TITRE }}
      onLayout={__DEV__ ? e => { reel.current.racine = e.nativeEvent.layout.height; controler(); } : undefined}
    >
      <View onLayout={__DEV__ ? e => { reel.current.titre = e.nativeEvent.layout.height; controler(); } : undefined}>
        <TitreBloc total={games.length} page={courante} onSeeAll={onSeeAll} />
      </View>

      <View style={{ flexGrow: 1 }} onLayout={e => setLargeur(e.nativeEvent.layout.width)}>
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
                // `alignSelf: flex-start` : la liste horizontale étirerait
                // sinon ses pages à sa propre hauteur, et la carte ne serait
                // plus mesurable — on lirait la hauteur de la zone, pas la
                // sienne. Sans étirement, la page vaut sa carte.
                style={{ width: largeur, alignSelf: 'flex-start' }}
                onLayout={__DEV__ ? e => { reel.current.pages[item.id] = e.nativeEvent.layout.height; controler(); } : undefined}
              >
                <PageBloc
                  game={item}
                  myId={myId}
                  myElo={myElo}
                  onOpenGame={onOpenGame}
                  onCreate={onCreate}
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
