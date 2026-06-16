import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, TextInput, ActivityIndicator } from 'react-native';
import { Alert } from 'react-native';
import { supabase } from '../../lib/supabase';
import { Colors, Fonts } from '../../lib/theme';

// ─── Delete account modal ─────────────────────────────────────
export function DeleteAccountModal({ visible, onClose, playerName, onConfirm }: {
  visible: boolean; onClose: () => void; playerName: string; onConfirm: () => void;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try { await onConfirm(); } catch { Alert.alert('Erreur', 'La suppression a échoué. Contacte le support.'); }
    setDeleting(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: Colors.bgCard, borderRadius: 24, padding: 24, width: '100%', maxWidth: 360 }}>
          <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: '#fef2f2', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 24 }}>🗑️</Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '900', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8, fontFamily: Fonts.uiBlack }}>Supprimer mon compte</Text>
          <Text style={{ fontSize: 13, color: Colors.textSecondary, fontWeight: '500', textAlign: 'center', marginBottom: 20 }}>
            Cette action est <Text style={{ fontWeight: '900', color: Colors.textPrimary }}>irréversible</Text>. Ton profil, tes matchs et tes badges seront définitivement supprimés.
          </Text>
          <Text style={{ fontSize: 11, fontWeight: '900', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            Tape ton pseudo pour confirmer
          </Text>
          <TextInput
            value={confirmText}
            onChangeText={setConfirmText}
            placeholder={playerName}
            placeholderTextColor="#cbd5e1"
            style={{ borderWidth: 1.5, borderColor: Colors.border, borderRadius: 12, padding: 12, fontSize: 14, fontWeight: '700', color: Colors.textPrimary, marginBottom: 20 }}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={{ flex: 1, backgroundColor: Colors.bgCardAlt, borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: Colors.textSecondary }}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDelete} disabled={confirmText !== playerName || deleting}
              style={{ flex: 2, backgroundColor: Colors.danger, borderRadius: 12, padding: 14, alignItems: 'center', opacity: confirmText !== playerName || deleting ? 0.4 : 1 }}>
              {deleting ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ fontSize: 14, fontWeight: '900', color: Colors.textOnDark, fontFamily: Fonts.uiBlack }}>Supprimer définitivement</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Comments policy modal ────────────────────────────────────
export function CommentsPolicyModal({ visible, onClose, player, onSaved }: {
  visible: boolean; onClose: () => void; player: any; onSaved: () => void;
}) {
  const options: { key: 'everyone' | 'friends' | 'nobody'; label: string; sub: string }[] = [
    { key: 'everyone', label: 'Tout le monde', sub: 'Tous les joueurs peuvent commenter.' },
    { key: 'friends', label: 'Amis', sub: 'Seuls tes amis (suivis dans un sens) peuvent commenter.' },
    { key: 'nobody', label: 'Personne', sub: 'Personne ne peut commenter tes activités.' },
  ];
  const current = (player?.comments_policy ?? 'friends') as 'everyone' | 'friends' | 'nobody';

  const choose = async (key: 'everyone' | 'friends' | 'nobody') => {
    const { error } = await supabase.from('players').update({ comments_policy: key }).eq('id', player.id);
    if (error) { Alert.alert('Erreur', "Le réglage n'a pas pu être enregistré."); return; }
    onSaved();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity activeOpacity={1} onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}
          style={{ backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34 }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary, marginBottom: 4 }}>
            Qui peut commenter mes activités
          </Text>
          <View style={{ marginTop: 10, gap: 8 }}>
            {options.map(o => {
              const on = o.key === current;
              return (
                <TouchableOpacity key={o.key} onPress={() => choose(o.key)} activeOpacity={0.8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1.5, borderColor: on ? Colors.primary : Colors.border, backgroundColor: on ? Colors.primary + '12' : Colors.bgCard }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>{o.label}</Text>
                    <Text style={{ fontFamily: Fonts.ui, fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>{o.sub}</Text>
                  </View>
                  {on && <Text style={{ fontSize: 16, color: Colors.primary }}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
