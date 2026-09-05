// app/tournaments/index.tsx — la liste des tournois : à venir, en cours, passés.
//
// ⚠️ L'INTERRUPTEUR. `fn_tournaments_enabled()` est ÉTEINT par défaut (clé
// absente = éteint, cf. tournaments_flag.sql). Éteint, l'entrée n'apparaît
// NULLE PART : pas d'écran vide, pas de message, rien. Cet écran se referme
// donc en silence, et l'entrée du menu ne s'affiche pas (ProfileMenuSheet).
// Les RPC répondent toutes `{ok:false, reason:'feature_disabled'}` — ce refus-là
// ne s'affiche jamais, il fait disparaître l'entrée.
//
// Conventions : en-tête sombre arrondi + onglets pastille du Lobby
// (app/(tabs)/lobby.tsx), cartes blanches, aucun style inventé.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { Icon } from '../../components/community/icons';
import { TournamentCard } from '../../components/tournaments/TournamentCard';
import { HiddenByFilters } from '../../components/tournaments/HiddenByFilters';
import {
  fetchTournaments, fetchRegistrationsFor, getTournamentsEnabled,
  tournamentPhase, freePlaces, dateBucket,
  filterTournaments, bestFilterToDrop, activeFilterCount, filterLabel, isThisWeekend,
  NO_FILTERS, type TournamentFilters,
  type Tournament, type TournamentRegistration, type TournamentPhase,
} from '../../lib/tournaments';
import {
  FilterBar, FilterCounter, FilterDeadEnd, GroupHeader, type FilterChip,
} from '../../components/tournaments/ListFilters';
import { GENERIC_REASON } from '../../lib/tournamentReasons';

type TabKey = Extract<TournamentPhase, 'upcoming' | 'live' | 'past'>;

const TABS: { id: TabKey; label: string }[] = [
  { id: 'upcoming', label: 'À venir' },
  { id: 'live',     label: 'En cours' },
  { id: 'past',     label: 'Passés' },
];

const EMPTY: Record<TabKey, { text: string; sub: string }> = {
  upcoming: { text: 'Aucun tournoi annoncé', sub: 'Les prochaines soirées montante / descente apparaîtront ici.' },
  live:     { text: 'Aucun tournoi en cours', sub: 'Reviens quand une soirée aura démarré.' },
  past:     { text: 'Aucun tournoi passé',    sub: 'Les classements des soirées jouées resteront ici.' },
};

function EmptyState({ text, sub }: { text: string; sub?: string }) {
  return (
    <View style={{
      paddingVertical: 32, paddingHorizontal: 16, alignItems: 'center',
      backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
      borderStyle: 'dashed', borderRadius: 18,
    }}>
      <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.textPrimary, fontSize: 14, textAlign: 'center' }}>{text}</Text>
      {sub ? <Text style={{ color: Colors.textMuted, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 4 }}>{sub}</Text> : null}
    </View>
  );
}

/** Un refus (réseau, PostgREST), distinct d'une liste simplement VIDE — même
 *  motif que `standingsError` (app/tournaments/[id].tsx) et `loadError`
 *  (app/tournaments/parcours.tsx). Un aléa réseau ne doit jamais se lire
 *  comme « aucun tournoi annoncé » : c'est exactement ce que disait le texte
 *  de l'onglet « À venir » avant cette correction. */
function ErrorNotice({ message }: { message: string }) {
  return (
    <View style={{
      backgroundColor: 'rgba(245,158,11,0.12)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.50)',
      borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    }}>
      <Text style={{ color: '#B45309', fontSize: 12.5, fontFamily: Fonts.uiBold, lineHeight: 17 }}>{message}</Text>
    </View>
  );
}

