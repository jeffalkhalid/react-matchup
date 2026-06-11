/* components/story/StoryStyles.tsx
 * Styles signature (port RN des maquettes) : CardDark (profil), ScoreHero + Ticket (match),
 * PhotoMatch (photo/Strava) + dispatcher StoryCardV2.
 * Tous dessinés en canvas logique 1080×1920, mis à l'échelle par la prop `width`. */
import React, { forwardRef } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';
import {
  Colors, Fonts, makeScale, leagueColor, leagueLabel, leagueGrad,
  setsWon, setsLost, initialsOf, StoryPlayer, StoryMatchData, InviteData,
  StoryMatchOpts, StoryToggles, DEFAULT_TOGGLES,
} from './storyTheme';
import { Wordmark, Avatars, BigSets, Invite } from './StoryPrimitives';

type Base = { width: number; invite: InviteData };

/* ── Ring : anneau de progression (win rate) ──────────────────────── */
function Ring({ rate, size, sw, track, color, labelColor, subColor }:
  { rate: number; size: number; sw: number; track: string; color: string; labelColor: string; subColor: string }) {
  const r = (size - sw) / 2; const c = 2 * Math.PI * r; const cx = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={cx} cy={cx} r={r} stroke={track} strokeWidth={sw} fill="none" />
        <Circle cx={cx} cy={cx} r={r} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round"
          strokeDasharray={`${(c * rate) / 100} ${c}`} />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontFamily: Fonts.display, fontSize: size * 0.3, color: labelColor }}>{rate}<Text style={{ fontSize: size * 0.16 }}>%</Text></Text>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: size * 0.08, letterSpacing: size * 0.02, color: subColor, marginTop: size * 0.02 }}>WIN RATE</Text>
      </View>
    </View>
  );
}

/* ── CARTE NOIRE (profil) ─────────────────────────────────────────── */
function CardDark({ width, player: p, invite }: Base & { player: StoryPlayer }) {
  const s = makeScale(width); const H = (width * 16) / 9; const gold = leagueColor(p.league);
  const rankLine = [
    p.rank > 0 ? `Rang #${p.rank}` : null,
    p.frmtRank ? `FRMT ${p.frmtRank} ✓` : null,
  ].filter(Boolean).join(' · ');
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
              {rankLine ? <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(24), color: 'rgba(255,255,255,0.45)' }}>{rankLine}</Text> : null}
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

/* Résout les options de personnalisation d'une story de match. */
function resolveMatchOpts(opts?: StoryMatchOpts) {
  return {
    brand: opts?.accent ?? Colors.brand,
    show: { ...DEFAULT_TOGGLES, ...(opts?.toggles ?? {}) } as StoryToggles,
    caption: opts?.caption?.trim() ? opts.caption.trim() : null,
    bgUri: opts?.bgUri ?? null,
  };
}

/* Ligne lieu · date respectant les toggles (renvoie null si tout est masqué). */
function metaLine(m: StoryMatchData, show: StoryToggles): string | null {
  const parts = [
    show.location && m.location ? `📍 ${m.location}` : null,
    show.date && m.date ? m.date : null,
  ].filter(Boolean) as string[];
  return parts.length ? parts.join('\n') : null;
}

