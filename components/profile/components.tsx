// ── PagMatch profile (refonte) — composants visuels ───────────────────
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, LayoutChangeEvent, Image } from 'react-native';
import Svg, {
  Path, Circle, Line, Polyline, Polygon, Defs, Stop,
  LinearGradient as SvgLinearGradient, G,
} from 'react-native-svg';
import { PM, accentOf, ACCENT, initials, PFonts } from './theme';
import { Glyph } from './glyphs';

const A = accentOf(ACCENT);

// ── Types de présentation (alimentés par les adaptateurs de tabs.tsx) ──
export interface PlayerLite { id?: string; name: string; lvl?: number; me?: boolean }
export interface MatchView {
  id?: string;
  club: string; date: string; time: string;
  result: 'Victoire' | 'Défaite'; delta: number;
  teams: [PlayerLite[], PlayerLite[]];
  sets: [number, number][]; winnerRow: 0 | 1;
}
export interface TimelinePoint { lvl: number; result: 'Victoire' | 'Défaite'; match: MatchView }
export interface RepBadge { emoji: string; label: string; n: number }
export interface AchievementView { key: string; name: string; desc: string; glyph: string; progress: number; target: number; unlocked: boolean }

// ── Avatar à initiales — charte noir/or, distinction d'équipe ─────────
export function Avatar({ name, size = 30, me = false, team }: { name: string; size?: number; me?: boolean; team?: 0 | 1 }) {
  const mine = me || team === 0;
  return (
    <View style={{
      width: size, height: size, borderRadius: Math.round(size * 0.32),
      backgroundColor: mine ? ACCENT : PM.ink,
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: mine ? PM.ink : '#FFFFFF', fontWeight: '800', fontSize: Math.round(size * 0.40) }}>
        {initials(name)}
      </Text>
    </View>
  );
}

// ── Niveau discret « Niv. X.XX » ─────────────────────────────────────
export function LevelPill({ lvl }: { lvl?: number }) {
  if (lvl == null) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      <Text style={{ fontSize: 7.5, fontWeight: '500', letterSpacing: 0.3, textTransform: 'uppercase', color: PM.faint }}>Niv. </Text>
      <Text style={{ fontSize: 9, fontWeight: '500', color: PM.sub }}>{lvl.toFixed(2)}</Text>
    </View>
  );
}

// ── Grille de score — sets en colonnes, 2 lignes = 2 équipes ──────────
export function ScoreGrid({ sets, winnerRow }: { sets: [number, number][]; winnerRow: 0 | 1 }) {
  const nSets = sets.length;
  const Row = (rowIdx: 0 | 1) => (
    <View style={{ flexDirection: 'row' }}>
      {sets.map((s, i) => {
        const win = winnerRow === rowIdx;
        return (
          <View key={`${rowIdx}-${i}`} style={{
            width: 30, paddingVertical: 7, alignItems: 'center', justifyContent: 'center',
            borderRightWidth: i < nSets - 1 ? 1 : 0, borderRightColor: PM.divider,
            borderBottomWidth: rowIdx === 0 ? 1 : 0, borderBottomColor: PM.divider,
            backgroundColor: win ? A.soft : 'transparent',
          }}>
            <Text style={{ fontFamily: PFonts.anton, fontSize: 19, lineHeight: 20, color: win ? ACCENT : PM.muted }}>
              {s[rowIdx]}
            </Text>
          </View>
        );
      })}
    </View>
  );
  return (
    <View style={{ borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: PM.border, backgroundColor: '#FBFBFA' }}>
      {Row(0)}
      {Row(1)}
    </View>
  );
}

function MatchPlayer({ p, team, onPress }: { p: PlayerLite; team: 0 | 1; onPress?: () => void }) {
  const Wrap: any = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      {...(onPress ? { onPress, activeOpacity: 0.7 } : {})}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 0 }}>
      <Avatar name={p.name} size={28} me={p.me} team={team} />
      <View style={{ minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: p.me ? '800' : '600', color: PM.text, maxWidth: 90 }}>
            {p.name.split(' ')[0]}
          </Text>
          {p.me && <Text style={{ fontSize: 11 }}>👑</Text>}
        </View>
        <LevelPill lvl={p.lvl} />
      </View>
    </Wrap>
  );
}

