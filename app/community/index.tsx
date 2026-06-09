import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ViewStyle } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts, LeagueGradients } from '../../lib/theme';
import { getFriends } from '../../lib/community';
import { Avatar } from '../../components/community/Avatar';
import { Card, Kicker, GhostBtn, BrandBtn } from '../../components/community/ui';
import { Icon } from '../../components/community/icons';
import type { SocialPlayer } from '../../types';

// Carte de section (kicker + titre + sous-titre + action), étirée pour remplir.
function SocialCard({ kicker, icon, title, titleSize = 18, sub, children, style }: {
  kicker: string; icon?: React.ReactNode; title: string; titleSize?: number;
  sub: string; children: React.ReactNode; style?: ViewStyle;
}) {
  return (
    <Card pad={16} style={{ flex: 1, justifyContent: 'center', ...style }}>
      {icon ? (
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 10 }}>
          <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: 'rgba(255,193,26,0.12)', alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Kicker color={Colors.brandDeep}>{kicker}</Kicker>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: titleSize, color: Colors.textPrimary, marginTop: 3, letterSpacing: -0.3 }}>{title}</Text>
          </View>
        </View>
      ) : (
        <View style={{ marginBottom: 10 }}>
          <Kicker color={Colors.brandDeep}>{kicker}</Kicker>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: titleSize, color: Colors.textPrimary, marginTop: 4, letterSpacing: -0.5 }}>{title}</Text>
        </View>
      )}
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13.5, color: Colors.textSecondary, lineHeight: 19, marginBottom: 12 }}>{sub}</Text>
      {children}
    </Card>
  );
}

export default function CommunityHubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const [friends, setFriends] = useState<SocialPlayer[]>([]);

  useFocusEffect(useCallback(() => {
    if (player) getFriends(player.id).then(setFriends);
  }, [player]));

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, paddingHorizontal: 16, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 14 }}>
      {/* En-tête */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 }}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.85} style={iconBtn}>
          <Icon name="chevronLeft" size={20} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: Colors.textPrimary, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          Communauté
        </Text>
        <TouchableOpacity onPress={() => router.push('/community/friends')} activeOpacity={0.85} style={iconBtn}>
          <Icon name="bell" size={19} color={Colors.textPrimary} />
          <View style={{ position: 'absolute', top: 7, right: 8, width: 8, height: 8, borderRadius: 999, backgroundColor: Colors.danger, borderWidth: 1.5, borderColor: '#fff' }} />
        </TouchableOpacity>
      </View>

      {/* Bandeau d'amis (scroll horizontal uniquement) */}
      {friends.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 12 }} contentContainerStyle={{ gap: 14, paddingVertical: 2, paddingHorizontal: 2 }}>
          {friends.slice(0, 10).map(f => (
            <TouchableOpacity key={f.id} onPress={() => router.push(`/player/${f.id}` as any)} activeOpacity={0.85} style={{ alignItems: 'center', gap: 6, width: 52 }}>
              <View style={{ padding: 2, borderRadius: 999, backgroundColor: (LeagueGradients[f.league] ?? LeagueGradients.gold)[1] }}>
                <Avatar name={f.name} size={44} radius={999} league={f.league} />
              </View>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 10.5, color: Colors.textSecondary, maxWidth: 52 }}>
                {f.name.split(' ')[0]}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* 3 cartes — se répartissent la hauteur restante (pas de scroll vertical) */}
      <View style={{ flex: 1, gap: 12 }}>
        <SocialCard
          kicker="Mes amis"
          icon={<Icon name="users" size={22} color={Colors.brandDeep} />}
          title="Activité, recherche & suggestions"
          sub="Suis tes amis, vois leurs résultats et trouve de nouveaux joueurs."
        >
          <GhostBtn label="Mes amis" onPress={() => router.push('/community/friends')} />
        </SocialCard>

        <SocialCard
          kicker="Mes alertes"
          icon={<Icon name="bell" size={22} color={Colors.brandDeep} />}
          title="Ne rate plus aucune partie"
          sub="Crée des alertes sur mesure et reçois une notif dès qu'une partie correspond."
        >
          <GhostBtn label="+ Créer une alerte" onPress={() => router.push('/community/alerts')} />
        </SocialCard>

        <SocialCard
          kicker="Invite & gagne"
          title="Fais grandir ta piste"
          titleSize={22}
          sub="Partage ton lien : chaque ami qui rejoint débloque un trophée parrainage."
        >
          <BrandBtn
            label="Inviter des amis"
            icon={<Icon name="arrowRight" size={17} color={Colors.primary} stroke={2.4} rotate={-45} />}
            onPress={() => router.push('/community/invite')}
          />
        </SocialCard>
      </View>
    </View>
  );
}

const iconBtn = {
  width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.bgCard,
  borderWidth: 1, borderColor: Colors.border,
  alignItems: 'center' as const, justifyContent: 'center' as const,
};