/* ── SCORE HERO (match) ───────────────────────────────────────────── */
function ScoreHero({ width, match: m, invite, opts }: Base & { match: StoryMatchData; opts?: StoryMatchOpts }) {
  const s = makeScale(width); const H = (width * 16) / 9; const win = m.result === 'win';
  const acc = win ? Colors.success : Colors.danger;
  const { brand, show, caption, bgUri } = resolveMatchOpts(opts);
  const inv = { ...invite, showQR: invite.showQR && show.qr };
  const meta = metaLine(m, show);
  return (
    <View style={{ width, height: H, backgroundColor: '#0A0A0A' }}>
      {bgUri ? (
        <>
          <Image source={{ uri: bgUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.66)' }]} />
        </>
      ) : (
        <Svg width={width} height={H} style={StyleSheet.absoluteFill}>
          <Defs><RadialGradient id="gh" cx="80%" cy="8%" r="55%"><Stop offset="0" stopColor={acc} stopOpacity={0.18} /><Stop offset="1" stopColor={acc} stopOpacity={0} /></RadialGradient></Defs>
          <Rect width={width} height={H} fill="url(#gh)" />
        </Svg>
      )}
      <View style={{ flex: 1, justifyContent: 'space-between', paddingHorizontal: s(90), paddingTop: s(110), paddingBottom: s(96) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {show.logo ? <Wordmark s={s} /> : <View />}
          {show.type ? <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(22), letterSpacing: s(4), color: 'rgba(255,255,255,0.35)' }}>{(m.type || '').toUpperCase()}</Text> : null}
        </View>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: s(90), color: acc, textTransform: 'uppercase', marginBottom: s(24) }}>{win ? 'Victoire' : 'Défaite'}</Text>
          <BigSets sets={m.sets} accent={brand} size={s(188)} s={s} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(28), letterSpacing: s(3), color: 'rgba(255,255,255,0.5)', marginTop: s(24) }}>{setsWon(m.sets)}–{setsLost(m.sets)} SETS{show.elo && m.eloDelta ? ` · ${m.eloDelta} NIV.` : ''}</Text>
          {caption ? <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(30), color: '#fff', textAlign: 'center', marginTop: s(24), maxWidth: s(820) }}>“{caption}”</Text> : null}
        </View>
        <View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(24), marginBottom: s(22) }}>
            <View style={{ width: s(6), height: s(96), backgroundColor: brand, borderRadius: s(3) }} />
            <Avatars names={m.winners} size={s(84)} dark s={s} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(20), letterSpacing: s(3), color: brand }}>VAINQUEURS</Text>
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
            <Invite invite={inv} s={s} light qr={s(120)} />
            {meta ? <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(22), color: 'rgba(255,255,255,0.45)', textAlign: 'right', maxWidth: s(240) }}>{meta}</Text> : null}
          </View>
        </View>
      </View>
    </View>
  );
}

/* ── TICKET (match, éditorial crème) ──────────────────────────────── */
function Ticket({ width, match: m, invite, opts }: Base & { match: StoryMatchData; opts?: StoryMatchOpts }) {
  const s = makeScale(width); const H = (width * 16) / 9; const win = m.result === 'win';
  const { brand, show, caption, bgUri } = resolveMatchOpts(opts);
  const inv = { ...invite, showQR: invite.showQR && show.qr };
  const ticketMeta = [
    show.location && m.location ? (m.location || '').toUpperCase() : null,
    show.date && m.date ? (m.date || '').toUpperCase() : null,
  ].filter(Boolean).join(' · ');
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
      {bgUri ? (
        <>
          <Image source={{ uri: bgUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.5)' }]} />
        </>
      ) : null}
      <View style={{ width: s(920), backgroundColor: Colors.bgCard, borderRadius: s(36), overflow: 'hidden' }}>
        <View style={{ backgroundColor: '#0A0A0A', paddingVertical: s(46), paddingHorizontal: s(56), flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {show.logo ? <Wordmark s={s} /> : <View />}
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(22), letterSpacing: s(3), color: win ? brand : Colors.danger }}>{win ? 'VICTOIRE' : 'DÉFAITE'}</Text>
        </View>
        <View style={{ paddingHorizontal: s(56), paddingTop: s(56), paddingBottom: s(30), alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(24), letterSpacing: s(4), color: Colors.textMuted }}>SCORE FINAL{show.elo && m.eloDelta ? ` · ${m.eloDelta} NIV.` : ''}</Text>
          <View style={{ marginVertical: s(20) }}>
            <BigSets sets={m.sets} accent={brand} mine={Colors.textPrimary} theirs={Colors.textMuted} size={s(170)} s={s} />
          </View>
          {caption ? <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(28), color: Colors.textSecondary, textAlign: 'center', maxWidth: s(760) }}>“{caption}”</Text> : null}
        </View>
        {/* perforation */}
        <View style={{ marginHorizontal: s(40), borderTopWidth: s(4), borderColor: Colors.border, borderStyle: 'dashed' }} />
        <View style={{ paddingHorizontal: s(56), paddingTop: s(40), paddingBottom: s(56), gap: s(26) }}>
          <Team names={m.winners} label="VAINQUEURS" c={brand} />
          <Team names={m.losers} label="ADVERSAIRES" c={Colors.textMuted} />
          {ticketMeta ? (
            <View style={{ borderTopWidth: 2, borderColor: Colors.border, paddingTop: s(22), alignItems: 'center' }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(24), letterSpacing: s(2), color: Colors.textSecondary }}>📍 {ticketMeta}</Text>
            </View>
          ) : null}
          <View style={{ borderTopWidth: 2, borderColor: Colors.border, paddingTop: s(26), alignItems: 'center' }}>
            <Invite invite={inv} s={s} light={false} accent={brand} qr={s(120)} />
          </View>
        </View>
      </View>
    </View>
  );
}

