// app/tournaments/parcours.tsx — « Mon parcours » : l'historique des
// tournois d'un joueur et ses cumuls.
//
// ⚠️ L'INTERRUPTEUR. Éteint, l'entrée n'apparaît NULLE PART : cet écran se
// referme en silence, sans écran vide ni message — même motif exact que
// app/tournaments/index.tsx et app/tournaments/[id].tsx.
//
// ⚠️ LA SOURCE. `tournament_results` se lit en direct (RLS ouverte à tout
// authentifié, tournaments.sql) — aucune RPC n'est dédiée à cet écran, et
// aucune fonction d'organisateur n'est appelée ici. Un tournoi CLÔTURÉ mais
// pas encore VALIDÉ n'apparaît PAS : `fetchMyTournamentResults`
// (lib/tournaments.ts) ne rend que les lignes dont le tournoi est
// CLASSEMENT_VALIDE — c'est la SEULE étape où les points sont crédités et où
// le tournoi entre dans « Mon parcours » (spec §14). Rien ici ne recalcule ce
// filtre : il est déjà appliqué à la lecture.
//
// ⚠️ LE CAS VIDE est l'état le plus fréquent au lancement — c'est lui que
// tout le monde verra en premier. Il explique ce que sont ces tournois et
// comment y entrer, ce n'est pas une liste vide avec un titre.
//
// ⚠️ UN REFUS N'EST PAS UN VIDE. `fetchMyTournamentResults` n'a pas de
// `{ok,reason}` à lire (ce n'est pas une RPC) : elle LÈVE. `loadError` est
// donc un état À PART de `rows.length === 0`, jamais avalé en silence — même
// motif que `standingsError` dans [id].tsx, corrigé au commit précédent
// (12a60d8) sur `fetchStandings`. Un joueur qui a des points ne doit jamais
// lire « aucun parcours » à cause d'un aléa réseau.
//
// Conventions : en-tête sombre + cartes blanches rayon 18 du Lobby / des
// autres écrans de tournoi (app/tournaments/index.tsx, [id].tsx) ; grille de
// cumuls dans l'esprit des cartes de statistiques du profil
// (components/profile/components.tsx `StatTile` : gros chiffre + libellé
// discret) — même grammaire visuelle, portée dans le système Colors/Fonts déjà
// utilisé par le reste du monde `tournament_*` plutôt que la palette sombre
// dédiée du profil, pour rester cohérent avec les deux écrans voisins.
//
// Un seul écran : les cumuls et l'historique cohabitent sur la même page,
// sans onglets « Résultats » / « Stats » séparés.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../../components/community/icons';
import {
  fetchMyTournamentResults, computeCareerTotals, getTournamentsEnabled,
  formatTournamentDate,
  type TournamentResultRow, type TournamentCareerTotals,
} from '../../lib/tournaments';
import { GENERIC_REASON } from '../../lib/tournamentReasons';

// ─── Briques d'affichage (mêmes conventions que index.tsx / [id].tsx) ───────

const cs = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
});

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 4 }}>
      <View style={{ width: 3, height: 14, backgroundColor: Colors.brand, borderRadius: 2 }} />
      <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, letterSpacing: 1.5, textTransform: 'uppercase' }}>
        {children}
      </Text>
    </View>
  );
}

/** Une tuile de cumul — même grammaire que la carte « Places » de
 *  app/tournaments/[id].tsx (libellé discret au-dessus, gros chiffre en
 *  dessous), reprise en grille pour les sept cumuls du joueur. */
function BigStat({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <View style={{ width: '33.33%', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4 }}>
      <Text style={{ fontSize: 22, lineHeight: 27, fontFamily: Fonts.uiBlack, color: tone ?? Colors.textPrimary }}>
        {value}
      </Text>
      <Text style={{
        fontSize: 9.5, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 0.3,
        textTransform: 'uppercase', textAlign: 'center', marginTop: 3,
      }}>
        {label}
      </Text>
    </View>
  );
}

/** Une petite statistique de ligne — MJ / V / D / JG / JP / Diff, même motif
 *  que `Stat` de components/tournaments/StandingsTable.tsx. */
function RowStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ alignItems: 'center', minWidth: 26 }}>
      <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: tone ?? Colors.textPrimary }}>{value}</Text>
      <Text style={{ fontSize: 7.5, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 1 }}>
        {label}
      </Text>
    </View>
  );
}

/** Le rang final du tournoi — même motif que le rankBadge de StandingsTable,
 *  doré/argenté/bronze sur le podium. */
