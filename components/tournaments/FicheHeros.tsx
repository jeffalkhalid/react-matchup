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
import Svg, { Rect, Line } from 'react-native-svg';
import { Icon } from '../community/icons';
import { FitTitle } from '../DisplayTitle';

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
          <Text numberOfLines={1} style={{ fontSize: 24, lineHeight: 27, fontFamily: Fonts.welcome, color: '#FFFFFF', paddingRight: 8 }}>
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
export function RegistrationCard({ dayLabel, timeLabel, clubLine, distanceLine, taken, total, free, waiting, courts, priceLabel: price, onDirections, onShare, onCalendar }: {
  /** « Ven. 11 sept. » */
  dayLabel: string;
  /** « 19:00 » */
  timeLabel: string;
  /** « Padel Nation · Casablanca » */
  clubLine: string;
  /** « 4,2 km depuis ta position » (lib/geo.distanceSentence). Absente quand
   *  on ne sait pas d'où mesurer, ou que le club n'a pas de position. */
  distanceLine?: string;
  taken: number; total: number; free: number; waiting: number;
  courts: number;
  priceLabel: string;
  /** Ouvre l'itinéraire vers le club. Absent quand il n'y a pas de club. */
  onDirections?: () => void;
  /** Envoie le tournoi à ses partenaires. */
  onShare?: () => void;
  /** Ajoute la soirée à l'agenda du téléphone. */
  onCalendar?: () => void;
}) {
  const ratio = total > 0 ? Math.min(1, taken / total) : 0;
  const plein = free === 0;
  const gratuit = price === 'Gratuit';

  return (
    <View style={{ gap: 12 }}>
      <View style={{
        backgroundColor: Colors.bgCard, borderRadius: 20, padding: 16,
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12,
        shadowOffset: { width: 0, height: 3 }, elevation: 1,
      }}>
        {/* ── Date et heure ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="calendar" size={20} color={ACCENT} stroke={2.2} />
          <FitTitle max={18} min={12} color={Colors.textPrimary}>DATE ET HEURE</FitTitle>
        </View>
        {/* Segment unique (pas de <Text> imbriqué) : adjustsFontSizeToFit
            reste opérant sur Android. Cf. feedback_android_title_clipping. */}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{
          alignSelf: 'stretch', fontSize: 30, lineHeight: 39, fontFamily: Fonts.welcome,
          color: Colors.textPrimary, marginTop: 6, paddingRight: 8,
        }}>
          {`${dayLabel} • ${timeLabel}`}
        </Text>

        {/* Le club mene a l'itineraire : on va y aller en voiture, et
            chercher l'adresse ailleurs est un aller-retour de trop. */}
        <TouchableOpacity
          onPress={onDirections}
          disabled={!onDirections}
          activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}
        >
          <Icon name="mapPin" size={20} color={Colors.textPrimary} stroke={2.2} />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 16, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>
            {clubLine}
          </Text>
          {onDirections && <Icon name="arrowRight" size={16} color={Colors.brandDeep} stroke={2.4} />}
        </TouchableOpacity>

        {distanceLine && (
          <Text numberOfLines={2} style={{ fontSize: 12.5, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, marginTop: 2, marginLeft: 28 }}>
            {distanceLine}
          </Text>
        )}

        <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 14 }} />

        {/* ── Capacité ──
            Les places se comptent en PLACES ASSISES, pas en inscrits : depuis
            la règle du siège-aux-binômes, tout inscrit passe d'abord par la
            file, donc « inscrits » et « places » divergent presque toujours.
            On nomme donc ce qu'on compte. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="users" size={20} color={Colors.textPrimary} stroke={2.2} />
            <FitTitle max={18} min={12} color={Colors.textPrimary}>CAPACITÉ</FitTitle>
          </View>
          <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'baseline' }}>
            <Text style={{ fontSize: 26, lineHeight: 32, fontFamily: Fonts.welcome, color: plein ? Colors.danger : Colors.brand, paddingRight: 3 }}>
              {taken}
            </Text>
            <Text numberOfLines={1} style={{
              fontSize: 18, lineHeight: 24, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 4,
            }}>
              {` / ${total} ${taken > 1 ? 'places occupées' : 'place occupée'}`}
            </Text>
          </View>
        </View>

        <View style={{ height: 10, borderRadius: 999, backgroundColor: '#EDEDEC', overflow: 'hidden', marginTop: 12 }}>
          <View style={{
            width: `${ratio * 100}%`, height: '100%', borderRadius: 999,
            backgroundColor: plein ? Colors.danger : Colors.brand,
          }} />
        </View>

        {/* Ce qui reste, la taille du plateau, le prix. */}
        <View style={{ flexDirection: 'row', alignItems: 'stretch', marginTop: 16 }}>
          <Cell
            icon={<CourtIcon color={Colors.textPrimary} />}
            strong={String(courts)}
            rest={`terrain${courts > 1 ? 's' : ''}`}
          />
          <View style={{ width: 1, backgroundColor: Colors.border }} />
          <Cell
            icon={<Icon name="gem" size={24} color={Colors.textPrimary} stroke={1.9} />}
            strong={price}
            rest={gratuit ? '' : 'par joueur'}
          />
          <View style={{ width: 1, backgroundColor: Colors.border }} />
          <Cell
            icon={<Icon name="users" size={24} color={plein ? Colors.danger : Colors.textPrimary} stroke={1.9} />}
            strong={plein ? 'Complet' : String(free)}
            strongColor={plein ? Colors.danger : Colors.brand}
            rest={plein ? '' : `place${free > 1 ? 's' : ''} restante${free > 1 ? 's' : ''}`}
            sub={waiting > 0 ? `${waiting} en attente` : null}
          />
        </View>
      </View>

      {/* Deux gestes : dire aux autres qu'une soirée existe, et ne pas
          l'oublier soi-même. L'inscription reste le geste principal, en bas
          d'écran. */}
      {(onShare || onCalendar) && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {onShare && (
            <TouchableOpacity
              onPress={onShare}
              activeOpacity={0.8}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                paddingVertical: 13, borderRadius: 16,
                backgroundColor: Colors.bgCard, borderWidth: 2, borderColor: Colors.primary,
              }}
            >
              <Icon name="share" size={20} color={Colors.textPrimary} stroke={2.3} />
              <Text style={{ fontSize: 19, lineHeight: 24, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 3 }}>
                Partager
              </Text>
            </TouchableOpacity>
          )}
          {onCalendar && (
            <TouchableOpacity
              onPress={onCalendar}
              activeOpacity={0.8}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                paddingVertical: 13, borderRadius: 16,
                backgroundColor: Colors.primary, borderWidth: 2, borderColor: Colors.primary,
              }}
            >
              <Icon name="calendar" size={20} color={Colors.textOnDark} stroke={2.3} />
              <Text style={{ fontSize: 19, lineHeight: 24, fontFamily: Fonts.welcome, color: Colors.textOnDark, paddingRight: 3 }}>
                Agenda
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const ACCENT = '#7C3AED';
const CARD_TITLE = {
  fontSize: 18, lineHeight: 23, fontFamily: Fonts.welcome,
  // Majuscules écrites telles quelles, pas `textTransform` : sur Android il
  // rogne les dernières lettres de cette police.
  color: Colors.textPrimary, paddingRight: 6, flexShrink: 1,
};

