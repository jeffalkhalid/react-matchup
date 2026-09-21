// Carte « Dispos ce soir » — hub Activité, étape 1. Montre qui, dans mon
// cercle (mes amis — le mercato « joueurs de mon niveau » viendra à l'étape
// suivante), s'est déclaré libre sur le créneau le plus proche.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Colors, Fonts, formatPadelLevel } from '../../lib/theme';
import { Icon } from '../community/icons';
import { Chip } from '../community/ui';
import { PlayerAvatar } from '../PlayerAvatar';
import { AMB, isAmbassador } from '../../lib/ambassador';
import { AmbassadorRing } from '../ambassador/primitives';
import { notifyPlayers } from '../../lib/notify';
import {
  availabilitySlots, displayedSlot, isSlotActive, slotTitle, slotShortLabel, missingPlayers,
  fetchCircleAvailability, slotFormFields, type AvailabilityRow, type Slot,
} from '../../lib/availability';
import {
  announcedSlots, alertBody, cooldownLeft, cooldownLabel, readLastAlert, markAlertSent,
} from '../../lib/circleAlert';

const CARD = { backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, padding: 14, marginTop: 14 } as const;
/** Trois places à pourvoir à côté de la mienne. */
const MAX_SELECTION = 3;

export function DispoCard({ playerId, playerName, playerElo, playerAvatarPath, playerIsAmbassador, friendIds, mine, onToggleSlot }: {
  playerId: string;
  playerName: string;
  /** Mon niveau — ma carte porte la même pastille que les autres. */
  playerElo?: number | null;
  playerAvatarPath?: string | null;
  playerIsAmbassador?: boolean;
  friendIds: string[];
  /** Mes propres dispos (chargées par l'écran, pour les chips du header). */
  mine: Pick<AvailabilityRow, 'slot_start' | 'slot_end'>[];
  /** Coche/décoche un créneau — même geste que les chips du header. */
  onToggleSlot: (slot: Slot) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [circle, setCircle] = useState<AvailabilityRow[]>([]);
  /** Les joueurs cochés : c'est avec eux que la partie se monte. */
  const [choisis, setChoisis] = useState<string[]>([]);

  // Le créneau affiché : MON premier jour déclaré, sinon le plus proche. La
  // carte restait figée sur « ce soir » et montrait les joueurs d'un soir où
  // l'on ne joue pas. Le titre suit (slotTitle), donc « Dispos demain ».
  const creneaux = availabilitySlots();
  const slot = displayedSlot(creneaux, mine) ?? creneaux[0];

  const load = useCallback(() => {
    setLoading(true);
    fetchCircleAvailability(friendIds, slot).then(rows => { setCircle(rows); setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendIds.join(','), slot.key]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const iAmIn = isSlotActive(slot, mine);
  const othersCount = circle.length;
  const missing = missingPlayers(othersCount);
  const basculer = (id: string) => setChoisis(prev =>
    prev.includes(id) ? prev.filter(x => x !== id)
      : prev.length >= MAX_SELECTION ? prev : [...prev, id]);

  // « Monter la partie avec eux » : le créneau et les joueurs cochés partent
  // dans l'assistant de création, qui s'ouvre déjà rempli.
  const monterLaPartie = () => {
    const { day, time } = slotFormFields(slot);
    const ids = choisis.join(',');
    router.push(`/(tabs)/lobby?create=1&inv=${ids}&invd=${day}&invt=${time}` as any);
  };

  const rows = [
    ...(iAmIn ? [{
      id: playerId, name: playerName, elo: playerElo ?? null,
      avatarPath: playerAvatarPath ?? null, ambassador: !!playerIsAmbassador, isMe: true,
    }] : []),
    ...circle.map(r => ({
      id: r.player_id ?? r.id ?? r.player?.id ?? '', name: r.player?.name ?? 'Joueur',
      elo: r.player?.elo_score ?? null, avatarPath: r.player?.avatar_path ?? null,
      ambassador: isAmbassador(r.player), isMe: false,
    })),
  ];

  // ── Prévenir mon cercle ────────────────────────────────────────────
  // On annonce les jours RÉELLEMENT cochés, pas le créneau affiché par la
  // carte : le bouton disait « dispo ce soir » à quelqu'un qui avait coché
  // demain et mercredi. Et un seul envoi passe par tranche de quelques
  // heures — voir lib/circleAlert pour la règle et ses limites.
  const [dernierEnvoi, setDernierEnvoi] = useState<number | null>(null);
  const [envoiEnCours, setEnvoiEnCours] = useState(false);
  const [maintenant, setMaintenant] = useState(() => Date.now());

  useFocusEffect(useCallback(() => {
    let vivant = true;
    setMaintenant(Date.now());
    readLastAlert(playerId).then(t => { if (vivant) setDernierEnvoi(t); });
    return () => { vivant = false; };
  }, [playerId]));

  const attente = cooldownLeft(dernierEnvoi, maintenant);

  // Le compte à rebours avance tout seul : sans ça le bouton resterait éteint
  // jusqu'à ce qu'on quitte l'onglet et qu'on y revienne.
  useEffect(() => {
    if (attente <= 0) return;
    const t = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [attente <= 0]);

  const aPrevenir = useMemo(() => announcedSlots(availabilitySlots(), mine), [mine]);

  const sansCercle = friendIds.length === 0;
  const peutPrevenir = !sansCercle && aPrevenir.length > 0 && attente <= 0 && !envoiEnCours;

  const prevenirCercle = async () => {
    if (!peutPrevenir) return;
    setEnvoiEnCours(true);
    const quand = Date.now();
    await notifyPlayers({
      playerIds: friendIds,
      title: `${playerName} cherche à jouer`,
      body: alertBody(aPrevenir),
      data: { type: 'availability' },
    });
    await markAlertSent(playerId, quand);
    setDernierEnvoi(quand); setMaintenant(Date.now()); setEnvoiEnCours(false);
  };

  const texteBouton = sansCercle ? 'Personne à prévenir'
    : attente > 0 ? 'Ton cercle est prévenu'
    : aPrevenir.length === 0 ? "Choisis d'abord un jour"
    : 'Prévenir mon cercle';

  const calm = othersCount === 0 && !iAmIn;

  return (
    <View style={CARD}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: calm ? 12 : 10 }}>
        <Icon name="clock" size={15} color={Colors.textPrimary} stroke={2} />
        <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 16, lineHeight: 21, color: Colors.textPrimary, paddingRight: 6, flexShrink: 1 }}>
          {slotTitle(slot)}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginVertical: 10 }} />
      ) : calm ? (
        <>
          <View style={{ flexDirection: 'row' }}>
            {[0, 1, 2].map(i => (
              <View key={i} style={{
                width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0EEEC',
                marginLeft: i > 0 ? -10 : 0, borderWidth: 2, borderColor: '#FFFFFF',
              }} />
            ))}
          </View>
          <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13.5, color: Colors.textPrimary, marginTop: 10 }}>
            Personne ne s'est encore déclaré
          </Text>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 12, color: Colors.textSecondary, marginTop: 4, lineHeight: 17 }}>
            Dis quand tu es libre : tes amis le voient tout de suite. C'est comme ça que les parties se montent.
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -14, marginTop: 12 }}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
          >
            {availabilitySlots().map(s => (
              <Chip key={s.key} label={s.label} on={isSlotActive(s, mine)} onPress={() => onToggleSlot(s)} pill />
            ))}
          </ScrollView>
          <TouchableOpacity onPress={prevenirCercle} activeOpacity={0.85} disabled={!peutPrevenir}
            style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center', marginTop: 10, opacity: peutPrevenir ? 1 : 0.5 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: '#FFFFFF' }}>{texteBouton}</Text>
          </TouchableOpacity>
          {attente > 0 ? (
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 8 }}>
              {`Tu pourras relancer dans ${cooldownLabel(attente)}.`}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          {/* Des cartes qui défilent : on voit tout le monde d'un coup d'œil,
              avec son niveau, et on coche d'un tap. La liste verticale ne
              tenait que deux joueurs à l'écran. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginHorizontal: -14 }}
            contentContainerStyle={{ paddingHorizontal: 14, gap: 10, paddingVertical: 2 }}
          >
            {rows.map(r => {
              const coche = choisis.includes(r.id);
              const plein = !coche && choisis.length >= MAX_SELECTION;
              const avatar = (
                <PlayerAvatar name={r.name} path={r.avatarPath} size={52} backgroundColor={Colors.brand} textColor={Colors.primary}
                  fontFamily={Fonts.uiBlack} fontSize={18} initialsMax={2} />
              );
              return (
                <TouchableOpacity
                  key={r.id}
                  activeOpacity={r.isMe || plein ? 1 : 0.85}
                  disabled={r.isMe || plein}
                  onPress={() => basculer(r.id)}
                  accessibilityLabel={r.isMe ? 'Toi' : `Inviter ${r.name.split(' ')[0]}`}
                  style={{
                    width: 104, borderRadius: 16, paddingVertical: 12, paddingHorizontal: 8,
                    alignItems: 'center', gap: 6,
                    backgroundColor: coche ? 'rgba(255,193,26,0.14)' : Colors.bgCard,
                    borderWidth: coche ? 1.5 : 1,
                    borderColor: coche ? Colors.brand : Colors.border,
                    opacity: plein ? 0.5 : 1,
                  }}>
                  <View>
                    {r.ambassador ? <AmbassadorRing size={52} radius={26} surface={Colors.bgCard} align="center">{avatar}</AmbassadorRing> : avatar}
                    {coche ? (
                      <View style={{
                        position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: 10,
                        backgroundColor: Colors.brand, borderWidth: 2, borderColor: Colors.bgCard,
                        alignItems: 'center', justifyContent: 'center',
                      }}>
                        <Icon name="check" size={11} color={Colors.primary} stroke={3} />
                      </View>
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12.5, color: Colors.textPrimary }}>
                    {r.isMe ? 'Toi' : r.name.split(' ')[0]}
                  </Text>
                  {r.elo != null ? (
                    <View style={{ borderWidth: 1.5, borderColor: Colors.brand, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1 }}>
                      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10.5, color: AMB.chipText }}>{formatPadelLevel(r.elo)}</Text>
                    </View>
                  ) : (
                    <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 10.5, color: Colors.textMuted }}>c'est toi</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, marginBottom: 10 }}>
            <Text style={{ fontFamily: Fonts.uiBold, fontSize: 12, color: Colors.textSecondary }}>
              {/* « 0 joueur dispo demain » sous sa propre photo n'avait pas de
                  sens : quand je suis le seul déclaré, on le dit. */}
              {othersCount === 0 && iAmIn
                ? `Tu es le seul déclaré ${slotShortLabel(slot)}`
                : `${othersCount} joueur${othersCount > 1 ? 's' : ''} dispo${othersCount > 1 ? 's' : ''} ${slotShortLabel(slot)}`}
            </Text>
            {choisis.length > 0 ? (
              <TouchableOpacity onPress={() => setChoisis([])} hitSlop={8}>
                <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11.5, color: Colors.textSecondary }}>Tout décocher</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Cocher des joueurs monte la partie AVEC eux : ils arrivent
              pré-invités dans l'assistant, sur ce créneau. Rien coché, on
              peut quand même ouvrir la création. */}
          <TouchableOpacity onPress={monterLaPartie} activeOpacity={0.85}
            style={{ backgroundColor: '#0A0A0A', borderRadius: 999, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13.5, color: '#FFFFFF' }}>
              {choisis.length > 0
                ? `Monter la partie avec ${choisis.length === 1 ? 'lui' : 'eux'} · ${slotShortLabel(slot)}`
                : `Monter la partie · ${slotShortLabel(slot)}`}
            </Text>
          </TouchableOpacity>
          {/* Le rappel au cercle vit ici AUSSI, en second rôle : il n'existait
              que dans l'état vide, donc il s'en allait à l'instant précis où
              il sert — un joueur s'est déclaré, il en manque deux, c'est le
              moment de sonner chez les autres. Discret pour ne pas concurrencer
              « Monter la partie », qui reste l'action du dessus. */}
          {!sansCercle && (attente > 0 || aPrevenir.length > 0) ? (
            <TouchableOpacity onPress={prevenirCercle} disabled={!peutPrevenir} hitSlop={8}
              style={{ alignSelf: 'center', marginTop: 10 }}>
              <Text style={{
                fontFamily: Fonts.uiExtraBold, fontSize: 11.5,
                color: attente > 0 ? Colors.textMuted : Colors.textPrimary,
              }}>
                {attente > 0 ? `Cercle prévenu · encore ${cooldownLabel(attente)}` : 'Prévenir mon cercle'}
              </Text>
            </TouchableOpacity>
          ) : null}
          {choisis.length === 0 ? (
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, color: Colors.textMuted, textAlign: 'center', marginTop: 8 }}>
              {missing > 0
                ? `Coche les joueurs à inviter — il en faut 3 en plus de toi.`
                : `Coche jusqu'à 3 joueurs : ils arriveront déjà invités.`}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