function RankBadge({ rank }: { rank: number }) {
  const podium = rank <= 3;
  // `tone` porte la couleur doré/argenté/bronze que le commentaire promet —
  // avant cette correction, `podium` (rank <= 3) était vrai CHAQUE FOIS que
  // `tone` était défini (rank 1, 2 ou 3), donc la branche qui le lisait
  // n'était jamais atteinte : les trois places du podium rendaient la MÊME
  // couleur uniforme, jamais doré/argenté/bronze. `tone` sert maintenant le
  // FOND du badge (podium), pas le texte (toujours lisible en clair dessus).
  const tone = rank === 1 ? '#F59E0B' : rank === 2 ? '#94A3B8' : rank === 3 ? '#B45309' : undefined;
  return (
    <View style={{
      width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
      backgroundColor: podium ? (tone ?? Colors.brand) : Colors.bg,
      borderWidth: 1, borderColor: podium ? (tone ?? Colors.brand) : Colors.border,
    }}>
      <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: podium ? Colors.textOnBrand : Colors.textPrimary }}>
        {rank}
      </Text>
    </View>
  );
}

/** Un refus, distinct du cas vide — même motif que `Notice` de [id].tsx
 *  (repris localement, une seule tonalité utile ici). Un aléa réseau ou une
 *  erreur PostgREST ne doit JAMAIS se lire comme « tu n'as joué aucun
 *  tournoi » : c'est exactement la confusion corrigée dans `fetchStandings`
 *  au commit précédent (12a60d8), portée ici à `fetchMyTournamentResults`,
 *  qui n'a pas de `{ok,reason}` à distinguer — elle LÈVE — donc rien ici ne
 *  prétend citer un refus serveur précis : le message reste générique
 *  (`GENERIC_REASON`, lib/tournamentReasons.ts), jamais une chaîne locale ni
 *  une trace technique. */
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

/** Le cas vide — l'état le plus fréquent au lancement. Explique ce que sont
 *  ces tournois et comment y entrer, plutôt qu'une liste vide avec un titre. */
function EmptyCareer({ onBrowse }: { onBrowse: () => void }) {
  return (
    <View style={[cs.card, { padding: 20, alignItems: 'center', gap: 10 }]}>
      <View style={{
        width: 52, height: 52, borderRadius: 16, backgroundColor: Colors.bg,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="trendingUp" size={24} color={Colors.brandDeep} stroke={2} />
      </View>
      <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, textAlign: 'center' }}>
        Aucun parcours pour l’instant
      </Text>
      <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 }}>
        Les tournois montante / descente rassemblent huit binômes sur quatre terrains, en
        six rotations courtes : on monte d’un terrain quand on gagne, on descend quand on
        perd, et le classement final se joue au terrain atteint. Dès qu’un tournoi auquel tu
        as joué est validé par son organisateur, il apparaît ici avec tes cumuls.
      </Text>
      <TouchableOpacity onPress={onBrowse} activeOpacity={0.85}
        style={{ marginTop: 4, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, backgroundColor: Colors.primary }}>
        <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>Voir les tournois</Text>
      </TouchableOpacity>
    </View>
  );
}

function CumulsCard({ totals }: { totals: TournamentCareerTotals }) {
  const diffTone = totals.gamesDiff > 0 ? Colors.success : totals.gamesDiff < 0 ? Colors.danger : undefined;
  const diffValue = totals.gamesDiff > 0 ? `+${totals.gamesDiff}` : String(totals.gamesDiff);
  return (
    <View style={[cs.card, { padding: 10 }]}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <BigStat value={totals.tournamentsPlayed} label="Tournois" />
        <BigStat value={totals.matchesPlayed} label="Matchs" />
        {/* « % Victoires » et non « Victoires » tout court : l'historique
            plus bas (ResultRow) utilise le même mot « V » pour un COMPTE de
            victoires — deux grandeurs différentes sous un même intitulé sur
            le même écran, sans le préfixe. */}
        <BigStat value={`${totals.winPct}%`} label="% Victoires" />
        <BigStat value={diffValue} label="Diff. jeux" tone={diffTone} />
        <BigStat value={totals.tournamentWins} label="Tournois gagnés" tone={totals.tournamentWins > 0 ? Colors.brandDeep : undefined} />
        <BigStat value={totals.podiums} label="Podiums" tone={totals.podiums > 0 ? Colors.brandDeep : undefined} />
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: Colors.borderLight, marginTop: 4, paddingTop: 12, alignItems: 'center' }}>
        <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' }}>
          Points montante / descente
        </Text>
        <Text style={{ fontSize: 30, lineHeight: 36, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, marginTop: 2 }}>
          {totals.points}
        </Text>
      </View>
    </View>
  );
}

