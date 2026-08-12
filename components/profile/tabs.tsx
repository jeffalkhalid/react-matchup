// ── PagMatch profile (refonte) — vues d'onglets (présentationnel) ─────
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { PM, accentOf, ACCENT, PFonts } from './theme';
import {
  Section, WinRing, StatTile, FilterPills, MatchCard, LevelChart, AchievementMedal,
  type MatchView, type TimelinePoint, type RepBadge, type AchievementView,
} from './components';
import { BadgePill } from './BadgePill';
import { Icon } from '../community/icons';

const A = accentOf(ACCENT);

// ════════════════════════════════════════════════════════════════════
//  STATS
// ════════════════════════════════════════════════════════════════════
export function StatsTab({ curLevel, delta30, timeline, winRate, played, wins, losses, streak, form, infoRows, lastMatch, renderFooter, onPlayerPress, fiability, fiabilityLabel, fiabilityColor }: {
  curLevel: number; delta30: number | null; timeline: TimelinePoint[];
  winRate: number; played: number; wins: number; losses: number; streak: number;
  form: ('V' | 'D')[]; infoRows: [string, string][]; lastMatch: MatchView | null; renderFooter: (m: MatchView) => React.ReactNode;
  onPlayerPress?: (id: string) => void;
  // Fiabilité du score (confiance ELO, pilote le K) — perdue à la refonte du
  // profil, réintégrée sous le niveau actuel.
  fiability: number; fiabilityLabel: string; fiabilityColor: string;
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
              <Text style={{ fontFamily: PFonts.anton, fontSize: 38, lineHeight: 49, color: PM.text }}>{curLevel.toFixed(2)}</Text>
              {delta30 != null && (
                <Text style={{ fontSize: 12, fontWeight: '800', color: delta30 >= 0 ? PM.successDk : PM.danger }}>
                  {delta30 >= 0 ? '▲ +' : '▼ '}{Math.abs(delta30).toFixed(2)}
                </Text>
              )}
            </View>
            <Text style={{ fontSize: 13, fontWeight: '800', color: PM.muted, marginTop: 4 }}>
              Fiabilité du score : <Text style={{ fontSize: 14, color: fiabilityColor, fontWeight: '900' }}>{fiability} % · {fiabilityLabel}</Text>
            </Text>
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
            {/* Point FRMT (pas de match associé) : encart sobre à la place de la carte. */}
            {!selMatch && slice[si]?.result === 'FRMT' && (
              <View style={{
                backgroundColor: 'rgba(255,193,26,0.08)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.35)',
                borderRadius: 14, padding: 14, gap: 4,
              }}>
                <Text style={{ fontSize: 13, fontWeight: '900', color: PM.text }}>Classement FRMT vérifié ✓</Text>
                <Text style={{ fontSize: 11.5, lineHeight: 16, color: PM.muted, fontWeight: '600' }}>
                  Bonus de liaison au classement officiel
                  {slice[si]?.frmtBonusLvl != null && slice[si]!.frmtBonusLvl! > 0
                    ? ` : +${slice[si]!.frmtBonusLvl!.toFixed(2)} niveau` : ''}
                  , calibré sur ta position FRMT.
                </Text>
              </View>
            )}
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
            <Text style={{ fontSize: 10, fontWeight: '600', color: PM.faint, marginBottom: 8 }}>5 derniers matchs compétitifs et défis</Text>
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
        <Icon name="search" size={14} color={PM.muted} stroke={2.2} />
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
            <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.7, textTransform: 'uppercase' }}>Badges débloqués</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 4 }}>
              <Text style={{ fontFamily: PFonts.anton, fontSize: 34, lineHeight: 44, color: ACCENT }}>{unlocked}</Text>
              <Text style={{ fontFamily: PFonts.anton, fontSize: 18, lineHeight: 23, color: 'rgba(255,255,255,0.45)' }}>/ {total}</Text>
            </View>
          </View>
          <Icon name="trophy" size={30} color={ACCENT} stroke={2} />
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
//  BINÔMES (ouverts aux défis)
// ════════════════════════════════════════════════════════════════════
type BinomeRow = { binomeId: string; id: string; name: string; level: string };

