/* components/story/StoryStyles.tsx
 * Styles signature (port RN des maquettes) : CardDark (profil), ScoreHero + Ticket (match),
 * PhotoMatch (photo/Strava) + dispatcher StoryCardV2.
 * Tous dessinés en canvas logique 1080×1920, mis à l'échelle par la prop `width`. */
import React, { forwardRef } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Rect } from 'react-native-svg';
import {
  Colors, Fonts, makeScale, leagueColor, leagueLabel,
  setsWon, setsLost, initialsOf, StoryPlayer, StoryMatchData, InviteData,
} from './storyTheme';
import { Wordmark, Avatars, BigSets, Invite } from './StoryPrimitives';

type Base = { width: number; invite: InviteData };

/* ── CARTE NOIRE (profil) ─────────────────────────────────────────── */
function CardDark({ width, player: p, invite }: Base & { player: StoryPlayer }) {
  const s = makeScale(width); const H = (width * 16) / 9; const gold = leagueColor(p.league);
  return (
    <View style={{ width, height: H, backgroundColor: '#0A0A0A' }}>
      <Svg width={width} height={H} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="g1" cx="82%" cy="10%" r="55%"><Stop offset="0" stopColor={Colors.brand} stopOpacity={0.16} /><Stop offset="1" stopColor={Colors.brand} stopOpacity={0} /></RadialGradient>
        </Defs>
        <Rect width={width} height={H} fill="url(#g1)" />
      </Svg>
      <View style={{ flex: 1, justifyContent: 'space-between', paddingHorizontal: s(92), paddingTop: s(110), paddingBottom: s(96) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Wordmark s={s} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(22), letterSpacing: s(5), color: 'rgba(255,255,255,0.35)' }}>CARTE JOUEUR</Text>
        </View>

        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(28), marginBottom: s(30) }}>
            <View style={{ width: s(132), height: s(132), borderRadius: s(32), backgroundColor: gold, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: Fonts.display, fontSize: s(64), color: '#0A0A0A' }}>{initialsOf(p.name)}</Text>
            </View>
            <View style={{ gap: s(12) }}>
              <View style={{ alignSelf: 'flex-start', borderRadius: 999, paddingVertical: s(8), paddingHorizontal: s(20), backgroundColor: gold + '22', borderWidth: 1.5, borderColor: gold + '66' }}>
                <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(22), letterSpacing: s(3), color: gold }}>● {leagueLabel[p.league]?.toUpperCase()}</Text>
              </View>
              <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(24), color: 'rgba(255,255,255,0.45)' }}>Rang #{p.rank}{p.frmtRank ? ` · FRMT ${p.frmtRank} ✓` : ''}</Text>
            </View>
          </View>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: s(150), lineHeight: s(140), color: '#fff', textTransform: 'uppercase' }} numberOfLines={1}>{p.name}</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(24), letterSpacing: s(4), color: 'rgba(255,255,255,0.4)', marginTop: s(28) }}>NIVEAU PADEL</Text>
          <Text style={{ fontFamily: Fonts.display, fontSize: s(200), color: gold }}>{p.level.toFixed(2)}</Text>
        </View>

        <View>
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.12)', paddingVertical: s(34) }}>
            {[['MATCHS', p.wins + p.losses], ['VICTOIRES', p.wins], ['WIN', p.winRate + '%']].map(([l, v], i) => (
              <View key={i} style={{ flex: 1, alignItems: i === 0 ? 'flex-start' : i === 2 ? 'flex-end' : 'center' }}>
                <Text style={{ fontFamily: Fonts.display, fontSize: s(84), color: '#fff' }}>{v}</Text>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(22), letterSpacing: s(3), color: 'rgba(255,255,255,0.4)' }}>{l}</Text>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: s(44), paddingTop: s(36), borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
            <Invite invite={invite} s={s} light accent={gold} qr={s(128)} />
            {p.club ? <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(22), color: 'rgba(255,255,255,0.4)', textAlign: 'right', maxWidth: s(220) }}>{p.club}</Text> : null}
          </View>
        </View>
      </View>
    </View>
  );
}

