// components/admin/DisputeEvidence.tsx — les deux versions d'un score en face
// l'une de l'autre, avec le score enregistré en direct comme tiers.
// Implémente `design_handoff_panel_arbitre`, fiche de décision de litige.
//
// La carte de litige donnait « Initial : 6-3, 7-5 » barré et « Contesté :
// 6-3, 5-7 » en dessous. Pour savoir OÙ se situe le désaccord, l'arbitre
// lisait deux chaînes de caractères et les comparait de tête — et devait
// ensuite retaper le score à la main.
//
// Le tableau met les sets en colonnes : la ligne qui diverge saute aux yeux,
// et la troisième colonne apporte la seule pièce neutre du dossier, le score
// que l'app a enregistré elle-même pendant le match. Un bouton par version
// remplit le champ, au lieu de le retaper.
//
// Tout le calcul — et surtout la remise des trois sources dans le même sens,
// où « 6-3 » et « 3-6 » ne doivent jamais être confondus — vit dans
// lib/disputeEvidence.ts avec ses tests. Ici, il n'y a que du rendu.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { setsToText, type EvidenceRow, type SetPair, type Verdict } from '../../lib/disputeEvidence';

const TONE: Record<Verdict['supports'], string> = {
  initial: Colors.info,
  counter: Colors.warning,
  neither: Colors.danger,
  none: Colors.textMuted,
};

function Cell({ pair, tone, strong }: { pair: SetPair | null; tone?: string; strong?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{
        fontSize: 13,
        fontFamily: strong ? Fonts.uiBlack : Fonts.uiBold,
        color: tone ?? (pair ? Colors.textPrimary : Colors.textMuted),
      }}>
        {/* Un tiret plutôt qu'une case vide : « ce set n'existe pas dans cette
            version » est une information, pas une absence de mise en page. */}
        {pair ? `${pair.a}-${pair.b}` : '—'}
      </Text>
    </View>
  );
}

/**
 * La confiance d'un camp. Elle n'accuse personne : elle dit lequel des deux
 * a l'historique le plus mince, ce qui ne compte que lorsque rien d'autre ne
 * departage. Absente quand la valeur est inconnue, plutot qu'affichee a 0 %.
 */
function Trust({ value }: { value: number | null }) {
  if (value === null) return null;
  const tone = value >= 70 ? Colors.success : value >= 45 ? Colors.warning : Colors.danger;
  return (
    <Text style={{ fontSize: 9, fontFamily: Fonts.uiExtraBold, letterSpacing: 0.3, color: tone }}>
      CONFIANCE {value} %
    </Text>
  );
}

/**
 * Le passé du camp en matière de contestation.
 *
 * La confiance dit ce qu'un joueur vaut en général ; ceci dit ce qu'il fait
 * DANS CETTE SITUATION-LÀ. Un camp sans passé n'affiche RIEN : une ligne
 * « aucun antécédent » suggérerait qu'on a ouvert un dossier sur lui.
 */
function History({ text, align }: { text: string; align?: 'right' }) {
  if (!text) return null;
  return (
    <Text
      numberOfLines={1}
      style={{
        fontSize: 8.5, fontFamily: Fonts.uiBold, color: Colors.textMuted,
        textAlign: align === 'right' ? 'right' : 'left',
      }}
    >
      {text}
    </Text>
  );
}

/** Un bouton « retenir cette version », qui remplit le champ de score. */
function UseButton({ label, text, reverses, onUse }: {
  label: string; text: string; reverses: boolean; onUse: (t: string) => void;
}) {
  return (
    <TouchableOpacity
      onPress={() => onUse(text)}
      activeOpacity={0.85}
      style={{
        flex: 1, borderRadius: 11, paddingVertical: 9, paddingHorizontal: 6,
        alignItems: 'center', gap: 2,
        backgroundColor: Colors.bg, borderWidth: 1,
        borderColor: reverses ? Colors.danger + '66' : Colors.border,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.4, color: Colors.textMuted }}>
        {label.toUpperCase()}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
        {text}
      </Text>
      {/* Retenir une version qui renverse le vainqueur ne change pas que le
          score : forcer la validation garderait le vainqueur enregistré et
          écrirait une ligne incohérente. Le bouton le dit avant le clic. */}
      {reverses && (
        <Text numberOfLines={1} style={{ fontSize: 8.5, fontFamily: Fonts.uiExtraBold, color: Colors.danger }}>
          CHANGE LE VAINQUEUR
        </Text>
      )}
    </TouchableOpacity>
  );
}

