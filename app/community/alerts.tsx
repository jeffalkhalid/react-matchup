import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { getAlerts, setAlertActive } from '../../lib/community';
import { Card, NavBar, Toggle } from '../../components/community/ui';
import { Icon } from '../../components/community/icons';
import { Pill } from '../../components/Pill';
import type { GameAlert } from '../../types';

const SLOT_LABEL: Record<string, string> = {
  morning: 'Matin', noon: 'Midi', afternoon: 'Après-midi', evening: 'Soir',
};

export function alertTitle(a: GameAlert): string {
  if (a.courts.length === 1) return a.courts[0];
  if (a.courts.length > 1) return `${a.courts.length} terrains`;
  return 'Toutes les pistes';
}

export function alertDetail(a: GameAlert): string {
  const days = a.days.length === 0 ? 'Tous les jours'
    : a.days.length === 7 ? 'Tous les jours'
    : a.days.join('·');
  const slots = a.slots.length === 0 ? 'Tout horaire'
    : a.slots.map(s => SLOT_LABEL[s] ?? s).join(' & ');
  const type = (a.formats ?? []).length === 1
    ? (a.formats[0] === 'friendly' ? 'Amical' : 'Compétitif')
    : null;
  const lvl = `Niv. ${fmt(a.lvl_min)}–${fmt(a.lvl_max)}`;
  return [days, slots, type, lvl].filter(Boolean).join(' · ');
}
const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1);

export default function AlertsListScreen() {
  const router = useRouter();
  const { player } = usePlayer();
  const [alerts, setAlerts] = useState<GameAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    if (!player) return;
    setLoading(true);
    getAlerts(player.id).then(a => { setAlerts(a); setLoading(false); });
  }, [player]));

  const toggle = (a: GameAlert) => {
    setAlerts(prev => prev.map(x => x.id === a.id ? { ...x, active: !x.active } : x));
    setAlertActive(a.id, !a.active);
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <NavBar title="Mes alertes" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <>
            {alerts.map(a => (
              <Card key={a.id} pad={16}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,193,26,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="bell" size={19} color={Colors.brandDeep} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>{alertTitle(a)}</Text>
                    <Text style={{ fontFamily: Fonts.ui, fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>{alertDetail(a)}</Text>
                    {a.friend_ids.length > 0 ? (
                      <View style={{ marginTop: 8, flexDirection: 'row' }}>
                        <Pill variant="brand">{a.friend_ids.length} ami{a.friend_ids.length > 1 ? 's' : ''}</Pill>
                      </View>
                    ) : null}
                  </View>
                  <Toggle on={a.active} onPress={() => toggle(a)} />
                </View>
              </Card>
            ))}

            <TouchableOpacity onPress={() => router.push('/community/alert-new')} activeOpacity={0.85} style={{
              marginTop: 4, height: 56, borderRadius: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              <Icon name="plus" size={18} color={Colors.textPrimary} stroke={2.4} />
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>Créer une alerte</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </View>
  );
}
