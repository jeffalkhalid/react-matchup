import { forwardRef } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Fonts } from '../lib/theme';

// ─── Types ─────────────────────────────────────────────────────
export type ThemeKey = 'midnight' | 'ember' | 'brand' | 'court' | 'mono';
export type BgMode  = 'court' | 'sombre' | 'brand' | 'amical' | { photo: string };
export type Layout  = 'hero' | 'players' | 'stats';

export interface StoryMatch {
  score_text: string | null;
  created_at: string;
  winner_name: string;
  winner_2_name: string | null;
  loser_name: string;
  loser_2_name: string | null;
  location: string | null;
  match_date: string | null;
}

// ─── Palettes ─────────────────────────────────────────────────
const THEMES: Record<ThemeKey, { bg1: string; bg2: string; accent: string; accentSoft: string }> = {
  midnight: { bg1: '#090d1a', bg2: '#151d3a', accent: '#818cf8', accentSoft: 'rgba(129,140,248,0.18)' },
  ember:    { bg1: '#0e0600', bg2: '#271200', accent: '#fb923c', accentSoft: 'rgba(251,146,60,0.18)' },
  brand:    { bg1: '#1a1410', bg2: '#3a2a0a', accent: '#FFC11A', accentSoft: 'rgba(255,193,26,0.20)' },
  court:    { bg1: '#001a14', bg2: '#003828', accent: '#34d399', accentSoft: 'rgba(52,211,153,0.18)' },
  mono:     { bg1: '#000000', bg2: '#1a1a1a', accent: '#ffffff', accentSoft: 'rgba(255,255,255,0.10)' },
};

