// app/tournaments/soiree/[id].tsx — l'écran pendant qu'on joue.
//
// Une rotation dure vingt minutes. Pour saisir un score il fallait ouvrir
// l'app, aller dans Tournois, ouvrir la fiche, faire défiler jusqu'à son
// match : quatre gestes, six fois dans la soirée, par trente-deux personnes.
// Ici on sort le téléphone et on est dessus.
//
// TROIS QUESTIONS, ET RIEN D'AUTRE : où je joue, contre qui, où en est le
// reste. Tout ce qui ne répond pas à l'une des trois appartient à la fiche du
// tournoi — le barème, le club, le prix, la liste des inscrits.
//
// CE N'EST PAS UN SCORE EN DIRECT. Le live point par point sert un match qu'on
// suit ; ici on joue vingt minutes et on reporte des jeux. On reprend du live
// l'EMPLACEMENT — une surface où l'on atterrit déjà au bon endroit — pas le
// mécanisme.
//
// L'ÉTAT DE TOUS LES TERRAINS EST VISIBLE PAR TOUS. Le tournoi se gère entre
// participants : sans organisateur, « le terrain 5 n'a rien rentré » doit
// s'afficher chez les trente-deux pour que quelqu'un aille leur dire un mot.
//
// La logique (qui bloque, quel est mon terrain, ce qu'on annonce) vit dans
// lib/tournamentEvening, avec ses tests. Ici, du rendu et des appels.
import { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../../hooks/usePlayer';
import { Colors, Fonts } from '../../../lib/theme';
import { Icon } from '../../../components/community/icons';
import {
  fetchTournament, fetchTournamentMatches, fetchTeams, fetchMatchEntries,
  fetchRegistrations, enterTournamentScore, validateTournamentScore,
  isFeatureDisabled, resultMessage, subscribeTournamentMatches,
  type Tournament, type TournamentMatch, type TournamentTeam,
  type TournamentMatchEntry, type TournamentRegistration,
} from '../../../lib/tournaments';
import { displayName } from '../../../lib/players';
import {
  eveningCourts, myCourt, blockingLabel, blocks, courtsDone, roundLabel,
  type CourtView, type CourtState,
} from '../../../lib/tournamentEvening';

/** La couleur d'un état — la même partout sur l'écran. */
const TEINTE: Record<CourtState, string> = {
  vide:       Colors.danger,
  litige:     Colors.danger,
  provisoire: Colors.brandDeep,
  acquis:     Colors.success,
  forfait:    Colors.textMuted,
  exempt:     Colors.textMuted,
};

const PASTILLE: Record<CourtState, string> = {
  vide: '·', litige: '!', provisoire: '~', acquis: '✓', forfait: '—', exempt: '—',
};

export default function SoireeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();

  const [t, setT] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [teams, setTeams] = useState<TournamentTeam[]>([]);
  const [entries, setEntries] = useState<TournamentMatchEntry[]>([]);
  const [regs, setRegs] = useState<TournamentRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [tt, ms, tm, rs] = await Promise.all([
        fetchTournament(id), fetchTournamentMatches(id), fetchTeams(id), fetchRegistrations(id),
      ]);
      setT(tt); setMatches(ms); setTeams(tm); setRegs(rs);
      // Les saisies de la rotation EN COURS seulement : c'est tout ce dont
      // l'écran a besoin, et ça évite de rapatrier six tours de saisies à
      // chaque rafraîchissement.
      const duTour = ms.filter(m => m.round_no === (tt?.current_round ?? 0)).map(m => m.id);
      setEntries(await fetchMatchEntries(duTour));
    } catch {
      // Une panne de lecture ne doit pas laisser un écran à moitié peint : on
      // garde ce qu'on avait, l'utilisateur retire vers le bas.
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Recharge a l'arrivee, puis SUIT les matchs du tournoi tant que l'ecran
  // est affiche. Depuis tournament_auto_advance.sql la rotation suivante part
  // toute seule quand le dernier terrain saisit : sans cet abonnement, on
  // restait sur l'ancienne rotation — et on allait jouer sur le mauvais
  // terrain. Actif seulement quand l'ecran a le focus : pas d'ecoute en
  // arriere-plan pour un ecran que personne ne regarde.
  useFocusEffect(useCallback(() => {
    load();
    if (!id) return undefined;
    return subscribeTournamentMatches(id, () => { load(); });
  }, [load, id]));

  if (loading || !player) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.heroBg, justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.brand} />
      </View>
    );
  }
  if (!t) return null;

  const courts = eveningCourts(matches, teams, entries, player.id, t.current_round);
  const mien = myCourt(courts);
  const blocage = blockingLabel(courts);
  const avancement = courtsDone(courts);

  const nomsDe = (teamId: string | null): string => {
    const eq = teams.find(x => x.id === teamId);
    if (!eq) return '—';
    const nom = (pid: string) => {
      const r = regs.find(x => x.player_id === pid);
      return displayName(r?.player ?? null, 'player').split(' ')[0];
    };
    return `${nom(eq.player1_id)} & ${nom(eq.player2_id)}`;
  };

  const matchMien = mien ? matches.find(m => m.id === mien.matchId) ?? null : null;

  const envoyer = async () => {
    if (!matchMien) return;
    const gA = a.trim() === '' ? null : Number(a);
    const gB = b.trim() === '' ? null : Number(b);
    const refus = validateTournamentScore(gA, gB);
    if (refus) { Alert.alert('Score', refus); return; }
    setBusy(true);
    try {
      const res = await enterTournamentScore(matchMien.id, gA!, gB!);
      if (isFeatureDisabled(res)) { router.back(); return; }
      if (!res.ok) { Alert.alert('Impossible', resultMessage(res)); return; }
      setA(''); setB('');
      await load();
      // Les trois états ne disent PAS la même chose, et le plus important est
      // « recorded » : le score compte déjà. Sans ce mot, on croit qu'on
      // bloque les autres et on relance son adversaire pour rien.
      if (res.state === 'confirmed') {
        Alert.alert('Score acquis', 'Vous dites la même chose tous les deux.');
      } else if (res.state === 'disputed') {
        Alert.alert(
          'Vos scores diffèrent',
          'Mettez-vous d’accord avant la rotation suivante : c’est ce score qui décide qui monte et qui descend.',
        );
      } else {
        Alert.alert('Score envoyé', 'Il compte déjà. Vos adversaires peuvent le confirmer ou le corriger.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.heroBg }}>
      <ScrollView contentContainerStyle={{
        paddingTop: insets.top + 10, paddingHorizontal: 18,
        paddingBottom: insets.bottom + 24, gap: 16,
      }}>
        {/* En-tête : le strict nécessaire, et la sortie vers la fiche. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
            <Icon name="chevronLeft" size={22} color={Colors.textOnDark} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
              {t.name}
            </Text>
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.brand }}>
              {roundLabel(t.current_round, t.round_count)}
            </Text>
          </View>
        </View>

        {/* MON TERRAIN — le cœur de l'écran, en grand. */}
        {mien && matchMien ? (
          <View style={{
            backgroundColor: Colors.bgCard, borderRadius: 22, padding: 18, gap: 14,
          }}>
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, letterSpacing: 1.2, color: Colors.textMuted, textAlign: 'center' }}>
              TON TERRAIN
            </Text>
            <Text style={{ fontSize: 52, fontFamily: Fonts.display, color: Colors.textPrimary, textAlign: 'center', lineHeight: 56 }}>
              {mien.courtNo}
            </Text>

            <View style={{ gap: 6 }}>
              <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary, textAlign: 'center' }}>
                {nomsDe(matchMien.team_a)}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textMuted, textAlign: 'center' }}>
                VS
              </Text>
              <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary, textAlign: 'center' }}>
                {nomsDe(matchMien.team_b)}
              </Text>
            </View>

            {/* Le score effectif, quand il y en a un — avec son état en clair. */}
            {mien.gamesA != null && (
              <View style={{
                backgroundColor: TEINTE[mien.state] + '18', borderRadius: 14,
                paddingVertical: 10, paddingHorizontal: 12, gap: 3,
              }}>
                <Text style={{ fontSize: 18, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, textAlign: 'center' }}>
                  {mien.gamesA} – {mien.gamesB}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: TEINTE[mien.state], textAlign: 'center' }}>
                  {mien.state === 'acquis' ? 'Acquis : vous dites la même chose'
                    : mien.state === 'litige' ? 'Vos scores diffèrent — mettez-vous d’accord'
                    : 'Ce score compte déjà. L’autre camp peut le confirmer ou le corriger.'}
                </Text>
              </View>
            )}

            {/* La saisie — deux champs, un bouton. Rien d'autre. */}
            {mien.state !== 'acquis' && mien.state !== 'forfait' && (
              <View style={{ gap: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Case value={a} onChange={setA} />
                  <Text style={{ fontSize: 18, fontFamily: Fonts.uiBlack, color: Colors.textMuted }}>–</Text>
                  <Case value={b} onChange={setB} />
                </View>
                <TouchableOpacity
                  onPress={envoyer}
                  disabled={busy}
                  activeOpacity={0.85}
                  style={{
                    backgroundColor: Colors.primary, borderRadius: 14,
                    paddingVertical: 14, alignItems: 'center', opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy
                    ? <ActivityIndicator color={Colors.textOnDark} />
                    : (
                      <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                        {mien.gamesA == null ? 'RENTRER LE SCORE' : 'CORRIGER LE SCORE'}
                      </Text>
                    )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          <View style={{ backgroundColor: Colors.bgCard, borderRadius: 22, padding: 20, gap: 6 }}>
            <Text style={{ fontSize: 15, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary, textAlign: 'center' }}>
              Tu ne joues pas cette rotation
            </Text>
            <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted, textAlign: 'center', lineHeight: 17 }}>
              Repose-toi. Tu reviens à la suivante.
            </Text>
          </View>
        )}

        {/* LA SOIRÉE — visible par tous, c'est ce qui remplace l'organisateur. */}
        <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: 16, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontSize: 11, fontFamily: Fonts.uiBlack, letterSpacing: 1.2, color: Colors.textOnDark }}>
              LA SOIRÉE
            </Text>
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.6)' }}>
              {avancement.done}/{avancement.total} terrains
            </Text>
          </View>

          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {courts.map(c => (
              <View
                key={c.matchId}
                style={{
                  minWidth: 62, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12,
                  alignItems: 'center', gap: 2,
                  backgroundColor: c.mine ? Colors.brand : 'rgba(255,255,255,0.08)',
                  borderWidth: blocks(c.state) ? 1 : 0, borderColor: Colors.danger,
                }}
              >
                <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: c.mine ? Colors.primary : Colors.textOnDark }}>
                  T{c.courtNo}
                </Text>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: c.mine ? Colors.primary : TEINTE[c.state] }}>
                  {c.mine ? 'toi' : PASTILLE[c.state]}
                </Text>
              </View>
            ))}
          </View>

          {/* Ce qui bloque, nommé — pour qu'on aille leur parler. */}
          {blocage && (
            <View style={{ backgroundColor: 'rgba(239,68,68,0.16)', borderRadius: 12, padding: 10 }}>
              <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: '#FCA5A5', lineHeight: 16 }}>
                {blocage}
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity onPress={() => router.push(`/tournaments/${t.id}` as any)} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.5)' }}>
            Voir la fiche du tournoi
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

/** Une case de score : grande, numérique, faite pour un pouce mouillé. */
function Case({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <TextInput
      value={value}
      onChangeText={v => onChange(v.replace(/[^0-9]/g, '').slice(0, 2))}
      keyboardType="number-pad"
      maxLength={2}
      placeholder="—"
      placeholderTextColor={Colors.textMuted}
      style={{
        flex: 1, textAlign: 'center',
        backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
        borderRadius: 14, paddingVertical: 14,
        fontSize: 26, fontFamily: Fonts.uiBlack, color: Colors.textPrimary,
      }}
    />
  );
}
