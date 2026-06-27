import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Pressable, Dimensions, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Fonts, eloToLevel } from '../../lib/theme';
import { track } from '../../lib/analytics';
import { postBilan } from '../../lib/activityFeed';
import { getMonthlyRecap, getRecapMonths, getLatestRecapMonth, type MonthlyRecap } from '../../lib/bilan';
import { GradientBg } from '../../components/bilan/GradientBg';
import { StoryProgress } from '../../components/bilan/StoryProgress';
import { SlideCover } from '../../components/bilan/slides/SlideCover';
import { SlideVolume } from '../../components/bilan/slides/SlideVolume';
import { SlideForme } from '../../components/bilan/slides/SlideForme';
import { SlideElo } from '../../components/bilan/slides/SlideElo';
import { SlideDuo } from '../../components/bilan/slides/SlideDuo';
import { SlideBest } from '../../components/bilan/slides/SlideBest';
import { SlidePartage } from '../../components/bilan/slides/SlidePartage';
import { SlideLowActivity } from '../../components/bilan/slides/SlideLowActivity';

const SLIDE_COUNT = 7;
const SLIDE_NAMES = ['cover', 'volume', 'forme', 'elo', 'duo', 'best', 'partage'];
// Palette multicolore handoff (cover/share orange→brun, volume vert, forme/duo noir, progression/best gris).
const BG: string[][] = [
  ['#FFC11A', '#E8A906', '#7C2D12'],  // 0 Cover
  ['#064E3B', '#022C22'],             // 1 Volume (green)
  ['#0A0A0A', '#1A1A1C'],             // 2 Forme (black)
  ['#1F2937', '#0A0A0A'],             // 3 Progression
  ['#0A0A0A', '#1A1A1C'],             // 4 Duo
  ['#1F2937', '#0F172A'],             // 5 Best
  ['#FFC11A', '#E8A906', '#7C2D12'],  // 6 Share
];

export default function BilanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { player } = usePlayer();
  const { month: monthParam } = useLocalSearchParams<{ month: string }>();

  const [month, setMonth] = useState<string | null>(null);
  const [months, setMonths] = useState<{ key: string; label: string }[]>([]);
  const [recap, setRecap] = useState<MonthlyRecap | null>(null);
  const [slide, setSlide] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const startMs = useRef(Date.now());

  useEffect(() => {
    if (!player) return;
    (async () => {
      const list = await getRecapMonths(player.id);
      setMonths(list);
      const wanted = monthParam && monthParam !== 'last' ? monthParam : await getLatestRecapMonth(player.id);
      setMonth(wanted ?? null);
      if (!wanted) setLoading(false);
    })();
  }, [player, monthParam]);

  const loadMonth = useCallback(async (m: string) => {
    if (!player) return;
    setLoading(true); setPosted(false);
    startMs.current = Date.now();
    const r = await getMonthlyRecap(player.id, m);
    setRecap(r); setSlide(0); setLoading(false);
    track('bilan_opened', { source: 'tab', month: m });
  }, [player]);

  useEffect(() => { if (month) loadMonth(month); }, [month, loadMonth]);

  useEffect(() => {
    if (recap) track('bilan_slide_viewed', { slide_index: slide, slide_name: SLIDE_NAMES[slide], month: recap.month });
    if (recap && slide === SLIDE_COUNT - 1) track('bilan_completed', { month: recap.month, duration_ms: Date.now() - startMs.current });
  }, [slide, recap]);

  const onPickMonth = (k: string) => {
    if (k === month) return;
    track('bilan_month_switched', { from_month: month, to_month: k });
    setMonth(k);
  };
  const goPrevMonth = () => {
    const idx = months.findIndex(m => m.key === month);
    const prevM = months[idx + 1];
    if (prevM) onPickMonth(prevM.key);
  };

  const next = () => setSlide(s => Math.min(SLIDE_COUNT - 1, s + 1));
  const prev = () => setSlide(s => Math.max(0, s - 1));

  // Auto-défilement façon Stories (~6 s/slide), stoppe sur la dernière slide.
  useEffect(() => {
    if (loading || !recap || recap.lowActivity) return;
    if (slide >= SLIDE_COUNT - 1) return;
    const t = setTimeout(() => setSlide(s => Math.min(SLIDE_COUNT - 1, s + 1)), 6000);
    return () => clearTimeout(t);
  }, [slide, loading, recap]);

  const doPost = async () => {
    if (!recap || busy || posted) return;
    setBusy(true);
    const err = await postBilan(recap.month, {
      label: recap.label, matches: recap.matches, winRate: recap.winRate,
      levelDelta: recap.levelDelta, topPartner: recap.topPartner?.name ?? null,
    });
    setBusy(false);
    if (!err) { setPosted(true); track('bilan_shared', { channel: 'in_app', month: recap.month }); Alert.alert('Publié', 'Ton bilan est partagé dans le fil de tes amis.'); }
    else Alert.alert('Publication impossible', err);
  };

  const colors = BG[slide] ?? BG[0];
  const darkText = slide === 0 || slide === 6;
  const W = Dimensions.get('window').width;
  const level = player ? eloToLevel(player.elo_score) : 0;

  return (
    <GradientBg colors={colors} angle={slide === 6 ? 135 : 160}>
      <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
        {!recap?.lowActivity && (
          <View style={{ paddingHorizontal: 12 }}>
            <StoryProgress count={SLIDE_COUNT} index={slide} />
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 8 }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 20, color: darkText ? '#0A0A0A' : '#FFFFFF' }}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#FFFFFF" /></View>
        ) : !recap ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 }}>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 16, color: '#FFFFFF', textAlign: 'center' }}>Pas encore de bilan pour ce mois.</Text>
          </View>
        ) : recap.lowActivity ? (
          <SlideLowActivity recap={recap} onPrevMonth={goPrevMonth} onPing={doPost} onClose={() => router.back()} />
        ) : (
          <View style={{ flex: 1 }}>
            {slide === 0 && <SlideCover recap={recap} months={months} onPickMonth={onPickMonth} />}
            {slide === 1 && <SlideVolume recap={recap} />}
            {slide === 2 && <SlideForme recap={recap} />}
            {slide === 3 && <SlideElo recap={recap} />}
            {slide === 4 && <SlideDuo recap={recap} onProposer={() => router.push('/(tabs)/lobby?create=1' as any)} />}
            {slide === 5 && <SlideBest recap={recap} />}
            {slide === 6 && <SlidePartage recap={recap} playerName={player?.name ?? ''} level={level} posted={posted} busy={busy} onPost={doPost} />}

            {slide !== 0 && slide !== 6 && (
              <View style={{ position: 'absolute', top: 60, bottom: 0, left: 0, right: 0, flexDirection: 'row' }} pointerEvents="box-none">
                <Pressable style={{ width: W * 0.33 }} onPress={prev} />
                <Pressable style={{ flex: 1 }} onPress={next} />
              </View>
            )}
            {slide === 0 && (
              <View style={{ position: 'absolute', top: 60, bottom: 120, right: 0, width: W * 0.5 }} pointerEvents="box-none">
                <Pressable style={{ flex: 1 }} onPress={next} />
              </View>
            )}
          </View>
        )}
      </View>
    </GradientBg>
  );
}
