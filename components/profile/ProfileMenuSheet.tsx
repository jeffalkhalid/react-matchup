import { View, Text, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';

function Group({ title }: { title: string }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginHorizontal: 18, marginTop: 16, marginBottom: 4, fontFamily: Fonts.uiBlack }}>
      {title}
    </Text>
  );
}

function Row({ emoji, label, onPress, danger }: { emoji: string; label: string; onPress: () => void; danger?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 18 }}>
      <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: danger ? '#fef2f2' : '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 15 }}>{emoji}</Text>
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
          <Row emoji="✏️" label="Modifier le profil" onPress={() => act(onEdit)} />
          <Row emoji="💬" label="Qui peut commenter" onPress={() => act(onComments)} />

          <Group title="Raccourcis" />
          <Row emoji="🏆" label="Classement" onPress={() => nav('/(tabs)/ranking')} />
          <Row emoji="🔔" label="Notifications" onPress={() => nav('/notifications')} />

          {isAdmin && (
            <>
              <Group title="Admin" />
              <Row emoji="🛡️" label="Panel Arbitre" onPress={() => nav('/admin')} />
            </>
          )}

          <Group title="Légal" />
          <Row emoji="🔒" label="Politique de confidentialité" onPress={() => nav('/legal/confidentialite')} />
          <Row emoji="📄" label="Conditions d'utilisation" onPress={() => nav('/legal/cgu')} />

          <View style={{ height: 1, backgroundColor: Colors.bgCardAlt, marginVertical: 10, marginHorizontal: 18 }} />
          <Row emoji="🚪" label="Se déconnecter" danger onPress={() => act(onLogout)} />
          <Row emoji="🗑️" label="Supprimer mon compte" danger onPress={() => act(onDelete)} />
        </ScrollView>
      </View>
    </View>
  );
}