/** Une case du pied de la carte : icône, chiffre fort, unité. */
function Cell({ icon, strong, rest, strongColor, sub }: {
  icon: React.ReactNode; strong: string; rest: string;
  strongColor?: string; sub?: string | null;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingHorizontal: 4 }}>
      {icon}
      <Text numberOfLines={1} style={{ fontSize: 20, lineHeight: 25, fontFamily: Fonts.welcome, color: strongColor ?? Colors.textPrimary, paddingLeft: 3, paddingRight: 7 }}>
        {strong}
      </Text>
      {rest ? (
        <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 15, fontFamily: Fonts.uiSemi, color: Colors.textSecondary, textAlign: 'center' }}>
          {rest}
        </Text>
      ) : null}
      {sub ? (
        <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>{sub}</Text>
      ) : null}
    </View>
  );
}

/** Un terrain vu du dessus : il n'y a pas d'icône de terrain dans le jeu. */
function CourtIcon({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x="2.5" y="4" width="19" height="16" rx="2" />
      <Line x1="12" y1="4" x2="12" y2="20" />
      <Rect x="2.5" y="8" width="4" height="8" />
      <Rect x="17.5" y="8" width="4" height="8" />
    </Svg>
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
          <Text numberOfLines={1} style={{ fontSize: 19, fontFamily: Fonts.welcome, color: Colors.textPrimary, paddingRight: 7 }}>
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
          flex: 1, backgroundColor: Colors.brand, borderRadius: 27,
          paddingVertical: 16, alignItems: 'center', opacity: disabled || busy ? 0.55 : 1,
        }}
      >
        <Text style={{ fontSize: 17, fontFamily: Fonts.welcome, letterSpacing: 0.5, color: Colors.textOnBrand }}>
          {label}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