export default function TournamentsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // `playerLoading` : sans lui, un inscrit voyait un instant une carte SANS
  // la pastille « Inscrit » (`isMine` dépend de `player?.id`, indisponible
  // tant que `usePlayer` n'a pas résolu).
  const { player, loading: playerLoading } = usePlayer();

  // `null` = on ne sait pas encore. On n'affiche RIEN tant qu'on ne sait pas :
  // un écran vide qui se referme serait déjà une entrée visible.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabKey>('upcoming');
  const [filters, setFilters] = useState<TournamentFilters>(NO_FILTERS);
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [regs, setRegs] = useState<Map<string, TournamentRegistration[]>>(new Map());
  // Distinct d'une liste simplement VIDE — cf. `ErrorNotice` ci-dessus.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const on = await getTournamentsEnabled();
    setEnabled(on);
    if (!on) { setLoading(false); return; }
    try {
      const list = await fetchTournaments();
      // Les DEUX lectures réussissent avant qu'AUCUNE des deux n'atteigne
      // l'écran : `setTournaments(list)` seul, suivi d'un `fetchRegistrationsFor`
      // qui échoue, affichait avant cette correction des cartes à « 0/16
      // joueurs » sur un tournoi complet — un CHIFFRE FAUX, pire qu'un refus
      // affiché. Si la seconde lecture échoue, on tombe dans le `catch`
      // ci-dessous SANS avoir touché `tournaments` : la liste précédente
      // (ou vide) reste affichée, jamais une liste à moitié à jour.
      const registrations = await fetchRegistrationsFor(list.map(t => t.id));
      setTournaments(list);
      setRegs(registrations);
      setLoadError(null);
    } catch (e) {
      console.warn('[tournois] liste indisponible', e);
      setLoadError(GENERIC_REASON);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Éteint : on repart d'où l'on vient, sans un mot. L'entrée du menu est déjà
  // masquée ; ce chemin ne sert qu'à un lien direct ou à une extinction en
  // cours de session.
  useEffect(() => {
    if (enabled === false) router.back();
  }, [enabled, router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const byPhase = useMemo(() => {
    const out: Record<TabKey, Tournament[]> = { upcoming: [], live: [], past: [] };
    for (const t of tournaments) {
      const phase = tournamentPhase(t.status);
      if (phase === 'draft') continue;                 // brouillon : jamais listé
      out[phase].push(t);
    }
    // Les passés du plus récent au plus ancien ; le reste par date croissante
    // (déjà trié par la requête).
    out.past.reverse();
    return out;
  }, [tournaments]);

  const isMine = useCallback((id: string) => {
    if (!player) return false;
    return (regs.get(id) ?? []).some(r => r.player_id === player.id);
  }, [regs, player]);

  // ── Filtres, epinglage et groupement (handoff design, chantier 3) ─────────
  // La liste etait plate : a sept tournois ca passe, a vingt mes inscriptions
  // se noient -- elles ne se distinguaient que par une pastille « Inscrit ».
  const ctx = useMemo(() => ({
    myLevel: player ? eloToLevel(player.elo_score) : null,
    freeById: new Map(tournaments.map(t => [t.id, freePlaces(regs.get(t.id) ?? [], t.court_count)])),
  }), [player, tournaments, regs]);

  // Le club le plus represente parmi les soirees a venir : c'est LUI que le
  // filtre « club » propose, plutot qu'une liste deroulante de plus.
  const topClub = useMemo(() => {
    const compte = new Map<string, { name: string; n: number }>();
    for (const t of byPhase.upcoming) {
      if (!t.club_id) continue;
      const e = compte.get(t.club_id);
      if (e) e.n += 1;
      else compte.set(t.club_id, { name: t.club?.name ?? 'Ce club', n: 1 });
    }
    let best: { id: string; name: string; n: number } | null = null;
    for (const [id, v] of compte) if (!best || v.n > best.n) best = { id, name: v.name, n: v.n };
    return best;
  }, [byPhase.upcoming]);

  const entries = useMemo(() => byPhase[tab].map(t => ({ tournament: t })), [byPhase, tab]);
  const outcome = useMemo(() => filterTournaments(entries, filters, ctx), [entries, filters, ctx]);
  const escape = useMemo(
    () => (outcome.kept.length === 0 ? bestFilterToDrop(entries, filters, ctx) : null),
    [outcome.kept.length, entries, filters, ctx],
  );

  // Mes inscriptions d'abord, puis par echeance. Le groupement ne s'applique
  // qu'a « a venir » : « en cours » et « passes » ont leur propre ordre.
  const groups = useMemo(() => {
    const kept = outcome.kept.map(e => e.tournament);
    if (tab !== 'upcoming') return [{ label: null as string | null, tone: undefined, items: kept }];
    const miennes = kept.filter(t => isMine(t.id));
    const autres  = kept.filter(t => !isMine(t.id));
    const semaine = autres.filter(t => dateBucket(t.starts_at) !== 'other' || isThisWeekend(t.starts_at));
    const plusTard = autres.filter(t => !semaine.includes(t));
    return [
      { label: 'MES INSCRIPTIONS', tone: 'success' as const, items: miennes },
      { label: 'CETTE SEMAINE', tone: 'brand' as const, items: semaine },
      { label: 'PLUS TARD', tone: undefined, items: plusTard },
    ].filter(g => g.items.length > 0);
  }, [outcome.kept, tab, isMine]);

  const chips: FilterChip[] = [
    { key: 'level', label: 'Mon niveau', active: filters.level, onToggle: () => setFilters(f => ({ ...f, level: !f.level })) },
    { key: 'weekend', label: 'Ce week-end', active: filters.weekend, onToggle: () => setFilters(f => ({ ...f, weekend: !f.weekend })) },
    ...(topClub ? [{
      key: 'clubId' as const, label: topClub.name, active: filters.clubId === topClub.id,
      onToggle: () => setFilters(f => ({ ...f, clubId: f.clubId === topClub.id ? null : topClub.id })),
    }] : []),
    { key: 'free', label: 'Places libres', active: filters.free, onToggle: () => setFilters(f => ({ ...f, free: !f.free })) },
  ];

  if (enabled !== true) {
    // Ni écran vide, ni message : un fond neutre le temps de savoir, puis on
    // s'efface. Le spinner ne s'affiche que pendant l'attente réelle.
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        {enabled === null && <ActivityIndicator color={Colors.primary} />}
      </View>
    );
  }

  const empty = EMPTY[tab];

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── En-tête ── (motif Lobby : fond sombre, coins bas arrondis) */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 16,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="chevronLeft" size={22} color={Colors.textOnDark} stroke={2.2} />
          </TouchableOpacity>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginRight: 22 }}>
            <Image source={require('../../assets/auth/splash-racket.png')} style={{ width: 22, height: 22 }} resizeMode="contain" />
            <Image source={require('../../assets/auth/splash-wordmark.png')} style={{ width: 100, height: 22, marginLeft: -7 }} resizeMode="contain" />
          </View>
        </View>

        <View style={{ alignItems: 'center', marginBottom: 14 }}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
            style={{ fontSize: 26, lineHeight: 34, fontFamily: Fonts.welcome, color: Colors.textOnDark, includeFontPadding: false, textAlign: 'center', paddingRight: 5 }}>
            Les <Text style={{ color: Colors.brand }}>Tournois</Text>
          </Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, marginTop: 2, textAlign: 'center' }}>
            Montante / descente · 8 binômes, 6 rotations
          </Text>
        </View>

        {/* Onglets — pastilles du Lobby */}
        <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 18, padding: 4, gap: 3 }}>
          {TABS.map(t => {
            const active = tab === t.id;
            const count = byPhase[t.id].length;
            return (
              <TouchableOpacity key={t.id} onPress={() => setTab(t.id)} activeOpacity={0.7}
                style={{
                  flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
                  backgroundColor: active ? Colors.bgCard : 'transparent',
                  borderRadius: 14, paddingVertical: 9,
                }}>
                <Text style={{ color: active ? Colors.textPrimary : 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: Fonts.uiBlack, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                  {t.label}
                </Text>
                {count > 0 && (
                  <View style={{ backgroundColor: active ? Colors.bgCardAlt : 'rgba(255,255,255,0.2)', borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                    <Text style={{ color: active ? Colors.textSecondary : Colors.textOnDark, fontSize: 9, fontWeight: '900' }}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {(loading || playerLoading) ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 28, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {/* Un rafraîchissement en échec garde la liste déjà connue à
              l'écran, avec ce bandeau au-dessus plutôt qu'à sa place. */}
          {loadError && <ErrorNotice message={loadError} />}

          {/* Les filtres n'ont de sens que sur « a venir » : sur les soirees
              en cours ou passees, il n'y a rien a arbitrer. */}
          {tab === 'upcoming' && entries.length > 0 && <FilterBar chips={chips} />}
          {tab === 'upcoming' && activeFilterCount(filters) > 0 && (
            <FilterCounter
              kept={outcome.kept.length}
              total={entries.length}
              count={activeFilterCount(filters)}
              onClear={() => setFilters(NO_FILTERS)}
            />
          )}

          {/* « Passes » ouvre sur MON PARCOURS. L'ecran existait deja mais
              n'etait atteignable que par le menu burger : personne ne va
              chercher son historique de tournois dans un menu de reglages.
              Il est ici, en tete de l'onglet ou l'on vient justement
              regarder derriere soi. */}
          {tab === 'past' && (
            <TouchableOpacity
              onPress={() => router.push('/tournaments/parcours' as any)}
              activeOpacity={0.85}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: Colors.primary, borderRadius: 16, padding: 15,
              }}
            >
              <Icon name="trendingUp" size={19} color={Colors.brand} stroke={2.4} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ fontSize: 14.5, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                  Mon parcours
                </Text>
                <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textOnDark, opacity: 0.75 }}>
                  Tes résultats, tes rangs et tes points, soirée par soirée.
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={Colors.textOnDark} stroke={2.4} />
            </TouchableOpacity>
          )}

          {entries.length === 0
            ? (loadError ? null : <EmptyState text={empty.text} sub={empty.sub} />)
            : outcome.kept.length === 0
            ? (
                /* Jamais un cul-de-sac : on nomme le filtre dont le retrait
                   revele le plus, et on propose de l'enlever d'un tap. */
                escape ? (
                  <FilterDeadEnd
                    unlocked={escape.unlocked}
                    filterName={filterLabel(escape.key, topClub?.name)}
                    onDrop={() => setFilters(f => (
                      escape.key === 'clubId' ? { ...f, clubId: null } : { ...f, [escape.key]: false }
                    ))}
                  />
                ) : (
                  <EmptyState text="Aucun tournoi ne correspond" sub="Retire un filtre pour en voir davantage." />
                )
              )
            : groups.map((g, gi) => (
                <View key={g.label ?? `g${gi}`} style={{ gap: 10 }}>
                  {g.label && <GroupHeader label={g.label} count={g.items.length} tone={g.tone} />}
                  {g.items.map(t => (
                    <TournamentCard
                      key={t.id}
                      tournament={t}
                      registrations={regs.get(t.id) ?? []}
                      mine={isMine(t.id)}
                      onPress={() => router.push(`/tournaments/${t.id}` as any)}
                    />
                  ))}
                </View>
              ))}

          {/* Le compteur disait COMBIEN on cache, jamais QUOI. Un filtre coche
              puis oublie ecarte une soiree du bon soir au bon club, et rien ne
              le montrait. En gris, replie, avec la raison — et tapable : voir
              un tournoi hors filtre ne doit pas empecher d'y aller. */}
          {tab === 'upcoming' && outcome.kept.length > 0 && (
            <HiddenByFilters
              hidden={outcome.hidden.map(h => ({ tournament: h.item.tournament, reason: h.reason }))}
              clubName={topClub?.name}
              onPress={id => router.push(`/tournaments/${id}` as any)}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}
