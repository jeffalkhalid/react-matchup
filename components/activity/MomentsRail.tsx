import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import Svg, { Line } from 'react-native-svg';
import { Colors, Fonts } from '../../lib/theme';
import { matchToView } from '../../lib/matchView';
import { track } from '../../lib/analytics';
import { BadgePill } from '../profile/BadgePill';
import type { ActivityEvent } from '../../types';

const initials = (n?: string) => (n || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();

// En-tête d'une tuile : avatar (cercle jaune) + prénom.
function TileHeader({ name }: { name?: string }) {
  return (
    <View style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: Colors.brand, borderWidth: 1.5, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 8.5, color: '#0A0A0A' }}>{initials(name)}</Text>
      </View>
      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9.5, color: '#FFFFFF', maxWidth: 80 }}>{name?.split(' ')[0] ?? 'Joueur'}</Text>
    </View>
  );
}

function MomentTile({ e, onPress }: { e: ActivityEvent; onPress: () => void }) {
  const name = e.actor?.name;
  // ── Match (victoire/défaite) : score + adversaires (rendu standard) ──
  if ((e.type === 'match_win' || e.type === 'match_loss') && e.match) {
    const v = matchToView(e.match, e.player_id, false);
    const win = e.type === 'match_win';
    const score = v.sets.map(([a, b]) => `${a}/${b}`).join(' ');
    const opp = v.teams[1].map(t => t.name.split(' ')[0]).join(' & ');
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.9}
        style={{ width: 128, height: 184, borderRadius: 18, backgroundColor: '#1F2937', overflow: 'hidden' }}>
        <TileHeader name={name} />
        {/* « terrain » avec le score écrit dedans */}
        <View style={{ position: 'absolute', top: '28%', bottom: '30%', left: '12%', right: '12%', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', borderRadius: 6, backgroundColor: 'rgba(255,193,26,0.08)', alignItems: 'center', justifyContent: 'center' }}>
          <Svg width="100%" height="100%" style={{ position: 'absolute' }}><Line x1="0" y1="50%" x2="100%" y2="50%" stroke="rgba(255,255,255,0.22)" strokeWidth={1} /></Svg>
          <Text style={{ fontFamily: Fonts.display, fontSize: 22, color: '#FFFFFF', letterSpacing: -0.5, textAlign: 'center' }}>{score || '—'}</Text>
        </View>
        <View style={{ position: 'absolute', bottom: 10, left: 10, right: 10 }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: win ? Colors.brand : Colors.danger, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 8, color: win ? '#0A0A0A' : '#FFFFFF', letterSpacing: 0.5 }}>{win ? 'VICTOIRE' : 'DÉFAITE'}</Text>
          </View>
          {opp ? <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 9, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>vs {opp}</Text> : null}
        </View>
      </TouchableOpacity>
    );
  }
  // ── Promotion ──
  if (e.type === 'promotion') {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.9}
        style={{ width: 128, height: 184, borderRadius: 18, backgroundColor: Colors.brand, overflow: 'hidden' }}>
        <TileHeader name={name} />
        <Text style={{ position: 'absolute', top: '38%', alignSelf: 'center', fontSize: 42 }}>🏆</Text>
        <View style={{ position: 'absolute', bottom: 10, left: 10, right: 10 }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: '#0A0A0A', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 8, color: Colors.brand, letterSpacing: 0.5 }}>⬆ {(e.payload.promo_label ?? 'PROMOTION').toUpperCase()}</Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  }
  // ── Bilan mensuel partagé ──
  if (e.type === 'bilan') {
    const lvl = e.payload.levelDelta ?? 0;
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.9}
        style={{ width: 128, height: 184, borderRadius: 18, backgroundColor: Colors.brand, overflow: 'hidden' }}>
        <TileHeader name={name} />
        <View style={{ position: 'absolute', top: '34%', left: 10, right: 10, alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.display, fontSize: 30, color: '#0A0A0A', lineHeight: 30 }}>{e.payload.matches ?? 0}</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 9, color: 'rgba(10,10,10,0.7)', letterSpacing: 0.5, textTransform: 'uppercase' }}>matchs · {e.payload.winRate ?? 0}%</Text>
        </View>
        <View style={{ position: 'absolute', bottom: 10, left: 10, right: 10 }}>
          <View style={{ alignSelf: 'flex-start', backgroundColor: '#0A0A0A', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 8, color: Colors.brand, letterSpacing: 0.5 }}>BILAN</Text>
          </View>
          <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 18, color: '#0A0A0A', lineHeight: 20, marginTop: 4 }}>{e.payload.label ?? 'Bilan'}</Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 9, color: 'rgba(10,10,10,0.7)', marginTop: 1 }}>{lvl >= 0 ? '+' : ''}{lvl.toFixed(2)} de niveau</Text>
        </View>
      </TouchableOpacity>
    );
  }
  // ── Badge ──
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}
      style={{ width: 128, height: 184, borderRadius: 18, backgroundColor: '#0A0A0A', overflow: 'hidden' }}>
      <TileHeader name={name} />
      <View style={{ position: 'absolute', top: '32%', alignSelf: 'center' }}>
        <BadgePill badge={e.payload.badge_label ?? ''} size={56} />
      </View>
      <View style={{ position: 'absolute', bottom: 10, left: 10, right: 10 }}>
        <View style={{ alignSelf: 'flex-start', backgroundColor: Colors.brand, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 8, color: '#0A0A0A', letterSpacing: 0.5 }}>+ BADGE</Text>
        </View>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 18, color: '#FFFFFF', lineHeight: 20, marginTop: 4 }}>{e.payload.badge_label ?? 'Badge'}</Text>
      </View>
    </TouchableOpacity>
  );
}

export function MomentsRail({ moments, onShareMatch, onOpen }: {
  moments: ActivityEvent[];
  onShareMatch: () => void;
  onOpen: (e: ActivityEvent) => void;
}) {
  return (
    <View style={{ marginTop: 18 }}>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 17, color: Colors.textPrimary, marginBottom: 10 }}>Moments de la semaine</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingRight: 16 }}>
        {moments.map(e => (
          <MomentTile key={e.id} e={e} onPress={() => { track('activity_moment_opened', { friend_id: e.player_id, moment_type: e.type }); onOpen(e); }} />
        ))}
        {/* Slot Partager — ouvre le compositeur in-app */}
        <TouchableOpacity onPress={onShareMatch} activeOpacity={0.85}
          style={{ width: 128, height: 184, borderRadius: 18, backgroundColor: '#F6F5F3', borderWidth: 2, borderStyle: 'dashed', borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14 }}>
          <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 20, color: Colors.brand, lineHeight: 22 }}>＋</Text>
          </View>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10.5, color: Colors.textPrimary, textAlign: 'center', lineHeight: 14 }}>Partage ton dernier match</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}