/* ── MINIMAL (match, fond uni + score géant) ──────────────────────── */
function MinimalMatch({ width, match: m, invite, opts }: Base & { match: StoryMatchData; opts?: StoryMatchOpts }) {
  const s = makeScale(width); const H = (width * 16) / 9; const win = m.result === 'win';
  const { brand, show, caption, bgUri } = resolveMatchOpts(opts);
  const inv = { ...invite, showQR: invite.showQR && show.qr };
  const meta = metaLine(m, show);
  return (
    <View style={{ width, height: H, backgroundColor: '#0A0A0A' }}>
      {bgUri ? (
        <>
          <Image source={{ uri: bgUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} />
        </>
      ) : null}
      <View style={{ flex: 1, justifyContent: 'space-between', paddingHorizontal: s(96), paddingTop: s(120), paddingBottom: s(110) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {show.logo ? <Wordmark s={s} /> : <View />}
          {show.type ? <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(22), letterSpacing: s(4), color: 'rgba(255,255,255,0.3)' }}>{(m.type || '').toUpperCase()}</Text> : null}
        </View>
        <View>
          <View style={{ width: s(120), height: s(10), backgroundColor: brand, borderRadius: s(5), marginBottom: s(40) }} />
          <Text style={{ fontFamily: Fonts.welcome, fontSize: s(120), lineHeight: s(118), color: '#fff', textTransform: 'uppercase' }}>{win ? 'Victoire' : 'Défaite'}</Text>
          <Text style={{ fontFamily: Fonts.display, fontSize: s(150), color: brand, marginTop: s(10) }}>{m.sets.map(([a, b]) => `${a}-${b}`).join('  ')}</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(26), letterSpacing: s(3), color: 'rgba(255,255,255,0.55)', marginTop: s(28) }} numberOfLines={2}>
            {m.winners.join(' & ')}  vs  {m.losers.join(' & ')}{show.elo && m.eloDelta ? `   ·   ${m.eloDelta} NIV.` : ''}
          </Text>
          {caption ? <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(32), color: '#fff', marginTop: s(30), maxWidth: s(840) }}>“{caption}”</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: s(34), borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          <Invite invite={inv} s={s} light qr={s(120)} />
          {meta ? <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(22), color: 'rgba(255,255,255,0.45)', textAlign: 'right', maxWidth: s(240) }}>{meta}</Text> : null}
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
        <Text style={{ fontFamily: Fonts.welcome, fontSize: s(72), color: Colors.brand, textTransform: 'uppercase', marginBottom: s(12) }}>{win ? 'Victoire' : 'Défaite'}</Text>
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

