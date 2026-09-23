// Les invitations reçues — hub Activité. Brancher sur l'existant :
// accepter = même mise à jour que app/(tabs)/lobby.tsx (handleAcceptInvitation),
// refuser = lib/games.declineInvitationPlan (déjà écrite/testée). Aucun nouveau
// circuit de données.
//
// On n'en montrait qu'UNE, la plus proche : on pouvait avoir trois parties qui
// attendent une réponse sans jamais le savoir depuis le hub. Elles défilent
// maintenant toutes, la plus proche d'abord — même forme que les autres rails.
// « ON T'ATTEND » est devenu le titre de section : il encombrait l'en-tête de
// chaque carte, qui porte déjà la date complète et la nature du match.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, Alert, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import { NaturePill } from '../profile/components';
import { matchNature } from '../../lib/matchView';
import { levelRangeLabel, isCreatorConflict, declineInvitationPlan } from '../../lib/games';
import { usePlayer } from '../../hooks/usePlayer';
import { useReleveDefi } from '../../hooks/useReleveDefi';
import {
  fetchMyInvitations, invitingDuo, invitationTitle, invitationDatePill, confirmedCount,
  type HubInvitation,
} from '../../lib/hubInvitation';
import { notifyPlayers } from '../../lib/notify';
import { supabase } from '../../lib/supabase';

type Resolution = 'accepted' | 'declined';

