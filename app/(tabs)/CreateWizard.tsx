import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, ActivityIndicator, StyleSheet, Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { eloToLevel, formatPadelLevel, padelLevelToElo } from '../../lib/theme';

// ─── Types ────────────────────────────────────────────────────
type GameType = 'Compétitif' | 'Amical' | 'Défi';
type Genre    = 'mixed' | 'men' | 'women';

export interface WizardResult {
  gameType: GameType; genre: Genre;
  matchDate: string; matchTime: string;
  location: string; hasReservation: boolean;
  minLevel: number; maxLevel: number;
  creatorSide: string;
  confirmedPlayers: Array<{ id: string; name: string; elo_score: number; team_side?: string }>;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onPublish: (data: WizardResult) => Promise<string>;
  player: { id: string; name: string; elo_score: number; gender?: string } | null;
  initialGameType?: GameType;
  initialInvite?: { id: string; name: string; elo_score: number };
}

// ─── Constants ────────────────────────────────────────────────
const SLOT_TO_SIDE: Record<string, string> = { A0: 'A_GAU', A1: 'A_DRO', B0: 'B_GAU', B1: 'B_DRO' };
const SCREEN_LABELS = ['Quand & Où', 'La partie', "L'équipe"];

const TIMES = [
  '08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30',
  '12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30',
  '16:00','16:30','17:00','17:30','18:00','18:30','19:00','19:30',
  '20:00','20:30','21:00','21:30','22:00','22:30',
];
const FR_DAYS         = ['Dim.','Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.'];
const FR_MONTHS       = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
const FR_MONTHS_LONG  = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const FR_DAYS_SHORT   = ['Lu','Ma','Me','Je','Ve','Sa','Di'];

// ─── Helpers ──────────────────────────────────────────────────
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildDays(n: number): Array<{ label: string; val: string }> {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(today); d.setDate(d.getDate() + i);
    const val   = localDateStr(d);
    const label = i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain'
      : `${FR_DAYS[d.getDay()]} ${d.getDate()} ${FR_MONTHS[d.getMonth()]}`;
    return { label, val };
  });
}

// approximate padel level (float) → ELO

// ─── Theme ────────────────────────────────────────────────────
function getTheme(type: GameType) {
  if (type === 'Défi') return {
    accent: '#d97706', headerBg: '#92400e', btnBg: '#f59e0b',
    eloBg: '#fef3c7', eloColor: '#92400e', eloBorder: '#fde68a',
    teamABg: '#fffbeb', teamABorder: '#fde68a', teamBBg: '#fff7ed', teamBBorder: '#fed7aa',
    libreBg: '#fffbeb', libreBorder: '#fde68a', libreColor: '#d97706',
    selectBg: '#fffbeb', selectColor: '#92400e',
  };
  if (type === 'Amical') return {
    accent: '#059669', headerBg: '#064e3b', btnBg: '#10b981',
    eloBg: '#d1fae5', eloColor: '#065f46', eloBorder: '#6ee7b7',
    teamABg: '#f0fdf4', teamABorder: '#bbf7d0', teamBBg: '#f0fdf4', teamBBorder: '#86efac',
    libreBg: '#dcfce7', libreBorder: '#86efac', libreColor: '#059669',
    selectBg: '#f0fdf4', selectColor: '#065f46',
  };
  return {
    accent: '#4f46e5', headerBg: '#1e1b4b', btnBg: '#4f46e5',
    eloBg: '#e0e7ff', eloColor: '#3730a3', eloBorder: '#c7d2fe',
    teamABg: '#eef2ff', teamABorder: '#c7d2fe', teamBBg: '#f5f3ff', teamBBorder: '#ddd6fe',
    libreBg: '#eef2ff', libreBorder: '#c7d2fe', libreColor: '#4f46e5',
    selectBg: '#eef2ff', selectColor: '#3730a3',
  };
}

