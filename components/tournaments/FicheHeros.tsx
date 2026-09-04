// components/tournaments/FicheHeros.tsx — les blocs de tête de la fiche
// tournoi, un par phase. Implémente `design_handoff_tournois`, chantier 1.
//
// Le défaut qu'ils corrigent : la fiche rendait ses huit sections dans le même
// ordre quoi qu'il arrive — en-tête, annulation, résultat, la soirée, les
// places, le format, comment ça marche, mon inscription, les joueurs seuls.
// Pendant une soirée, « sur quel terrain je joue » se cherchait donc sous
// quatre cartes de brochure.
//
// Chaque bloc ouvre sur ce que le joueur vient chercher À CE MOMENT-LÀ :
//   avant   -> quand, où, combien de places, et le bouton pour entrer ;
//   pendant -> mon terrain, je monte ou je descends, contre qui, saisir ;
//   après   -> mon rang, mes chiffres, et de quoi partager.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';

// ── Pendant la soirée ──────────────────────────────────────────────────────

export type LiveMovement = 'UP' | 'DOWN' | 'STAY' | null;

/**
 * Le bloc du joueur pendant la soirée : son terrain, son mouvement, son camp,
 * ses adversaires, et la saisie du score.
 *
 * `courtNo` nul = ce joueur ne joue pas ce tour (il a un bye, ou il n'est pas
 * dans le tournoi) : le bloc n'est alors pas rendu du tout, l'écran passe
 * directement au tableau des terrains.
 */
export function LiveHero({ courtNo, movement, movedFrom, mine, theirs, canScore, onScore }: {
  courtNo: number | null;
  movement: LiveMovement;
  /** Le terrain d'où je viens — n'a de sens qu'avec un mouvement. */
  movedFrom: number | null;
  /** « Toi · Jean-Marc » */
  mine: string;
  /** « Sara · Yassine », ou null si j'ai un bye ce tour. */
  theirs: string | null;
  canScore: boolean;
  onScore: () => void;
}) {
  if (courtNo == null) return null;

  // Même mécanisme que MovementBadge de CourtRow : il n'y a pas d'icône
  // arrowUp/arrowDown dans le jeu, on fait pivoter arrowRight.
  const mv =
    movement === 'UP' ? { label: 'TU MONTES', color: Colors.success, bg: 'rgba(16,185,129,0.16)', rotate: -90 }
    : movement === 'DOWN' ? { label: 'TU DESCENDS', color: Colors.danger, bg: 'rgba(239,68,68,0.16)', rotate: 90 }
    : null;

  return (
    <View style={{
      backgroundColor: Colors.heroBg, borderRadius: 20, padding: 14, gap: 12,
      overflow: 'hidden', position: 'relative',
    }}>
      {/* Halo de marque, comme la carte de profil de l'accueil. */}
      <View pointerEvents="none" style={{
        position: 'absolute', top: -70, right: -40, width: 170, height: 170,
        borderRadius: 85, backgroundColor: 'rgba(255,193,26,0.10)',
      }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{
          width: 52, height: 52, borderRadius: 14, backgroundColor: Colors.brand,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 7.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.8, color: Colors.primary }}>
            TERRAIN
          </Text>
          <Text style={{ fontSize: 24, lineHeight: 26, fontFamily: Fonts.display, color: Colors.primary }}>
            {courtNo}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {mv && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 4,
                backgroundColor: mv.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
              }}>
                <Icon name="arrowRight" size={11} rotate={mv.rotate} color={mv.color} stroke={2.6} />
                <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, letterSpacing: 0.5, color: mv.color }}>
                  {mv.label}
                </Text>
              </View>
              {movedFrom != null && (
                <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.5)' }}>
                  depuis le {movedFrom}
                </Text>
              )}
            </View>
          )}

          <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: '#FFFFFF' }}>
            {mine}
          </Text>
          {theirs ? (
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.68)' }}>
              contre <Text style={{ fontFamily: Fonts.uiBlack, color: '#FFFFFF' }}>{theirs}</Text>
            </Text>
          ) : (
            <Text style={{ fontSize: 13.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.68)' }}>
              Tu te reposes ce tour-ci
            </Text>
          )}
        </View>
      </View>

      {/* Le bouton n'existe que s'il y a un match à saisir : sur un bye, il
          n'y a rien à entrer, et un bouton mort vaut moins que pas de bouton. */}
      {canScore && (
        <TouchableOpacity
          onPress={onScore}
          activeOpacity={0.85}
          style={{
            backgroundColor: Colors.brand, borderRadius: 14,
            paddingVertical: 15, alignItems: 'center',
          }}
        >
          <Text style={{ fontSize: 16, fontFamily: Fonts.welcome, letterSpacing: 0.5, color: Colors.primary }}>
            SAISIR LE SCORE
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** Le bandeau de rotation : « ROTATION 3 / 6 » + jauge segmentée. */
export function RoundBanner({ current, total, minutes }: {
  current: number; total: number; minutes: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBlack, letterSpacing: 1, color: 'rgba(255,255,255,0.62)' }}>
        ROTATION {current} / {total}
      </Text>
      <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{
            flex: 1, height: 4, borderRadius: 999,
            backgroundColor: i < current ? Colors.brand : 'rgba(255,255,255,0.18)',
          }} />
        ))}
      </View>
      <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: 'rgba(255,255,255,0.62)' }}>
        {minutes} min
      </Text>
    </View>
  );
}

