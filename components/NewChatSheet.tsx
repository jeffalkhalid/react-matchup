// components/NewChatSheet.tsx — « Nouvelle conversation ».
//
// Refonte de l'onglet Chats, lot B (design_handoff_chats_refonte §2). On
// choisit le match, on écrit le premier message, et les joueurs inscrits sont
// ajoutés. Le message est OBLIGATOIRE : une conversation lancée vide
// recréerait le bruit qu'on vient de supprimer.
//
// Les matchs qui ont déjà un fil ne sont pas sélectionnables — ils sont
// listés à part, avec « Ouvrir ». C'est ce qui empêche les doublons, et
// c'est plus honnête que de griser une ligne sans dire pourquoi.
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, ScrollView, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../lib/theme';
import { Icon } from './community/icons';
import { PlayerAvatar } from './PlayerAvatar';
import { POINTILLES, chatPlayers } from './ChatCard';
import { autoTitle, hourLabel, dayParts, dayGap, initialsColor } from '../lib/chatList';
import type { GameChat, StartableGame } from '../hooks/useGameChats';

/** Une partie de padel se joue à quatre. */
const PLACES = 4;

function Titre({ mot }: { mot: string }) {
  return (
    <Text style={{
      fontFamily: Fonts.uiBlack, fontSize: 11, letterSpacing: 0.8,
      color: Colors.textMuted, paddingTop: 14, paddingBottom: 8,
    }}>
      {mot.toUpperCase()}
    </Text>
  );
}

/** Le bloc jour + numéro, à gauche de chaque match. */
function Calendrier({ matchDate }: { matchDate: string }) {
  const { jour, numero } = dayParts(matchDate);
  const aujourdhui = dayGap(matchDate) === 0;
  return (
    <View style={{
      width: 40, height: 46, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
      backgroundColor: aujourdhui ? Colors.primary : Colors.bgCard,
      borderWidth: aujourdhui ? 0 : 1, borderColor: Colors.border,
    }}>
      <Text style={{
        fontFamily: Fonts.uiBlack, fontSize: 8, letterSpacing: 0.3,
        color: aujourdhui ? Colors.textOnDark : Colors.textMuted,
      }}>
        {jour.toUpperCase()}
      </Text>
      <Text style={{
        fontFamily: Fonts.welcome, fontSize: 21, lineHeight: 25,
        color: aujourdhui ? Colors.brand : Colors.textPrimary,
      }}>
        {numero}
      </Text>
    </View>
  );
}

/** Les visages déjà inscrits, empilés, et les places restantes en pointillés. */
function Empiles({ game, myId }: { game: StartableGame; myId: string | undefined }) {
  const joueurs = chatPlayers(game, myId);
  const libres = Math.max(0, PLACES - joueurs.length);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {joueurs.slice(0, PLACES).map((p, i) => (
        <View key={p.id} style={{ marginLeft: i === 0 ? 0 : -6, borderRadius: 999, borderWidth: 2, borderColor: Colors.bg }}>
          <PlayerAvatar
            name={p.name} path={p.path} size={22}
            backgroundColor={p.isMe ? Colors.primary : initialsColor(p.name)}
            textColor={Colors.textOnDark} fontFamily={Fonts.uiBlack} fontSize={9} initialsMax={1}
          />
        </View>
      ))}
      {Array.from({ length: libres }).map((_, i) => (
        <View
          key={`libre-${i}`}
          style={{
            width: 22, height: 22, borderRadius: 11, marginLeft: joueurs.length === 0 && i === 0 ? 0 : -6,
            borderWidth: 1, borderStyle: 'dashed', borderColor: POINTILLES, backgroundColor: Colors.bg,
          }}
        />
      ))}
    </View>
  );
}

