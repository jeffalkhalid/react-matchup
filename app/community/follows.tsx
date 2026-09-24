// app/community/follows.tsx — « Abonnés » et « Abonnements ».
//
// Les deux chiffres s'affichaient sous le nom depuis toujours, sans rien
// derrière. On savait donc que trois joueurs nous suivaient, sans jamais
// pouvoir savoir QUI — donc sans pouvoir les suivre en retour.
//
// C'est ce manque qui rendait le graphe social à sens unique : on ne suivait
// que les gens qu'on trouvait soi-même, et jamais ceux qui étaient venus vers
// nous. D'où le bouton « Suivre en retour », qui est tout l'intérêt de la
// liste des abonnés.
//
// Les deux sens ne veulent pas dire la même chose, et l'écran le dit :
// j'envoie mes dispos à mes ABONNÉS, je reçois celles de mes ABONNEMENTS.
import { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { getFollowers, getFriends, setFollow } from '../../lib/community';
import { Colors, Fonts, Spacing, FontSize, formatPadelLevel } from '../../lib/theme';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { Icon } from '../../components/community/icons';
import { initialsColor } from '../../lib/chatList';
import type { SocialPlayer } from '../../types';

type Sens = 'followers' | 'following';

export default function FollowsScreen() {
  const { player } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [sens, setSens] = useState<Sens>(params.tab === 'following' ? 'following' : 'followers');
  const [abonnes, setAbonnes] = useState<SocialPlayer[]>([]);
  const [abonnements, setAbonnements] = useState<SocialPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [enCours, setEnCours] = useState<Set<string>>(new Set());

  const charger = useCallback(async () => {
    if (!player) return;
    const [f, a] = await Promise.all([getFollowers(player.id), getFriends(player.id)]);
    setAbonnes(f); setAbonnements(a); setLoading(false);
  }, [player]);

  useFocusEffect(useCallback(() => { charger(); }, [charger]));

  const basculer = async (cible: SocialPlayer) => {
    if (!player || enCours.has(cible.id)) return;
    setEnCours(prev => new Set(prev).add(cible.id));
    try {
      await setFollow(player.id, cible.id, !cible.following);
      await charger();
    } finally {
      setEnCours(prev => { const n = new Set(prev); n.delete(cible.id); return n; });
    }
  };

  const liste = sens === 'followers' ? abonnes : abonnements;
  const phrase = sens === 'followers'
    ? 'Ils reçoivent tes dispos quand tu préviens ton cercle.'
    : 'Tu vois leurs dispos dans ton onglet Activité.';

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 8, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: 12 }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: Colors.textOnDark, fontSize: 20, fontWeight: '900' }}>‹</Text>
          </TouchableOpacity>
          <Text numberOfLines={1} style={{
            color: Colors.brand, fontSize: 24, lineHeight: 31,
            fontFamily: Fonts.welcome, letterSpacing: -0.5, paddingRight: 5,
          }}>
            Mon cercle
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['followers', `Abonnés · ${abonnes.length}`], ['following', `Abonnements · ${abonnements.length}`]] as const).map(([cle, mot]) => {
            const actif = sens === cle;
            return (
              <TouchableOpacity
                key={cle}
                onPress={() => setSens(cle)}
                activeOpacity={0.85}
                style={{
                  paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999,
                  backgroundColor: actif ? Colors.bgCard : 'rgba(255,255,255,0.08)',
                }}
              >
                <Text style={{
                  fontFamily: Fonts.uiExtraBold, fontSize: 12.5,
                  color: actif ? Colors.textPrimary : 'rgba(255,255,255,0.7)',
                }}>
                  {mot}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={{
        fontFamily: Fonts.uiSemi, fontSize: 11.5, lineHeight: 16, color: Colors.textMuted,
        paddingTop: 14, paddingHorizontal: 20, paddingBottom: 6,
      }}>
        {phrase}
      </Text>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={liste}
          keyExtractor={p => p.id}
          contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
          renderItem={({ item: p }) => {
            const occupe = enCours.has(p.id);
            return (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                marginHorizontal: 16, marginBottom: 8, padding: 12,
                backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16,
              }}>
                <TouchableOpacity
                  onPress={() => router.push(`/player/${p.id}` as any)}
                  activeOpacity={0.85}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
                >
                  <PlayerAvatar
                    name={p.name} path={p.avatar_path} size={44}
                    backgroundColor={initialsColor(p.name)} textColor={Colors.textOnDark}
                    fontFamily={Fonts.uiBlack} fontSize={16}
                  />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: Colors.textPrimary }}>
                      {p.name}
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted, marginTop: 2 }}>
                      {`Niveau ${formatPadelLevel(p.elo_score)}`}
                    </Text>
                  </View>
                </TouchableOpacity>

                {/* Sur un abonné qu'on ne suit pas, c'est LE geste de l'écran :
                    il est donc noir, comme toute action qu'on veut voir. */}
                <TouchableOpacity
                  onPress={() => basculer(p)}
                  disabled={occupe}
                  activeOpacity={0.85}
                  style={{
                    borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14,
                    backgroundColor: p.following ? Colors.bgCard : Colors.primary,
                    borderWidth: p.following ? 1 : 0, borderColor: Colors.border,
                    opacity: occupe ? 0.5 : 1,
                  }}
                >
                  <Text style={{
                    fontFamily: Fonts.uiExtraBold, fontSize: 12,
                    color: p.following ? Colors.textSecondary : Colors.textOnDark,
                  }}>
                    {p.following ? 'Suivi' : sens === 'followers' ? 'Suivre en retour' : 'Suivre'}
                  </Text>
                </TouchableOpacity>
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
                <Icon name="users" size={26} color={Colors.textSecondary} stroke={2} />
              </View>
              <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, lineHeight: 30, color: Colors.textPrimary, textAlign: 'center' }}>
                {sens === 'followers' ? 'Personne ne te suit encore' : 'Tu ne suis personne'}
              </Text>
              <Text style={{ fontFamily: Fonts.ui, fontSize: 13, lineHeight: 18, color: Colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                {sens === 'followers'
                  ? 'Invite des joueurs : ce sont tes abonnés qui reçoivent tes dispos.'
                  : 'Suis des joueurs pour voir leurs dispos et leur activité.'}
              </Text>
              <TouchableOpacity
                onPress={() => router.push('/community/friends' as any)}
                activeOpacity={0.85}
                style={{ marginTop: 16, backgroundColor: Colors.primary, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20 }}
              >
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textOnDark }}>
                  Trouver des joueurs
                </Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </View>
  );
}