// ── Après la soirée ────────────────────────────────────────────────────────

/** Mon résultat, en grand — le fait que le joueur vient chercher une fois clos. */
export function ResultHero({ rank, total, partner, climbs, wins, losses, gamesWon, diff, onShare }: {
  rank: number;
  total: number;
  partner: string | null;
  /** Combien de fois je suis monté d'un terrain — null si on ne le sait pas. */
  climbs: number | null;
  wins: number; losses: number; gamesWon: number; diff: number;
  onShare: () => void;
}) {
  const ordinal =
    rank === 1 ? 'PREMIER' : rank === 2 ? 'DEUXIÈME' : rank === 3 ? 'TROISIÈME'
    : `${rank}ᵉ`;

  return (
    <View style={{
      backgroundColor: Colors.heroBg, borderRadius: 20, padding: 16, gap: 14,
      overflow: 'hidden', position: 'relative',
    }}>
      <View pointerEvents="none" style={{
        position: 'absolute', top: -60, left: -30, width: 160, height: 160,
        borderRadius: 80, backgroundColor: 'rgba(255,193,26,0.10)',
      }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{
          width: 66, height: 66, borderRadius: 33, backgroundColor: Colors.brand,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontSize: 28, lineHeight: 30, fontFamily: Fonts.display, color: Colors.primary }}>
            {rank}
          </Text>
          <Text style={{ fontSize: 7.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.6, color: Colors.primary }}>
            SUR {total}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, letterSpacing: 1.2, color: Colors.brand }}>
            TON RÉSULTAT
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 24, lineHeight: 27, fontFamily: Fonts.welcome, color: '#FFFFFF' }}>
            {ordinal}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.62)' }}>
            {partner ? `avec ${partner}` : 'sans binôme'}
            {climbs != null && climbs > 0 ? ` · monté ${climbs} fois` : ''}
          </Text>
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.10)' }} />

      <View style={{ flexDirection: 'row' }}>
        {[
          { v: String(wins), l: 'VICTOIRES', c: '#FFFFFF' },
          { v: String(losses), l: 'DÉFAITES', c: '#FFFFFF' },
          { v: String(gamesWon), l: 'JEUX GAGNÉS', c: '#FFFFFF' },
          { v: diff > 0 ? `+${diff}` : String(diff), l: 'DIFFÉRENCE', c: diff > 0 ? Colors.success : diff < 0 ? Colors.danger : '#FFFFFF' },
        ].map(s => (
          <View key={s.l} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 19, fontFamily: Fonts.display, color: s.c }}>{s.v}</Text>
            <Text style={{ fontSize: 8, fontFamily: Fonts.uiBlack, letterSpacing: 0.5, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
              {s.l}
            </Text>
          </View>
        ))}
      </View>

      <TouchableOpacity
        onPress={onShare}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 14, paddingVertical: 13,
        }}
      >
        <Icon name="share" size={16} color={Colors.brand} stroke={2.4} />
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: '#FFFFFF' }}>
          Partager ma soirée
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Avant la soirée ────────────────────────────────────────────────────────

/**
 * Le bloc d'ouverture d'un tournoi qui prend encore des inscriptions : quand,
 * où, combien de places — et rien d'autre.
 *
 * Il remplace deux cartes empilées (« Les places » et « Le format ») qui
 * répétaient la date et le club déjà présents dans l'en-tête. Ce qui reste ici
 * est ce qui décide : la date, le lieu, et s'il reste de la place.
 */