function ResultRow({ row }: { row: TournamentResultRow }) {
  const t = row.tournament;
  const diff = row.games_won - row.games_lost;
  const diffTone = diff > 0 ? Colors.success : diff < 0 ? Colors.danger : undefined;
  const diffValue = diff > 0 ? `+${diff}` : String(diff);
  const losses = row.played - row.wins;
  return (
    <View style={cs.card}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12, gap: 10 }}>
        <RankBadge rank={row.final_rank} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
            {t.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
            {formatTournamentDate(t.starts_at)} · {t.club?.name ?? 'Club à confirmer'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.brandDeep }}>+{row.points}</Text>
          <Text style={{ fontSize: 8.5, fontFamily: Fonts.uiBlack, color: Colors.textMuted, letterSpacing: 0.3, textTransform: 'uppercase' }}>
            points
          </Text>
        </View>
      </View>
      <View style={{
        flexDirection: 'row', justifyContent: 'space-between',
        paddingHorizontal: 12, paddingVertical: 10, gap: 4,
        backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.borderLight,
      }}>
        <RowStat label="MJ" value={String(row.played)} />
        <RowStat label="V" value={String(row.wins)} tone={Colors.success} />
        <RowStat label="D" value={String(losses)} tone={Colors.danger} />
        <RowStat label="JG" value={String(row.games_won)} />
        <RowStat label="JP" value={String(row.games_lost)} />
        <RowStat label="Diff" value={diffValue} tone={diffTone} />
        <RowStat label="Rang" value={String(row.final_rank)} />
      </View>
    </View>
  );
}

// ─── Écran ───────────────────────────────────────────────────────────────────

export default function CareerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player, loading: playerLoading } = usePlayer();

  // `null` = on ne sait pas encore. On n'affiche RIEN tant qu'on ne sait pas :
  // un écran vide qui se referme serait déjà une entrée visible.
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [rows, setRows] = useState<TournamentResultRow[]>([]);
  // Distinct d'un historique simplement VIDE (aucun tournoi validé pour
  // l'instant) : un aléa réseau ou une erreur PostgREST ne doit jamais se
  // lire comme « tu n'as joué aucun tournoi » — cf. `fetchStandings` /
  // `standingsError` dans app/tournaments/[id].tsx, même distinction.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const on = await getTournamentsEnabled();
    setEnabled(on);
    if (!on) { setLoading(false); return; }
    // Le joueur n'est pas encore résolu : on repasse au prochain rendu, quand
    // `playerLoading` bascule (dépendance ci-dessous) — le spinner reste affiché.
    if (playerLoading) return;
    if (!player) { setLoading(false); return; }
    try {
      setRows(await fetchMyTournamentResults(player.id));
      setLoadError(null);
    } catch (e) {
      console.warn('[tournois] parcours indisponible', e);
      // On NE VIDE PAS `rows` : un refus pendant un rafraîchissement garde
      // l'historique déjà affiché plutôt que de le remplacer par un message
      // d'erreur qui ferait disparaître ce qui était déjà connu.
      setLoadError(GENERIC_REASON);
    } finally {
      setLoading(false);
    }
  }, [player, playerLoading]);

  useEffect(() => { load(); }, [load]);

  // Éteint : on repart d'où l'on vient, sans un mot — même motif que les
  // deux autres écrans de tournoi.
  useEffect(() => {
    if (enabled === false) router.back();
  }, [enabled, router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const totals = useMemo(() => computeCareerTotals(rows), [rows]);

  if (enabled !== true) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        {enabled === null && <ActivityIndicator color={Colors.primary} />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── En-tête ── (motif Lobby / index.tsx : fond sombre, coins bas arrondis) */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 18,
        borderBottomLeftRadius: 32, borderBottomRightRadius: 32,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ alignSelf: 'flex-start' }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="chevronLeft" size={22} color={Colors.textOnDark} stroke={2.2} />
        </TouchableOpacity>
        {/* Titre Fonts.welcome : segment unique, numberOfLines=1 +
            adjustsFontSizeToFit + paddingRight anti-débord italique, alignSelf
            'stretch' — cf. feedback_android_title_clipping. */}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
          style={{
            alignSelf: 'stretch', fontSize: 25, lineHeight: 33, fontFamily: Fonts.welcome,
            color: Colors.textOnDark, includeFontPadding: false, marginTop: 10, paddingRight: 8,
          }}>
          Mon <Text style={{ color: Colors.brand }}>parcours</Text>
        </Text>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, marginTop: 3 }}>
          Tes tournois montante / descente validés, cumulés
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} size="large" />
        </View>
      ) : loadError && rows.length === 0 ? (
        // Un refus (réseau, PostgREST) SANS rien de connu à montrer : on le
        // dit, on ne prétend jamais que c'est un historique vide.
        <ScrollView
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 28 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <ErrorNotice message={loadError} />
        </ScrollView>
      ) : rows.length === 0 ? (
        <ScrollView
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 28 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <EmptyCareer onBrowse={() => router.push('/tournaments' as any)} />
        </ScrollView>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 14, paddingBottom: insets.bottom + 28, gap: 14 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {/* Un rafraîchissement en échec garde l'historique déjà connu à
              l'écran, avec ce bandeau au-dessus plutôt qu'à sa place. */}
          {loadError && <ErrorNotice message={loadError} />}

          <View>
            <SectionTitle>Mes cumuls</SectionTitle>
            <CumulsCard totals={totals} />
          </View>

          <View style={{ gap: 8 }}>
            <SectionTitle>Historique</SectionTitle>
            {rows.map(r => <ResultRow key={r.tournament_id} row={r} />)}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