export function BinomesTab({ active, incoming, outgoing, isSelf, onConfirm, onClose, onAdd, onPlayerPress }: {
  active: BinomeRow[];
  incoming?: BinomeRow[];
  outgoing?: BinomeRow[];
  isSelf?: boolean;
  onConfirm?: (binomeId: string) => Promise<void> | void;
  onClose?: (binomeId: string) => Promise<void> | void;
  onAdd?: () => void;
  onPlayerPress?: (id: string) => void;
}) {
  const inc = incoming ?? [];
  const out = outgoing ?? [];
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const run = (key: string, fn?: (id: string) => Promise<void> | void, arg?: string) => {
    if (!fn || arg == null) return;
    setBusy(s => new Set(s).add(key));
    Promise.resolve(fn(arg)).catch(() => {}).finally(() =>
      setBusy(s => { const n = new Set(s); n.delete(key); return n; }));
  };
  const nothing = active.length === 0 && inc.length === 0 && out.length === 0;

  const avatar = (name: string) => (
    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: A.soft, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 14, fontWeight: '900', color: A.deep }}>{(name[0] ?? '?').toUpperCase()}</Text>
    </View>
  );
  const row = (p: BinomeRow, right: React.ReactNode) => (
    <View key={p.binomeId} style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: PM.page, borderWidth: 1, borderColor: PM.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    }}>
      <TouchableOpacity onPress={() => onPlayerPress?.(p.id)} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        {avatar(p.name)}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: PM.text }}>{p.name}</Text>
          <Text style={{ fontSize: 10.5, fontWeight: '700', color: PM.muted, marginTop: 1 }}>Niv. {p.level}</Text>
        </View>
      </TouchableOpacity>
      {right}
    </View>
  );
  const smallBtn = (label: string, onPress: () => void, opts: { danger?: boolean; solid?: boolean; loading?: boolean; disabled?: boolean }) => (
    <TouchableOpacity onPress={onPress} disabled={opts.disabled || opts.loading} activeOpacity={0.8} style={{
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9,
      backgroundColor: opts.solid ? '#16A34A' : 'transparent',
      borderWidth: opts.solid ? 0 : 1, borderColor: opts.danger ? PM.border : PM.border,
      opacity: (opts.disabled || opts.loading) ? 0.5 : 1, minWidth: 62, alignItems: 'center',
    }}>
      {opts.loading
        ? <ActivityIndicator size="small" color={opts.solid ? '#fff' : PM.muted} />
        : <Text style={{ fontSize: 11, fontWeight: '800', color: opts.solid ? '#fff' : PM.muted }}>{label}</Text>}
    </TouchableOpacity>
  );

  return (
    <View style={{ gap: 14 }}>
      {/* En-tête */}
      <View style={{ backgroundColor: PM.ink, borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: A.soft, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 26 }}>⚔️</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.7, textTransform: 'uppercase' }}>Ouvert aux défis</Text>
          <Text numberOfLines={1} style={{ fontFamily: PFonts.barlow, fontSize: 22, lineHeight: 29, color: '#fff', textTransform: 'uppercase', marginTop: 2 }}>
            {active.length === 0 ? 'Aucun binôme' : `${active.length} binôme${active.length > 1 ? 's' : ''}`}
          </Text>
        </View>
        {isSelf && onAdd && (
          <TouchableOpacity onPress={onAdd} activeOpacity={0.85} style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: ACCENT,
          }}>
            <Text style={{ fontSize: 11, fontWeight: '800', color: PM.ink }}>＋ Proposer</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Demandes reçues */}
      {inc.length > 0 && (
        <Section title="À confirmer" action={`${inc.length}`}>
          <Text style={{ fontSize: 10.5, color: PM.muted, marginBottom: 11, marginTop: -2, lineHeight: 15 }}>
            On te propose de former un binôme de défis.
          </Text>
          <View style={{ gap: 8 }}>
            {inc.map(p => row(p, (
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {smallBtn('Refuser', () => run('x-' + p.binomeId, onClose, p.binomeId), { loading: busy.has('x-' + p.binomeId), disabled: busy.has('c-' + p.binomeId) })}
                {smallBtn('Confirmer', () => run('c-' + p.binomeId, onConfirm, p.binomeId), { solid: true, loading: busy.has('c-' + p.binomeId), disabled: busy.has('x-' + p.binomeId) })}
              </View>
            )))}
          </View>
        </Section>
      )}

      {/* Demandes envoyées, en attente */}
      {out.length > 0 && (
        <Section title="En attente" action={`${out.length}`}>
          <Text style={{ fontSize: 10.5, color: PM.muted, marginBottom: 11, marginTop: -2, lineHeight: 15 }}>
            Tes propositions envoyées — en attente de confirmation.
          </Text>
          <View style={{ gap: 8 }}>
            {out.map(p => row(p, smallBtn('Annuler', () => run('x-' + p.binomeId, onClose, p.binomeId), { loading: busy.has('x-' + p.binomeId) })))}
          </View>
        </Section>
      )}

      {/* Binômes actifs */}
      {active.length > 0 && (
        <Section title="Binômes de défis" action={`${active.length} actif${active.length > 1 ? 's' : ''}`}>
          <Text style={{ fontSize: 10.5, color: PM.muted, marginBottom: 11, marginTop: -2, lineHeight: 15 }}>
            {isSelf ? 'Les paires que tu formes et qui peuvent être défiées.' : 'Les paires ouvertes aux défis avec ce joueur.'}
          </Text>
          <View style={{ gap: 8 }}>
            {active.map(p => row(p, isSelf
              ? smallBtn('Fermer', () => run('x-' + p.binomeId, onClose, p.binomeId), { loading: busy.has('x-' + p.binomeId) })
              : null))}
          </View>
        </Section>
      )}

      {nothing && (
        <Text style={{ fontSize: 12, color: PM.muted, textAlign: 'center', paddingVertical: 24, lineHeight: 18 }}>
          {isSelf
            ? "Tu n'es ouvert aux défis avec personne pour l'instant.\nAppuie sur « Proposer » pour former un binôme."
            : "Ce joueur n'a pas de binôme de défis pour le moment."}
        </Text>
      )}
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
          <BadgePill badge={top.label} size={44} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 10, fontWeight: '800', color: 'rgba(255,255,255,0.55)', letterSpacing: 0.7, textTransform: 'uppercase' }}>Badge signature</Text>
          <Text numberOfLines={1} style={{ fontFamily: PFonts.barlow, fontSize: 22, lineHeight: 29, color: '#fff', textTransform: 'uppercase', marginTop: 2 }}>{top.label}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: PFonts.anton, fontSize: 28, lineHeight: 36, color: ACCENT }}>{totalVotes}</Text>
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
                    <BadgePill badge={b.label} size={22} />
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
