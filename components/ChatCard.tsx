// components/ChatCard.tsx — une conversation de partie, en carte.
//
// Refonte de l'onglet Chats (design_handoff_chats_refonte, option 4a). Elle
// remplace <ChatRow>, qui montrait « date · lieu · un prénom » et pas une
// ligne de ce qui s'était dit : toutes les lignes se ressemblaient, et on ne
// savait jamais laquelle ouvrir.
//
// La carte répond aux trois questions qu'on se pose devant une liste de
// messages : de quel match s'agit-il (mosaïque + étiquette de date + club),
// avec qui (prénoms), et qu'est-ce qui s'est dit en dernier (aperçu).
//
// Les mots et les dates viennent de lib/chatList — partagés avec les Directs,
// pour que « 12 min » ou « hier » veuillent dire la même chose partout.
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../lib/theme';
import { PlayerAvatar } from './PlayerAvatar';
import {
  dateTag, relativeTime, hourLabel, previewLine, othersLabel, initialsColor,
  longDateLabel, dayParts,
  type DateTagKind,
} from '../lib/chatList';
import type { GameChat } from '../hooks/useGameChats';

/** Le gris des bordures en pointillés — une place libre, une archive. */
export const POINTILLES = '#D4D4D8';

/** Le gris d'un aperçu déjà lu : plus doux que `textMuted`, encore lisible. */
const APERCU_LU = '#71717A';

const MOSAIQUE = 54;
const TUILE = (MOSAIQUE - 2) / 2;

interface Joueur {
  id: string;
  name: string;
  path: string | null;
  isMe: boolean;
}

/**
 * Les quatre joueurs de la partie, MOI d'abord.
 *
 * Le créateur n'est PAS une ligne de `game_participants` : il vit sur la
 * partie (`creator_id`). Ne lire que les participants donnait trois joueurs
 * sur quatre — le piège le plus cher de cette base.
 */
export function chatPlayers(game: GameChat, myId: string | undefined): Joueur[] {
  const vus = new Set<string>();
  const out: Joueur[] = [];
  const ajouter = (id: string, name: string, path: string | null) => {
    if (!id || vus.has(id)) return;
    vus.add(id);
    out.push({ id, name, path, isMe: id === myId });
  };
  ajouter(game.creator_id, game.creator?.name ?? '?', game.creator?.avatar_path ?? null);
  for (const p of game.participants ?? []) {
    if (p.status !== 'accepted') continue;
    ajouter(p.player_id, p.player?.name ?? '?', p.player?.avatar_path ?? null);
  }
  // Ma tuile occupe toujours le premier emplacement, en noir.
  return [...out.filter(p => p.isMe), ...out.filter(p => !p.isMe)];
}

/** La mosaïque 2×2 des photos, avec l'étiquette de date posée dessous. */
function Mosaique({ joueurs, tag }: { joueurs: Joueur[]; tag: { label: string; kind: DateTagKind } }) {
  const slots: (Joueur | undefined)[] = [joueurs[0], joueurs[1], joueurs[2], joueurs[3]];
  const fond = tag.kind === 'today' ? Colors.primary : tag.kind === 'tomorrow' ? Colors.brand : Colors.bg;
  const encre = tag.kind === 'today' ? Colors.brand : tag.kind === 'tomorrow' ? Colors.primary : Colors.textSecondary;

  return (
    <View style={{ width: MOSAIQUE, height: MOSAIQUE }}>
      <View style={{
        width: MOSAIQUE, height: MOSAIQUE, borderRadius: 17, overflow: 'hidden',
        backgroundColor: Colors.bgCard, flexDirection: 'row', flexWrap: 'wrap', gap: 2,
      }}>
        {slots.map((p, i) => (p ? (
          <PlayerAvatar
            key={p.id}
            name={p.name} path={p.path} size={TUILE} radius={0}
            backgroundColor={p.isMe ? Colors.primary : initialsColor(p.name)}
            textColor={Colors.textOnDark}
            fontFamily={Fonts.uiBlack} fontSize={10} initialsMax={1}
          />
        ) : (
          // Une place libre se voit : pointillés, pas un carré plein qu'on
          // prendrait pour un joueur sans photo.
          <View key={`vide-${i}`} style={{
            width: TUILE, height: TUILE, backgroundColor: Colors.bgCard,
            borderWidth: 1, borderStyle: 'dashed', borderColor: POINTILLES,
          }} />
        )))}
      </View>

      {tag.label ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: -7, alignItems: 'center' }}>
          <View style={{
            backgroundColor: fond, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1,
            borderWidth: 2, borderColor: Colors.bgCard,
          }}>
            <Text numberOfLines={1} style={{
              fontFamily: Fonts.uiBlack, fontSize: 9, letterSpacing: 0.4, color: encre,
            }}>
              {tag.label.toUpperCase()}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Le bloc calendrier des archives.
 *
 * Une mosaïque de visages promet une conversation vivante. Dans les archives
 * le match est joué : ce qui reste utile, c'est QUAND il a eu lieu.
 */
function BlocCalendrier({ matchDate }: { matchDate: string }) {
  const { jour, numero } = dayParts(matchDate);
  return (
    <View style={{
      width: MOSAIQUE, height: MOSAIQUE, borderRadius: 14, opacity: 0.7,
      backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 9, color: Colors.textMuted, letterSpacing: 0.4 }}>
        {jour.toUpperCase()}
      </Text>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 21, lineHeight: 25, color: Colors.textSecondary }}>
        {numero}
      </Text>
    </View>
  );
}

