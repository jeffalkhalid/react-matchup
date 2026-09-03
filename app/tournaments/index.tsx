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
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../../components/community/icons';
import { TournamentCard } from '../../components/tournaments/TournamentCard';
import {
  fetchTournaments, fetchRegistrationsFor, getTournamentsEnabled,
  tournamentPhase, type Tournament, type TournamentRegistration, type TournamentPhase,
} from '../../lib/tournaments';
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

  if (enabled !== true) {
    // Ni écran vide, ni message : un fond neutre le temps de savoir, puis on
    // s'efface. Le spinner ne s'affiche que pendant l'attente réelle.
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        {enabled === null && <ActivityIndicator color={Colors.primary} />}
      </View>
    );
  }

  const shown = byPhase[tab];
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

          {shown.length === 0
            ? (loadError ? null : <EmptyState text={empty.text} sub={empty.sub} />)
            : shown.map(t => (
                <TournamentCard
                  key={t.id}
                  tournament={t}
                  registrations={regs.get(t.id) ?? []}
                  mine={isMine(t.id)}
                  onPress={() => router.push(`/tournaments/${t.id}` as any)}
                />
              ))}
        </ScrollView>
      )}
    </View>
  );
}
