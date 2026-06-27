import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, Platform, Keyboard } from 'react-native';
import { Colors, Fonts } from '../lib/theme';

const MAX_LEN = 300;

type Props = {
  visible: boolean;
  title?: string;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
};

/**
 * Feuille de saisie d'un motif de signalement (optionnel).
 * Modèle sur ApplicationNoteSheet / DirectMessageComposer (Modal + keyboard-follow).
 */
export default function ReportReasonSheet({ visible, title, onSubmit, onCancel }: Props) {
  const [note, setNote] = useState('');
  const [kbHeight, setKbHeight] = useState(0);

  // KeyboardAvoidingView ne marche pas dans un <Modal> Android (la fenêtre du
  // Modal n'hérite pas du adjustResize de l'activité), et la feuille est ancrée
  // en bas — le clavier la recouvre. On suit donc la hauteur du clavier et on
  // relève la feuille d'autant. iOS = events Will (plus fluides), Android = Did.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const sub = Keyboard.addListener(showEvt, (e) => setKbHeight(e.endCoordinates?.height ?? 0));
    const hideSub = Keyboard.addListener(hideEvt, () => setKbHeight(0));
    return () => { sub.remove(); hideSub.remove(); };
  }, []);

  const handleSubmit = () => {
    Keyboard.dismiss();
    const value = note.trim();
    setNote('');
    onSubmit(value);
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    setNote('');
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)', paddingBottom: kbHeight }}>
        <View style={{ backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, gap: 14 }}>
          <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
            {title ?? 'Signaler'}
          </Text>
          <Text style={{ fontSize: 13, color: Colors.textSecondary }}>
            Décris le problème pour aider la modération (optionnel).
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Ex. propos déplacés, spam, usurpation…"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={MAX_LEN}
            style={{
              minHeight: 72, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
              padding: 12, fontSize: 14, color: Colors.textPrimary, textAlignVertical: 'top',
            }}
          />
          <Text style={{ fontSize: 11, color: Colors.textMuted, textAlign: 'right' }}>
            {note.length}/{MAX_LEN}
          </Text>
          <TouchableOpacity
            onPress={handleSubmit}
            style={{ backgroundColor: Colors.danger, borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}>
            <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontSize: 15 }}>Envoyer le signalement</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCancel} style={{ paddingVertical: 8, alignItems: 'center' }}>
            <Text style={{ color: Colors.textMuted, fontSize: 13 }}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
