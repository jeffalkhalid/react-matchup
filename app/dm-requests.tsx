// app/dm-requests.tsx — « Demandes » : qui veut m'écrire.
//
// Refonte de l'onglet Chats (design_handoff_chats_refonte, §5). Avant, la
// ligne « Demandes » de l'onglet Directs ouvrait la PREMIÈRE demande en
// conversation : on répondait sans avoir vu les autres, et refuser demandait
// d'entrer dans le fil de quelqu'un qu'on ne voulait pas lire.
//
// Ici, tout est posé côte à côte : le message, le niveau, et les deux
// réponses. Accepter est noir, refuser est blanc — la règle de couleur des
// actions de l'app.
import { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../hooks/usePlayer';
import { useDirectChats } from '../hooks/useDirectChats';
import { Colors, Fonts, Spacing, FontSize, formatPadelLevel } from '../lib/theme';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { Icon } from '../components/community/icons';
import { otherName, otherAvatarPath, otherElo, respondDirectRequest } from '../lib/directChats';
import { relativeTime, initialsColor } from '../lib/chatList';

export default function DmRequestsScreen() {
  const { player } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { requests, loading, load, lastMessage } = useDirectChats();
  // Les identifiants en cours de réponse : le bouton se verrouille le temps
  // de l'aller-retour, sinon un double tap envoie deux réponses.
  const [enCours, setEnCours] = useState<Set<string>>(new Set());
  const [erreur, setErreur] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { if (player) load(); }, [player, load]));

  const repondre = async (id: string, accepte: boolean) => {
    if (enCours.has(id)) return;
    setErreur(null);
    setEnCours(prev => new Set(prev).add(id));
    try {
      await respondDirectRequest(id, accepte);
      await load();
    } catch (e) {
      setErreur("La réponse n'a pas pu être envoyée. Réessaie.");
      console.log('[dm-requests] respond failed', String(e));
    } finally {
      setEnCours(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  const myId = player?.id ?? '';

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 8, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: Colors.textOnDark, fontSize: 20, fontWeight: '900' }}>‹</Text>
          </TouchableOpacity>
          <View>
            <Text numberOfLines={1} style={{
              color: Colors.brand, fontSize: 24, lineHeight: 31,
              fontFamily: Fonts.welcome, letterSpacing: -0.5, paddingRight: 5,
            }}>
              Demandes
            </Text>
            <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600' }}>
              {requests.length} en attente
            </Text>
          </View>
        </View>
      </View>

      {loading && requests.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={c => c.id}
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          ListHeaderComponent={requests.length > 0 ? (
            <Text style={{
              fontFamily: Fonts.uiSemi, fontSize: 12, lineHeight: 17, color: Colors.textMuted,
              paddingHorizontal: 20, paddingTop: 16, paddingBottom: 10,
            }}>
              Ces joueurs veulent t'écrire. Ils ne savent pas si tu as lu leur message tant que tu n'as pas accepté.
            </Text>
          ) : null}
          renderItem={({ item: conv }) => {
            const nom = otherName(conv, myId);
            const elo = otherElo(conv, myId);
            const message = lastMessage(conv);
            const occupe = enCours.has(conv.id);
            return (
              <View style={{
                marginHorizontal: 16, marginBottom: 10, padding: 14, gap: 12,
                backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <PlayerAvatar
                    name={nom} path={otherAvatarPath(conv, myId)} size={44}
                    backgroundColor={initialsColor(nom)} textColor={Colors.textOnDark}
                    fontFamily={Fonts.uiBlack} fontSize={16}
                  />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: Colors.textPrimary }}>
                      {nom}
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted, marginTop: 2 }}>
                      {[elo != null ? `Niveau ${formatPadelLevel(elo)}` : null, relativeTime(conv.last_message_at ?? conv.created_at)]
                        .filter(Boolean).join('  ·  ')}
                    </Text>
                  </View>
                </View>

                {message?.content ? (
                  <View style={{
                    backgroundColor: Colors.bg, paddingVertical: 10, paddingHorizontal: 12,
                    borderTopLeftRadius: 4, borderTopRightRadius: 14, borderBottomLeftRadius: 14, borderBottomRightRadius: 14,
                  }}>
                    <Text style={{ fontFamily: Fonts.ui, fontSize: 13, lineHeight: 18, color: Colors.textPrimary }}>
                      {message.content}
                    </Text>
                  </View>
                ) : null}

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {/* Refuser en BLANC, accepter en NOIR : la règle de couleur
                      des actions, la même que valider ou contester un score. */}
                  <TouchableOpacity
                    onPress={() => repondre(conv.id, false)}
                    disabled={occupe}
                    activeOpacity={0.85}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center',
                      backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
                      opacity: occupe ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textSecondary }}>Refuser</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => repondre(conv.id, true)}
                    disabled={occupe}
                    activeOpacity={0.85}
                    style={{
                      flex: 1, paddingVertical: 10, borderRadius: 999, alignItems: 'center',
                      backgroundColor: Colors.primary, opacity: occupe ? 0.5 : 1,
                    }}
                  >
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textOnDark }}>Accepter</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 }}>
              <View style={{
                width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.bgCard,
                borderWidth: 1, borderColor: Colors.border,
                alignItems: 'center', justifyContent: 'center', marginBottom: 14,
              }}>
                <Icon name="mail" size={26} color={Colors.textSecondary} stroke={2} />
              </View>
              <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, lineHeight: 30, color: Colors.textPrimary, textAlign: 'center' }}>
                Aucune demande
              </Text>
              <Text style={{ fontFamily: Fonts.ui, fontSize: 13, lineHeight: 18, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                Tu es à jour.
              </Text>
            </View>
          }
        />
      )}

      {erreur ? (
        <Text style={{
          fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.danger,
          textAlign: 'center', paddingHorizontal: 20, paddingBottom: insets.bottom + 12,
        }}>
          {erreur}
        </Text>
      ) : null}
    </View>
  );
}