export function NewChatSheet({ visible, onClose, startables, dejaOuvertes, myId, onChoose, onOpenExisting, envoi }: {
  visible: boolean;
  onClose: () => void;
  /** Mes matchs à venir SANS conversation. */
  startables: StartableGame[];
  /** Mes matchs à venir qui en ont déjà une. */
  dejaOuvertes: GameChat[];
  myId: string | undefined;
  /** Le joueur valide : à l'écran de faire l'appel serveur. */
  onChoose: (game: StartableGame, message: string) => void;
  onOpenExisting: (gameId: string) => void;
  /** Vrai pendant l'appel : le bouton se verrouille. */
  envoi?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [choisi, setChoisi] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const game = useMemo(() => startables.find(g => g.id === choisi) ?? null, [startables, choisi]);

  // La feuille oublie tout quand elle se ferme. Sans ça, l'écran qui la ferme
  // lui-même après un envoi réussi la rouvrirait sur le match précédent et un
  // message déjà parti.
  useEffect(() => {
    if (!visible) { setChoisi(null); setMessage(''); }
  }, [visible]);
  const pret = !!game && message.trim().length > 0;

  const fermer = () => {
    setChoisi(null);
    setMessage('');
    onClose();
  };

  const libelle = !game ? 'Choisis un match'
    : message.trim().length === 0 ? 'Écris un premier message'
    : 'Envoyer et créer';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={fermer}>
      <View style={{ flex: 1, backgroundColor: 'rgba(10,10,10,0.45)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={fermer} />

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{
            backgroundColor: Colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            maxHeight: 700, paddingBottom: 28 + insets.bottom,
          }}>
            <View style={{ alignItems: 'center', marginTop: 8 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: POINTILLES }} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, paddingHorizontal: 20 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: Fonts.welcome, fontSize: 26, lineHeight: 30, letterSpacing: -0.3, color: Colors.textPrimary }}>
                  Nouvelle <Text style={{ color: Colors.brandDeep }}>conversation</Text>
                </Text>
                <Text style={{ fontFamily: Fonts.ui, fontSize: 12, lineHeight: 16, color: Colors.textSecondary, marginTop: 2 }}>
                  Choisis le match, puis écris le premier message. Les joueurs inscrits sont ajoutés.
                </Text>
              </View>
              <TouchableOpacity
                onPress={fermer}
                style={{
                  width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.bgCard,
                  borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Icon name="x" size={14} color={Colors.textSecondary} stroke={2.4} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={{ paddingHorizontal: 16 }}
              contentContainerStyle={{ paddingBottom: 8 }}
              keyboardShouldPersistTaps="handled"
            >
              {startables.length === 0 && dejaOuvertes.length === 0 ? (
                <View style={{
                  backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
                  borderRadius: 14, padding: 16, marginTop: 14,
                }}>
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>
                    Aucun match à venir
                  </Text>
                  <Text style={{ fontFamily: Fonts.ui, fontSize: 12, lineHeight: 17, color: Colors.textSecondary, marginTop: 4 }}>
                    Inscris-toi à une partie dans le Lobby pour lancer une conversation.
                  </Text>
                </View>
              ) : null}

              {startables.length > 0 ? <Titre mot="Tes matchs à venir" /> : null}
              {startables.map(g => {
                const actif = choisi === g.id;
                const joueurs = chatPlayers(g, myId).length;
                const libres = Math.max(0, PLACES - joueurs);
                return (
                  <TouchableOpacity
                    key={g.id}
                    onPress={() => setChoisi(actif ? null : g.id)}
                    activeOpacity={0.85}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      backgroundColor: Colors.bgCard, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12,
                      marginBottom: 8,
                      borderWidth: actif ? 2 : 1, borderColor: actif ? Colors.primary : Colors.border,
                    }}
                  >
                    <Calendrier matchDate={g.match_date} />
                    <View style={{ flex: 1, gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>
                          {autoTitle(g.match_date, g.location)}
                        </Text>
                        {g.is_challenge ? (
                          <View style={{
                            backgroundColor: 'rgba(255,193,26,0.18)', borderWidth: 1, borderColor: Colors.brand,
                            borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1,
                          }}>
                            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 9, color: Colors.brandDeep }}>DÉFI</Text>
                          </View>
                        ) : null}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Empiles game={g} myId={myId} />
                        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textSecondary }}>
                          {`${hourLabel(g.match_date)} · ${joueurs}/${PLACES} · ${libres === 0 ? 'complet' : `${libres} place${libres > 1 ? 's' : ''}`}`}
                        </Text>
                      </View>
                    </View>
                    <View style={{
                      width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                      borderWidth: 2, borderColor: actif ? Colors.primary : POINTILLES,
                      backgroundColor: actif ? Colors.primary : 'transparent',
                    }}>
                      {actif ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.textOnDark }} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}

              {dejaOuvertes.length > 0 ? <Titre mot="Déjà une conversation" /> : null}
              {dejaOuvertes.map(g => (
                <TouchableOpacity
                  key={g.id}
                  onPress={() => { fermer(); onOpenExisting(g.id); }}
                  activeOpacity={0.85}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    paddingVertical: 8, paddingHorizontal: 12, marginBottom: 6,
                  }}
                >
                  <View style={{ opacity: 0.5 }}>
                    <Calendrier matchDate={g.match_date} />
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 13, color: Colors.textSecondary }}>
                    {autoTitle(g.match_date, g.location)}
                  </Text>
                  <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: Colors.textPrimary }}>Ouvrir ›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={{
              borderTopWidth: 1, borderTopColor: Colors.border,
              paddingTop: 12, paddingHorizontal: 16, gap: 10,
            }}>
              {game ? (
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={2}
                  placeholder={`Message pour ${autoTitle(game.match_date, game.location)}…`}
                  placeholderTextColor={Colors.textMuted}
                  style={{
                    backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
                    borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12,
                    fontFamily: Fonts.ui, fontSize: 13, color: Colors.textPrimary,
                    minHeight: 58, textAlignVertical: 'top',
                  }}
                />
              ) : null}

              <TouchableOpacity
                onPress={() => { if (pret && game && !envoi) onChoose(game, message.trim()); }}
                disabled={!pret || !!envoi}
                activeOpacity={0.85}
                style={{
                  borderRadius: 999, paddingVertical: 13, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: pret && !envoi ? Colors.primary : Colors.border,
                }}
              >
                {envoi ? (
                  <ActivityIndicator color={Colors.textOnDark} />
                ) : (
                  <Text style={{
                    fontFamily: Fonts.uiExtraBold, fontSize: 14,
                    color: pret ? Colors.textOnDark : Colors.textMuted,
                  }}>
                    {libelle}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
