import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { Icon, type IconName } from '../community/icons';
import { getWatchPairingEnabled } from '../../lib/watchLink';
import { getTournamentsEnabled } from '../../lib/tournaments';

function Group({ title }: { title: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginHorizontal: 18, marginTop: 16, marginBottom: 4, fontFamily: Fonts.uiBlack }}>
      {title}
    </Text>
  );
}

function Row({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 18 }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: danger ? '#fef2f2' : '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={16} color={danger ? '#ef4444' : Colors.textSecondary} stroke={2} />
      </View>
      <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '700', color: danger ? '#ef4444' : Colors.textPrimary, fontFamily: Fonts.uiBold }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ProfileMenuSheet({ visible, onClose, isAdmin, onEdit, onComments, onLogout, onDelete }: {
  visible: boolean; onClose: () => void; isAdmin: boolean;
  onEdit: () => void; onComments: () => void; onLogout: () => void; onDelete: () => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Interrupteur global du Panel Arbitre. Les hooks doivent rester AVANT le
  // `return null` ci-dessous : les appeler après le rendrait conditionnel.
  // Défaut `true` : on ne masque jamais l'entrée à cause d'un aléa réseau.
  const [watchOn, setWatchOn] = useState(true);
  // Interrupteur global des tournois. Défaut `false`, à l'INVERSE de la montre :
  // côté serveur, clé absente = ÉTEINT (tournaments_flag.sql), et le brief est
  // formel — éteint, l'entrée n'apparaît NULLE PART, ni écran vide ni message.
  const [tournamentsOn, setTournamentsOn] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    getWatchPairingEnabled().then(v => { if (!cancelled) setWatchOn(v); });
    getTournamentsEnabled().then(v => { if (!cancelled) setTournamentsOn(v); });
    return () => { cancelled = true; };
  }, [visible]);

  if (!visible) return null;

  // Navigation interne : on ferme la feuille puis on pousse l'écran.
  const nav = (path: string) => { onClose(); router.push(path as any); };
  // Action ouvrant un modal du parent : fermer la feuille d'abord.
  const act = (fn: () => void) => { onClose(); fn(); };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: insets.bottom + 12, maxHeight: '80%' }}>
        <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
        </View>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary, paddingHorizontal: 18, paddingTop: 8 }}>Menu</Text>

        <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
          <Group title="Compte" />
          <Row icon="pencil" label="Modifier le profil" onPress={() => act(onEdit)} />
          <Row icon="message" label="Qui peut commenter" onPress={() => act(onComments)} />
          <Row icon="mail" label="Confidentialité des messages" onPress={() => nav('/dm-settings')} />
          {watchOn && <Row icon="clock" label="Connecter ma montre" onPress={() => nav('/watch-link')} />}

          <Group title="Raccourcis" />
          <Row icon="trophy" label="Classement" onPress={() => nav('/ranking')} />
          {tournamentsOn && <Row icon="medal" label="Tournois" onPress={() => nav('/tournaments')} />}
          {tournamentsOn && <Row icon="trendingUp" label="Mon parcours" onPress={() => nav('/tournaments/parcours')} />}
          <Row icon="bell" label="Notifications" onPress={() => nav('/notifications')} />

          {isAdmin && (
            <>
              <Group title="Admin" />
              <Row icon="shield" label="Panel Arbitre" onPress={() => nav('/admin')} />
            </>
          )}

          <Group title="Légal" />
          <Row icon="lock" label="Politique de confidentialité" onPress={() => nav('/legal/confidentialite')} />
          <Row icon="fileText" label="Conditions d'utilisation" onPress={() => nav('/legal/cgu')} />

          <View style={{ height: 1, backgroundColor: Colors.bgCardAlt, marginVertical: 10, marginHorizontal: 18 }} />
          <Row icon="logOut" label="Se déconnecter" danger onPress={() => act(onLogout)} />
          <Row icon="trash" label="Supprimer mon compte" danger onPress={() => act(onDelete)} />
        </ScrollView>
      </View>
    </View>
  );
}