/* ── TRADING CARD (profil — collector or/holo) ────────────────────── */
function TradingCard({ width, player: p, invite }: Base & { player: StoryPlayer }) {
  const s = makeScale(width); const H = (width * 16) / 9;
  const [g1, g2] = leagueGrad[p.league] ?? leagueGrad.gold;
  const ink = '#2A1C00'; const inkSoft = 'rgba(42,28,0,0.55)';
  const total = p.wins + p.losses;
  const cw = s(940); const ch = (cw * 1740) / 980;
  const Cell = ({ l, v }: { l: string; v: string | number }) => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontFamily: Fonts.display, fontSize: s(72), color: ink }}>{v}</Text>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(22), letterSpacing: s(2), color: inkSoft, marginTop: s(2) }}>{l}</Text>
    </View>
  );
  return (
    <View style={{ width, height: H, backgroundColor: '#0A0A0A', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: cw, height: ch, borderRadius: s(56), overflow: 'hidden', borderWidth: s(6), borderColor: 'rgba(255,255,255,0.35)' }}>
        <Svg width={cw} height={ch} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="tc" x1="0" y1="0" x2="1" y2="1"><Stop offset="0" stopColor={g2} /><Stop offset="0.6" stopColor={g1} /><Stop offset="1" stopColor="#8a4f04" /></LinearGradient>
            <RadialGradient id="tcg" cx="50%" cy="28%" r="62%"><Stop offset="0" stopColor="#fff" stopOpacity={0.32} /><Stop offset="1" stopColor="#fff" stopOpacity={0} /></RadialGradient>
          </Defs>
          <Rect width={cw} height={ch} fill="url(#tc)" />
          <Rect width={cw} height={ch} fill="url(#tcg)" />
        </Svg>
        {/* holo streak */}
        <View style={{ position: 'absolute', top: -ch * 0.1, left: cw * 0.22, width: cw * 0.16, height: ch * 1.3, backgroundColor: 'rgba(255,255,255,0.12)', transform: [{ rotate: '22deg' }] }} />

        <View style={{ flex: 1, paddingHorizontal: s(56), paddingTop: s(64), paddingBottom: s(54), justifyContent: 'space-between' }}>
          {/* top corner */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontFamily: Fonts.display, fontSize: s(150), color: ink, lineHeight: s(140) }}>{p.level.toFixed(1)}</Text>
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(36), letterSpacing: s(3), color: ink }}>{leagueLabel[p.league]?.toUpperCase()}</Text>
              <View style={{ width: s(90), height: s(4), backgroundColor: ink, opacity: 0.4, marginVertical: s(12), borderRadius: s(4) }} />
              <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(34), letterSpacing: s(4), color: ink }}>PADEL</Text>
            </View>
            {p.rank > 0 ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(26), letterSpacing: s(4), color: inkSoft }}>RANG</Text>
                <Text style={{ fontFamily: Fonts.display, fontSize: s(96), color: ink, lineHeight: s(92) }}>#{p.rank}</Text>
              </View>
            ) : null}
          </View>

          {/* avatar + name */}
          <View style={{ alignItems: 'center', gap: s(28) }}>
            <View style={{ width: s(300), height: s(300), borderRadius: s(150), backgroundColor: 'rgba(10,8,0,0.18)', borderWidth: s(8), borderColor: ink, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: Fonts.display, fontSize: s(150), color: ink }}>{initialsOf(p.name)}</Text>
            </View>
            <Text style={{ fontFamily: Fonts.welcome, fontSize: s(104), color: ink, textTransform: 'uppercase', textAlign: 'center' }} numberOfLines={1}>{p.name}</Text>
            {p.frmtVerified && p.frmtRank ? <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(28), letterSpacing: s(2), color: inkSoft }}>FRMT {p.frmtRank} ✓</Text> : null}
          </View>

          {/* stat grid */}
          <View>
            <View style={{ flexDirection: 'row', paddingVertical: s(22), borderTopWidth: s(3), borderColor: 'rgba(42,28,0,0.2)' }}>
              <Cell l="MAT" v={total} /><Cell l="VIC" v={p.wins} /><Cell l="DÉF" v={p.losses} />
            </View>
            <View style={{ flexDirection: 'row', paddingVertical: s(22), borderTopWidth: s(2), borderColor: 'rgba(42,28,0,0.14)' }}>
              <Cell l="WIN%" v={p.winRate} /><Cell l="SÉRIE" v={p.streak} /><Cell l="FIAB" v={p.fiability ?? 0} />
            </View>
            <View style={{ alignItems: 'center', marginTop: s(20), paddingTop: s(24), borderTopWidth: s(2), borderColor: 'rgba(42,28,0,0.14)' }}>
              <Invite invite={invite} s={s} light={false} accent={ink} qr={s(104)} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

