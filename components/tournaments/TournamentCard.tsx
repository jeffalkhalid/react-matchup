// components/tournaments/TournamentCard.tsx — la carte d'un tournoi.
//
// Conventions reprises telles quelles du Lobby (app/(tabs)/lobby.tsx) : carte
// blanche rayon 18 + bordure + ombre légère, bloc horaire proéminent à gauche,
// pastilles du système <Pill> partagé, bandeau d'infos gris en pied de carte.
// Aucun style inventé ici.

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Pill } from '../Pill';
import { Icon } from '../community/icons';
import {
  type Tournament, type TournamentRegistration,
  seatsLabel, waitlistCount,
  levelRangeLabel, priceLabel, statusLabel, statusTone, tournamentPhase, freePlaces, dateBucket,
} from '../../lib/tournaments';

// Décompose la date en label (« AUJOURD'HUI » / « DEMAIN » / date courte) +
// heure « HH:MM » — même bloc horaire que les cartes de partie du Lobby.
// Le calcul « aujourd'hui / demain » passe par `dateBucket` (lib/tournaments.ts,
// TESTÉ) — avant cette correction, cette fonction portait son PROPRE calcul,
// séparé de celui de `formatTournamentDate`, ni l'un ni l'autre testé.
function splitDate(iso: string): { label: string; tone: 'today' | 'tomorrow' | 'other'; time: string } {
  const d = new Date(iso);
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const bucket = dateBucket(iso);
  if (bucket === 'today') return { label: "AUJOURD'HUI", tone: 'today', time };
  if (bucket === 'tomorrow') return { label: 'DEMAIN', tone: 'tomorrow', time };
  return {
    label: d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase(),
    tone: 'other',
    time,
  };
}

// La couleur passe désormais par `statusTone` (lib/tournaments.ts) — SOURCE
// UNIQUE partagée avec la fiche (app/tournaments/[id].tsx) et l'admin
// (app/(tabs)/admin.tsx TournamentManage) : avant, COMPLET était orange ici,
// gris sur la fiche, vert dans l'admin — trois vérités pour le même mot.
function StatusPill({ t }: { t: Tournament }) {
  return <Pill variant={statusTone(t.status)}>{statusLabel(t.status)}</Pill>;
}

function Info({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {icon}
      <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>{children}</Text>
    </View>
  );
}

export function TournamentCard({ tournament, registrations, mine, onPress }: {
  tournament: Tournament;
  /** Les inscriptions DE CE TOURNOI. Les places se comptent en JOUEURS. */
  registrations: TournamentRegistration[];
  /** Je suis inscrit (assis ou en file) — pastille d'appartenance. */
  mine?: boolean;
  onPress: () => void;
}) {
  const t = tournament;
  const date = splitDate(t.starts_at);
  const waiting = waitlistCount(registrations);
  const phase = tournamentPhase(t.status);
  // Une seule source pour « plus de place » : freePlaces(), la même que la
  // fiche. `taken >= total` mentait dès qu'une file existait — un binôme trop
  // grand pour les derniers sièges est dépassé par la file (règle du serveur),
  // donc taken < total alors que plus personne n'entre directement.
  const full = freePlaces(registrations, t.court_count) === 0;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={cs.card}>
      <View style={{ flexDirection: 'row', padding: 12, gap: 12 }}>
        {/* Bloc horaire */}
        <View style={{
          width: 62, borderRadius: 12, paddingVertical: 8, alignItems: 'center',
          backgroundColor: date.tone === 'other' ? Colors.bg : Colors.primary,
          borderWidth: 1, borderColor: date.tone === 'other' ? Colors.border : Colors.primary,
        }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{
            fontSize: 8, letterSpacing: 0.4, textTransform: 'uppercase', fontFamily: Fonts.uiBlack,
            color: date.tone === 'other' ? Colors.textMuted : Colors.brand,
          }}>
            {date.label}
          </Text>
          <Text style={{
            fontSize: 17, fontFamily: Fonts.uiBlack, marginTop: 1,
            color: date.tone === 'other' ? Colors.textPrimary : Colors.textOnDark,
          }}>
            {date.time}
          </Text>
        </View>

        {/* Titre + club + pastilles */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={{
            fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, lineHeight: 19,
          }}>
            {t.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
            <Icon name="mapPin" size={11} color={Colors.textMuted} stroke={2.2} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary }}>
              {t.club?.name ?? 'Club à confirmer'}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 7 }}>
            <StatusPill t={t} />
            {mine && <Pill variant="success">Inscrit</Pill>}
            <Pill variant="ink">{levelRangeLabel(t.level_min, t.level_max)}</Pill>
          </View>
        </View>
      </View>

      {/* Bandeau d'infos — places EN JOUEURS, terrains, prix */}
      <View style={cs.infoRow}>
        <Info icon={<Icon name="users" size={12} color={full ? Colors.danger : Colors.textSecondary} stroke={2.2} />}>
          <Text style={{ color: full ? Colors.danger : Colors.textPrimary, fontFamily: Fonts.uiBlack }}>
            {seatsLabel(registrations, t.court_count)}
          </Text>
          {' joueurs'}
          {waiting > 0 ? ` · ${waiting} en attente` : ''}
        </Info>
        <Info icon={<Icon name="racket" size={12} color={Colors.textSecondary} stroke={2.2} />}>
          {t.court_count} terrain{t.court_count > 1 ? 's' : ''}
        </Info>
        <Info icon={<Icon name="trophy" size={12} color={Colors.textSecondary} stroke={2.2} />}>
          {phase === 'past' ? `${t.round_count} rotations` : priceLabel(t.price_mad)}
        </Info>
      </View>
    </TouchableOpacity>
  );
}

// StyleSheet (et non classes NativeWind) : motif de lobby.tsx `cs`.
const cs = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard, borderRadius: 18,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    shadowColor: Colors.textPrimary, shadowOpacity: 0.04, shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
});

export default TournamentCard;