// ─── Helpers ──────────────────────────────────────────────────
const HASH_COLORS = ['#4f46e5', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b', '#10b981'];
function hashColor(name: string) {
  const h = (name ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return HASH_COLORS[h % HASH_COLORS.length];
}
function initial(name: string | null | undefined) {
  return (name ?? '?').trim().charAt(0).toUpperCase();
}
function parseSets(text: string | null): Array<[number, number]> {
  if (!text) return [];
  return text.trim().split(/[\s,]+/).flatMap(s => {
    const parts = s.split('-').map(n => parseInt(n, 10));
    return parts.length === 2 && !parts.some(isNaN) ? [[parts[0], parts[1]] as [number, number]] : [];
  });
}

// ─── Avatar pile ──────────────────────────────────────────────
function AvatarPile({ names, size = 56, ring }: { names: string[]; size?: number; ring?: string }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {names.map((n, i) => (
        <View
          key={i}
          style={{
            width: size, height: size, borderRadius: size / 2,
            backgroundColor: hashColor(n),
            marginLeft: i === 0 ? 0 : -size * 0.3,
            borderWidth: ring ? 3 : 0, borderColor: ring ?? 'transparent',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontSize: size * 0.42, fontFamily: Fonts.uiBlack, fontWeight: '900' }}>
            {initial(n)}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Background layer ─────────────────────────────────────────
function Background({ mode, theme }: { mode: BgMode; theme: typeof THEMES[ThemeKey] }) {
  // Photo background
  if (typeof mode === 'object' && mode.photo) {
    return (
      <>
        <Image source={{ uri: mode.photo }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: theme.bg1 + '99' }]} />
      </>
    );
  }
  // Themed gradients (faked via 2 layers — RN has no native gradient without lib)
  const palette: Record<Exclude<BgMode, object>, { topColor: string; bottomColor: string; pattern?: 'court' }> = {
    sombre:  { topColor: theme.bg1, bottomColor: theme.bg2 },
    brand:   { topColor: '#3a2a0a', bottomColor: '#1a1410' },
    amical:  { topColor: '#003828', bottomColor: '#001a14' },
    court:   { topColor: '#0a3a5a', bottomColor: '#001f3a', pattern: 'court' },
  };
  const p = palette[mode];
  return (
    <>
      <View style={[StyleSheet.absoluteFillObject, { backgroundColor: p.topColor }]} />
      <View style={[StyleSheet.absoluteFillObject, { top: '50%', backgroundColor: p.bottomColor }]} />
      {/* Glow décoratif accent */}
      <View style={{
        position: 'absolute', top: -120, right: -120,
        width: 360, height: 360, borderRadius: 180,
        backgroundColor: theme.accent, opacity: 0.12,
      }} />
      {/* Pattern terrain padel (lignes blanches stylisées) */}
      {p.pattern === 'court' && (
        <>
          <View style={{ position: 'absolute', top: '35%', left: 30, right: 30, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
          <View style={{ position: 'absolute', top: '65%', left: 30, right: 30, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
          <View style={{ position: 'absolute', top: '45%', bottom: '45%', left: '50%', width: 1, backgroundColor: 'rgba(255,255,255,0.18)' }} />
        </>
      )}
    </>
  );
}

// ─── Brand header (toujours en haut) ──────────────────────────
function Brand({ accent }: { accent: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{
        width: 38, height: 38, borderRadius: 10,
        backgroundColor: accent + '22', borderWidth: 1.5, borderColor: accent + '88',
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontSize: 20 }}>🎾</Text>
      </View>
      <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: 'rgba(255,255,255,0.75)', letterSpacing: 3 }}>
        PAGMATCH
      </Text>
    </View>
  );
}

// ─── Footer (lieu + date) ─────────────────────────────────────
function FooterMeta({ match }: { match: StoryMatch }) {
  const dateSrc = match.match_date ?? match.created_at;
  const dateLabel = dateSrc
    ? new Date(dateSrc).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  return (
    <View style={{ gap: 4 }}>
      {match.location ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>📍</Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.75)' }} numberOfLines={1}>
            {match.location}
          </Text>
        </View>
      ) : null}
      {dateLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 14 }}>🕒</Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.75)' }}>
            {dateLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Score block (réutilisé par les 3 layouts) ────────────────
function ScoreBlock({ sets, large = true, accent }: { sets: Array<[number, number]>; large?: boolean; accent: string }) {
  const fontSize = large ? (sets.length > 2 ? 76 : sets.length === 2 ? 96 : 120) : 42;
  if (sets.length === 0) {
    return <Text style={{ fontSize: large ? 110 : 42, fontFamily: Fonts.uiBlack, color: '#fff' }}>—</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 14, flexWrap: 'wrap' }}>
      {sets.map(([w, l], i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
          <Text style={{ fontSize, fontFamily: Fonts.uiBlack, color: '#fff', letterSpacing: -2, lineHeight: fontSize * 1.05 }}>
            {w}
          </Text>
          <Text style={{ fontSize: fontSize * 0.45, fontFamily: Fonts.uiBlack, color: accent }}>–</Text>
          <Text style={{ fontSize, fontFamily: Fonts.uiBlack, color: '#fff', letterSpacing: -2, lineHeight: fontSize * 1.05, opacity: 0.85 }}>
            {l}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Players block ────────────────────────────────────────────
function PlayersBlock({ match, accent, compact = false }: { match: StoryMatch; accent: string; compact?: boolean }) {
  const winners = [match.winner_name, match.winner_2_name].filter(Boolean) as string[];
  const losers  = [match.loser_name,  match.loser_2_name].filter(Boolean)  as string[];
  const avSize = compact ? 36 : 52;
  return (
    <View style={{ gap: compact ? 10 : 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 5, height: avSize + 6, backgroundColor: accent, borderRadius: 3 }} />
        <AvatarPile names={winners} size={avSize} ring="#fff" />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: accent, letterSpacing: 2 }}>VAINQUEUR</Text>
          <Text style={{ fontSize: compact ? 18 : 24, fontFamily: Fonts.uiBlack, color: '#fff', letterSpacing: -0.5 }} numberOfLines={2}>
            {winners.join(' & ')}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.10)' }} />
        <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: 'rgba(255,255,255,0.30)', letterSpacing: 4 }}>VS</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.10)' }} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 5, height: avSize + 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 3 }} />
        <AvatarPile names={losers} size={avSize} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: 'rgba(255,255,255,0.40)', letterSpacing: 2 }}>CHALLENGER</Text>
          <Text style={{ fontSize: compact ? 17 : 22, fontFamily: Fonts.uiBlack, color: 'rgba(255,255,255,0.55)', letterSpacing: -0.5 }} numberOfLines={2}>
            {losers.join(' & ')}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Canvas principal ─────────────────────────────────────────
interface StoryCanvasProps {
  match: StoryMatch;
  bg: BgMode;
  themeKey: ThemeKey;
  layout: Layout;
  width: number;   // largeur logique (la hauteur est 16/9 × width)
}

const StoryCanvas = forwardRef<View, StoryCanvasProps>(function StoryCanvas(
  { match, bg, themeKey, layout, width },
  ref,
) {
  const t = THEMES[themeKey];
  const height = (width * 16) / 9;
  const sets = parseSets(match.score_text);
  const pad = width * 0.06;

  return (
    <View
      ref={ref}
      collapsable={false}
      style={{ width, height, overflow: 'hidden', backgroundColor: t.bg1, position: 'relative' }}
    >
      <Background mode={bg} theme={t} />

      {/* Bande accent à gauche */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: t.accent }} />

      {/* Contenu */}
      <View style={{ flex: 1, padding: pad, paddingLeft: pad + 4, justifyContent: 'space-between' }}>
        {/* Top : brand */}
        <Brand accent={t.accent} />

        {/* Middle : selon layout */}
        {layout === 'hero' && (
          <View style={{ alignItems: 'center', gap: 18 }}>
            <ScoreBlock sets={sets} accent={t.accent} />
          </View>
        )}

        {layout === 'players' && (
          <View style={{ alignItems: 'center', gap: 24 }}>
            <AvatarPile
              names={[match.winner_name, match.winner_2_name].filter(Boolean) as string[]}
              size={92}
              ring="#fff"
            />
            <ScoreBlock sets={sets} large={false} accent={t.accent} />
          </View>
        )}

        {layout === 'stats' && (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <ScoreBlock sets={sets} accent={t.accent} />
            <View style={{
              flexDirection: 'row', gap: 10,
              backgroundColor: t.accentSoft, borderRadius: 999,
              paddingHorizontal: 18, paddingVertical: 8,
              borderWidth: 1, borderColor: t.accent + '55',
            }}>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: t.accent, letterSpacing: 2 }}>
                {sets.filter(([w, l]) => w > l).length}–{sets.filter(([w, l]) => w < l).length} SETS
              </Text>
            </View>
          </View>
        )}

        {/* Bottom : players + footer */}
        <View style={{ gap: 18 }}>
          {layout !== 'players' && <PlayersBlock match={match} accent={t.accent} compact={layout === 'stats'} />}
          {layout === 'players' && (
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: t.accent, letterSpacing: 2 }}>VAINQUEUR</Text>
                <Text style={{ fontSize: 20, fontFamily: Fonts.uiBlack, color: '#fff' }} numberOfLines={1}>
                  {[match.winner_name, match.winner_2_name].filter(Boolean).join(' & ')}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: 'rgba(255,255,255,0.4)', letterSpacing: 2 }}>VS</Text>
                <Text style={{ fontSize: 16, fontFamily: Fonts.uiBlack, color: 'rgba(255,255,255,0.55)' }} numberOfLines={1}>
                  {[match.loser_name, match.loser_2_name].filter(Boolean).join(' & ')}
                </Text>
              </View>
            </View>
          )}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <FooterMeta match={match} />
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.35)', letterSpacing: 2 }}>
              pagmatch.com
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
});

export default StoryCanvas;
