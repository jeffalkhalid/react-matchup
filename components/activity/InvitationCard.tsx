// Carte d'invitation reçue — hub Activité, étape 1. Brancher sur l'existant :
// accepter = même mise à jour que app/(tabs)/lobby.tsx (handleAcceptInvitation),
// refuser = lib/games.declineInvitationPlan (déjà écrite/testée). Aucun nouveau
// circuit de données.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import { AMB } from '../../lib/ambassador';
import { levelRangeLabel, isCreatorConflict, declineInvitationPlan } from '../../lib/games';
import { fetchMyInvitation, invitingDuo, invitationTitle, invitationDatePill, type HubInvitation } from '../../lib/hubInvitation';
import { notifyPlayers } from '../../lib/notify';
import { supabase } from '../../lib/supabase';

const CARD = { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 14 } as const;

export function InvitationCard({ playerId }: { playerId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<HubInvitation | null>(null);
  const [resolution, setResolution] = useState<'accepted' | 'declined' | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setResolution(null);
    fetchMyInvitation(playerId).then(inv => { setInvitation(inv); setLoading(false); });
  }, [playerId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Pas d'invitation : le bloc ne s'affiche pas. Un encart « personne ne te
  // cherche » en pleine page ne dit rien d'utile et pèse sur l'écran.
  if (loading || !invitation) return null;

  const { game, participantId } = invitation;
  const duo = invitingDuo(game as any, playerId);
  const title = invitationTitle(duo);
  const datePill = game.match_date ? invitationDatePill(game.match_date) : null;
  const level = levelRangeLabel(game as any);
  const jour = game.match_date ? new Date(game.match_date).toLocaleDateString('fr-FR', { weekday: 'long' }) : '';

  const accept = async () => {
    setBusy(true);
    const { error } = await supabase.from('game_participants').update({ status: 'accepted' }).eq('id', participantId);
    setBusy(false);
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
    setResolution('accepted');
  };

  const decline = async () => {
    setBusy(true);
    const { data: row } = await supabase.from('game_participants').select('status, auto_declined').eq('id', participantId).maybeSingle();
    const plan = declineInvitationPlan(row ?? { status: 'invited' });
    const { error } = await supabase.from('game_participants').update(plan.update).eq('id', participantId);
    if (!error && plan.freeSpot) {
      await supabase.from('open_games').update({ spots_available: Math.min(3, (game.spots_available ?? 0) + 1) }).eq('id', game.id);
      if (game.creator_id && game.creator_id !== playerId) {
        notifyPlayers({ playerIds: [game.creator_id], title: 'Invitation refusée', body: 'Un joueur invité ne pourra pas venir.', data: { type: 'lobby', gameId: game.id } });
      }
    }
    setBusy(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setResolution('declined');
  };

  // Occupation après mon acceptation (créateur + acceptés + moi), sans refetch.
  const occupiedAfterMe = 1 + (game.participants ?? []).filter(p => p.status === 'accepted' && p.player_id !== game.creator_id).length + 1;

  return (
    <View style={CARD}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        {datePill ? (
          <View style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: Colors.brand, letterSpacing: 0.4 }}>{datePill}</Text>
          </View>
        ) : <View />}
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: AMB.chipText, letterSpacing: 0.8 }}>ON T'ATTEND</Text>
      </View>

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
        <Text numberOfLines={2} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 20, lineHeight: 25, color: Colors.textPrimary, paddingRight: 6 }}>
          {title}
        </Text>
      </View>

      <Text numberOfLines={1} style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.textSecondary, marginBottom: 14 }}>
        {[game.location, level].filter(Boolean).join(' · niv. ')}
      </Text>

      {resolution === 'accepted' ? (
        <View style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: Colors.brand }}>
            Tu joues {jour} · {occupiedAfterMe}/4
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
          <TouchableOpacity onPress={accept} disabled={busy} activeOpacity={0.85} style={{
            flex: 1.4, backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center', opacity: busy ? 0.6 : 1,
          }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: '#FFFFFF' }}>Accepter</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={decline} disabled={busy} activeOpacity={0.85} style={{
            flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Colors.border, borderRadius: 999, paddingVertical: 12, alignItems: 'center', opacity: busy ? 0.6 : 1,
          }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: '#0A0A0A' }}>Pas dispo</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
