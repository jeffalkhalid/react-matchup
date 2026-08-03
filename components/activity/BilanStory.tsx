import { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { GradientBg } from '../bilan/GradientBg';
import { StoryProgress } from '../bilan/StoryProgress';
import { SlideCover } from '../bilan/slides/SlideCover';
import { SlideVolume } from '../bilan/slides/SlideVolume';
import { SlideForme } from '../bilan/slides/SlideForme';
import { SlideElo } from '../bilan/slides/SlideElo';
import { SlideDuo } from '../bilan/slides/SlideDuo';
import { SlideBest } from '../bilan/slides/SlideBest';
import type { MonthlyRecap } from '../../lib/bilan';

// Lecteur PLEIN ÉCRAN d'un bilan partagé, en « succession de slides » (comme l'original).
// Lecture seule : pas de sélecteur de mois, pas de slide « Partager ». Cover→Best (6 slides).
// Réactions (🔥/💬) sur le POST via le bandeau du bas.
const COUNT = 6;
const BG: string[][] = [
  ['#FFC11A', '#E8A906', '#7C2D12'], ['#064E3B', '#022C22'], ['#0A0A0A', '#1A1A1C'],
  ['#1F2937', '#0A0A0A'], ['#0A0A0A', '#1A1A1C'], ['#1F2937', '#0F172A'],
];

export function BilanStory({ recap, authorName, myId, reactions, onReact, onComment, onClose }: {
  recap: MonthlyRecap;
  authorName?: string;
  myId: string;
  reactions?: Record<string, string[]>;
  onReact: () => void;
  onComment: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [slide, setSlide] = useState(0);
  const W = Dimensions.get('window').width;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-défilement ~6 s/slide, stoppe sur la dernière.
  useEffect(() => {
    if (slide >= COUNT - 1) return;
    timer.current = setTimeout(() => setSlide(s => Math.min(COUNT - 1, s + 1)), 6000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [slide]);

  const next = () => setSlide(s => Math.min(COUNT - 1, s + 1));
  const prev = () => setSlide(s => Math.max(0, s - 1));
  const darkText = slide === 0;
  const fire = reactions?.['🔥'] ?? [];
  const liked = !!myId && fire.includes(myId);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <GradientBg colors={BG[slide] ?? BG[0]} angle={160}>
        <View style={{ flex: 1, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 10 }}>
          <View style={{ paddingHorizontal: 12 }}><StoryProgress count={COUNT} index={slide} /></View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 }}>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiExtraBold, fontSize: 13, color: darkText ? '#0A0A0A' : '#FFFFFF' }}>
              {authorName ? `Bilan de ${authorName.split(' ')[0]}` : 'Bilan'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Icon name="x" size={20} color={darkText ? '#0A0A0A' : '#FFFFFF'} stroke={2.2} />
            </TouchableOpacity>
          </View>

          <View style={{ flex: 1 }}>
            {slide === 0 && <SlideCover recap={recap} months={[]} onPickMonth={() => {}} />}
            {slide === 1 && <SlideVolume recap={recap} />}
            {slide === 2 && <SlideForme recap={recap} />}
            {slide === 3 && <SlideElo recap={recap} />}
            {slide === 4 && <SlideDuo recap={recap} onProposer={() => {}} />}
            {slide === 5 && <SlideBest recap={recap} />}

            {/* Zones de tap g/d */}
            <View style={{ position: 'absolute', top: 60, bottom: 64, left: 0, right: 0, flexDirection: 'row' }} pointerEvents="box-none">
              <Pressable style={{ width: W * 0.33 }} onPress={prev} />
              <Pressable style={{ flex: 1 }} onPress={next} />
            </View>
          </View>

          {/* Bandeau réactions sur le post */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 }}>
            <TouchableOpacity onPress={onReact} activeOpacity={0.8}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: liked ? 'rgba(255,193,26,0.25)' : 'rgba(0,0,0,0.25)' }}>
              <Text style={{ fontSize: 15 }}>🔥</Text>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: liked ? Colors.brand : '#FFFFFF' }}>{fire.length || ''}</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={onComment} activeOpacity={0.85}
              style={{ borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10, backgroundColor: Colors.brand }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.primary }}>Commenter →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </GradientBg>
    </Modal>
  );
}