/* ── SCORE HERO (match) ───────────────────────────────────────────── */
function ScoreHero({ width, match: m, invite }: Base & { match: StoryMatchData }) {
  const s = makeScale(width); const H = (width * 16) / 9; const win = m.result === 'win';
  const acc = win ? Colors.success : Colors.danger;
  return (
    <View style={{ width, height: H, backgroundColor: '#0A0A0A' }}>
      <Svg width={width} height={H} style={StyleSheet.absoluteFill}>
        <Defs><RadialGradient id="gh" cx="80%" cy="8%" r="55%"><Stop offset="0" stopColor={acc} stopOpacity={0.18} /><Stop offset="1" stopColor={acc} stopOpacity={0} /></RadialGradient></Defs>
        <Rect width={width} height={H} fill="url(#gh)" />
      </Svg>
      <View style={{ flex: 1, justifyContent: 'space-between', paddingHorizontal: s(90), paddingTop: s(110), paddingBottom: s(96) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Wordmark s={s} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(22), letterSpacing: s(4), color: 'rgba(255,255,255,0.35)' }}>{(m.type || '').toUpperCase()}</Text>
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: s(90), color: acc, textTransform: 'uppercase', marginBottom: s(24) }}>{win ? 'Victoire 🏆' : 'Défaite'}</Text>
          <BigSets sets={m.sets} accent={Colors.brand} size={s(188)} s={s} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(28), letterSpacing: s(3), color: 'rgba(255,255,255,0.5)', marginTop: s(24) }}>{setsWon(m.sets)}–{setsLost(m.sets)} SETS{m.eloDelta ? ` · ${m.eloDelta} NIV.` : ''}</Text>
        </View>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(24), marginBottom: s(22) }}>
            <View style={{ width: s(6), height: s(96), backgroundColor: Colors.brand, borderRadius: s(3) }} />
            <Avatars names={m.winners} size={s(84)} dark s={s} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(20), letterSpacing: s(3), color: Colors.brand }}>VAINQUEURS</Text>
              <Text style={{ fontFamily: Fonts.welcome, fontSize: s(56), color: '#fff', textTransform: 'uppercase' }} numberOfLines={1}>{m.winners.join(' & ')}</Text>
            </View>
          </View>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(22), letterSpacing: s(6), color: 'rgba(255,255,255,0.3)', textAlign: 'center', marginVertical: s(10) }}>VS</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(24), marginBottom: s(34) }}>
            <View style={{ width: s(6), height: s(80), backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: s(3) }} />
            <Avatars names={m.losers} size={s(70)} dark s={s} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(18), letterSpacing: s(3), color: 'rgba(255,255,255,0.4)' }}>ADVERSAIRES</Text>
              <Text style={{ fontFamily: Fonts.welcome, fontSize: s(46), color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase' }} numberOfLines={1}>{m.losers.join(' & ')}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: s(30), borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
            <Invite invite={invite} s={s} light qr={s(120)} />
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(22), color: 'rgba(255,255,255,0.45)', textAlign: 'right', maxWidth: s(240) }}>📍 {m.location}{'\n'}{m.date}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/* ── TICKET (match, éditorial crème) ──────────────────────────────── */
function Ticket({ width, match: m, invite }: Base & { match: StoryMatchData }) {
  const s = makeScale(width); const H = (width * 16) / 9; const win = m.result === 'win';
  const Team = ({ names, label, c }: { names: string[]; label: string; c: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(20) }}>
      <Avatars names={names} size={s(72)} s={s} />
      <View>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(18), letterSpacing: s(3), color: c }}>{label}</Text>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: s(50), color: Colors.textPrimary, textTransform: 'uppercase' }} numberOfLines={1}>{names.join(' & ')}</Text>
      </View>
    </View>
  );
  return (
    <View style={{ width, height: H, backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: s(920), backgroundColor: Colors.bgCream, borderRadius: s(36), overflow: 'hidden' }}>
        <View style={{ backgroundColor: '#0A0A0A', paddingVertical: s(46), paddingHorizontal: s(56), flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Wordmark s={s} />
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(22), letterSpacing: s(3), color: win ? Colors.brand : Colors.danger }}>{win ? 'VICTOIRE' : 'DÉFAITE'}</Text>
        </View>
        <View style={{ paddingHorizontal: s(56), paddingTop: s(56), paddingBottom: s(30), alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(24), letterSpacing: s(4), color: Colors.textMuted }}>SCORE FINAL</Text>
          <View style={{ marginVertical: s(20) }}>
            <BigSets sets={m.sets} accent={Colors.brandDeep} mine={Colors.textPrimary} theirs={Colors.textMuted} size={s(170)} s={s} />
          </View>
        </View>
        {/* perforation */}
        <View style={{ marginHorizontal: s(40), borderTopWidth: s(4), borderColor: Colors.border, borderStyle: 'dashed' }} />
        <View style={{ paddingHorizontal: s(56), paddingTop: s(40), paddingBottom: s(56), gap: s(26) }}>
          <Team names={m.winners} label="VAINQUEURS" c={Colors.brandDeep} />
          <Team names={m.losers} label="ADVERSAIRES" c={Colors.textMuted} />
          <View style={{ borderTopWidth: 2, borderColor: Colors.border, paddingTop: s(22), alignItems: 'center' }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(24), letterSpacing: s(2), color: Colors.textSecondary }}>📍 {(m.location || '').toUpperCase()} · {(m.date || '').toUpperCase()}</Text>
          </View>
          <View style={{ borderTopWidth: 2, borderColor: Colors.border, paddingTop: s(26), alignItems: 'center' }}>
            <Invite invite={invite} s={s} light={false} accent={Colors.brandDeep} qr={s(120)} />
          </View>
        </View>
      </View>
    </View>
  );
}

