// app/events/[id].tsx — la fiche d'un événement de club.
//
// LE CODE COULEUR, et il n'est pas décoratif : en-tête NOIR = tournoi (on y
// joue, on y est classé), en-tête JAUNE = événement (le club invite). C'est
// ce qui permet de savoir, avant d'avoir lu un mot, si on s'apprête à
// s'engager sur une compétition ou à répondre à une invitation.
//
// Un événement se répond SEUL : pas de binôme, pas de côté, pas de score.
// Toute la fiche tient donc en quatre blocs et un bouton.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../../components/community/icons';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { displayName } from '../../lib/players';
import { getFollowingIds } from '../../lib/community';
import {
  fetchEvent, fetchEventRsvps, rsvpEvent, cancelRsvp,
  eventKindLabel, eventIsFull, eventSpotsLabel, eventPriceLabel, eventRsvpState,
  type ClubEvent, type EventRsvp,
} from '../../lib/events';

/** « Samedi 27 sept · 10:00 – 12:00 » — et sans l'heure de fin quand il n'y
 *  en a pas : un afterwork n'annonce pas quand il se termine. */
function quand(e: ClubEvent): string {
  const d = new Date(e.starts_at);
  const jour = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
  const h = (x: Date) => x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const fin = e.ends_at ? ` – ${h(new Date(e.ends_at))}` : '';
  return `${jour.charAt(0).toUpperCase()}${jour.slice(1)} · ${h(d)}${fin}`;
}

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();

  const [event, setEvent] = useState<ClubEvent | null>(null);
  const [rsvps, setRsvps] = useState<EventRsvp[]>([]);
  const [suivis, setSuivis] = useState<Set<string>>(new Set());
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const charger = useCallback(async () => {
    if (!id) return;
    try {
      const [e, r] = await Promise.all([fetchEvent(id), fetchEventRsvps(id)]);
      setEvent(e);
      setRsvps(r);
      setErreur(null);
    } catch (err: any) {
      setErreur(err?.message ?? 'Chargement impossible');
    } finally {
      setChargement(false);
    }
  }, [id]);

  useEffect(() => { charger(); }, [charger]);

  // L'anneau jaune des joueurs qu'on suit : il transforme une liste de noms
  // en « tiens, Karim y va ». Son absence ne doit rien casser — d'où l'échec
  // silencieux, la fiche se lit très bien sans.
  useEffect(() => {
    if (!player?.id) return;
    getFollowingIds(player.id).then(ids => setSuivis(new Set(ids))).catch(() => {});
  }, [player?.id]);

  if (chargement) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (erreur || !event) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.bg, paddingTop: insets.top + 20, paddingHorizontal: 18, gap: 14 }}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Icon name="chevronLeft" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
          {erreur ?? 'Cet événement n’existe plus.'}
        </Text>
      </View>
    );
  }

  const venants = rsvps.filter(r => !r.notify_on_free);
  const mien = rsvps.find(r => r.player_id === player?.id) ?? null;
  const etat = eventRsvpState(mien);
  const complet = eventIsFull(event.capacity, venants.length);
  const annule = event.status === 'ANNULE';
  const passe = new Date(event.starts_at) < new Date();
  const externe = event.kind === 'externe';

  const repondre = async (notifyOnFree: boolean) => {
    if (!player?.id) return;
    setBusy(true);
    try {
      const res = await rsvpEvent(event.id, player.id, notifyOnFree);
      if (!res.ok) {
        // Les refus viennent du trigger : on les traduit ici, une fois.
        const m = res.reason ?? '';
        Alert.alert(
          'Impossible',
          /event_full/.test(m) ? 'C’est complet — quelqu’un vient de prendre la dernière place.'
            : /event_cancelled/.test(m) ? 'Cet événement a été annulé.'
            : /event_past/.test(m) ? 'Cet événement a déjà eu lieu.'
            : m,
        );
        return;
      }
      await charger();
    } finally { setBusy(false); }
  };

  const meRetirer = async () => {
    if (!player?.id) return;
    setBusy(true);
    try {
      await cancelRsvp(event.id, player.id);
      await charger();
    } finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}>
        {/* ── L'en-tête JAUNE : c'est le club qui invite ── */}
        <View style={{
          backgroundColor: Colors.brand,
          paddingTop: insets.top + 10, paddingHorizontal: 18, paddingBottom: 20,
          borderBottomLeftRadius: 32, borderBottomRightRadius: 32, gap: 10,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
              <Icon name="chevronLeft" size={22} color={Colors.primary} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <View style={{ backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, letterSpacing: 1, color: Colors.brand }}>
                  {eventKindLabel(event.kind).toUpperCase()}
                </Text>
              </View>
            </View>
            {/* Symétrie de la flèche : sans cette largeur, la pastille est décentrée. */}
            <View style={{ width: 22 }} />
          </View>

          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            style={{ fontSize: 26, fontFamily: Fonts.welcome, color: Colors.primary, paddingRight: 6, alignSelf: 'stretch' }}
          >
            {event.title}
          </Text>

          <View style={{ gap: 2 }}>
            <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.primary }}>
              {quand(event)}
            </Text>
            <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: 'rgba(10,10,10,0.6)' }}>
              {event.club?.name ?? 'Lieu à confirmer'}
            </Text>
          </View>
        </View>

        <View style={{ padding: 14, gap: 12 }}>
          {/* Annulé : la RAISON, jamais un statut muet — un événement qui
              disparaît sans un mot passe pour un bug de l'app. */}
          {annule && (
            <View style={{ backgroundColor: 'rgba(239,68,68,0.10)', borderRadius: 14, padding: 12, gap: 3 }}>
              <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: '#B91C1C' }}>
                Cet événement est annulé
              </Text>
              {event.cancel_reason && (
                <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: '#B91C1C', lineHeight: 17 }}>
                  {event.cancel_reason}
                </Text>
              )}
            </View>
          )}

          {event.description && (
            <View style={carte}>
              <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 19 }}>
                {event.description}
              </Text>
            </View>
          )}

          {/* ── Qui vient ── */}
          <View style={[carte, { gap: 10 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <Text style={{ flex: 1, fontSize: 17, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 6 }}>
                Qui vient
              </Text>
              <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                {event.capacity != null ? `${venants.length} sur ${event.capacity}` : `${venants.length} inscrit${venants.length > 1 ? 's' : ''}`}
              </Text>
            </View>

            {venants.length === 0 ? (
              <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textMuted }}>
                Personne n’a encore répondu. Sois le premier.
              </Text>
            ) : (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {venants.slice(0, 5).map(r => {
                    const suivi = suivis.has(r.player_id);
                    return (
                      <TouchableOpacity
                        key={r.player_id}
                        onPress={() => router.push(`/player/${r.player_id}` as any)}
                        style={{ alignItems: 'center', gap: 4, width: 52 }}
                      >
                        <View style={{
                          padding: 2, borderRadius: 999,
                          borderWidth: 2, borderColor: suivi ? Colors.brand : 'transparent',
                        }}>
                          <PlayerAvatar
                            name={displayName(r.player, 'player')}
                            path={r.player?.avatar_path ?? null}
                            size={38}
                            backgroundColor={Colors.primary} textColor={Colors.brand}
                            fontFamily={Fonts.uiBlack} fontSize={14} initialsMax={1}
                          />
                        </View>
                        <Text numberOfLines={1} style={{ fontSize: 10, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
                          {displayName(r.player, 'player').split(' ')[0]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {venants.length > 5 && (
                    <View style={{ alignItems: 'center', gap: 4, width: 52 }}>
                      <View style={{
                        width: 38, height: 38, borderRadius: 19, marginTop: 2,
                        backgroundColor: Colors.bgCardAlt, alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>
                          +{venants.length - 5}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 10, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>autres</Text>
                    </View>
                  )}
                </View>
                {suivis.size > 0 && (
                  <Text style={{ fontSize: 10.5, fontFamily: Fonts.ui, color: Colors.textMuted }}>
                    Anneau jaune : des joueurs que tu suis.
                  </Text>
                )}
              </>
            )}
          </View>

          {/* ── Prix et places ── */}
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={[carte, { flex: 1, alignItems: 'center', gap: 2 }]}>
              <Text style={{ fontSize: 17, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                {eventPriceLabel(event.price_mad)}
              </Text>
              <Text style={{ fontSize: 10, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                {event.price_mad > 0 ? 'payé sur place' : 'prix'}
              </Text>
            </View>
            <View style={[carte, { flex: 1, alignItems: 'center', gap: 2 }]}>
              <Text style={{ fontSize: 17, fontFamily: Fonts.uiBlack, color: complet ? Colors.danger : Colors.textPrimary }}>
                {eventSpotsLabel(event.capacity, venants.length)}
              </Text>
              <Text style={{ fontSize: 10, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>places</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* ── La barre d'action : UNE seule, celle du moment ── */}
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: 14, paddingTop: 12, paddingBottom: insets.bottom + 12,
        backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: Colors.border, gap: 8,
      }}>
        {externe ? (
          // Externe : l'app ne gère rien, elle renvoie. « J'y vais aussi »
          // reste possible — c'est une information pour les autres, pas une
          // inscription.
          <>
            <TouchableOpacity
              onPress={() => event.external_url && Linking.openURL(event.external_url)}
              style={bouton(Colors.primary)}
            >
              <Text style={texteBouton(Colors.textOnDark)}>OUVRIR LE SITE DE LA FÉDÉRATION</Text>
            </TouchableOpacity>
            {etat === 'aucun' && !passe && (
              <TouchableOpacity onPress={() => repondre(false)} disabled={busy} style={{ alignItems: 'center', padding: 6 }}>
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary, textDecorationLine: 'underline' }}>
                  J’y vais aussi
                </Text>
              </TouchableOpacity>
            )}
          </>
        ) : annule || passe ? (
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textMuted, textAlign: 'center', paddingVertical: 12 }}>
            {annule ? 'Événement annulé' : 'Cet événement a déjà eu lieu'}
          </Text>
        ) : etat === 'jy_serai' ? (
          <>
            <View style={{ alignItems: 'center', gap: 2, paddingBottom: 4 }}>
              <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>Tu y seras</Text>
              <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted }}>
                On te le rappellera la veille.
              </Text>
            </View>
            <TouchableOpacity onPress={meRetirer} disabled={busy} style={{ alignItems: 'center', padding: 6 }}>
              <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary, textDecorationLine: 'underline' }}>
                Je ne peux plus venir
              </Text>
            </TouchableOpacity>
          </>
        ) : etat === 'me_prevenir' ? (
          <>
            <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary, textAlign: 'center' }}>
              On te préviendra si une place se libère.
            </Text>
            <TouchableOpacity onPress={meRetirer} disabled={busy} style={{ alignItems: 'center', padding: 6 }}>
              <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary, textDecorationLine: 'underline' }}>
                Laisse tomber
              </Text>
            </TouchableOpacity>
          </>
        ) : complet ? (
          <TouchableOpacity onPress={() => repondre(true)} disabled={busy} style={bouton(Colors.primary)}>
            {busy ? <ActivityIndicator color={Colors.textOnDark} /> : (
              <Text style={texteBouton(Colors.textOnDark)}>ME PRÉVENIR S’IL Y A DE LA PLACE</Text>
            )}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => repondre(false)} disabled={busy} style={bouton(Colors.primary)}>
            {busy ? <ActivityIndicator color={Colors.textOnDark} /> : (
              <Text style={texteBouton(Colors.textOnDark)}>J’Y SERAI</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const carte = {
  backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1,
  borderColor: Colors.border, padding: 14,
} as const;

const bouton = (bg: string) => ({
  backgroundColor: bg, borderRadius: 16, paddingVertical: 16, alignItems: 'center' as const,
});

const texteBouton = (color: string) => ({
  fontSize: 13.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.6, color,
});
