// components/activity/ClashOutcome.tsx — l'après-match d'une carte de prono.
//
// Le même résultat s'affiche dans DEUX blocs : « Qui va gagner ? » (le verdict
// de mon pronostic) et « Prono des PAGUISTES » (ce qu'ils avaient vu de mon
// match). Les phrases diffèrent, le dessin non — d'où un seul composant.
// Deux rendus maison pour un même résultat, c'est le piège qu'on a déjà payé
// ailleurs dans l'app.
//
// Ce fichier ne décide de rien : les appelants lui passent des mots et un ton,
// il les met en page. Les règles (qui a gagné, mon verdict, la part des
// PAGUISTES) vivent dans lib/clashResult.ts, pures et testées.
import { View, Text } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import type { ClashPhase } from '../../lib/clashResult';

const BLANC_60 = 'rgba(255,255,255,0.6)';
const BLANC_45 = 'rgba(255,255,255,0.45)';
const BLANC_08 = 'rgba(255,255,255,0.08)';
const VERT_DOUX = 'rgba(16,185,129,0.14)';
const ROUGE_DOUX = 'rgba(239,68,68,0.14)';

/** La couleur d'un verdict : juste, raté, ou rien à trancher. */
export type OutcomeTone = 'juste' | 'rate' | 'neutre';

/**
 * La pastille d'état, à droite de la ligne d'en-tête.
 *
 * Rien pour une partie à venir : la date suffit, et une pastille « À VENIR »
 * répéterait ce qu'on vient de lire.
 */
export function PhasePill({ phase }: { phase: ClashPhase }) {
  if (phase === 'a_venir') return null;
  const enCours = phase === 'en_cours';
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: enCours ? 'rgba(239,68,68,0.18)' : BLANC_08,
      borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
    }}>
      {enCours ? (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.danger }} />
      ) : (
        <Icon name="clock" size={10} color={BLANC_60} stroke={2.4} />
      )}
      <Text numberOfLines={1} style={{
        fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.6,
        color: enCours ? Colors.danger : BLANC_60,
      }}>
        {enCours ? 'MATCH EN COURS' : 'TERMINÉ'}
      </Text>
    </View>
  );
}

/**
 * La répartition des avis, nommée des deux côtés.
 *
 * Elle remplace les deux « % » posés sous chaque paire : ceux-là donnaient le
 * chiffre sans dire de quel côté on l'avait lu, et il fallait retrouver la
 * paire au-dessus pour le comprendre. Une seule représentation de la
 * répartition dans toute l'app, celle-ci.
 */
export function CrowdBar({ labelA, labelB, shareA, highlight }: {
  labelA: string;
  labelB: string;
  /** Part du camp A, en pourcentage entier. B reçoit le reste. */
  shareA: number;
  /** Le camp mis en avant : mon prono avant le match, le vainqueur après. */
  highlight?: 'A' | 'B' | null;
}) {
  const teinteA = highlight === 'A' ? Colors.brand : BLANC_60;
  const teinteB = highlight === 'B' ? Colors.brand : BLANC_60;
  return (
    <View style={{ marginTop: 10, gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.uiSemi, fontSize: 10, color: BLANC_45 }}>
          {labelA}
        </Text>
        <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontFamily: Fonts.uiSemi, fontSize: 10, color: BLANC_45 }}>
          {labelB}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: teinteA }}>{`${shareA} %`}</Text>
        <View style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: BLANC_08, overflow: 'hidden', flexDirection: 'row' }}>
          <View style={{ width: `${shareA}%`, backgroundColor: highlight === 'A' ? Colors.brand : 'rgba(255,255,255,0.28)' }} />
          <View style={{ flex: 1, backgroundColor: highlight === 'B' ? Colors.brand : 'rgba(255,255,255,0.14)' }} />
        </View>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: teinteB }}>{`${100 - shareA} %`}</Text>
      </View>
    </View>
  );
}

/**
 * Ce qu'il reste à dire une fois le match joué : qui a gagné, de combien, et
 * ce que ça fait au pronostic.
 *
 * `winnerLabel` peut être absent : quand les vainqueurs ne se rangent pas d'un
 * seul côté des paires pronostiquées (un joueur a changé de partenaire à la
 * saisie du score), on montre le score et on se tait sur le verdict.
 */
export function ClashOutcome({ winnerLabel, scoreText, message, tone = 'neutre', crowd }: {
  winnerLabel?: string | null;
  scoreText: string;
  /** La phrase du verdict. Absente, la boîte ne s'affiche pas. */
  message?: string | null;
  tone?: OutcomeTone;
  /** Part des PAGUISTES qui avaient choisi les vainqueurs. */
  crowd?: number | null;
}) {
  const couleur = tone === 'juste' ? Colors.success : tone === 'rate' ? Colors.danger : BLANC_60;
  const fond = tone === 'juste' ? VERT_DOUX : tone === 'rate' ? ROUGE_DOUX : BLANC_08;
  return (
    <View style={{ marginTop: 10, gap: 8 }}>
      {winnerLabel ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          backgroundColor: 'rgba(255,193,26,0.16)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.45)',
          borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10,
        }}>
          <Icon name="trophy" size={13} color={Colors.brand} stroke={2.2} />
          <Text numberOfLines={1} style={{ flex: 1, textAlign: 'center', fontFamily: Fonts.uiBlack, fontSize: 12, color: Colors.brand }}>
            {`${winnerLabel.toUpperCase()} GAGNENT`}
          </Text>
        </View>
      ) : null}

      {scoreText ? (
        <Text numberOfLines={1} style={{
          fontFamily: Fonts.uiBlack, fontSize: 19, letterSpacing: 0.5,
          color: '#FFFFFF', textAlign: 'center',
        }}>
          {scoreText}
        </Text>
      ) : null}

      {message ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 7,
          backgroundColor: fond, borderWidth: 1, borderColor: tone === 'neutre' ? BLANC_08 : couleur,
          borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10,
        }}>
          <Icon
            name={tone === 'juste' ? 'check' : tone === 'rate' ? 'x' : 'users'}
            size={13} color={couleur} stroke={2.4}
          />
          <Text style={{ flex: 1, fontFamily: Fonts.uiExtraBold, fontSize: 11.5, lineHeight: 15, color: couleur }}>
            {message}
          </Text>
        </View>
      ) : null}

      {crowd != null ? (
        <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, lineHeight: 15, color: BLANC_60, textAlign: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiBlack, color: Colors.brand }}>{`${crowd} % `}</Text>
          des PAGUISTES avaient vu juste
        </Text>
      ) : null}
    </View>
  );
}