/* ── PHOTO MATCH (façon Strava) ───────────────────────────────────── */
function PhotoMatch({ width, match: m, invite, photoUri }: Base & { match: StoryMatchData; photoUri?: string | null }) {
  const s = makeScale(width); const H = (width * 16) / 9; const win = m.result === 'win';
  return (
    <View style={{ width, height: H, backgroundColor: '#16181d' }}>
      {photoUri ? <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
      {/* scrim */}
      <Svg width={width} height={H} style={StyleSheet.absoluteFill}>
        <Defs><LinearGradient id="sc" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0A0A0A" stopOpacity={0.45} /><Stop offset="0.32" stopColor="#0A0A0A" stopOpacity={0} />
          <Stop offset="0.5" stopColor="#0A0A0A" stopOpacity={0} /><Stop offset="1" stopColor="#0A0A0A" stopOpacity={0.88} />
        </LinearGradient></Defs>
        <Rect width={width} height={H} fill="url(#sc)" />
      </Svg>
      <View style={{ position: 'absolute', top: s(100), left: s(84), right: s(84), flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark s={s} />
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(22), letterSpacing: s(3), color: '#fff', backgroundColor: 'rgba(0,0,0,0.32)', paddingVertical: s(12), paddingHorizontal: s(20), borderRadius: 999, overflow: 'hidden' }}>{(m.date || '').toUpperCase()}</Text>
      </View>
      <View style={{ position: 'absolute', left: s(84), right: s(84), bottom: s(96) }}>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: s(72), color: Colors.brand, textTransform: 'uppercase', marginBottom: s(12) }}>{win ? 'Victoire' : 'Défaite'} 🎾</Text>
        <BigSets sets={m.sets} accent={Colors.brand} size={s(172)} s={s} />
        <View style={{ height: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: s(28) }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: s(26) }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(36), color: '#fff' }} numberOfLines={1}>{m.winners.join(' & ')}</Text>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(26), color: 'rgba(255,255,255,0.8)' }} numberOfLines={1}>vs {m.losers.join(' & ')} · 📍 {m.location}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: Fonts.display, fontSize: s(56), color: Colors.brand }}>{m.eloDelta}</Text>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(20), letterSpacing: s(2), color: 'rgba(255,255,255,0.7)' }}>NIVEAU</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(18), padding: s(16), borderRadius: s(20), backgroundColor: 'rgba(0,0,0,0.34)' }}>
          <Invite invite={invite} s={s} light qr={s(96)} />
        </View>
      </View>
    </View>
  );
}

/* ── Dispatcher : mode + style → composant ────────────────────────── */
export type StoryMode = 'profil' | 'match' | 'photo';
export interface StoryCardProps {
  width: number; mode: StoryMode; styleId: string;
  player: StoryPlayer; match: StoryMatchData; invite: InviteData; photoUri?: string | null;
}

export const STORY_REGISTRY: Record<StoryMode, Array<{ id: string; name: string }>> = {
  profil: [{ id: 'dark', name: 'Carte Noire' }],
  match: [{ id: 'mhero', name: 'Score Hero' }, { id: 'mticket', name: 'Ticket' }],
  photo: [{ id: 'pmatch', name: 'Photo Match' }],
};

const StoryCardV2 = forwardRef<View, StoryCardProps>(function StoryCardV2(props, ref) {
  const { width, mode, styleId, player, match, invite, photoUri } = props;
  let content: React.ReactNode = null;
  if (mode === 'profil') content = <CardDark width={width} player={player} invite={invite} />;
  else if (mode === 'match') content = styleId === 'mticket'
    ? <Ticket width={width} match={match} invite={invite} />
    : <ScoreHero width={width} match={match} invite={invite} />;
  else content = <PhotoMatch width={width} match={match} invite={invite} photoUri={photoUri} />;
  return <View ref={ref} collapsable={false}>{content}</View>;
});

export default StoryCardV2;
export { CardDark, ScoreHero, Ticket, PhotoMatch };
