import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, Share, Linking, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import Svg, { Path } from 'react-native-svg';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts, getLeague, eloToLevel } from '../../lib/theme';
import { getReferralStats, referralLink, referralQRValue, SHARE_LABEL } from '../../lib/community';
import { NavBar, Kicker, Chips } from '../../components/community/ui';
import { Icon } from '../../components/community/icons';
import { Pill } from '../../components/Pill';
import StoryComposerV2 from '../../components/StoryComposerV2';
import type { StoryPlayer, InviteData } from '../../components/story/storyTheme';
import type { ReferralStats } from '../../types';

const WhatsAppGlyph = ({ size = 26 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="#fff">
    <Path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.5A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .1-1.7-.1-.4-.1-.9-.3-1.5-.6-2.7-1.2-4.4-3.9-4.6-4.1-.1-.2-1.1-1.4-1.1-2.7s.7-1.9.9-2.2c.2-.2.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 1.9c.1.2.1.3 0 .5-.4.8-.8.8-.5 1.2.9 1.5 1.8 2 3.1 2.7.2.1.4.1.5-.1l.7-.9c.2-.2.3-.2.6-.1l1.8.9c.3.1.4.2.5.3.1.3.1.7-.1 1.1z" />
  </Svg>
);

export default function InviteScreen() {
  const router = useRouter();
  const { player } = usePlayer();
  const [variant, setVariant] = useState<'dark' | 'cream'>('dark');
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);

  useEffect(() => { if (player) getReferralStats(player).then(setStats); }, [player]);

  const code = stats?.code ?? '';
  const link = code ? referralLink(code) : '';
  const message = `Rejoins-moi sur PagMatch ${link}`;
  const cream = variant === 'cream';

  // Données pour le composer de story (mêmes types que la fiche joueur).
  const totalM = (player?.win_count ?? 0) + (player?.loss_count ?? 0);
  const storyPlayer: StoryPlayer | null = player ? {
    name: player.name,
    league: getLeague(player.elo_score),
    level: eloToLevel(player.elo_score),
    rank: 0,
    frmtRank: player.frmt_rank ?? undefined,
    frmtVerified: player.frmt_verified ?? undefined,
    fiability: player.fiability_pct,
    wins: player.win_count ?? 0,
    losses: player.loss_count ?? 0,
    winRate: totalM > 0 ? Math.round(((player.win_count ?? 0) / totalM) * 100) : 0,
    streak: 0,
    recentForm: [],
    club: player.clubs?.[0],
  } : null;
  const storyInvite: InviteData = {
    cta: 'Rejoins-moi sur',
    link: SHARE_LABEL,
    appUrl: 'Télécharger l’app',
    qrValue: code ? referralQRValue(code) : link,
    showApp: true, showQR: true,
  };

  const copy = async () => {
    await Clipboard.setStringAsync(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const shareVia = async (channel: 'whatsapp' | 'sms' | 'more') => {
    try {
      if (channel === 'whatsapp') {
        const url = `whatsapp://send?text=${encodeURIComponent(message)}`;
        if (await Linking.canOpenURL(url)) return Linking.openURL(url);
      }
      if (channel === 'sms') {
        const sep = Platform.OS === 'ios' ? '&' : '?';
        const url = `sms:${sep}body=${encodeURIComponent(message)}`;
        if (await Linking.canOpenURL(url)) return Linking.openURL(url);
      }
      await Share.share({ message });
    } catch {
      // l'utilisateur a annulé le partage
    }
  };

  const heroBg = cream ? Colors.bgCream : Colors.heroBg;
  const titleColor = cream ? Colors.textPrimary : '#fff';
  const subColor = cream ? Colors.textSecondary : 'rgba(255,255,255,0.55)';

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <NavBar title="Inviter des amis" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 60 }}>
        {/* Sélecteur de variante */}
        <View style={{ flexDirection: 'row', gap: 4, backgroundColor: Chips, borderWidth: 1, borderColor: Colors.border, borderRadius: 999, padding: 4, marginBottom: 16, alignSelf: 'center' }}>
          {([['dark', 'Sombre'], ['cream', 'Crème']] as const).map(([key, label]) => {
            const on = variant === key;
            return (
              <TouchableOpacity key={key} onPress={() => setVariant(key)} activeOpacity={0.9} style={{
                paddingHorizontal: 20, height: 32, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? Colors.primary : 'transparent',
              }}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: on ? '#fff' : Colors.textSecondary }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Carte hero partageable */}
        <View style={{
          backgroundColor: heroBg, borderRadius: 24, paddingVertical: 26, paddingHorizontal: 22, overflow: 'hidden',
          borderWidth: cream ? 1 : 0, borderColor: Colors.bgCream === heroBg ? Colors.border : 'transparent',
          shadowColor: '#000', shadowOpacity: cream ? 0.1 : 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 12 }, elevation: 8,
        }}>
          <View pointerEvents="none" style={{ position: 'absolute', top: -50, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,193,26,0.16)' }} />
          <View style={{ alignItems: 'center' }}>
            {cream ? (
              <Image source={require('../../assets/auth/splash-wordmark-dark.png')} style={{ width: 150, height: 34 }} resizeMode="contain" />
            ) : (
              <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 44, height: 44 }} resizeMode="contain" />
            )}
            <Text style={{ fontFamily: Fonts.welcome, fontSize: 26, color: titleColor, textTransform: 'uppercase', marginTop: cream ? 14 : 8, textAlign: 'center', lineHeight: 28 }}>
              Rejoins-moi sur <Text style={{ color: Colors.brandDeep }}>PagMatch</Text>
            </Text>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: subColor, marginTop: 6, textAlign: 'center' }}>
              Scanne le QR ou ouvre le lien pour créer ton profil et me défier.
            </Text>
            <View style={{ marginTop: 18, backgroundColor: '#fff', borderRadius: 16, padding: 10 }}>
              {link ? <QRCode value={referralQRValue(code)} size={140} color={Colors.primary} backgroundColor="#fff" /> : <View style={{ width: 140, height: 140 }} />}
            </View>
            <View style={{ marginTop: 16, backgroundColor: cream ? 'rgba(232,169,6,0.12)' : 'rgba(255,193,26,0.12)', borderWidth: 1, borderColor: cream ? 'rgba(232,169,6,0.45)' : 'rgba(255,193,26,0.4)', paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999 }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.brandDeep }}>{link.replace(/^https?:\/\//, '')}</Text>
            </View>
          </View>
        </View>

        {/* Ligne copier-lien */}
        <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14 }}>
          <Icon name="users" size={18} color={Colors.textMuted} />
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiSemi, fontSize: 13.5, color: Colors.textSecondary }}>{link.replace(/^https?:\/\//, '')}</Text>
          <TouchableOpacity onPress={copy} activeOpacity={0.85} style={{ backgroundColor: copied ? Colors.success : Colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: '#fff' }}>{copied ? 'Copié ✓' : 'Copier'}</Text>
          </TouchableOpacity>
        </View>

        {/* Partager via */}
        <View style={{ marginTop: 20 }}>
          <Kicker style={{ marginBottom: 14 }}>Partager via</Kicker>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <ShareBtn label="WhatsApp" bg="#25D366" icon={<WhatsAppGlyph />} onPress={() => shareVia('whatsapp')} />
            <ShareBtn label="Messages" bg="#34C759" icon={<Icon name="message" size={24} color="#fff" stroke={2.2} />} onPress={() => shareVia('sms')} />
            <ShareBtn label="Story" bg={Colors.brand} icon={<Icon name="camera" size={24} color={Colors.primary} stroke={2.2} />} onPress={() => { if (storyPlayer) setComposerOpen(true); }} />
            <ShareBtn label="Plus" bg={Chips} icon={<Icon name="arrowRight" size={22} color={Colors.textPrimary} stroke={2.4} rotate={-90} />} onPress={() => shareVia('more')} />
          </View>
        </View>

        {/* Incitation parrainage */}
        <View style={{ marginTop: 22, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,193,26,0.10)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.4)', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 24 }}>🏆</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: Colors.textPrimary }}>Badge Parrain</Text>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 12, color: Colors.textSecondary }}>
              {stats?.goal ?? 3} amis rejoignent = badge exclusif débloqué.
            </Text>
          </View>
          <Pill variant="brand">{stats?.joined ?? 0} / {stats?.goal ?? 3}</Pill>
        </View>
      </ScrollView>

      {storyPlayer && (
        <StoryComposerV2
          visible={composerOpen}
          player={storyPlayer}
          match={null}
          invite={storyInvite}
          initialMode="profil"
          onClose={() => setComposerOpen(false)}
        />
      )}
    </View>
  );
}

function ShareBtn({ label, bg, icon, onPress }: { label: string; bg: string; icon: React.ReactNode; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ flex: 1, alignItems: 'center', gap: 7 }}>
      <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>{icon}</View>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 11, color: Colors.textSecondary }}>{label}</Text>
    </TouchableOpacity>
  );
}