/* ── ÉDITORIAL (profil — crème magazine) ──────────────────────────── */
function EditorialLight({ width, player: p, invite }: Base & { player: StoryPlayer }) {
  const s = makeScale(width); const H = (width * 16) / 9; const gold = Colors.brandDeep;
  const total = p.wins + p.losses;
  const parts = p.name.split(' '); const first = parts[0]; const last = parts.slice(1).join(' ');
  return (
    <View style={{ width, height: H, backgroundColor: Colors.bgCard, paddingHorizontal: s(92), paddingTop: s(120), paddingBottom: s(100) }}>
      {/* top meta */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Wordmark s={s} light={false} h={52} />
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: s(24), letterSpacing: s(3), color: Colors.textMuted }}>CARTE JOUEUR</Text>
      </View>
      <View style={{ height: s(5), backgroundColor: Colors.textPrimary, marginTop: s(28) }}>
        <View style={{ width: s(240), height: s(5), backgroundColor: Colors.brand }} />
      </View>

      {/* name block */}
      <View style={{ marginTop: s(64) }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(26), letterSpacing: s(5), color: gold, marginBottom: s(16) }}>● {leagueLabel[p.league]?.toUpperCase()}{p.rank > 0 ? ` · RANG #${p.rank}` : ''}</Text>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: s(176), lineHeight: s(160), color: Colors.textPrimary, textTransform: 'uppercase' }} numberOfLines={1}>{first}</Text>
        {last ? <Text style={{ fontFamily: Fonts.welcome, fontSize: s(176), lineHeight: s(160), color: Colors.textPrimary, textTransform: 'uppercase' }} numberOfLines={1}>{last}</Text> : null}
      </View>

      {/* big number + ring */}
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: s(20) }}>
        <View>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(26), letterSpacing: s(4), color: Colors.textMuted }}>NIVEAU PADEL</Text>
          <Text style={{ fontFamily: Fonts.display, fontSize: s(240), lineHeight: s(210), color: Colors.textPrimary }}>{p.level.toFixed(2)}</Text>
        </View>
        <Ring rate={p.winRate} size={s(220)} sw={s(16)} track="rgba(10,10,10,0.10)" color={Colors.textPrimary} labelColor={Colors.textPrimary} subColor={Colors.textMuted} />
      </View>

      {/* stat line */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: s(3), borderColor: Colors.textPrimary, paddingTop: s(36) }}>
        {([[p.wins, 'VICTOIRES'], [p.losses, 'DÉFAITES'], [total, 'MATCHS'], [p.streak, 'SÉRIE 🔥']] as [number, string][]).map(([v, l], i) => (
          <React.Fragment key={l}>
            {i > 0 ? <View style={{ width: s(2), height: s(80), backgroundColor: Colors.border }} /> : null}
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontFamily: Fonts.display, fontSize: s(88), color: Colors.textPrimary }}>{v}</Text>
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(22), letterSpacing: s(2), color: Colors.textMuted, marginTop: s(4) }}>{l}</Text>
            </View>
          </React.Fragment>
        ))}
      </View>

      {/* invite */}
      <View style={{ alignItems: 'center', marginTop: s(40), paddingTop: s(36), borderTopWidth: s(2), borderColor: Colors.border }}>
        <Invite invite={invite} s={s} light={false} accent={gold} qr={s(112)} />
      </View>
    </View>
  );
}

/* ── Dispatcher : mode + style → composant ────────────────────────── */
export type StoryMode = 'profil' | 'match' | 'photo';
export interface StoryCardProps {
  width: number; mode: StoryMode; styleId: string;
  player: StoryPlayer; match: StoryMatchData; invite: InviteData; photoUri?: string | null;
  matchOpts?: StoryMatchOpts;
}

export const STORY_REGISTRY: Record<StoryMode, Array<{ id: string; name: string }>> = {
  profil: [{ id: 'dark', name: 'Carte Noire' }, { id: 'trading', name: 'Trading Card' }, { id: 'editorial', name: 'Éditorial' }],
  match: [{ id: 'mhero', name: 'Score Hero' }, { id: 'mticket', name: 'Ticket' }, { id: 'mmin', name: 'Minimal' }],
  photo: [{ id: 'pmatch', name: 'Photo Match' }],
};

const StoryCardV2 = forwardRef<View, StoryCardProps>(function StoryCardV2(props, ref) {
  const { width, mode, styleId, player, match, invite, photoUri, matchOpts } = props;
  let content: React.ReactNode = null;
  if (mode === 'profil') content = styleId === 'trading'
    ? <TradingCard width={width} player={player} invite={invite} />
    : styleId === 'editorial'
      ? <EditorialLight width={width} player={player} invite={invite} />
      : <CardDark width={width} player={player} invite={invite} />;
  else if (mode === 'match') content = styleId === 'mticket'
    ? <Ticket width={width} match={match} invite={invite} opts={matchOpts} />
    : styleId === 'mmin'
      ? <MinimalMatch width={width} match={match} invite={invite} opts={matchOpts} />
      : <ScoreHero width={width} match={match} invite={invite} opts={matchOpts} />;
  else content = <PhotoMatch width={width} match={match} invite={invite} photoUri={photoUri} />;
  return <View ref={ref} collapsable={false}>{content}</View>;
});

export default StoryCardV2;
export { CardDark, TradingCard, EditorialLight, ScoreHero, Ticket, MinimalMatch, PhotoMatch };
