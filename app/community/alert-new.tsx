import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { supabase } from '../../lib/supabase';
import { Colors, Fonts } from '../../lib/theme';
import { getFriends, createAlert } from '../../lib/community';
import { Card, NavBar, Kicker, Chip, Toggle, BrandBtn } from '../../components/community/ui';
import { Icon } from '../../components/community/icons';
import { Avatar } from '../../components/community/Avatar';
import { RangeSlider } from '../../components/community/RangeSlider';
import type { SocialPlayer } from '../../types';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const TIME_SLOTS = [
  { k: 'morning', label: 'Matin', sub: '6 h – 12 h' },
  { k: 'noon', label: 'Midi', sub: '12 h – 14 h' },
  { k: 'afternoon', label: 'Après-midi', sub: '14 h – 18 h' },
  { k: 'evening', label: 'Soir', sub: '18 h – 23 h' },
];
const MATCH_TYPES = [
  { k: 'friendly', label: 'Amical', sub: 'Détente' },
  { k: 'competitive', label: 'Compétitif', sub: 'Classé' },
];
const LVL_MIN = 1, LVL_MAX = 8, LVL_STEP = 0.5;

function FieldGroup({ kicker, children }: { kicker: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 22 }}>
      <Kicker style={{ marginBottom: 12 }}>{kicker}</Kicker>
      {children}
    </View>
  );
}

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
}

