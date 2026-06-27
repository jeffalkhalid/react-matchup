import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { supabase } from '../lib/supabase';
import { usePlayer } from '../hooks/usePlayer';
import { Colors, Spacing, FontSize, Radius } from '../lib/theme';
import type { DmPrivacy } from '../lib/directChats';

const OPTIONS: { key: DmPrivacy; label: string; hint: string }[] = [
  { key: 'everyone', label: 'Tout le monde', hint: "N'importe qui peut envoyer une demande" },
  { key: 'played',   label: 'Joueurs croisés', hint: "Seulement ceux avec qui j'ai joué" },
  { key: 'none',     label: 'Personne', hint: "Je n'accepte aucune nouvelle demande" },
];

export default function DmSettingsScreen() {
  const { player } = usePlayer();
  const [privacy, setPrivacy] = useState<DmPrivacy>('everyone');
  const [blocked, setBlocked] = useState<{ blocked_id: string; name: string }[]>([]);

  useEffect(() => {
    if (!player) return;
    supabase.from('players').select('dm_privacy').eq('id', player.id).single()
      .then(({ data }) => { if (data?.dm_privacy) setPrivacy(data.dm_privacy as DmPrivacy); });
    supabase.from('user_blocks').select('blocked_id, player:blocked_id(name)').eq('blocker_id', player.id)
      .then(({ data }) => setBlocked((data ?? []).map((r: any) => ({ blocked_id: r.blocked_id, name: r.player?.name ?? '—' }))));
  }, [player]);

  const choose = async (p: DmPrivacy) => {
    if (!player) return;
    setPrivacy(p);
    await supabase.from('players').update({ dm_privacy: p }).eq('id', player.id);
  };

  const unblock = async (id: string) => {
    if (!player) return;
    await supabase.from('user_blocks').delete().eq('blocker_id', player.id).eq('blocked_id', id);
    setBlocked(prev => prev.filter(b => b.blocked_id !== id));
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg, padding: Spacing.lg }}>
      <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900', marginBottom: 12 }}>Qui peut m'envoyer un message</Text>
      {OPTIONS.map(o => (
        <TouchableOpacity key={o.key} onPress={() => choose(o.key)} style={{
          padding: 14, borderRadius: Radius.md, marginBottom: 8,
          backgroundColor: privacy === o.key ? Colors.primary : Colors.bgCard,
        }}>
          <Text style={{ color: privacy === o.key ? '#fff' : Colors.textPrimary, fontWeight: '800' }}>{o.label}</Text>
          <Text style={{ color: privacy === o.key ? 'rgba(255,255,255,0.85)' : Colors.textMuted, fontSize: FontSize.xs, marginTop: 2 }}>{o.hint}</Text>
        </TouchableOpacity>
      ))}
      <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900', marginTop: 20, marginBottom: 12 }}>Joueurs bloqués</Text>
      <FlatList
        data={blocked}
        keyExtractor={b => b.blocked_id}
        ListEmptyComponent={<Text style={{ color: Colors.textMuted }}>Aucun joueur bloqué</Text>}
        renderItem={({ item }) => (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 }}>
            <Text style={{ color: Colors.textPrimary }}>{item.name}</Text>
            <TouchableOpacity onPress={() => unblock(item.blocked_id)}>
              <Text style={{ color: Colors.primary, fontWeight: '800' }}>Débloquer</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}