// ── Carte d'un match ──────────────────────────────────────────────────
export function MatchCard({ m, onShare, compact = false, onPress, footer, showActions = true, showDelta = true, onPlayerPress }: {
  m: MatchView; onShare?: () => void; compact?: boolean;
  onPress?: () => void; footer?: React.ReactNode; showActions?: boolean; showDelta?: boolean;
  onPlayerPress?: (id: string) => void;
}) {
  const win = m.result === 'Victoire';
  const clubInit = m.club.split(' ').map(w => w[0]).join('').slice(0, 2);
  const Wrap: any = onPress ? TouchableOpacity : View;
  return (
    <Wrap
      {...(onPress ? { onPress, activeOpacity: 0.85 } : {})}
      style={{
        backgroundColor: PM.card, borderRadius: 18, borderWidth: 1, borderColor: PM.border,
        padding: compact ? 12 : 14, gap: compact ? 10 : 12,
      }}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: PM.ink, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: ACCENT, fontSize: 8.5, fontWeight: '900', textAlign: 'center' }}>{clubInit}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '800', color: PM.text, textTransform: 'uppercase', letterSpacing: 0.2 }}>{m.club}</Text>
          <Text style={{ fontSize: 10.5, color: PM.muted, marginTop: 1 }}>{m.date} · {m.time}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          {showDelta && (
            <Text style={{ fontSize: 11, fontWeight: '800', color: m.delta >= 0 ? PM.successDk : PM.danger }}>
              {m.delta >= 0 ? '+' : ''}{m.delta.toFixed(2)}
            </Text>
          )}
          <View style={{ borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: win ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.10)' }}>
            <Text style={{ fontSize: 9.5, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase', color: win ? PM.successDk : PM.danger }}>{m.result}</Text>
          </View>
        </View>
      </View>

      {/* Équipes + score */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {m.teams[0].map((p, i) => <View key={i} style={{ flex: 1, minWidth: 0 }}><MatchPlayer p={p} team={0} onPress={p.id && onPlayerPress ? () => onPlayerPress(p.id!) : undefined} /></View>)}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {m.teams[1].map((p, i) => <View key={i} style={{ flex: 1, minWidth: 0 }}><MatchPlayer p={p} team={1} onPress={p.id && onPlayerPress ? () => onPlayerPress(p.id!) : undefined} /></View>)}
          </View>
        </View>
        <View><ScoreGrid sets={m.sets} winnerRow={m.winnerRow} /></View>
      </View>

      {/* Actions / footer personnalisable */}
      {footer ? footer : showActions ? (
        <View style={{ flexDirection: 'row', gap: 7, borderTopWidth: 1, borderTopColor: PM.divider, paddingTop: 10 }}>
          {([['🔥', 'Vamos', undefined], ['💬', 'Commenter', undefined], ['↗', 'Partager', onShare]] as [string, string, (() => void) | undefined][]).map(([ic, lbl, fn]) => (
            <TouchableOpacity key={lbl} activeOpacity={0.7} onPress={fn} style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
              borderWidth: 1, borderColor: PM.border, backgroundColor: '#fff', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 4,
            }}>
              <Text style={{ fontSize: 12 }}>{ic}</Text>
              {!compact && <Text style={{ fontSize: 11, fontWeight: '700', color: PM.sub }}>{lbl}</Text>}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </Wrap>
  );
}

// ── Bouton d'action d'une carte de match (Vamos / Commenter / Partager) ─
export function MatchActionButton({ icon, label, onPress, active, count, compact = false }: {
  icon: string; label: string; onPress?: () => void; active?: boolean; count?: number; compact?: boolean;
}) {
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={{
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      borderWidth: 1, borderColor: active ? A.line : PM.border,
      backgroundColor: active ? A.soft : '#fff', borderRadius: 10, paddingVertical: 7, paddingHorizontal: 4,
    }}>
      <Text style={{ fontSize: 12 }}>{icon}</Text>
      {!compact && <Text style={{ fontSize: 11, fontWeight: '700', color: active ? A.deep : PM.sub }}>{label}{count ? ` ${count}` : ''}</Text>}
    </TouchableOpacity>
  );
}

// ── Anneau de victoires ───────────────────────────────────────────────
export function WinRing({ rate, label = 'VICTOIRES' }: { rate: number; label?: string }) {
  const size = 78, stroke = 8, r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={PM.divider} strokeWidth={stroke} />
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={ACCENT} strokeWidth={stroke}
          strokeDasharray={`${c * rate / 100} ${c}`} strokeLinecap="round" />
      </Svg>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: PFonts.anton, fontSize: 22, lineHeight: 24, color: PM.text }}>{rate}%</Text>
        <Text style={{ fontSize: 7, fontWeight: '800', color: PM.muted, letterSpacing: 0.7, marginTop: 1 }}>{label}</Text>
      </View>
    </View>
  );
}

export function StatTile({ value, label, sub, accentVal }: { value: string | number; label: string; sub?: string; accentVal?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 4, paddingVertical: 2 }}>
      <Text style={{ fontFamily: PFonts.anton, fontSize: 24, lineHeight: 26, color: accentVal || PM.text }}>{value}</Text>
      <Text style={{ fontSize: 8.5, fontWeight: '800', color: PM.muted, letterSpacing: 0.7, textTransform: 'uppercase', marginTop: 5, textAlign: 'center' }}>{label}</Text>
      {sub ? <Text style={{ fontSize: 9, color: PM.faint, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

export function Section({ title, action, children, pad = 15, noCard = false }: {
  title: string; action?: string; children: React.ReactNode; pad?: number; noCard?: boolean;
}) {
  return (
    <View style={{ gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: '900', color: PM.text, letterSpacing: 1, textTransform: 'uppercase' }}>{title}</Text>
        {action ? <Text style={{ fontSize: 11, fontWeight: '700', color: PM.muted, marginLeft: 12 }}>{action}</Text> : null}
      </View>
      {noCard ? children : (
        <View style={{ backgroundColor: PM.card, borderRadius: 18, borderWidth: 1, borderColor: PM.border, padding: pad }}>{children}</View>
      )}
    </View>
  );
}

export function FilterPills({ items, active, onPick }: { items: string[]; active: string; onPick: (s: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {items.map(it => {
        const on = it === active;
        return (
          <TouchableOpacity key={it} activeOpacity={0.8} onPress={() => onPick(it)} style={{
            borderWidth: on ? 0 : 1, borderColor: PM.border,
            backgroundColor: on ? PM.ink : '#fff',
            borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5,
          }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: on ? ACCENT : PM.sub }}>{it}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Graphe d'évolution du niveau — points cliquables ──────────────────
export function LevelChart({ data, selected, onSelect }: { data: TimelinePoint[]; selected: number; onSelect: (i: number) => void }) {
  const [w, setW] = useState(0);
  const W = 300, H = 118, padX = 14, padTop = 20, padBot = 22;
  const vals = data.map(d => d.lvl);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 0.01;
  const step = (W - padX * 2) / (data.length - 1 || 1);
  const pts = data.map((d, i) => ({
    x: padX + i * step,
    y: padTop + (1 - (d.lvl - min) / range) * (H - padTop - padBot),
    d,
  }));
  const line = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${pts[0].x},${H - padBot} ${line} ${pts[pts.length - 1].x},${H - padBot}`;
  const si = Math.min(selected, pts.length - 1);
  const sel = pts[si];
  const win = sel.d.result === 'Victoire';
  const scale = w > 0 ? w / W : 0;

  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);

  return (
    <View onLayout={onLayout} style={{ width: '100%', height: H * (scale || 1) }}>
      {scale > 0 && (
        <>
          {/* key = signature de la ligne → remonte le SVG quand le jeu de points
              change (5/10/Tous), sinon react-native-svg garde l'ancien tracé. */}
          <Svg key={line} width={w} height={H * scale} viewBox={`0 0 ${W} ${H}`}>
            <Defs>
              <SvgLinearGradient id="lvlgrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={ACCENT} stopOpacity={0.28} />
                <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
              </SvgLinearGradient>
            </Defs>
            <Line x1={padX} x2={W - padX} y1={padTop + 0.5 * (H - padTop - padBot)} y2={padTop + 0.5 * (H - padTop - padBot)} stroke={PM.divider} strokeWidth={1} strokeDasharray="3 4" />
            <Polygon points={area} fill="url(#lvlgrad)" />
            <Polyline points={line} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            <Line x1={sel.x} x2={sel.x} y1={sel.y} y2={H - padBot} stroke={ACCENT} strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
            {pts.map((p, i) => i === si ? null : (
              <Circle key={i} cx={p.x} cy={p.y} r={3.2} fill={p.d.result === 'Victoire' ? '#fff' : PM.muted} stroke={ACCENT} strokeWidth={1.6} />
            ))}
            <Circle cx={sel.x} cy={sel.y} r={5.5} fill={win ? ACCENT : PM.danger} stroke="#fff" strokeWidth={2.5} />
          </Svg>

          {/* Cible de clic unique : sélectionne le point le plus proche du toucher.
              Évite les zones 32px qui se chevauchaient (points denses non cliquables). */}
          <Pressable
            onPress={(e) => {
              const lx = e.nativeEvent.locationX;
              let best = 0, bestD = Infinity;
              for (let i = 0; i < pts.length; i++) {
                const dx = Math.abs(pts[i].x * scale - lx);
                if (dx < bestD) { bestD = dx; best = i; }
              }
              onSelect(best);
            }}
            style={{ position: 'absolute', left: 0, top: 0, width: w, height: H * scale }}
          />

          {/* Bulle valeur */}
          <View pointerEvents="none" style={{
            position: 'absolute', left: sel.x * scale - 22, top: Math.max(0, sel.y * scale - 30),
            backgroundColor: PM.ink, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, minWidth: 44, alignItems: 'center',
          }}>
            <Text style={{ fontFamily: PFonts.anton, color: ACCENT, fontSize: 12 }}>{sel.d.lvl.toFixed(2)}</Text>
          </View>
        </>
      )}
    </View>
  );
}

// ── Médaille de palmarès — hexagone + anneau de progression ───────────
function hexPoints(r: number, cx = 50, cy = 50) {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = (-90 + i * 60) * Math.PI / 180;
    pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)},${(cy + r * Math.sin(ang)).toFixed(2)}`);
  }
  return pts.join(' ');
}

export function AchievementMedal({ ach }: { ach: AchievementView }) {
  const pct = Math.max(0, Math.min(ach.progress / ach.target, 1));
  const done = ach.unlocked || ach.progress >= ach.target;
  const fillPct = Math.round(pct * 100);
  const fmt = (n: number) => Number.isInteger(n) ? `${n}` : n.toFixed(1);
  const uid = ach.key.replace(/\W/g, '');
  const ringR = 44, circ = 2 * Math.PI * ringR, dashOn = circ * pct;

  return (
    <View style={{
      flex: 1, backgroundColor: done ? '#0A0A0A' : PM.card, borderRadius: 18,
      borderWidth: 1, borderColor: done ? '#0A0A0A' : PM.border,
      paddingTop: 12, paddingBottom: 11, paddingHorizontal: 6, alignItems: 'center', gap: 8, overflow: 'hidden',
    }}>
      {done && (
        <View style={{ position: 'absolute', top: -20, width: 110, height: 110, borderRadius: 55, backgroundColor: A.soft }} />
      )}

      <View style={{ width: 76, height: 76 }}>
        <Svg width={76} height={76} viewBox="0 0 100 100">
          <Defs>
            <SvgLinearGradient id={`g-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={done ? ACCENT : '#3A3A3A'} stopOpacity={done ? 1 : 0.18} />
              <Stop offset="1" stopColor={done ? ACCENT : '#3A3A3A'} stopOpacity={done ? 0.78 : 0.10} />
            </SvgLinearGradient>
          </Defs>

          {!done && <Circle cx={50} cy={50} r={ringR} fill="none" stroke={PM.divider} strokeWidth={3} />}
          {!done && pct > 0 && (
            <Circle cx={50} cy={50} r={ringR} fill="none" stroke={ACCENT} strokeWidth={3.5} strokeLinecap="round"
              strokeDasharray={`${dashOn} ${circ}`} transform="rotate(-90 50 50)" />
          )}
          {done && <Circle cx={50} cy={50} r={ringR} fill="none" stroke={ACCENT} strokeOpacity={0.35} strokeWidth={2} />}

          <Polygon points={hexPoints(38)} fill={done ? '#1A1A1A' : PM.page} stroke={done ? ACCENT : PM.border} strokeWidth={done ? 2.2 : 1.4} strokeLinejoin="round" />
          <Polygon points={hexPoints(31)} fill={`url(#g-${uid})`} stroke={done ? ACCENT : 'transparent'} strokeOpacity={0.4} strokeWidth={0.6} strokeLinejoin="round" />

          <G x={38} y={38} stroke={done ? '#0A0A0A' : PM.muted} opacity={done ? 1 : 0.55}>
            <Glyph name={ach.glyph} color={done ? '#0A0A0A' : PM.muted} />
          </G>
        </Svg>

        {done && (
          <View style={{
            position: 'absolute', left: 28, bottom: -3, width: 20, height: 20, borderRadius: 10,
            backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#0A0A0A',
          }}>
            <Text style={{ fontSize: 11, fontWeight: '900', color: '#0A0A0A' }}>✓</Text>
          </View>
        )}
      </View>

      <Text numberOfLines={2} style={{
        fontFamily: PFonts.barlow, fontSize: 13, letterSpacing: 0.3, textTransform: 'uppercase',
        color: done ? '#fff' : PM.text, textAlign: 'center', marginTop: 4, paddingHorizontal: 4,
      }}>{ach.name}</Text>

      <Text numberOfLines={2} style={{ fontSize: 8.5, color: done ? 'rgba(255,255,255,0.72)' : PM.muted, textAlign: 'center', minHeight: 21, paddingHorizontal: 6 }}>{ach.desc}</Text>

      {done ? (
        <Text style={{ fontFamily: PFonts.anton, fontSize: 9, letterSpacing: 0.7, textTransform: 'uppercase', color: ACCENT }}>Débloqué</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
          <Text style={{ fontFamily: PFonts.anton, fontSize: 14, color: PM.text }}>{fmt(ach.progress)}</Text>
          <Text style={{ fontFamily: PFonts.anton, fontSize: 10, color: PM.muted }}>/{fmt(ach.target)}</Text>
          <Text style={{ fontSize: 8.5, fontWeight: '800', color: A.deep, marginLeft: 4 }}>{fillPct}%</Text>
        </View>
      )}
    </View>
  );
}

// ── Carte de feed « palmarès débloqué » (onglet Activité) ─────────────
export function AchievementFeedCard({ ach }: { ach: AchievementView }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: PM.ink, borderRadius: 16, padding: 12 }}>
      <View style={{ width: 46, height: 46 }}>
        <Svg width={46} height={46} viewBox="0 0 100 100">
          <Polygon points={hexPoints(40)} fill="#1A1A1A" stroke={ACCENT} strokeWidth={2.4} strokeLinejoin="round" />
          <Circle cx={50} cy={50} r={44} fill="none" stroke={ACCENT} strokeOpacity={0.35} strokeWidth={2} />
          <G x={38} y={38} stroke={ACCENT}>
            <Glyph name={ach.glyph} color={ACCENT} />
          </G>
        </Svg>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 9.5, fontWeight: '800', color: ACCENT, letterSpacing: 0.6, textTransform: 'uppercase' }}>🏆 Palmarès débloqué</Text>
        <Text numberOfLines={1} style={{ fontFamily: PFonts.barlow, fontSize: 18, color: '#fff', textTransform: 'uppercase', marginTop: 2 }}>{ach.name}</Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{ach.desc}</Text>
      </View>
    </View>
  );
}

// ── En-tête sombre + onglets ──────────────────────────────────────────
export const TABS = ['Stats', 'Matchs', 'Palmarès', 'Badges', 'Activité'] as const;
export type TabName = typeof TABS[number];

// Onglets masqués temporairement (code conservé, juste retiré de la barre).
// « Activité » est en pause : il recoupe Palmarès/Badges sans valeur claire en plus.
// À ré-afficher quand on aura une meilleure idée de son rôle.
const HIDDEN_TABS: TabName[] = ['Activité'];
const VISIBLE_TABS = TABS.filter(t => !HIDDEN_TABS.includes(t));

export function ProfileHeader(props: {
  name: string; level: number; leagueLabel: string; leagueColor: string;
  frmt?: { text: string; verified: boolean } | null;
  followers: number; following: number;
  isSelf: boolean; isFollowing: boolean;
  onToggleFollow: () => void; onBack: () => void; onMenu: () => void; onEdit: () => void;
  onShareProfile: () => void; onDefier: () => void;
  tab: TabName; setTab: (t: TabName) => void; topInset: number;
}) {
  const { name, level, leagueLabel, leagueColor, followers, following, isSelf, isFollowing } = props;
  const iconBtn = { width: 36, height: 36, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View style={{ backgroundColor: PM.ink, paddingTop: props.topInset + 8, paddingHorizontal: 18 }}>
      {/* Barre logo + actions */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <TouchableOpacity onPress={props.onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M15 18l-6-6 6-6" /></Svg>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 22, height: 22 }} resizeMode="contain" />
            <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 100, height: 22, marginLeft: -7 }} resizeMode="contain" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {isSelf ? (
            <>
              <TouchableOpacity onPress={props.onShareProfile} style={iconBtn}>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z" /><Circle cx={12} cy={13} r={3.6} /></Svg>
              </TouchableOpacity>
              <TouchableOpacity onPress={props.onEdit} style={iconBtn}>
                <Svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><Path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><Path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Svg>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={props.onMenu} style={iconBtn}>
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="#fff"><Circle cx={5} cy={12} r={2} /><Circle cx={12} cy={12} r={2} /><Circle cx={19} cy={12} r={2} /></Svg>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Identité */}
      <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: PM.inkSoft }}>
          <Text style={{ fontFamily: PFonts.anton, fontSize: 30, color: PM.ink }}>{initials(name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: PFonts.barlow, fontSize: 27, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.3 }}>{name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: ACCENT, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}>
              <Text style={{ fontSize: 12, fontWeight: '800', color: ACCENT }}>{level.toFixed(2)}</Text>
              <Text style={{ fontSize: 11 }}>⭐</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1.5, borderColor: leagueColor, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2, backgroundColor: leagueColor + '22' }}>
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: leagueColor }} />
              <Text style={{ fontSize: 11, fontWeight: '800', color: leagueColor }}>{leagueLabel}</Text>
            </View>
            {props.frmt && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}>
                <Text style={{ fontSize: 10, fontWeight: '900', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.3 }}>FRMT</Text>
                <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>{props.frmt.text}</Text>
                {props.frmt.verified && <Text style={{ fontSize: 10, color: ACCENT }}>✓</Text>}
              </View>
            )}
          </View>
          <Text style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.62)', marginTop: 7 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{followers}</Text> abonnés · <Text style={{ color: '#fff', fontWeight: '700' }}>{following}</Text> abonnements
          </Text>
        </View>
      </View>

      {/* Actions : Modifier (soi) | Suivre + Défier (autre) */}
      {isSelf ? (
        <TouchableOpacity onPress={props.onEdit} activeOpacity={0.85} style={{
          marginTop: 14, borderRadius: 999, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
          paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 13.5, fontWeight: '800', color: '#fff' }}>Modifier le profil</Text>
        </TouchableOpacity>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
          <TouchableOpacity onPress={props.onToggleFollow} activeOpacity={0.85} style={{
            flex: 1, borderRadius: 999,
            borderWidth: isFollowing ? 1.5 : 0, borderColor: 'rgba(255,255,255,0.25)',
            backgroundColor: isFollowing ? 'transparent' : ACCENT,
            paddingVertical: 11, alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontSize: 13.5, fontWeight: '800', color: isFollowing ? '#fff' : PM.ink }}>
              {isFollowing ? '✓ Suivi' : '＋ Suivre'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={props.onDefier} activeOpacity={0.85} style={{
            flex: 1, borderRadius: 999, borderWidth: 1.5, borderColor: ACCENT,
            paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></Svg>
            <Text style={{ fontSize: 13.5, fontWeight: '800', color: ACCENT }}>Défier</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Onglets */}
      <View style={{ flexDirection: 'row', marginTop: 16 }}>
        {VISIBLE_TABS.map(t => {
          const on = t === props.tab;
          return (
            <TouchableOpacity key={t} onPress={() => props.setTab(t)} style={{ flex: 1, paddingTop: 11, paddingBottom: 12, alignItems: 'center' }}>
              <Text style={{ fontSize: 11.5, fontWeight: on ? '800' : '600', color: on ? ACCENT : 'rgba(255,255,255,0.5)' }}>{t}</Text>
              {on && <View style={{ position: 'absolute', bottom: 0, height: 3, left: '20%', right: '20%', borderRadius: 3, backgroundColor: ACCENT }} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