export function RegistrationCard({ dayLabel, timeLabel, clubLine, taken, total, free, waiting, courts, priceLabel: price }: {
  /** « VEN. 11 SEPT » */
  dayLabel: string;
  /** « 19:00 » */
  timeLabel: string;
  /** « Padel Nation · Casablanca » */
  clubLine: string;
  taken: number; total: number; free: number; waiting: number;
  courts: number;
  priceLabel: string;
}) {
  const ratio = total > 0 ? Math.min(1, taken / total) : 0;
  const plein = free === 0;

  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 18, overflow: 'hidden',
      borderWidth: 1, borderColor: Colors.border,
      shadowColor: '#0A0A0A', shadowOpacity: 0.04, shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 }, elevation: 1,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 }}>
        {/* Bloc horaire, même grammaire que les cartes de partie du Lobby. */}
        <View style={{
          backgroundColor: Colors.heroBg, borderRadius: 14,
          paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center', minWidth: 84,
        }}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{
            fontSize: 9, fontFamily: Fonts.uiBlack, letterSpacing: 0.6, color: Colors.brand,
          }}>
            {dayLabel}
          </Text>
          <Text style={{ fontSize: 21, lineHeight: 25, fontFamily: Fonts.display, color: '#FFFFFF', marginTop: 1 }}>
            {timeLabel}
          </Text>
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Icon name="mapPin" size={12} color={Colors.textMuted} stroke={2.2} />
            <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
              {clubLine}
            </Text>
          </View>

          {/* Les places se comptent en JOUEURS — l'unité de toute l'app. */}
          <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            <Text style={{ fontSize: 22, fontFamily: Fonts.display, color: plein ? Colors.danger : Colors.textPrimary }}>
              {taken}
            </Text>
            {'  '}joueurs sur {total}
          </Text>

          <View style={{ height: 6, borderRadius: 999, backgroundColor: Colors.bg, overflow: 'hidden' }}>
            <View style={{
              width: `${ratio * 100}%`, height: '100%', borderRadius: 999,
              backgroundColor: plein ? Colors.danger : Colors.brand,
            }} />
          </View>
        </View>
      </View>

      {/* Pied : ce qui reste, la taille du plateau, le prix. */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 14, paddingVertical: 11, gap: 8,
        backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.borderLight,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
          <Icon name="users" size={12} color={plein ? Colors.danger : Colors.textSecondary} stroke={2.2} />
          <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            <Text style={{ fontFamily: Fonts.uiBlack, color: plein ? Colors.danger : Colors.textPrimary }}>
              {plein ? 'Complet' : `${free} place${free > 1 ? 's' : ''}`}
            </Text>
            {waiting > 0 ? ` · ${waiting} en attente` : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="racket" size={12} color={Colors.textSecondary} stroke={2.2} />
          <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            {courts} terrain{courts > 1 ? 's' : ''}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="gem" size={12} color={Colors.textSecondary} stroke={2.2} />
          <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            {price}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * La barre d'action fixée en pied d'écran, tant qu'il reste quelque chose à
 * faire. Elle remplace un bouton enterré après cinq sections : le geste
 * principal ne doit pas se mériter au défilement.
 */
export function StickyActionBar({ priceLine, priceNote, label, disabled, busy, onPress, insetBottom }: {
  priceLine: string | null;
  priceNote: string | null;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  onPress: () => void;
  insetBottom: number;
}) {
  return (
    <View style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingTop: 12, paddingBottom: insetBottom + 12,
      backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: Colors.border,
      shadowColor: '#0A0A0A', shadowOpacity: 0.08, shadowRadius: 12,
      shadowOffset: { width: 0, height: -4 }, elevation: 12,
    }}>
      {priceLine && (
        <View style={{ minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 19, fontFamily: Fonts.welcome, color: Colors.textPrimary }}>
            {priceLine}
          </Text>
          {priceNote && (
            <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: Fonts.uiSemi, color: Colors.textMuted }}>
              {priceNote}
            </Text>
          )}
        </View>
      )}
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled || busy}
        activeOpacity={0.85}
        style={{
          flex: 1, backgroundColor: Colors.heroBg, borderRadius: 16,
          paddingVertical: 15, alignItems: 'center', opacity: disabled || busy ? 0.55 : 1,
        }}
      >
        <Text style={{ fontSize: 15.5, fontFamily: Fonts.welcome, letterSpacing: 0.5, color: Colors.textOnDark }}>
          {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
