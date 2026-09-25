// components/events/EventsPane.tsx — l'onglet « Événements » de l'entrée.
//
// Le prochain en GRANDE carte jaune, le reste en lignes compactes. Ce n'est
// pas une hiérarchie décorative : à notre échelle il y a un événement, pas
// trente. Une liste de cartes égales donnerait l'impression d'un annuaire
// vide ; une carte en avant donne un rendez-vous.
import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Fonts } from '../../lib/theme';
import {
  eventKindLabel, eventSpotsLabel, eventPriceLabel, eventIsFull,
  type EventRow, type EventsBoard,
} from '../../lib/events';

const JOUR = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const HEURE = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

/** La grande carte : celle qu'on vient voir. */
function ProchainEvenement({ row, onOpen, onJySerai, busy }: {
  row: EventRow; onOpen: () => void; onJySerai: () => void; busy: boolean;
}) {
  const e = row.event;
  const complet = eventIsFull(e.capacity, row.attending);
  const repondu = row.mine !== 'aucun';

  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onOpen} style={{
      backgroundColor: Colors.brand, borderRadius: 22, padding: 16, gap: 10,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 10, fontFamily: Fonts.uiBlack, letterSpacing: 1, color: Colors.primary }}>
          {eventKindLabel(e.kind).toUpperCase()}
        </Text>
        <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, letterSpacing: 1, color: 'rgba(10,10,10,0.55)' }}>
          {JOUR(e.starts_at).toUpperCase()}
        </Text>
      </View>

      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.75}
        style={{ fontSize: 22, fontFamily: Fonts.welcome, color: Colors.primary, paddingRight: 6, alignSelf: 'stretch' }}
      >
        {e.title}
      </Text>

      <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: 'rgba(10,10,10,0.65)' }}>
        {HEURE(e.starts_at)}{e.ends_at ? ` – ${HEURE(e.ends_at)}` : ''}
        {e.club?.name ? ` · ${e.club.name}` : ''}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.primary }}>
            {eventPriceLabel(e.price_mad)} · {eventSpotsLabel(e.capacity, row.attending)}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: Fonts.ui, color: 'rgba(10,10,10,0.55)' }}>
            {row.attending === 0
              ? 'Personne n’a encore répondu'
              : `${row.attending} y ser${row.attending > 1 ? 'ont' : 'a'}`}
          </Text>
        </View>

        {/* Le geste est possible d'ici : ouvrir la fiche pour un seul tap
            serait une étape de plus pour la réponse la plus fréquente. */}
        {repondu ? (
          <View style={{ backgroundColor: 'rgba(10,10,10,0.08)', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }}>
            <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBlack, color: Colors.primary }}>
              {row.mine === 'jy_serai' ? 'Tu y seras' : 'Prévenu'}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={onJySerai}
            disabled={busy}
            style={{ backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, opacity: busy ? 0.6 : 1 }}
          >
            {busy ? <ActivityIndicator color={Colors.textOnDark} size="small" /> : (
              <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                {complet ? 'Me prévenir' : 'J’y serai'}
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

/** Une ligne compacte : date à gauche, ce que c'est au milieu, où j'en suis à droite. */
function LigneEvenement({ row, onOpen }: { row: EventRow; onOpen: () => void }) {
  const e = row.event;
  const annule = e.status === 'ANNULE';

  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onOpen} style={{
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: Colors.bgCard, borderRadius: 16,
      borderWidth: 1, borderColor: Colors.border, padding: 12,
      opacity: annule ? 0.6 : 1,
    }}>
      <View style={{
        width: 46, alignItems: 'center', gap: 1,
        backgroundColor: Colors.bgCardAlt, borderRadius: 10, paddingVertical: 6,
      }}>
        <Text style={{ fontSize: 9, fontFamily: Fonts.uiBlack, letterSpacing: 0.5, color: Colors.textMuted }}>
          {new Date(e.starts_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' }).toUpperCase()}
        </Text>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          {HEURE(e.starts_at)}
        </Text>
      </View>

      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          {e.title}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textSecondary }}>
          {annule
            ? (e.cancel_reason ? `Annulé · ${e.cancel_reason}` : 'Annulé')
            : `${eventKindLabel(e.kind)}${e.club?.name ? ` · ${e.club.name}` : ''} · ${eventPriceLabel(e.price_mad)}`}
        </Text>
      </View>

      {!annule && (row.mine !== 'aucun' || e.kind === 'externe') && (
        <View style={{
          borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4,
          backgroundColor: row.mine === 'jy_serai' ? 'rgba(16,185,129,0.12)' : Colors.bgCardAlt,
        }}>
          <Text style={{
            fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.4,
            color: row.mine === 'jy_serai' ? '#047857' : Colors.textSecondary,
          }}>
            {row.mine === 'jy_serai' ? 'J’Y SERAI' : row.mine === 'me_prevenir' ? 'PRÉVENU' : 'EXTERNE'}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export function EventsPane({ board, busyId, onJySerai }: {
  board: EventsBoard;
  busyId: string | null;
  onJySerai: (row: EventRow) => void;
}) {
  const router = useRouter();
  const ouvrir = (id: string) => router.push(`/events/${id}` as any);

  if (!board.next && board.others.length === 0) {
    // L'état vide est l'état NORMAL à notre échelle : il doit donc expliquer
    // ce qu'on peut y mettre, pas s'excuser d'être vide.
    return (
      <View style={{
        backgroundColor: Colors.bgCard, borderRadius: 18, borderWidth: 1,
        borderColor: Colors.border, borderStyle: 'dashed', padding: 18, gap: 8,
      }}>
        <Text style={{ fontSize: 17, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 6 }}>
          Rien de prévu au club
        </Text>
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 19 }}>
          Une matinée découverte, un stage, un afterwork, une journée portes
          ouvertes : tout ce qui se joue au club sans être une compétition.
          On y répond seul, d’un tap.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {board.next && (
        <ProchainEvenement
          row={board.next}
          busy={busyId === board.next.event.id}
          onOpen={() => ouvrir(board.next!.event.id)}
          onJySerai={() => onJySerai(board.next!)}
        />
      )}
      {board.others.map(row => (
        <LigneEvenement key={row.event.id} row={row} onOpen={() => ouvrir(row.event.id)} />
      ))}
    </View>
  );
}