export function InvitationCard({ playerId }: { playerId: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { player } = usePlayer();
  const [loading, setLoading] = useState(true);
  const [invitations, setInvitations] = useState<HubInvitation[]>([]);
  /** Répondu depuis la carte — par invitation, plusieurs vivant côte à côte. */
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true); setResolutions({});
    fetchMyInvitations(playerId).then(list => { setInvitations(list); setLoading(false); });
  }, [playerId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Relever un défi nominatif : même hook que le lobby et le hub Défi
  // (hooks/useReleveDefi) — une seule écriture de la règle pour trois écrans.
  const releve = useReleveDefi({
    me: player ? { id: player.id, name: player.name, elo_score: player.elo_score } : null,
    onDone: load,
  });

  // Pas d'invitation : le bloc ne s'affiche pas. Un encart « personne ne te
  // cherche » en pleine page ne dit rien d'utile et pèse sur l'écran.
  if (loading || invitations.length === 0) return null;

  const occupe = (id: string, on: boolean) =>
    setBusy(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const accept = async (inv: HubInvitation) => {
    const { game, participantId } = inv;
    // Défi nominatif : relever le défi et amener son binôme sont UN SEUL
    // geste, et il se fait ICI — la fenêtre du binôme prend la main, rien
    // n'est accepté tant qu'il n'est pas choisi.
    if (releve.start(game as any, participantId)) return;
    occupe(participantId, true);
    const { error } = await supabase.from('game_participants').update({ status: 'accepted' }).eq('id', participantId);
    occupe(participantId, false);
    if (error) {
      if (isCreatorConflict(error)) {
        Alert.alert('Conflit de créneau', 'Tu es déjà sur une autre partie au même créneau (±2h). Annule-la ou quitte-la avant de rejoindre celle-ci.');
      } else {
        Alert.alert('Impossible de rejoindre', 'Une erreur est survenue, réessaie dans un instant.');
      }
      return;
    }
    if (game.creator_id) {
      const others = [
        game.creator_id,
        ...(game.participants ?? []).filter(p => p.status === 'accepted').map(p => p.player_id),
      ].filter(id => id !== playerId);
      if (others.length > 0) {
        notifyPlayers({ playerIds: others, title: 'Nouveau joueur confirmé', body: `Vous êtes prêts pour ${game.location ?? 'la partie'}.`, data: { type: 'lobby', gameId: game.id } });
      }
    }
    setResolutions(r => ({ ...r, [participantId]: 'accepted' }));
  };

  const decline = async (inv: HubInvitation) => {
    const { game, participantId } = inv;
    occupe(participantId, true);
    const { data: row } = await supabase.from('game_participants').select('status, auto_declined').eq('id', participantId).maybeSingle();
    const plan = declineInvitationPlan(row ?? { status: 'invited' });
    const { error } = await supabase.from('game_participants').update(plan.update).eq('id', participantId);
    if (!error && plan.freeSpot) {
      await supabase.from('open_games').update({ spots_available: Math.min(3, (game.spots_available ?? 0) + 1) }).eq('id', game.id);
      if (game.creator_id && game.creator_id !== playerId) {
        notifyPlayers({ playerIds: [game.creator_id], title: 'Invitation refusée', body: 'Un joueur invité ne pourra pas venir.', data: { type: 'lobby', gameId: game.id } });
      }
    }
    occupe(participantId, false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setResolutions(r => ({ ...r, [participantId]: 'declined' }));
  };

  // Presque pleine largeur : on en voit une, on devine la suivante, on fait
  // défiler. Seule, l'invitation garde la pleine largeur d'avant.
  const LARGEUR = invitations.length > 1 ? Math.min(width - 56, 340) : width - 32;

  return (
    <View style={{ marginTop: 18 }}>
      {/* Le choix du binôme quand on relève un défi nominatif d'ici. */}
      {releve.sheet}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <Icon name="bellRing" size={15} color={Colors.textPrimary} stroke={2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6 }}>
          On t'attend
        </Text>
        {invitations.length > 1 ? (
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: Colors.textSecondary }}>
            {`${invitations.length} parties`}
          </Text>
        ) : null}
      </View>

      <ScrollView
        horizontal
        scrollEnabled={invitations.length > 1}
        showsHorizontalScrollIndicator={false}
        snapToInterval={LARGEUR + 10}
        decelerationRate="fast"
        style={{ marginHorizontal: -16 }}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      >
        {invitations.map(inv => (
          <Invitation
            key={inv.participantId}
            inv={inv}
            playerId={playerId}
            largeur={LARGEUR}
            resolution={resolutions[inv.participantId] ?? null}
            busy={busy.has(inv.participantId)}
            onAccept={() => accept(inv)}
            onDecline={() => decline(inv)}
            onOpen={() => router.push(`/(tabs)/lobby?gameId=${inv.game.id}` as any)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/** Une invitation : qui attend, sur quelle partie, et les deux réponses. */
function Invitation({ inv, playerId, largeur, resolution, busy, onAccept, onDecline, onOpen }: {
  inv: HubInvitation;
  playerId: string;
  largeur: number;
  resolution: Resolution | null;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onOpen: () => void;
}) {
  const { game } = inv;
  const duo = invitingDuo(game as any, playerId);
  // Combien sont déjà là, et quelle place je prendrais. Le « 4ᵉ » était écrit
  // en dur : sur une partie où il manquait trois joueurs, on faisait croire
  // qu'on complétait l'équipe.
  const confirmes = confirmedCount(game as any, playerId);
  const title = invitationTitle(duo, confirmes + 1);
  const datePill = game.match_date ? invitationDatePill(game.match_date) : null;
  const level = levelRangeLabel(game as any);
  const jour = game.match_date ? new Date(game.match_date).toLocaleDateString('fr-FR', { weekday: 'long' }) : '';
  const nature = matchNature(game as any);

  return (
    <View style={{
      width: largeur, backgroundColor: Colors.bgCard, borderRadius: 18,
      borderWidth: 1, borderColor: Colors.border, padding: 14,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {datePill ? (
          <View style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.brand, letterSpacing: 0.4 }}>{datePill}</Text>
          </View>
        ) : null}
        {/* Sur quoi on m'attend : un amical et un défi ×4 ne s'acceptent pas
            de la même façon. Même pastille que les cartes de match. */}
        <NaturePill kind={nature.kind} stake={nature.stake} />
      </View>

      {/* Tout le bloc mène à la fiche de la partie : on décidait sans pouvoir
          regarder qui joue, ni où exactement. */}
      <TouchableOpacity onPress={onOpen} activeOpacity={0.8} accessibilityLabel="Voir le match">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row' }}>
            {duo.map((p, i) => (
              <PlayerAvatar key={p.id ?? i} name={p.name} path={p.avatar_path}
                size={40} ring={2} ringColor="#FFFFFF"
                backgroundColor={i === 0 ? Colors.brand : Colors.primary}
                textColor={i === 0 ? Colors.primary : Colors.brand}
                fontFamily={Fonts.uiBlack} fontSize={14} initialsMax={2}
                style={i > 0 ? { marginLeft: -10 } : undefined} />
            ))}
          </View>
          <Text numberOfLines={2} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 19, lineHeight: 24, color: Colors.textPrimary, paddingRight: 6 }}>
            {title}
          </Text>
        </View>

        <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.textSecondary, marginBottom: 2 }}>
          {[game.location, level].filter(Boolean).join(' · niv. ')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14 }}>
          {/* L'état réel : est-ce que je complète, ou faudra-t-il encore du monde. */}
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiBold, fontSize: 11.5, color: Colors.textMuted }}>
            {`${confirmes} confirmé${confirmes > 1 ? 's' : ''} sur 4`}
          </Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.textSecondary }}>Voir le match</Text>
          <Icon name="chevronRight" size={13} color={Colors.textMuted} stroke={2.4} />
        </View>
      </TouchableOpacity>

      {resolution === 'accepted' ? (
        <View style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: Colors.brand }}>
            Tu joues {jour} · {Math.min(4, confirmes + 1)}/4
          </Text>
        </View>
      ) : resolution === 'declined' ? (
        <View style={{ backgroundColor: '#F5F5F4', borderWidth: 1, borderColor: Colors.border, borderRadius: 999, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textSecondary }}>
            Décliné — ils cherchent ailleurs
          </Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity onPress={onAccept} disabled={busy} activeOpacity={0.85} style={{
            flex: 1.4, backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center', opacity: busy ? 0.6 : 1,
          }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: '#FFFFFF' }}>Accepter</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDecline} disabled={busy} activeOpacity={0.85} style={{
            flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Colors.border, borderRadius: 999, paddingVertical: 12, alignItems: 'center', opacity: busy ? 0.6 : 1,
          }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#0A0A0A' }}>Pas dispo</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