// ─── Avatar ───────────────────────────────────────────────────
const AV_COLORS = ['#4f46e5','#10b981','#f59e0b','#ef4444','#06b6d4','#84cc16','#ec4899','#8b5cf6'];
function hashColor(name: string) {
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return AV_COLORS[h % AV_COLORS.length];
}
function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hashColor(name), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: Math.round(size * 0.4), fontWeight: '900' }}>
        {(name || '?').charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

// ─── MiniCalendar ─────────────────────────────────────────────
function MiniCalendar({ selectedVal, onSelect, t, allDays }: {
  selectedVal: string;
  onSelect: (val: string) => void;
  t: ReturnType<typeof getTheme>;
  allDays: Array<{ label: string; val: string }>;
}) {
  const todayStr = localDateStr(new Date());
  const [offset, setOffset] = useState(0);

  const base = new Date(); base.setDate(1); base.setMonth(base.getMonth() + offset);
  const year = base.getFullYear(), month = base.getMonth();
  const firstDow    = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const validSet    = new Set(allDays.map(d => d.val));

  const cells: Array<{ d: number; val: string; valid: boolean } | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const val = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ d, val, valid: validSet.has(val) });
  }

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1.5, borderColor: '#e2e8f0', padding: 12, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <TouchableOpacity onPress={() => offset > 0 && setOffset(o => o - 1)}
          style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', opacity: offset > 0 ? 1 : 0.3 }}>
          <Text style={{ color: '#64748b', fontSize: 16, fontWeight: '600' }}>‹</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 13, fontWeight: '900', color: '#0f172a' }}>{FR_MONTHS_LONG[month]} {year}</Text>
        <TouchableOpacity onPress={() => offset < 3 && setOffset(o => o + 1)}
          style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center', opacity: offset < 3 ? 1 : 0.3 }}>
          <Text style={{ color: '#64748b', fontSize: 16, fontWeight: '600' }}>›</Text>
        </TouchableOpacity>
      </View>
      {/* Day headers */}
      <View style={{ flexDirection: 'row', marginBottom: 4 }}>
        {FR_DAYS_SHORT.map(d => (
          <View key={d} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 9.5, fontWeight: '900', color: '#94a3b8' }}>{d}</Text>
          </View>
        ))}
      </View>
      {/* Day cells */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((cell, i) => {
          if (!cell) return <View key={`e${i}`} style={{ width: '14.28%', height: 34 }} />;
          const active  = cell.val === selectedVal;
          const isToday = cell.val === todayStr;
          return (
            <TouchableOpacity key={i} onPress={() => cell.valid && onSelect(cell.val)}
              activeOpacity={cell.valid ? 0.7 : 1}
              style={{ width: '14.28%', height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                backgroundColor: active ? t.btnBg : isToday ? t.eloBg : 'transparent',
                opacity: !cell.valid ? 0.3 : 1,
              }}>
              <Text style={{ fontSize: 12, fontWeight: (active || isToday) ? '900' : '500',
                color: active ? '#fff' : isToday ? t.eloColor : '#0f172a',
              }}>{cell.d}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────
export default function CreateWizard({ visible, onClose, onPublish, player, initialGameType, initialInvite }: Props) {
  const insets = useSafeAreaInsets();
  const ALL_DAYS   = buildDays(92);
  const QUICK_DAYS = ALL_DAYS.slice(0, 7);

  // UI state
  const [step,        setStep]        = useState(0);
  const [published,   setPublished]   = useState(false);
  const [submitting,  setSubmitting]  = useState(false);
  const [showAbandon, setShowAbandon] = useState(false);
  const [showCal,     setShowCal]     = useState(false);
  const [venueOpen,   setVenueOpen]   = useState(false);
  const [venueSearch, setVenueSearch] = useState('');
  const [inviteTarget, setInviteTarget] = useState<string | null>(null);

  // Data
  const [clubsList,   setClubsList]   = useState<string[]>([]);
  const [freqPlayers, setFreqPlayers] = useState<Array<{ id: string; name: string; elo_score: number }>>([]);
  const [searchQ,     setSearchQ]     = useState('');
  const [searchRes,   setSearchRes]   = useState<any[]>([]);
  const [searching,   setSearching]   = useState(false);

  // Form
  const myLevel = player ? eloToLevel(player.elo_score) : 4.0;
  const defaultMin = Math.max(1.0, Math.round((myLevel - 0.5) * 2) / 2);
  const defaultMax = Math.min(8.0, Math.round((myLevel + 0.5) * 2) / 2);

  const [form, setFormState] = useState({
    day:            QUICK_DAYS[1]?.val ?? '',
    time:           '19:00',
    location:       '',
    hasReservation: false,
    gameType:       'Compétitif' as GameType,
    genre:          'mixed' as Genre,
    minLevel:       defaultMin,
    maxLevel:       defaultMax,
    mySlot:         'A0' as string | null,
    invites:        {} as Record<string, { id: string; name: string; elo_score: number }>,
  });

  const set = useCallback(<K extends keyof typeof form>(k: K, v: typeof form[K]) => {
    setFormState(f => ({ ...f, [k]: v }));
  }, []);

  const t = getTheme(form.gameType);

  // Reset on open
  useEffect(() => {
    if (!visible) return;
    const lv = player ? eloToLevel(player.elo_score) : 4.0;
    const mn = Math.max(1.0, Math.round((lv - 0.5) * 2) / 2);
    const mx = Math.min(8.0, Math.round((lv + 0.5) * 2) / 2);
    setStep(0); setPublished(false); setSubmitting(false);
    setShowAbandon(false); setShowCal(false); setVenueOpen(false); setVenueSearch('');
    setInviteTarget(null); setSearchQ(''); setSearchRes([]);
    const gameType = initialGameType ?? 'Compétitif';
    const invites: Record<string, { id: string; name: string; elo_score: number }> = {};
    if (initialInvite) invites['B0'] = initialInvite;
    const defaultGenre: Genre =
      player?.gender === 'male' ? 'men' : player?.gender === 'female' ? 'women' : 'mixed';
    setFormState({
      day: QUICK_DAYS[1]?.val ?? '', time: '19:00', location: '',
      hasReservation: false, gameType, genre: defaultGenre,
      minLevel: mn, maxLevel: mx, mySlot: 'A0', invites,
    });
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load clubs
  useEffect(() => {
    if (!visible) return;
    supabase.from('clubs').select('name').order('name').then(({ data }) => {
      if (data) setClubsList(data.map((c: any) => c.name));
    });
  }, [visible]);

  // Load frequent players
  useEffect(() => {
    if (!visible || !player) return;
    const myId = player.id;
    supabase.from('matches')
      .select('winner_id,winner_id_2,loser_id,loser_id_2')
      .or(`winner_id.eq.${myId},winner_id_2.eq.${myId},loser_id.eq.${myId},loser_id_2.eq.${myId}`)
      .eq('status', 'validated').order('created_at', { ascending: false }).limit(30)
      .then(({ data: matches }) => {
        if (!matches?.length) return;
        const freq: Record<string, number> = {};
        matches.forEach((m: any) => {
          [m.winner_id, m.winner_id_2, m.loser_id, m.loser_id_2].forEach((id: string | null) => {
            if (id && id !== myId) freq[id] = (freq[id] || 0) + 1;
          });
        });
        const topIds = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
        if (!topIds.length) return;
        supabase.from('players').select('id,name,elo_score').in('id', topIds).then(({ data: players }) => {
          if (players) setFreqPlayers(topIds.map(id => (players as any[]).find(p => p.id === id)).filter(Boolean));
        });
      });
  }, [visible, player]);

  // Player search
  useEffect(() => {
    if (searchQ.length < 2) { setSearchRes([]); return; }
    setSearching(true);
    const t = setTimeout(() => {
      supabase.from('players').select('id,name,elo_score')
        .ilike('name', `%${searchQ}%`)
        .neq('id', player?.id ?? '')
        .limit(6)
        .then(({ data }) => { setSearchRes(data || []); setSearching(false); });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ, player]);

  // Step validation
  const canNext = [
    !!form.day && !!form.time && !!form.location,
    !!form.gameType && form.minLevel <= form.maxLevel,
    true,
  ][step] ?? true;

  // Step 2 helpers
  const invitedPlayers = Object.values(form.invites);
  const filledCount    = ['A0','A1','B0','B1'].filter(k => k === form.mySlot || form.invites[k]).length;
  const missingCount   = 4 - filledCount;
  const freqAvail  = freqPlayers.filter(fp => !invitedPlayers.find(i => i.id === fp.id) && fp.id !== player?.id);
  const searchAvail = searchRes.filter(r => !invitedPlayers.find(i => i.id === r.id) && r.id !== player?.id);

  function openInvite(key: string) { setInviteTarget(key); setSearchQ(''); }

  function assignPlayer(p: { id: string; name: string; elo_score: number }) {
    if (!inviteTarget) return;
    const newInvites = { ...form.invites, [inviteTarget]: p };
    const newMySlot  = form.mySlot === inviteTarget ? null : form.mySlot;
    setFormState(f => ({ ...f, invites: newInvites, mySlot: newMySlot }));
    setInviteTarget(null); setSearchQ('');
  }

  function pickMeSlot(key: string | null) {
    if (!key) { set('mySlot', null); return; }
    const inv = { ...form.invites }; delete inv[key];
    setFormState(f => ({ ...f, mySlot: key, invites: inv }));
  }

  async function handlePublish() {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onPublish({
        gameType:       form.gameType,
        genre:          form.genre,
        matchDate:      form.day,
        matchTime:      form.time,
        location:       form.location,
        hasReservation: form.hasReservation,
        minLevel:       form.minLevel,
        maxLevel:       form.maxLevel,
        creatorSide:    form.mySlot ? SLOT_TO_SIDE[form.mySlot] : 'A_GAU',
        confirmedPlayers: Object.entries(form.invites).map(([slot, p]) => ({ ...p, team_side: SLOT_TO_SIDE[slot] })),
      });
      setPublished(true);
    } catch { /* onPublish shows Alert */ }
    finally { setSubmitting(false); }
  }

  // ─── Step 0: When & Where ──────────────────────────────────
  function renderStep0() {
    const filteredClubs = clubsList.filter(c => c.toLowerCase().includes(venueSearch.toLowerCase()));
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Venue */}
        <Text style={sty.sectionLabel}>Terrain</Text>
        {/* Reservation toggle */}
        <TouchableOpacity onPress={() => set('hasReservation', !form.hasReservation)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12,
            backgroundColor: form.hasReservation ? '#fffbeb' : '#f8fafc',
            borderWidth: 1.5, borderColor: form.hasReservation ? '#fde68a' : '#e2e8f0', marginBottom: 10,
          }}>
          <Text style={{ fontSize: 15 }}>📅</Text>
          <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '900', color: form.hasReservation ? '#92400e' : '#334155' }}>
            J'ai une réservation
          </Text>
          <View style={{ width: 42, height: 24, borderRadius: 99, backgroundColor: form.hasReservation ? '#f59e0b' : '#e2e8f0', justifyContent: 'center', paddingHorizontal: 3 }}>
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: form.hasReservation ? 'flex-end' : 'flex-start', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 }} />
          </View>
        </TouchableOpacity>

        {/* Venue picker */}
        <TouchableOpacity onPress={() => setVenueOpen(v => !v)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13,
            borderWidth: 1.5, borderColor: form.location ? t.eloBorder : '#e2e8f0',
            backgroundColor: form.location ? t.selectBg : '#fff', marginBottom: venueOpen ? 0 : 10,
          }}>
          <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: form.location ? t.btnBg : '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14 }}>📍</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: form.location ? '900' : '500', color: form.location ? t.selectColor : '#94a3b8' }}>
            {form.location || 'Choisir un terrain…'}
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 12 }}>{venueOpen ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {venueOpen && (
          <View style={{ backgroundColor: '#fff', borderWidth: 1.5, borderColor: t.eloBorder, borderTopWidth: 0, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, marginBottom: 10, overflow: 'hidden' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
              <Text style={{ fontSize: 13 }}>🔍</Text>
              <TextInput
                value={venueSearch} onChangeText={setVenueSearch}
                placeholder="Rechercher…" placeholderTextColor="#94a3b8"
                style={{ flex: 1, fontSize: 13, color: '#0f172a' }}
                autoFocus
              />
              {venueSearch ? <TouchableOpacity onPress={() => setVenueSearch('')}><Text style={{ color: '#94a3b8' }}>✕</Text></TouchableOpacity> : null}
            </View>
            <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
              {filteredClubs.map(club => {
                const active = form.location === club;
                return (
                  <TouchableOpacity key={club} onPress={() => { set('location', club); setVenueOpen(false); setVenueSearch(''); }}
                    style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f8fafc', backgroundColor: active ? t.selectBg : '#fff' }}>
                    <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: active ? t.selectColor : '#0f172a' }}>{club}</Text>
                    {active && <Text style={{ color: t.accent, fontWeight: '900' }}>✓</Text>}
                  </TouchableOpacity>
                );
              })}
              {filteredClubs.length === 0 && venueSearch.length > 0 && (
                <TouchableOpacity onPress={() => { set('location', venueSearch); setVenueOpen(false); setVenueSearch(''); }}
                  style={{ padding: 12, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, fontWeight: '900', color: t.accent }}>+ Ajouter « {venueSearch} »</Text>
                </TouchableOpacity>
              )}
              {filteredClubs.length === 0 && venueSearch.length === 0 && (
                <View style={{ padding: 14, alignItems: 'center' }}>
                  <Text style={{ fontSize: 12, color: '#94a3b8' }}>Aucun club trouvé</Text>
                </View>
              )}
            </ScrollView>
          </View>
        )}

        {/* Date */}
        <Text style={[sty.sectionLabel, { marginTop: 4 }]}>Jour</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: showCal ? 8 : 14 }}>
          {QUICK_DAYS.map(d => {
            const active = form.day === d.val;
            return (
              <TouchableOpacity key={d.val} onPress={() => { set('day', d.val); setShowCal(false); }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
                  borderWidth: 2, borderColor: active ? t.accent : '#e2e8f0',
                  backgroundColor: active ? t.selectBg : '#fff',
                }}>
                <Text style={{ fontSize: 12, fontWeight: active ? '900' : '600', color: active ? t.selectColor : '#0f172a' }}>
                  {d.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity onPress={() => setShowCal(v => !v)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
              borderWidth: 2, borderColor: showCal ? t.eloBorder : '#e2e8f0',
              backgroundColor: showCal ? t.selectBg : 'transparent',
            }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: showCal ? t.selectColor : '#94a3b8' }}>
              📅 {showCal ? 'Masquer' : 'Autres dates'}
            </Text>
          </TouchableOpacity>
        </View>

        {showCal && (
          <MiniCalendar selectedVal={form.day} onSelect={v => { set('day', v); setShowCal(false); }} t={t} allDays={ALL_DAYS} />
        )}

        {/* Selected day pill (when from calendar) */}
        {form.day && !QUICK_DAYS.find(d => d.val === form.day) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10,
            backgroundColor: t.selectBg, borderWidth: 1.5, borderColor: t.eloBorder, borderRadius: 10, padding: 9 }}>
            <Text style={{ fontSize: 13 }}>📅</Text>
            <Text style={{ fontSize: 12, fontWeight: '900', color: t.selectColor, flex: 1 }}>
              {ALL_DAYS.find(d => d.val === form.day)?.label || form.day}
            </Text>
            <TouchableOpacity onPress={() => set('day', QUICK_DAYS[0].val)}>
              <Text style={{ color: t.selectColor, fontWeight: '900' }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Time */}
        <Text style={[sty.sectionLabel, { marginTop: 4 }]}>Heure</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
          {TIMES.map(tm => {
            const active = form.time === tm;
            return (
              <TouchableOpacity key={tm} onPress={() => set('time', tm)}
                style={{ width: '23%', paddingVertical: 9, borderRadius: 10,
                  borderWidth: 1.5, borderColor: active ? t.eloBorder : '#e2e8f0',
                  backgroundColor: active ? t.selectBg : '#fff', alignItems: 'center',
                }}>
                <Text style={{ fontSize: 12, fontWeight: active ? '900' : '600', color: active ? t.selectColor : '#0f172a' }}>{tm}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    );
  }

  // ─── Step 1: The match ─────────────────────────────────────
  function renderStep1() {
    const gameOptions: Array<{ val: GameType; icon: string; desc: string }> = [
      { val: 'Compétitif', icon: '🏆', desc: 'Points ELO, matchs classés' },
      { val: 'Amical',     icon: '😄', desc: 'Détente, sans classement' },
      { val: 'Défi',       icon: '⚡', desc: 'Défier une équipe adverse' },
    ];
    const genderOptions: Array<{ val: Genre; icon: string; label: string; desc: string }> =
      player?.gender === 'male'
        ? [{ val: 'men',   icon: '♂', label: 'Hommes', desc: 'Réservé aux hommes' }, { val: 'mixed', icon: '⚧', label: 'Mixte', desc: 'Hommes & femmes' }]
        : player?.gender === 'female'
          ? [{ val: 'women', icon: '♀', label: 'Femmes', desc: 'Réservé aux femmes' }, { val: 'mixed', icon: '⚧', label: 'Mixte', desc: 'Hommes & femmes' }]
          : [{ val: 'mixed', icon: '⚧', label: 'Mixte', desc: 'Hommes & femmes' }, { val: 'men', icon: '♂', label: 'Hommes', desc: 'Réservé aux hommes' }, { val: 'women', icon: '♀', label: 'Femmes', desc: 'Réservé aux femmes' }];

    const lockMin = form.gameType !== 'Amical';
    const lockMax = form.gameType === 'Compétitif';

    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Game type */}
        <Text style={sty.sectionLabel}>Type de match</Text>
        <View style={{ gap: 8, marginBottom: 18 }}>
          {gameOptions.map(opt => {
            const ot     = getTheme(opt.val);
            const active = form.gameType === opt.val;
            return (
              <TouchableOpacity key={opt.val} activeOpacity={0.8}
                onPress={() => {
                  const lv = player ? eloToLevel(player.elo_score) : 4.0;
                  const mn = Math.max(1.0, +(lv - 0.5).toFixed(2));
                  const mx = Math.min(8.0, +(lv + 0.5).toFixed(2));
                  if (opt.val === 'Compétitif') setFormState(f => ({ ...f, gameType: opt.val, minLevel: mn, maxLevel: mx }));
                  else if (opt.val === 'Défi')  setFormState(f => ({ ...f, gameType: opt.val, minLevel: mx }));
                  else set('gameType', opt.val);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
                  borderWidth: 2, borderColor: active ? ot.eloBorder : '#e2e8f0',
                  backgroundColor: active ? ot.teamABg : '#fff',
                }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: active ? ot.btnBg : '#f1f5f9', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 20 }}>{opt.icon}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: active ? ot.eloColor : '#0f172a' }}>{opt.val}</Text>
                  <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{opt.desc}</Text>
                </View>
                {active && <Text style={{ color: ot.accent, fontWeight: '900', fontSize: 16 }}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Gender */}
        <Text style={sty.sectionLabel}>Format</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
          {genderOptions.map(opt => {
            const active = form.genre === opt.val;
            return (
              <TouchableOpacity key={opt.val} onPress={() => set('genre', opt.val)} activeOpacity={0.8}
                style={{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 14,
                  borderWidth: 2, borderColor: active ? t.eloBorder : '#e2e8f0',
                  backgroundColor: active ? t.selectBg : '#fff',
                }}>
                <Text style={{ fontSize: 22 }}>{opt.icon}</Text>
                <Text style={{ fontSize: 12, fontWeight: '900', color: active ? t.selectColor : '#0f172a', textAlign: 'center' }}>{opt.label}</Text>
                <Text style={{ fontSize: 9.5, color: '#94a3b8', textAlign: 'center' }}>{opt.desc}</Text>
                {active && <Text style={{ color: t.accent, fontWeight: '900' }}>✓</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Level range */}
        <Text style={sty.sectionLabel}>Niveau (Padel)</Text>
        <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1.5, borderColor: '#e2e8f0', padding: 16, marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            {/* Min */}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', marginBottom: 6 }}>
                Minimum{lockMin ? ' 🔒' : ''}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {!lockMin && (
                  <TouchableOpacity onPress={() => set('minLevel', Math.max(1.0, +(form.minLevel - 0.1).toFixed(2)))}
                    style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 18, color: '#0f172a' }}>−</Text>
                  </TouchableOpacity>
                )}
                <Text style={{ fontSize: 26, fontWeight: '900', color: t.eloColor, minWidth: 42, textAlign: 'center' }}>
                  {form.minLevel.toFixed(2)}
                </Text>
                {!lockMin && (
                  <TouchableOpacity onPress={() => set('minLevel', Math.min(8.0, +(form.minLevel + 0.1).toFixed(2)))}
                    style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 18, color: '#0f172a' }}>+</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <View style={{ width: 1, height: 40, backgroundColor: '#e2e8f0' }} />
            {/* Max */}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: '#94a3b8', marginBottom: 6 }}>
                Maximum{lockMax ? ' 🔒' : ''}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {!lockMax && (
                  <TouchableOpacity onPress={() => set('maxLevel', Math.max(form.minLevel, +(form.maxLevel - 0.1).toFixed(2)))}
                    style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 18, color: '#0f172a' }}>−</Text>
                  </TouchableOpacity>
                )}
                <Text style={{ fontSize: 26, fontWeight: '900', color: t.eloColor, minWidth: 42, textAlign: 'center' }}>
                  {form.maxLevel.toFixed(2)}
                </Text>
                {!lockMax && (
                  <TouchableOpacity onPress={() => set('maxLevel', Math.min(8.0, +(form.maxLevel + 0.1).toFixed(2)))}
                    style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 18, color: '#0f172a' }}>+</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
          {/* Range bar */}
          <View style={{ height: 5, borderRadius: 99, backgroundColor: '#f1f5f9', overflow: 'hidden' }}>
            <View style={{ position: 'absolute', height: '100%', borderRadius: 99, backgroundColor: t.btnBg,
              left: `${((form.minLevel - 1) / 7) * 100}%`,
              right: `${100 - ((form.maxLevel - 1) / 7) * 100}%`,
            }} />
          </View>
          {lockMin && (
            <View style={{ marginTop: 8, backgroundColor: t.eloBg, borderWidth: 1, borderColor: t.eloBorder, borderRadius: 8, padding: 8 }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: t.eloColor, textAlign: 'center' }}>
                {lockMax ? '🔒 Niveaux fixés selon votre niveau' : '🔒 Niveau minimum fixé selon votre niveau'}
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    );
  }

  // ─── Step 2: The team ──────────────────────────────────────
  function renderStep2() {
    const recapItems = [
      ALL_DAYS.find(d => d.val === form.day)?.label || form.day,
      form.time, form.location || '—', form.gameType,
      form.genre === 'mixed' ? '⚧ Mixte' : form.genre === 'men' ? '♂ Hommes' : '♀ Femmes',
      `Niv. ${form.minLevel.toFixed(2)}–${form.maxLevel.toFixed(2)}`,
    ];
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Status */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, padding: 10, borderRadius: 12,
          backgroundColor: missingCount === 0 ? t.eloBg : '#fff7ed',
          borderWidth: 1, borderColor: missingCount === 0 ? t.eloBorder : '#fed7aa',
        }}>
          <Text style={{ fontSize: 16 }}>{missingCount === 0 ? '✅' : 'ℹ️'}</Text>
          <Text style={{ fontSize: 12, fontWeight: '900', color: missingCount === 0 ? t.eloColor : '#c2410c' }}>
            {missingCount === 0 ? 'Équipe complète !'
              : `${missingCount} place${missingCount > 1 ? 's' : ''} libre${missingCount > 1 ? 's' : ''}`}
          </Text>
          {missingCount > 0 && (
            <Text style={{ fontSize: 11, color: '#9a3412', marginLeft: 'auto', flexShrink: 1 }}>
              Tapez un emplacement pour inviter
            </Text>
          )}
        </View>

        {/* Slot grid */}
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
          {(['A', 'B'] as const).map(team => (
            <View key={team} style={{ flex: 1, backgroundColor: team === 'A' ? t.teamABg : t.teamBBg,
              borderWidth: 1.5, borderColor: team === 'A' ? t.teamABorder : t.teamBBorder,
              borderRadius: 14, padding: 10, alignItems: 'center', gap: 8,
            }}>
              <View style={{ backgroundColor: team === 'A' ? t.teamABorder : t.teamBBorder, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                <Text style={{ fontSize: 9, fontWeight: '900', color: t.accent, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Équipe {team}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {([0, 1] as const).map(pos => {
                  const key    = `${team}${pos}`;
                  const isMe   = form.mySlot === key;
                  const inv    = form.invites[key];
                  const isEmpty = !isMe && !inv;
                  return (
                    <View key={pos} style={{ alignItems: 'center', gap: 5 }}>
                      <TouchableOpacity
                        onPress={() => {
                          if (isMe) { pickMeSlot(null); }
                          else if (inv) { /* tap to remove */ const ni = { ...form.invites }; delete ni[key]; set('invites', ni); }
                          else if (!form.mySlot) { pickMeSlot(key); }
                          else { openInvite(key); }
                        }}
                        activeOpacity={0.7}
                        style={{ width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
                          backgroundColor: isMe ? '#4f46e5' : inv ? hashColor(inv.name) : t.libreBg,
                          borderWidth: isEmpty ? 2 : isMe ? 2.5 : 0,
                          borderStyle: isEmpty ? 'dashed' : 'solid',
                          borderColor: isEmpty ? t.libreBorder : isMe ? '#fff' : 'transparent',
                        }}>
                        {isMe
                          ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>{(player?.name || '?').charAt(0).toUpperCase()}</Text>
                          : inv
                            ? <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>{(inv.name || '?').charAt(0).toUpperCase()}</Text>
                            : <Text style={{ color: t.libreColor, fontSize: 20, fontWeight: '300' }}>+</Text>
                        }
                      </TouchableOpacity>
                      <View style={{ backgroundColor: '#0f172a', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                        <Text style={{ fontSize: 8, fontWeight: '900', color: '#fff', letterSpacing: 0.5 }}>
                          {pos === 0 ? 'GAU' : 'DRO'}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 9.5, fontWeight: '700', color: isMe ? '#4f46e5' : inv ? '#4f46e5' : t.libreColor, maxWidth: 52, textAlign: 'center' }} numberOfLines={1}>
                        {isMe ? 'Vous' : inv ? inv.name.split(' ')[0] : 'Libre'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        {/* Invite panel */}
        {inviteTarget && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={{ backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 14, padding: 12, marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <Text style={{ fontSize: 11, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  Inviter — Éq. {inviteTarget[0]} · {inviteTarget[1] === '0' ? 'Gauche' : 'Droite'}
                </Text>
                <TouchableOpacity onPress={() => { setInviteTarget(null); setSearchQ(''); }}
                  style={{ width: 24, height: 24, backgroundColor: '#f1f5f9', borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '900' }}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#f8fafc', borderRadius: 10, padding: 10, borderWidth: 1.5, borderColor: '#e2e8f0', marginBottom: 10 }}>
                <Text style={{ fontSize: 13 }}>🔍</Text>
                <TextInput
                  value={searchQ} onChangeText={setSearchQ}
                  placeholder="Nom du joueur…" placeholderTextColor="#94a3b8"
                  style={{ flex: 1, fontSize: 13, color: '#0f172a' }}
                  autoFocus
                />
                {searching && <ActivityIndicator size="small" color="#4f46e5" />}
              </View>
              {/* Frequent players */}
              {!searchQ && freqAvail.length > 0 && (
                <>
                  <Text style={[sty.sectionLabel, { marginBottom: 6 }]}>Habituels</Text>
                  <View style={{ gap: 5, marginBottom: searchAvail.length > 0 ? 10 : 0 }}>
                    {freqAvail.map(p => (
                      <TouchableOpacity key={p.id} onPress={() => assignPlayer(p)}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' }}>
                        <Avatar name={p.name} size={32} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>{p.name}</Text>
                          <Text style={{ fontSize: 10, color: '#94a3b8' }}>Niv. {formatPadelLevel(p.elo_score)}</Text>
                        </View>
                        <View style={{ backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fde68a', borderRadius: 99, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 9, fontWeight: '900', color: '#92400e' }}>Habituel</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              {/* Search results */}
              {searchAvail.length > 0 && (
                <View style={{ gap: 5 }}>
                  {searchAvail.map(p => (
                    <TouchableOpacity key={p.id} onPress={() => assignPlayer(p)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' }}>
                      <Avatar name={p.name} size={32} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>{p.name}</Text>
                        <Text style={{ fontSize: 10, color: '#94a3b8' }}>Niv. {formatPadelLevel(p.elo_score)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        )}

        {/* Recap */}
        <View style={{ backgroundColor: '#fff', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 14, overflow: 'hidden', marginBottom: 8 }}>
          <View style={{ height: 3, backgroundColor: t.btnBg }} />
          <View style={{ padding: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {recapItems.map((item, i) => (
                <View key={i} style={{ backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#334155' }}>{item}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
    );
  }

  // ─── Published screen ──────────────────────────────────────
  if (published) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#f8fafc', paddingTop: insets.top }}>
          <View style={{ alignItems: 'center', padding: 32, paddingBottom: 16 }}>
            <Text style={{ fontSize: 52, marginBottom: 12 }}>🎾</Text>
            <Text style={{ fontSize: 22, fontWeight: '900', color: '#0f172a', letterSpacing: -0.4, marginBottom: 6 }}>Partie publiée !</Text>
            <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 20 }}>
              Visible dans l'Explorer.{Object.keys(form.invites).length > 0
                ? ` ${Object.keys(form.invites).length} invitation${Object.keys(form.invites).length > 1 ? 's' : ''} envoyée${Object.keys(form.invites).length > 1 ? 's' : ''}.`
                : ''}
            </Text>
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 18, borderWidth: 1.5, borderColor: '#e2e8f0', overflow: 'hidden' }}>
              <View style={{ height: 4, backgroundColor: t.btnBg }} />
              <View style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                  <View style={{ backgroundColor: t.eloBg, borderWidth: 1, borderColor: t.eloBorder, borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: t.eloColor, textTransform: 'uppercase' }}>{form.gameType}</Text>
                  </View>
                  <View style={{ backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 99, paddingHorizontal: 9, paddingVertical: 3 }}>
                    <Text style={{ fontSize: 10, fontWeight: '900', color: '#64748b' }}>
                      {form.genre === 'mixed' ? '⚧ Mixte' : form.genre === 'men' ? '♂ Hommes' : '♀ Femmes'}
                    </Text>
                  </View>
                </View>
                <Text style={{ fontSize: 15, fontWeight: '900', color: '#0f172a' }}>
                  {ALL_DAYS.find(d => d.val === form.day)?.label || form.day}
                  <Text style={{ color: t.accent }}> · {form.time}</Text>
                </Text>
                <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                  Niv. {form.minLevel.toFixed(2)}–{form.maxLevel.toFixed(2)} · {form.location}
                </Text>
              </View>
            </View>
          </ScrollView>
          <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 16, gap: 10 }}>
            <TouchableOpacity onPress={onClose} style={{
              padding: 14, borderRadius: 14, backgroundColor: t.btnBg, alignItems: 'center',
              shadowColor: t.btnBg, shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
            }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>Retour au Lobby 🎾</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // ─── Wizard shell ──────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => setShowAbandon(true)}>
      <View style={{ flex: 1, backgroundColor: '#f8fafc' }}>

        {/* Abandon confirm */}
        {showAbandon && (
          <View style={{ position: 'absolute', inset: 0, zIndex: 100, backgroundColor: 'rgba(11,17,33,0.75)', justifyContent: 'flex-end' }}>
            <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 32 }}>
              <Text style={{ fontSize: 32, textAlign: 'center', marginBottom: 10 }}>🚫</Text>
              <Text style={{ fontSize: 17, fontWeight: '900', color: '#0f172a', textAlign: 'center', marginBottom: 8 }}>Abandonner la création ?</Text>
              <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 20, marginBottom: 22 }}>
                Ta partie n'a pas été sauvegardée.{'\n'}Toutes les informations seront perdues.
              </Text>
              <View style={{ gap: 9 }}>
                <TouchableOpacity onPress={() => { setShowAbandon(false); onClose(); }}
                  style={{ padding: 14, borderRadius: 14, backgroundColor: '#ef4444', alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>Abandonner</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setShowAbandon(false)}
                  style={{ padding: 13, borderRadius: 14, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', alignItems: 'center' }}>
                  <Text style={{ color: '#334155', fontWeight: '800', fontSize: 14 }}>Continuer la création</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Header */}
        <View style={{ backgroundColor: t.headerBg, paddingHorizontal: 16, paddingTop: insets.top + 12, paddingBottom: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <TouchableOpacity onPress={() => step > 0 ? setStep(s => s - 1) : undefined}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', opacity: step > 0 ? 1 : 0 }}>
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: '600' }}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#fff' }}>Créer une partie</Text>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: '600' }}>{SCREEN_LABELS[step]}</Text>
            </View>
            {/* Step dots */}
            <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
              {[0, 1, 2].map(i => (
                <View key={i} style={{ height: 6, borderRadius: 99, backgroundColor: i < step ? 'rgba(255,255,255,0.55)' : i === step ? '#fff' : 'rgba(255,255,255,0.18)', width: i === step ? 18 : 6 }} />
              ))}
            </View>
            <TouchableOpacity onPress={() => setShowAbandon(true)}
              style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontWeight: '900' }}>✕</Text>
            </TouchableOpacity>
          </View>
          {/* Progress bar */}
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {[0, 1, 2].map(i => (
              <View key={i} style={{ flex: 1, height: 3, borderRadius: 99,
                backgroundColor: i < step ? 'rgba(255,255,255,0.75)' : i === step ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)',
              }} />
            ))}
          </View>
        </View>

        {/* Step content */}
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 18 }}>
          {step === 0 && renderStep0()}
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
        </View>

        {/* CTA */}
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: '#fff', borderTopWidth: 1.5, borderTopColor: '#e2e8f0', flexDirection: 'row', gap: 8 }}>
          {step > 0 && (
            <TouchableOpacity onPress={() => setStep(s => s - 1)}
              style={{ width: 50, height: 50, borderRadius: 13, borderWidth: 1.5, borderColor: '#e2e8f0', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#64748b', fontWeight: '900', fontSize: 16 }}>‹</Text>
            </TouchableOpacity>
          )}
          {step < 2 ? (
            <TouchableOpacity onPress={() => canNext && setStep(s => s + 1)}
              activeOpacity={canNext ? 0.8 : 1}
              style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: canNext ? t.btnBg : '#e2e8f0', alignItems: 'center', justifyContent: 'center',
                ...(canNext ? { shadowColor: t.btnBg, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 } : {}),
              }}>
              <Text style={{ color: canNext ? '#fff' : '#94a3b8', fontWeight: '900', fontSize: 14 }}>
                {step === 0 && !canNext ? 'Choisissez un terrain, une date et une heure' : 'Continuer →'}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={handlePublish} disabled={submitting}
              style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: submitting ? '#e2e8f0' : t.btnBg, alignItems: 'center', justifyContent: 'center',
                ...(!submitting ? { shadowColor: t.btnBg, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 } : {}),
              }}>
              {submitting
                ? <ActivityIndicator color="#94a3b8" />
                : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>Publier la partie 🎾</Text>
              }
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const sty = StyleSheet.create({
  sectionLabel: {
    fontSize: 10, fontWeight: '900', color: '#94a3b8',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 7,
  },
});
