// ── PagMatch profile (refonte) — vues d'onglets (présentationnel) ─────
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput } from 'react-native';
import { PM, accentOf, ACCENT, PFonts } from './theme';
import {
  Section, WinRing, StatTile, FilterPills, MatchCard, LevelChart, AchievementMedal,
  type MatchView, type TimelinePoint, type RepBadge, type AchievementView,
} from './components';

const A = accentOf(ACCENT);

// ════════════════════════════════════════════════════════════════════
//  STATS
// ════════════════════════════════════════════════════════════════════
export function StatsTab({ curLevel, delta30, timeline, winRate, played, wins, losses, streak, form, infoRows, lastMatch, renderFooter, onPlayerPress }: {
  curLevel: number; delta30: number | null; timeline: TimelinePoint[];
  winRate: number; played: number; wins: number; losses: number; streak: number;
  form: ('V' | 'D')[]; infoRows: [string, string][]; lastMatch: MatchView | null; renderFooter: (m: MatchView) => React.ReactNode;
  onPlayerPress?: (id: string) => void;
}) {
  const [filt, setFilt] = useState('10 résultats');
  const slice = filt === '5 résultats' ? timeline.slice(-5) : filt === 'Tous' ? timeline : timeline.slice(-10);
  const [sel, setSel] = useState(Math.max(0, slice.length - 1));
  useEffect(() => { setSel(Math.max(0, slice.length - 1)); }, [filt, timeline.length]);
  const si = Math.min(sel, slice.length - 1);
  const selMatch = slice[si]?.match ?? null;

  // Progression vers le prochain demi-palier (comme la maquette).
  const floor = Math.floor(curLevel * 2) / 2;
  const next = floor + 0.5;
  const prog = Math.max(0, Math.min((curLevel - floor) / 0.5, 1));
  const remain = next - curLevel;

  return (
    <View style={{ gap: 14 }}>
      {/* Évolution du niveau */}
      <Section title="Évolution du niveau">
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <View>
            <Text style={{ fontSize: 10, fontWeight: '800', color: PM.muted, letterSpacing: 0.5, textTransform: 'uppercase' }}>Niveau actuel</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 7, marginTop: 2 }}>
              <Text style={{ fontFamily: PFonts.anton, fontSize: 38, lineHeight: 40, color: PM.text }}>{curLevel.toFixed(2)}</Text>
              {delta30 != null && (
                <Text style={{ fontSize: 12, fontWeight: '800', color: delta30 >= 0 ? PM.successDk : PM.danger }}>
                  {delta30 >= 0 ? '▲ +' : '▼ '}{Math.abs(delta30).toFixed(2)}
                </Text>
              )}
            </View>
          </View>
          <Text style={{ fontSize: 11, fontWeight: '800', color: PM.muted, marginTop: 4 }}>30 derniers jours</Text>
        </View>

        {next <= 8.0 && (
          <View style={{ marginBottom: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
              <Text style={{ fontSize: 10, fontWeight: '800', color: PM.muted, letterSpacing: 0.4, textTransform: 'uppercase' }}>
                Progression vers <Text style={{ color: PM.text }}>{next.toFixed(1)}</Text>
              </Text>
              <Text style={{ fontSize: 11, fontWeight: '900', color: A.deep }}>+{remain.toFixed(2)} restant</Text>
            </View>
            <View style={{ height: 9, borderRadius: 999, backgroundColor: PM.divider, overflow: 'hidden' }}>
              <View style={{ height: '100%', width: `${prog * 100}%`, backgroundColor: ACCENT, borderRadius: 999 }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ fontSize: 9, fontWeight: '700', color: PM.faint }}>{floor.toFixed(1)}</Text>
              <Text style={{ fontSize: 9, fontWeight: '700', color: PM.faint }}>{next.toFixed(1)}</Text>
            </View>
          </View>
        )}

        {timeline.length >= 2 ? (
          <>
            <FilterPills items={['5 résultats', '10 résultats', 'Tous']} active={filt} onPick={setFilt} />
            <View style={{ marginTop: 10 }}>
              <LevelChart data={slice} selected={si} onSelect={setSel} />
            </View>
            <Text style={{ fontSize: 10, fontWeight: '700', color: PM.muted, marginVertical: 8, marginHorizontal: 2 }}>
              👆 Touche un point pour voir le match.
            </Text>
            {selMatch && <MatchCard m={selMatch} footer={renderFooter(selMatch)} showActions={false} onPlayerPress={onPlayerPress} />}
          </>
        ) : (
          <Text style={{ fontSize: 12, color: PM.muted, textAlign: 'center', paddingVertical: 12 }}>
            Pas encore assez de matchs pour tracer l'évolution.
          </Text>
        )}
      </Section>

      {/* Statistiques */}
      <Section title="Statistiques">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <WinRing rate={winRate} />
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <StatTile value={played} label="Matchs" />
            <View style={{ width: 1, backgroundColor: PM.divider }} />
            <StatTile value={`${wins}-${losses}`} label="V - D" />
            <View style={{ width: 1, backgroundColor: PM.divider }} />
            <StatTile value={streak} label="Série" sub={streak > 0 ? '🔥 en cours' : undefined} accentVal={A.deep} />
          </View>
        </View>
        {form.length > 0 && (
          <View style={{ borderTopWidth: 1, borderTopColor: PM.divider, marginTop: 12, paddingTop: 12 }}>
            <Text style={{ fontSize: 9, fontWeight: '800', color: PM.muted, letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 2 }}>Forme récente</Text>
            <Text style={{ fontSize: 10, fontWeight: '600', color: PM.faint, marginBottom: 8 }}>Matchs compétitifs et défis uniquement</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {form.map((f, i) => (
                <View key={i} style={{
                  width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: f === 'V' ? 'rgba(16,185,129,0.14)' : 'rgba(239,68,68,0.10)',
                }}>
                  <Text style={{ fontSize: 11, fontWeight: '900', color: f === 'V' ? PM.successDk : PM.danger }}>{f}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Section>

      {/* Dernier match */}
      {lastMatch && (
        <Section title="Dernier match" action="" noCard>
          <MatchCard m={lastMatch} footer={renderFooter(lastMatch)} showActions={false} onPlayerPress={onPlayerPress} />
        </Section>
      )}

      {/* Infos (préférences + classement FRMT) — uniquement les valeurs présentes */}
      {infoRows.length > 0 && (
        <Section title="Infos">
          <View style={{ gap: 10 }}>
            {infoRows.map(([label, value], i) => (
              <View key={i} style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                ...(i > 0 ? { borderTopWidth: 1, borderTopColor: PM.divider, paddingTop: 10 } : {}),
              }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: PM.muted }}>{label}</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: PM.text, flexShrink: 1, textAlign: 'right' }}>{value}</Text>
              </View>
            ))}
          </View>
        </Section>
      )}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════
//  MATCHS
// ════════════════════════════════════════════════════════════════════
export function MatchsTab({ matches, renderFooter, onPlayerPress }: { matches: MatchView[]; renderFooter: (m: MatchView) => React.ReactNode; onPlayerPress?: (id: string) => void }) {
  const [filt, setFilt] = useState('Tous');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const byResult = filt === 'Victoires' ? matches.filter(m => m.result === 'Victoire')
    : filt === 'Défaites' ? matches.filter(m => m.result === 'Défaite') : matches;
  const list = q
    ? byResult.filter(m =>
        [...m.teams[0], ...m.teams[1]].some(p => p.name.toLowerCase().includes(q))
        || m.club.toLowerCase().includes(q))
    : byResult;
  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 }}>
        <Text style={{ fontSize: 11, fontWeight: '900', color: PM.text, letterSpacing: 1, textTransform: 'uppercase' }}>{matches.length} matchs</Text>
        <FilterPills items={['Tous', 'Victoires', 'Défaites']} active={filt} onPick={setFilt} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: PM.card, borderRadius: 12, borderWidth: 1, borderColor: PM.border, paddingHorizontal: 12, height: 42 }}>
        <Text style={{ fontSize: 14, color: PM.muted }}>🔍</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Rechercher un joueur, un club…"
          placeholderTextColor={PM.muted}
          style={{ flex: 1, fontSize: 13, color: PM.text }}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      {list.length === 0
        ? <Text style={{ fontSize: 12, color: PM.muted, textAlign: 'center', paddingVertical: 16 }}>{q ? `Aucun match pour « ${search.trim()} ».` : 'Aucun match.'}</Text>
        : list.map((m, i) => <MatchCard key={i} m={m} footer={renderFooter(m)} showActions={false} onPlayerPress={onPlayerPress} />)}
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════
//  PALMARÈS
// ════════════════════════════════════════════════════════════════════
export function PalmaresTab({ achievements }: { achievements: AchievementView[] }) {
  const unlocked = achievements.filter(a => a.unlocked || a.progress >= a.target).length;
  const total = achievements.length;
  const sorted = [...achievements].sort((x, y) => {
    const dx = x.unlocked || x.progress >= x.target, dy = y.unlocked || y.progress >= y.target;
    if (dx !== dy) return dx ? -1 : 1;
    return (y.progress / y.target) - (x.progress / x.target);
  });
  const pct = total > 0 ? Math.round((unlocked / total) * 100) : 0;

  // 3 colonnes
  const rows: AchievementView[][] = [];
  for (let i = 0; i < sorted.length; i += 3) rows.push(sorted.slice(i, i + 3));

  return (
    <View style={{ gap: 14 }}>
      <View style={{ backgroundColor: PM.ink, borderRadius: 18, padding: 18, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.7, textTransform: 'uppercase' }}>Trophées débloqués</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
              <Text style={{ fontFamily: PFonts.anton, fontSize: 34, lineHeight: 36, color: ACCENT }}>{unlocked}</Text>
              <Text style={{ fontFamily: PFonts.anton, fontSize: 18, color: 'rgba(255,255,255,0.45)' }}>/ {total}</Text>
            </View>
          </View>
          <Text style={{ fontSize: 30 }}>🏆</Text>
        </View>
        <View style={{ height: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <View style={{ height: '100%', width: `${pct}%`, backgroundColor: ACCENT, borderRadius: 999 }} />
        </View>
      </View>

      <Section title="Réalisations" action="Continue de jouer pour tout débloquer" noCard>
        <View style={{ gap: 9 }}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap: 9 }}>
              {row.map(ach => <AchievementMedal key={ach.key} ach={ach} />)}
              {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, k) => <View key={'f' + k} style={{ flex: 1 }} />)}
            </View>
          ))}
        </View>
      </Section>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════════