export default function AlertNewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();

  const [days, setDays] = useState<string[]>(['Lun', 'Mar', 'Mer', 'Jeu']);
  const [slots, setSlots] = useState<string[]>(['evening']);
  const [courts, setCourts] = useState<string[]>([]);
  const [formats, setFormats] = useState<string[]>([]);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [lvl, setLvl] = useState<[number, number]>([5, 6]);
  const [push, setPush] = useState(true);
  const [onlyFriends, setOnlyFriends] = useState(false);
  const [saving, setSaving] = useState(false);

  const [courtOptions, setCourtOptions] = useState<string[]>([]);
  const [courtsOpen, setCourtsOpen] = useState(false);
  const [friends, setFriends] = useState<SocialPlayer[]>([]);

  useEffect(() => {
    if (!player) return;
    getFriends(player.id).then(setFriends);
    // Terrains : table `clubs` (source officielle, même que CreateWizard) +
    // les clubs du joueur — tout nouveau club ajouté en base apparaît ici.
    supabase.from('clubs').select('name').order('name').then(({ data }) => {
      const set = new Set<string>(player.clubs ?? []);
      (data ?? []).forEach((c: any) => { if (c.name) set.add(c.name); });
      setCourtOptions([...set].sort((a, b) => a.localeCompare(b)));
    });
  }, [player]);

  const save = async () => {
    if (!player) return;
    setSaving(true);
    await createAlert(player.id, {
      days, slots, courts, formats, friend_ids: friendIds,
      lvl_min: lvl[0], lvl_max: lvl[1], push_on: push, only_friends: onlyFriends, active: true,
    });
    setSaving(false);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <NavBar title="Nouvelle alerte" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 130 }}>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 24, color: Colors.textPrimary, textTransform: 'uppercase', marginBottom: 4 }}>
          Sois notifié des bonnes parties
        </Text>
        <Text style={{ fontFamily: Fonts.ui, fontSize: 13.5, color: Colors.textSecondary, marginBottom: 22 }}>
          On t'envoie une notif dès qu'une partie correspond à tous tes critères.
        </Text>

        <FieldGroup kicker="Jours">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {WEEKDAYS.map(d => (
              <Chip key={d} label={d} on={days.includes(d)} onPress={() => setDays(toggle(days, d))} />
            ))}
          </View>
        </FieldGroup>

        <FieldGroup kicker="Créneaux horaires">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {TIME_SLOTS.map(s => (
              <Chip key={s.k} label={s.label} sub={s.sub} on={slots.includes(s.k)} onPress={() => setSlots(toggle(slots, s.k))} />
            ))}
          </View>
        </FieldGroup>

        <FieldGroup kicker="Type de match">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {MATCH_TYPES.map(t => (
              <View key={t.k} style={{ flex: 1 }}>
                <Chip label={t.label} sub={t.sub} on={formats.includes(t.k)} onPress={() => setFormats(toggle(formats, t.k))} />
              </View>
            ))}
          </View>
        </FieldGroup>

        {courtOptions.length > 0 && (
          <FieldGroup kicker="Terrains">
            {/* Liste déroulante (bottom-sheet scrollable) */}
            <TouchableOpacity onPress={() => setCourtsOpen(true)} activeOpacity={0.85} style={{
              flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, borderRadius: 12, paddingHorizontal: 14,
              backgroundColor: Colors.bgCard, borderWidth: 1.5, borderColor: Colors.border,
            }}>
              <Icon name="mapPin" size={16} color={Colors.textMuted} />
              <Text numberOfLines={1} style={{
                flex: 1, fontFamily: courts.length ? Fonts.uiBold : Fonts.ui, fontSize: 14,
                color: courts.length ? Colors.textPrimary : Colors.textMuted,
              }}>
                {courts.length === 0 ? 'Tous les terrains'
                  : courts.length === 1 ? courts[0]
                  : `${courts.length} terrains sélectionnés`}
              </Text>
              <Icon name="chevronRight" size={18} color={Colors.textMuted} stroke={2.4} rotate={90} />
            </TouchableOpacity>

            {/* Aperçu des terrains choisis (tap = retirer) */}
            {courts.length > 0 && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {courts.map(c => (
                  <TouchableOpacity key={c} onPress={() => setCourts(toggle(courts, c))} activeOpacity={0.85} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10,
                    backgroundColor: 'rgba(255,193,26,0.14)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.55)',
                  }}>
                    <Text style={{ fontFamily: Fonts.uiBold, fontSize: 12, color: Colors.brandDeep }}>{c}</Text>
                    <Icon name="x" size={12} color={Colors.brandDeep} stroke={2.6} />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </FieldGroup>
        )}

        <FieldGroup kicker="Niveau du match">
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textMuted }}>Niv. {LVL_MIN.toFixed(1)}</Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.brandDeep }}>
              {lvl[0].toFixed(1)} → {lvl[1].toFixed(1)}
            </Text>
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textMuted }}>Niv. {LVL_MAX.toFixed(1)}</Text>
          </View>
          <RangeSlider
            lo={lvl[0]} hi={lvl[1]} min={LVL_MIN} max={LVL_MAX} step={LVL_STEP}
            onChange={(lo, hi) => setLvl([lo, hi])}
          />
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.textMuted, marginTop: 4 }}>
            Glisse les curseurs pour définir le niveau visé.
          </Text>
        </FieldGroup>

        {friends.length > 0 && (
          <FieldGroup kicker="Avec ces amis (optionnel)">
            <Card pad={6}>
              {friends.slice(0, 6).map((f, i, arr) => {
                const on = friendIds.includes(f.id);
                return (
                  <TouchableOpacity key={f.id} onPress={() => setFriendIds(toggle(friendIds, f.id))} activeOpacity={0.85} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9, paddingHorizontal: 10,
                    borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: '#F1F0EE',
                  }}>
                    <Avatar name={f.name} size={38} radius={12} league={f.league} />
                    <Text style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 14, color: Colors.textPrimary }}>{f.name}</Text>
                    <View style={{
                      width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                      borderWidth: 1.5, borderColor: on ? Colors.brand : Colors.border, backgroundColor: on ? Colors.brand : 'transparent',
                    }}>
                      {on ? <Icon name="check" size={15} color={Colors.primary} stroke={3} /> : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </Card>
          </FieldGroup>
        )}

        <FieldGroup kicker="Notifications">
          <Card pad={0}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: '#F1F0EE' }}>
              <Icon name="bell" size={18} color={Colors.brandDeep} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: Colors.textPrimary }}>Notif push</Text>
                <Text style={{ fontFamily: Fonts.ui, fontSize: 11.5, color: Colors.textMuted }}>Reçois une alerte en temps réel.</Text>
              </View>
              <Toggle on={push} onPress={() => setPush(p => !p)} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 }}>
              <Icon name="users" size={18} color={Colors.brandDeep} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: Fonts.uiBold, fontSize: 14, color: Colors.textPrimary }}>Seulement avec mes amis</Text>
                <Text style={{ fontFamily: Fonts.ui, fontSize: 11.5, color: Colors.textMuted }}>Ignore les parties sans amis suivis.</Text>
              </View>
              <Toggle on={onlyFriends} onPress={() => setOnlyFriends(p => !p)} />
            </View>
          </Card>
        </FieldGroup>
      </ScrollView>

      {/* Liste déroulante des terrains (scrollable) */}
      <Modal visible={courtsOpen} transparent animationType="slide" onRequestClose={() => setCourtsOpen(false)}>
        <Pressable onPress={() => setCourtsOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} />
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '70%',
          backgroundColor: Colors.bgCard, borderTopLeftRadius: 20, borderTopRightRadius: 20,
          paddingBottom: insets.bottom + 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 16, color: Colors.textPrimary }}>Terrains</Text>
            <TouchableOpacity onPress={() => setCourtsOpen(false)} hitSlop={8}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.brandDeep }}>OK</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ paddingHorizontal: 18, fontFamily: Fonts.ui, fontSize: 12, color: Colors.textMuted, marginBottom: 6 }}>
            Aucun sélectionné = tous les terrains.
          </Text>
          <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8 }}>
            {courtOptions.map((c, i) => {
              const on = courts.includes(c);
              return (
                <TouchableOpacity key={c} onPress={() => setCourts(toggle(courts, c))} activeOpacity={0.85} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13, paddingHorizontal: 10,
                  borderBottomWidth: i < courtOptions.length - 1 ? 1 : 0, borderBottomColor: '#F1F0EE',
                }}>
                  <Icon name="mapPin" size={16} color={on ? Colors.brandDeep : Colors.textMuted} />
                  <Text style={{ flex: 1, fontFamily: on ? Fonts.uiBold : Fonts.ui, fontSize: 14, color: Colors.textPrimary }}>{c}</Text>
                  <View style={{
                    width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1.5, borderColor: on ? Colors.brand : Colors.border, backgroundColor: on ? Colors.brand : 'transparent',
                  }}>
                    {on ? <Icon name="check" size={15} color={Colors.primary} stroke={3} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      {/* Barre d'action collante */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 14, paddingBottom: insets.bottom + 14, backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.border }}>
        <BrandBtn
          label={saving ? 'Activation…' : "Activer l'alerte"}
          icon={saving ? <ActivityIndicator size="small" color={Colors.primary} /> : <Icon name="bell" size={18} color={Colors.primary} stroke={2.2} />}
          onPress={saving ? () => {} : save}
        />
      </View>
    </View>
  );
}