export function DisputeEvidence({
  rows, verdict, winnerSide, loserSide, winnerTrust, loserTrust,
  winnerHistory, loserHistory, hasLive,
  counterReverses, liveReverses, onUse,
}: {
  rows: EvidenceRow[];
  verdict: Verdict;
  /** Les noms des deux camps, dans le sens du tableau. */
  winnerSide: string;
  loserSide: string;
  /** La confiance moyenne de chaque camp. `null` = pas de valeur connue. */
  winnerTrust: number | null;
  loserTrust: number | null;
  /** Le passé de chaque camp en matière de contestation. Vide = rien à dire. */
  winnerHistory: string;
  loserHistory: string;
  hasLive: boolean;
  counterReverses: boolean;
  liveReverses: boolean;
  onUse: (text: string) => void;
}) {
  const initial = rows.map(r => r.initial).filter(Boolean) as SetPair[];
  const counter = rows.map(r => r.counter).filter(Boolean) as SetPair[];
  const live = rows.map(r => r.live).filter(Boolean) as SetPair[];
  const tone = TONE[verdict.supports];

  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 14, padding: 12, gap: 10,
      borderWidth: 1, borderColor: Colors.border,
    }}>
      {/* La conclusion AVANT le tableau : l'arbitre lit une phrase, puis
          vérifie sur les chiffres — pas l'inverse. */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: tone + '18', borderRadius: 10, padding: 9,
      }}>
        <Icon
          name={verdict.supports === 'neither' ? 'x' : verdict.supports === 'none' ? 'clock' : 'check'}
          size={14}
          color={tone}
          stroke={2.6}
        />
        <Text style={{ flex: 1, fontSize: 11.5, fontFamily: Fonts.uiExtraBold, color: tone, lineHeight: 16 }}>
          {verdict.label}
        </Text>
      </View>

      {/* Qui est à gauche, qui est à droite — sans ça, « 6-3 » ne veut rien
          dire : c'est la question même sur laquelle porte la moitié des
          litiges. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: Fonts.uiBlack, color: Colors.success }}>
            {winnerSide}
          </Text>
          <Trust value={winnerTrust} />
          <History text={winnerHistory} />
        </View>
        <Text style={{ fontSize: 9.5, fontFamily: Fonts.uiBold, color: Colors.textMuted, marginTop: 1 }}>
          à gauche · à droite
        </Text>
        <View style={{ flex: 1, gap: 1, alignItems: 'flex-end' }}>
          <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: Fonts.uiBlack, color: Colors.danger }}>
            {loserSide}
          </Text>
          <Trust value={loserTrust} />
          <History text={loserHistory} align="right" />
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 4 }}>
          <Text style={{ width: 34, fontSize: 9, fontFamily: Fonts.uiBlack, letterSpacing: 0.5, color: Colors.textMuted }}>
            SET
          </Text>
          {['SAISI', 'CONTESTÉ', 'DIRECT'].map((h, i) => (
            <Text key={h} style={{
              flex: 1, textAlign: 'center', fontSize: 9, fontFamily: Fonts.uiBlack,
              letterSpacing: 0.5, color: i === 2 && !hasLive ? Colors.borderDark : Colors.textMuted,
            }}>
              {h}
            </Text>
          ))}
        </View>

        {rows.map(r => (
          <View
            key={r.set}
            style={{
              flexDirection: 'row', alignItems: 'center',
              paddingVertical: 6, borderRadius: 8,
              // Le set litigieux est teinté : c'est la seule ligne qu'on
              // regarde vraiment, elle ne doit pas se chercher.
              backgroundColor: r.differs ? Colors.warning + '14' : 'transparent',
            }}
          >
            <Text style={{ width: 34, paddingLeft: 6, fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>
              {r.set}
            </Text>
            <Cell pair={r.initial} strong={r.liveBacks === 'initial'} tone={r.liveBacks === 'initial' ? Colors.success : undefined} />
            <Cell pair={r.counter} strong={r.liveBacks === 'counter'} tone={r.liveBacks === 'counter' ? Colors.success : undefined} />
            <Cell pair={r.live} strong={!!r.live} tone={r.live ? Colors.info : undefined} />
          </View>
        ))}
      </View>

      {!hasLive && (
        <Text style={{ fontSize: 10.5, fontFamily: Fonts.ui, color: Colors.textMuted, lineHeight: 15 }}>
          Ce match n'a pas été marqué en direct dans l'app : il n'y a pas de
          troisième source pour départager.
        </Text>
      )}

      <View style={{ gap: 5 }}>
        <Text style={{ fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.5, color: Colors.textMuted }}>
          RETENIR UNE VERSION
        </Text>
        <View style={{ flexDirection: 'row', gap: 7 }}>
          {initial.length > 0 && (
            <UseButton label="Saisi" text={setsToText(initial)} reverses={false} onUse={onUse} />
          )}
          {counter.length > 0 && (
            <UseButton label="Contesté" text={setsToText(counter)} reverses={counterReverses} onUse={onUse} />
          )}
          {live.length > 0 && (
            <UseButton label="Direct" text={setsToText(live)} reverses={liveReverses} onUse={onUse} />
          )}
        </View>
      </View>
    </View>
  );
}

export default DisputeEvidence;