//  BADGES (réputation)
// ════════════════════════════════════════════════════════════════════
export function BadgesTab({ badges }: { badges: RepBadge[] }) {
  const rep = [...badges].sort((x, y) => y.n - x.n);
  const totalVotes = badges.reduce((s, r) => s + r.n, 0);
  const top = rep[0];

  if (badges.length === 0) {
    return <Text style={{ fontSize: 12, color: PM.muted, textAlign: 'center', paddingVertical: 24 }}>Aucun badge reçu pour l'instant.</Text>;
  }

  const pairs: RepBadge[][] = [];
  for (let i = 0; i < rep.length; i += 2) pairs.push(rep.slice(i, i + 2));

  return (
    <View style={{ gap: 14 }}>
      <View style={{ backgroundColor: PM.ink, borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: A.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 26 }}>{top.emoji}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.7, textTransform: 'uppercase' }}>Badge signature</Text>
          <Text numberOfLines={1} style={{ fontFamily: PFonts.barlow, fontSize: 22, color: '#fff', textTransform: 'uppercase', marginTop: 2 }}>{top.label}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: PFonts.anton, fontSize: 28, lineHeight: 30, color: ACCENT }}>{totalVotes}</Text>
          <Text style={{ fontSize: 9, fontWeight: '800', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 }}>votes reçus</Text>
        </View>
      </View>

      <Section title="Badges de réputation" action={`${badges.length} badges`}>
        <Text style={{ fontSize: 10.5, color: PM.muted, marginBottom: 11, marginTop: -2, lineHeight: 15 }}>
          Les badges que tes partenaires t'attribuent après chaque partie.
        </Text>
        <View style={{ gap: 8 }}>
          {pairs.map((pair, pi) => (
            <View key={pi} style={{ flexDirection: 'row', gap: 8 }}>
              {pair.map((b, i) => {
                const hi = pi === 0; // les 2 plus votés mis en avant (1re paire)
                return (
                  <View key={i} style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
                    backgroundColor: hi ? A.soft : PM.page,
                    borderWidth: 1, borderColor: hi ? A.line : PM.border, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8,
                  }}>
                    <Text style={{ fontSize: 16 }}>{b.emoji}</Text>
                    <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, fontWeight: '700', color: PM.text }}>{b.label}</Text>
                    <Text style={{ fontSize: 12, fontWeight: '900', color: A.deep }}>×{b.n}</Text>
                  </View>
                );
              })}
              {pair.length < 2 && <View style={{ flex: 1 }} />}
            </View>
          ))}
        </View>
      </Section>
    </View>
  );
}
