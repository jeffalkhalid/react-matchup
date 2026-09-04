// Bloc « Score en direct » du détail de partie : désignation du scoreur
// (volontariat) + démarrage de la session dans la fenêtre H-15 → H+2h.
// Invisible si le flag admin est éteint ou si la partie n'est pas complète.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { Colors, Fonts, FontSize, Radius } from '../../lib/theme';
import { getLiveScoringEnabled, fetchLiveSession, startLiveSession } from '../../lib/liveSession';
import { notifyPlayers } from '../../lib/notify';

type Props = {
  gameId: string;
  meId: string;
  meName: string;                  // mon prénom/nom, pour la notif « Match lancé »
  matchDate: string | null;        // open_games.match_date
  liveScorerId: string | null;     // open_games.live_scorer_id
  isComplete: boolean;             // 4 confirmés
  participants: { id: string; name: string }[];
  onChanged: () => void;           // re-fetch de la partie par le parent
  // Le bloc vit dans une <Modal> native (GameDetailsSheet) : toute navigation
  // doit fermer la modale d'abord, sinon l'écran poussé monte DERRIÈRE elle.
  onCloseSheet?: () => void;
};

// Mini contrôle segmenté à deux choix, style pilules du projet.
function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { key: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: Colors.bgCardAlt, borderRadius: 999, padding: 3 }}>
      {options.map(o => (
        <TouchableOpacity key={o.key} onPress={() => onChange(o.key)} activeOpacity={0.8}
          style={{ flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center',
                   backgroundColor: value === o.key ? Colors.primary : 'transparent' }}>
          <Text style={{ fontSize: FontSize.xs, fontWeight: '900', fontFamily: Fonts.uiBlack,
                         color: value === o.key ? Colors.textOnDark : Colors.textSecondary }}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function LiveLobbyBlock({ gameId, meId, meName, matchDate, liveScorerId, isComplete, participants, onChanged, onCloseSheet }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  // Options de session, choisies juste avant le démarrage.
  const [showOptions, setShowOptions] = useState(false);
  const [mode, setMode] = useState<'games' | 'points'>('games');
  const [golden, setGolden] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getLiveScoringEnabled().then(v => { if (!cancelled) setEnabled(v); });
    return () => { cancelled = true; };
  }, []);
  if (!enabled || !isComplete) return null;

  const scorer = participants.find(p => p.id === liveScorerId) ?? null;
  const now = Date.now();
  const start = matchDate ? new Date(matchDate).getTime() : null;
  const inWindow = start != null && now >= start - 15 * 60_000 && now <= start + 2 * 3_600_000;

  const volunteer = async (id: string | null) => {
    setBusy(true);
    if (id != null) {
      // Se proposer : update conditionnel (personne n'a déjà pris le rôle)
      // pour éviter que deux joueurs qui tapent en même temps s'écrasent
      // silencieusement l'un l'autre.
      const { data, error } = await supabase
        .from('open_games')
        .update({ live_scorer_id: id })
        .eq('id', gameId)
        .is('live_scorer_id', null)
        .select('id');
      setBusy(false);
      if (error) { Alert.alert('Erreur', error.message); return; }
      onChanged();
      if (!data || data.length === 0) {
        Alert.alert('Trop tard', "Un autre joueur s'est déjà proposé.");
      }
    } else {
      // Se désister : on ne peut retirer que sa propre désignation.
      const { error } = await supabase
        .from('open_games')
        .update({ live_scorer_id: null })
        .eq('id', gameId)
        .eq('live_scorer_id', meId);
      setBusy(false);
      if (error) Alert.alert('Erreur', error.message); else onChanged();
    }
  };

  const startLive = async () => {
    setBusy(true);
    try {
      const sessionId = await startLiveSession(gameId, { mode, goldenPoint: golden });
      // Prévenir les 3 autres : sans notif, personne ne sait qu'un live démarre.
      // Fire-and-forget (notifyPlayers ne throw jamais).
      const others = participants.map(p => p.id).filter(id => id && id !== meId);
      if (others.length > 0) {
        notifyPlayers({
          playerIds: others,
          title: '🔴 Match lancé',
          body: `${meName} score en direct — suis le match !`,
          data: { type: 'live', sessionId },
        });
      }
      onCloseSheet?.();
      router.push(`/live/${sessionId}` as any);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const friendly = msg.includes('sides_unassigned')
        ? "Répartis d'abord les équipes (côtés A/B) dans le lobby."
        : msg.includes('teams_incomplete')
        ? 'Il faut 4 joueurs confirmés pour scorer en direct.'
        : msg.includes('session_already_closed')
        ? 'Le suivi live de cette partie est terminé — saisis le score classiquement.'
        : msg;
      Alert.alert('Impossible de démarrer', friendly);
    } finally { setBusy(false); }
  };

  return (
    <View style={{ backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 8 }}>
      <Text style={{ fontSize: FontSize.sm, fontWeight: '900', color: Colors.textPrimary, fontFamily: Fonts.uiBlack }}>🔴 Score en direct</Text>
      {scorer == null ? (
        <>
          <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>
            Un joueur peut saisir le score pendant le match (jeu par jeu, ou point par point). Les trois autres le verront en direct.
          </Text>
          <TouchableOpacity disabled={busy} onPress={() => volunteer(meId)} activeOpacity={0.8}
            style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, padding: 12, alignItems: 'center' }}>
            <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Je scorerai ce match</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={{ fontSize: FontSize.xs, color: Colors.textSecondary }}>
            {scorer.id === meId ? 'Tu scoreras ce match.' : `${scorer.name} scorera ce match.`}
          </Text>
          {scorer.id === meId && (
            <TouchableOpacity disabled={busy} onPress={() => volunteer(null)} activeOpacity={0.7}>
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted, textDecorationLine: 'underline' }}>Me désister</Text>
            </TouchableOpacity>
          )}
          {scorer.id === meId && inWindow && !showOptions && (
            <TouchableOpacity disabled={busy} onPress={() => setShowOptions(true)} activeOpacity={0.8}
              style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, padding: 12, alignItems: 'center' }}>
              <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontFamily: Fonts.uiBlack }}>Démarrer le score en direct</Text>
            </TouchableOpacity>
          )}
          {scorer.id === meId && inWindow && showOptions && (
            <View style={{ gap: 8, marginTop: 2 }}>
              <Text style={{ fontSize: FontSize.xs, fontWeight: '800', color: Colors.textSecondary }}>Granularité de saisie</Text>
              <Segmented value={mode} onChange={setMode} options={[
                { key: 'games', label: 'Jeu par jeu' },
                { key: 'points', label: 'Point par point' },
              ]} />
              {mode === 'points' && (
                <>
                  <Text style={{ fontSize: FontSize.xs, fontWeight: '800', color: Colors.textSecondary }}>À 40-40</Text>
                  <Segmented value={golden ? 'golden' : 'adv'} onChange={v => setGolden(v === 'golden')} options={[
                    { key: 'golden', label: '🔥 Point en or' },
                    { key: 'adv', label: 'Avantage' },
                  ]} />
                </>
              )}
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>
                {mode === 'games'
                  ? '1 tap par jeu, aux pauses — le plus simple quand tu joues.'
                  : '1 tap par point (0·15·30·40) — affichage complet, idéal avec un scoreur au bord du terrain.'}
              </Text>
              <TouchableOpacity disabled={busy} onPress={startLive} activeOpacity={0.8}
                style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, padding: 12, alignItems: 'center' }}>
                <Text style={{ color: Colors.textOnDark, fontWeight: '900', fontFamily: Fonts.uiBlack }}>C'est parti 🔥</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
}