export function ChatCard({ game, playerId, onPress, now, variant = 'live' }: {
  game: GameChat;
  playerId: string | undefined;
  onPress: () => void;
  /** Injectable pour les tests et les captures. */
  now?: Date;
  /** `archive` : match joué, bloc calendrier et date en toutes lettres. */
  variant?: 'live' | 'archive';
}) {
  const maintenant = now ?? new Date();
  const joueurs = chatPlayers(game, playerId);
  const autres = joueurs.filter(p => !p.isMe);
  const nonLu = game.unread > 0;

  const expediteur = joueurs.find(p => p.id === game.last_message?.player_id);
  const apercu = previewLine(
    game.last_message?.content,
    expediteur?.name,
    game.last_message?.player_id === playerId,
  );

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={{
        marginHorizontal: 16, marginBottom: 8,
        backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16,
        paddingTop: 12, paddingHorizontal: 12, paddingBottom: 14,
        flexDirection: 'row', alignItems: 'center', gap: 14,
        shadowColor: Colors.primary, shadowOpacity: 0.04, shadowRadius: 2,
        shadowOffset: { width: 0, height: 1 }, elevation: 1,
      }}
    >
      {variant === 'archive'
        ? <BlocCalendrier matchDate={game.match_date} />
        : <Mosaique joueurs={joueurs} tag={dateTag(game.match_date, maintenant)} />}

      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={{
            flex: 1, fontSize: 14, color: Colors.textPrimary,
            fontFamily: nonLu ? Fonts.uiBlack : Fonts.uiBold,
          }}>
            {game.location}
          </Text>
          {game.is_challenge ? (
            <View style={{
              backgroundColor: 'rgba(255,193,26,0.18)', borderWidth: 1, borderColor: Colors.brand,
              borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1,
            }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 9, color: Colors.brandDeep }}>DÉFI</Text>
            </View>
          ) : null}
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textMuted }}>
            {relativeTime(game.last_message_at, maintenant)}
          </Text>
        </View>

        {variant === 'archive' ? (
          <Text numberOfLines={1} style={{ fontSize: 11, color: Colors.textSecondary, fontFamily: Fonts.uiSemi }}>
            {`${longDateLabel(game.match_date)}  ·  ${hourLabel(game.match_date)}`}
          </Text>
        ) : (
          <Text numberOfLines={1} style={{ fontSize: 11, color: Colors.textSecondary, fontFamily: Fonts.uiSemi }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
              {hourLabel(game.match_date)}
            </Text>
            {`  ·  ${othersLabel(autres.map(p => p.name))}`}
          </Text>
        )}

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <Text numberOfLines={1} style={{
            flex: 1, fontSize: 12,
            color: nonLu ? Colors.textPrimary : APERCU_LU,
            fontFamily: nonLu ? Fonts.uiSemi : Fonts.ui,
          }}>
            {apercu ?? 'Pas encore de message'}
          </Text>
          {nonLu ? (
            <View style={{
              minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
              backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11, color: Colors.textOnDark }}>
                {game.unread > 99 ? '99+' : game.unread}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}
