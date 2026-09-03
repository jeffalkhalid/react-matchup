// components/tournaments/ScoreSheet.tsx — la saisie (et la lecture) du score
// d'un match de tournoi.
//
// ⚠️ CONTRAT D'ORIENTATION, SANS EXCEPTION (en-tête de `tournament_enter_score`,
// supabase/migrations/tournaments_rpcs.sql) : `gamesA` EST TOUJOURS le score
// de `teamA` DU MATCH, `gamesB` celui de `teamB` — quel que soit le joueur
// qui saisit, quel que soit son camp. Cet écran NOMME LES DEUX CAMPS et ne
// les réordonne JAMAIS selon qui regarde : pas de « toi / adversaire »,
// teamA reste en haut, teamB en bas, pour les QUATRE joueurs du match. Deux
// adversaires qui inverseraient chacun de leur côté acquerraient un score à
// l'envers sans que rien ne le signale — c'est cette inversion que la
// convention interdit, et c'est une exigence dure de ce chantier.
//
// ⚠️ Un score à ÉGALITÉ est refusé ICI, avant même d'appeler le serveur
// (`validateTournamentScore` → `draw_not_allowed`, cf. lib/tournamentReasons) :
// le point décisif s'inscrit comme un jeu, jamais un match nul.
//
// ⚠️ Un FORFAIT se lit à `forfeitedTeamId` — jamais aux jeux, qui peuvent
// porter un score de courtoisie égal des deux côtés. Ni ce composant ni la
// saisie ne redérivent un vainqueur : ils affichent ce que le serveur a
// tranché (`status`, calculé par `lib/tournaments.matchLiveStatus`).
//
// ⚠️ Un LITIGE se montre, il ne se tranche pas ici : `tournament_resolve_dispute`
// appartient à l'organisateur (Task 10). Cet écran affiche « en attente
// d'arbitrage », sans aucun bouton pour trancher.
//
// Surimpression absolue (motif ProfileMenuSheet), pas un <Modal> natif — cf.
// feedback_nav_depuis_modal_native — comme la feuille d'inscription de
// app/tournaments/[id].tsx.

import { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import {
  validateTournamentScore, type MatchLiveStatus, type TournamentMatchEntry,
} from '../../lib/tournaments';

export interface ScoreSheetTeam {
  id: string;
  /** Les deux joueurs du binôme, TELS QUELS — jamais « toi / adversaire ». */
  names: [string, string];
  playerIds: [string, string];
}

export function ScoreSheet({
  courtNo, teamA, teamB, status, gamesA, gamesB, forfeitedTeamId,
  entries, myPlayerId, canEnter, busy, onSubmit, onClose,
}: {
  courtNo: number;
  /** Toujours `team_a` DU MATCH — jamais réordonné selon qui regarde. */
  teamA: ScoreSheetTeam;
  teamB: ScoreSheetTeam;
  status: MatchLiveStatus;
  /** Le score ACQUIS (`tournament_matches.games_a/b`), `null` tant qu'il ne
   *  l'est pas. */
  gamesA: number | null;
  gamesB: number | null;
  forfeitedTeamId?: string | null;
  /** Toutes les saisies déjà connues pour ce match. */
  entries: TournamentMatchEntry[];
  myPlayerId: string;
  /** Je fais partie des quatre joueurs, le tournoi est en cours, et ce match
   *  n'est ni acquis ni forfait : la saisie a un sens. */
  canEnter: boolean;
  busy?: boolean;
  onSubmit: (gamesA: number, gamesB: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const teamAEntries = entries.filter(e => teamA.playerIds.includes(e.player_id));
  const teamBEntries = entries.filter(e => teamB.playerIds.includes(e.player_id));
  // Le préremplissage vient de MOI ou de MON COÉQUIPIER, JAMAIS de
  // l'adversaire : avant cette correction, à défaut de ma propre saisie, la
  // case se préremplissait avec la PREMIÈRE saisie connue toutes équipes
  // confondues — donc, la moitié du temps, celle du camp d'en face. « Deux
  // témoignages indépendants » devenait alors « un tap pour entériner la
  // version de l'adversaire ». Rien à préremplir tant que ni moi ni mon
  // coéquipier n'avons rien saisi : mieux vaut un champ vide qu'une
  // proposition venue d'en face.
  const myTeamEntries = teamA.playerIds.includes(myPlayerId) ? teamAEntries
    : teamB.playerIds.includes(myPlayerId) ? teamBEntries
    : [];
  const myEntry = entries.find(e => e.player_id === myPlayerId)
    ?? myTeamEntries[0]
    ?? null;

  const [inputA, setInputA] = useState(myEntry ? String(myEntry.games_a) : '');
  const [inputB, setInputB] = useState(myEntry ? String(myEntry.games_b) : '');

  // Une saisie déjà connue (la mienne, ou à défaut celle de mon coéquipier —
  // orientation team_a/team_b déjà correcte quel qu'en soit l'auteur) préremplit
  // les deux cases : confirmer un score juste ne demande alors qu'un tap.
  useEffect(() => {
    if (myEntry) { setInputA(String(myEntry.games_a)); setInputB(String(myEntry.games_b)); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myEntry?.games_a, myEntry?.games_b]);

  const parsedA = inputA.trim() === '' ? null : Number(inputA);
  const parsedB = inputB.trim() === '' ? null : Number(inputB);
  const error = validateTournamentScore(parsedA, parsedB);
  const canSubmit = canEnter && parsedA != null && parsedB != null && !error && !busy;

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%' }}
      >
        <View style={{
          backgroundColor: Colors.bg, borderTopLeftRadius: 22, borderTopRightRadius: 22,
          paddingBottom: insets.bottom + 16, paddingHorizontal: 18,
        }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 10 }}>
            <Text style={{ flex: 1, fontFamily: Fonts.uiBlack, fontSize: 16, color: Colors.textPrimary }}>
              Terrain {courtNo}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ fontSize: 20, color: Colors.textMuted, lineHeight: 22 }}>×</Text>
            </TouchableOpacity>
          </View>

          {/* Les deux camps, TOUJOURS dans cet ordre — jamais « toi / adversaire ». */}
          <View style={{ marginTop: 14, gap: 10 }}>
            <TeamScoreRow
              team={teamA} value={inputA} editable={canEnter} onChangeText={setInputA}
              forfeited={forfeitedTeamId === teamA.id}
              acquiredScore={status === 'confirmed' ? gamesA : null}
            />
            <TeamScoreRow
              team={teamB} value={inputB} editable={canEnter} onChangeText={setInputB}
              forfeited={forfeitedTeamId === teamB.id}
              acquiredScore={status === 'confirmed' ? gamesB : null}
            />
          </View>

          {/* Ce qui manque pour que le match soit acquis, ou le litige en
              attente d'arbitrage — jamais un bouton pour le trancher ici. */}
          <View style={{ marginTop: 12 }}>
            <StatusNotice
              status={status} teamA={teamA} teamB={teamB}
              teamAEntries={teamAEntries} teamBEntries={teamBEntries}
              forfeitedTeamId={forfeitedTeamId}
            />
          </View>

          {canEnter && (
            <>
              {error && parsedA != null && parsedB != null && (
                <Text style={{ marginTop: 10, fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.danger }}>
                  {error}
                </Text>
              )}
              <TouchableOpacity
                onPress={() => { if (canSubmit && parsedA != null && parsedB != null) onSubmit(parsedA, parsedB); }}
                disabled={!canSubmit} activeOpacity={0.85}
                style={{
                  marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 13,
                  opacity: canSubmit ? 1 : 0.45,
                }}
              >
                {busy && <ActivityIndicator size="small" color={Colors.textOnDark} />}
                <Text style={{ color: Colors.textOnDark, fontSize: 13.5, fontFamily: Fonts.uiBlack }}>
                  Enregistrer le score
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function TeamScoreRow({ team, value, editable, onChangeText, forfeited, acquiredScore }: {
  team: ScoreSheetTeam; value: string; editable: boolean;
  onChangeText: (v: string) => void; forfeited?: boolean; acquiredScore: number | null;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.bgCard, borderRadius: 14, borderWidth: 1, borderColor: Colors.border,
      paddingHorizontal: 14, paddingVertical: 10,
    }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          {team.names[0]} · {team.names[1]}
        </Text>
        {forfeited && (
          <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.danger, marginTop: 2 }}>
            Forfait
          </Text>
        )}
      </View>
      {editable ? (
        <TextInput
          value={value} onChangeText={t => onChangeText(t.replace(/[^0-9]/g, '').slice(0, 2))}
          keyboardType="number-pad" selectTextOnFocus placeholder="–"
          placeholderTextColor={Colors.textMuted}
          style={{
            width: 52, textAlign: 'center', paddingVertical: 8, borderRadius: 10,
            backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
            fontSize: 18, fontFamily: Fonts.uiBlack, color: Colors.textPrimary,
          }}
        />
      ) : (
        <Text style={{ fontSize: 20, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, minWidth: 30, textAlign: 'right' }}>
          {acquiredScore != null ? acquiredScore : '–'}
        </Text>
      )}
    </View>
  );
}

function StatusNotice({ status, teamA, teamB, teamAEntries, teamBEntries, forfeitedTeamId }: {
  status: MatchLiveStatus;
  teamA: ScoreSheetTeam; teamB: ScoreSheetTeam;
  teamAEntries: TournamentMatchEntry[]; teamBEntries: TournamentMatchEntry[];
  forfeitedTeamId?: string | null;
}) {
  const latest = (es: TournamentMatchEntry[]) =>
    [...es].sort((a, b) => b.entered_at.localeCompare(a.entered_at))[0] ?? null;
  const a = latest(teamAEntries);
  const b = latest(teamBEntries);

  let tone: 'warning' | 'danger' | 'success' | 'info';
  let text: string;
  if (status === 'bye') {
    tone = 'info'; text = 'Ce tour est un repos : il n’y a pas de score à saisir.';
  } else if (status === 'confirmed') {
    tone = 'success'; text = 'Score acquis — les deux camps concordent.';
  } else if (status === 'forfeited') {
    tone = 'danger';
    const loser = forfeitedTeamId === teamA.id ? teamA : teamB;
    text = `${loser.names.join(' · ')} a déclaré forfait sur ce match.`;
  } else if (status === 'disputed') {
    tone = 'danger';
    text = a && b
      ? `Litige : ${teamA.names.join(' · ')} dit ${a.games_a}-${a.games_b}, ${teamB.names.join(' · ')} dit ${b.games_a}-${b.games_b}. Seul l’organisateur peut trancher.`
      : 'Litige entre les deux camps. Seul l’organisateur peut trancher.';
  } else if (!a && !b) {
    tone = 'warning'; text = 'Aucun score saisi pour l’instant.';
  } else if (a && !b) {
    tone = 'warning';
    text = `${teamA.names.join(' · ')} a saisi ${a.games_a}-${a.games_b}. En attente d’un joueur de ${teamB.names.join(' · ')}.`;
  } else if (!a && b) {
    tone = 'warning';
    text = `${teamB.names.join(' · ')} a saisi ${b.games_a}-${b.games_b}. En attente d’un joueur de ${teamA.names.join(' · ')}.`;
  } else {
    tone = 'warning'; text = 'Les deux camps ont saisi un score — mise à jour en cours.';
  }

  const map = {
    warning: { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.50)', fg: '#B45309' },
    danger:  { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.45)',  fg: '#B91C1C' },
    success: { bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.45)', fg: '#047857' },
    info:    { bg: 'rgba(59,130,246,0.10)', border: 'rgba(59,130,246,0.45)', fg: '#1D4ED8' },
  }[tone];
  return (
    <View style={{
      backgroundColor: map.bg, borderWidth: 1, borderColor: map.border,
      borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    }}>
      <Text style={{ color: map.fg, fontSize: 12, fontFamily: Fonts.uiBold, lineHeight: 17 }}>{text}</Text>
    </View>
  );
}

export default ScoreSheet;
