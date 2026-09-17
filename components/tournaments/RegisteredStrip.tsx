// components/tournaments/RegisteredStrip.tsx — « qui est déjà là », en tête de
// la fiche d'un tournoi ouvert. Implémente `design_handoff_tournois`,
// chantier 1, puis la maquette « inscrits par binôme ».
//
// La question qu'on se pose avant de s'inscrire à une soirée n'est pas le
// barème de points : c'est « qui vient ». Elle n'avait aucune réponse — les
// inscrits n'apparaissaient nulle part.
//
// Première réponse : des initiales, puis les prénoms à la suite. Elle disait
// QUI, pas AVEC QUI. Or on ne s'inscrit pas seul à une montante, on s'inscrit
// à deux : la première chose qu'on cherche dans la liste, c'est de savoir qui
// joue avec qui, et s'il reste quelqu'un à prendre comme partenaire.
//
// D'où des CARTES DE BINÔME : deux visages, une esperluette, les niveaux. Un
// joueur encore seul occupe la même carte avec une moitié vide qui invite à
// le rejoindre — c'est la même forme, donc on compare d'un coup d'œil ce qui
// est complet et ce qui ne l'est pas.
//
// Le regroupement (équipe retirée, membre disparu, moitié en file d'attente)
// vit dans lib/tournaments.groupRegistrations avec ses tests. Ici, du rendu.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import { FitTitle } from '../DisplayTitle';
import { PlayerAvatar } from '../PlayerAvatar';
import { eloToLevel } from '../../lib/theme';
import { pairsCountLabel, type RegisteredPair, type PairedPlayer } from '../../lib/tournaments';

// Taille des photos des joueurs. La case « cherche un binôme » et le rond « & »
// entre les deux joueurs en dépendent : ils doivent rester alignés sur elles.
const TAILLE_JOUEUR = 56;

function initiales(name: string): string {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** Un joueur dans une carte : rond, nom, niveau. */
function Joueur({ p, onPress }: { p: PairedPlayer; onPress?: (id: string) => void }) {
  return (
    <TouchableOpacity
      onPress={() => onPress?.(p.id)}
      disabled={!onPress}
      activeOpacity={0.75}
      style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 5 }}
    >
      <PlayerAvatar
        name={p.name} path={p.avatarPath} size={TAILLE_JOUEUR}
        backgroundColor={p.mine ? Colors.brand : Colors.primary}
        textColor={p.mine ? Colors.primary : Colors.textOnDark}
        fontFamily={Fonts.uiBlack} fontSize={20} initialsMax={2}
      />
      <Text numberOfLines={1} style={{
        maxWidth: '100%', fontSize: 12.5,
        fontFamily: p.mine ? Fonts.uiBlack : Fonts.uiExtraBold, color: Colors.textPrimary,
      }}>
        {p.name}
      </Text>
      {/* Le niveau sous le nom : c'est ce qui dit si la soirée est à sa
          portée, et ça ne se lit nulle part ailleurs dans la liste. */}
      <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
        {p.elo != null ? `Niv. ${eloToLevel(p.elo).toFixed(1)}` : '—'}
      </Text>
    </TouchableOpacity>
  );
}

/**
 * La moitié « en attente de réponse » : un ou plusieurs candidats, sous un
 * sablier.
 *
 * PLUSIEURS, parce que rien n'empêche deux personnes de demander le même
 * joueur seul — et c'est même le cas intéressant : celui qui reçoit doit
 * choisir. On en montre DEUX au plus ; au-delà, les ronds deviennent
 * illisibles à cette taille et le compte fait le reste.
 */
function Candidats({ gens, onPress }: {
  gens: PairedPlayer[];
  onPress?: (id: string) => void;
}) {
  const montres = gens.slice(0, 2);
  const reste = gens.length - montres.length;
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
        {montres.map((p, i) => (
          <TouchableOpacity
            key={p.id}
            onPress={() => onPress?.(p.id)}
            disabled={!onPress}
            activeOpacity={0.75}
            style={{
              // Les ronds se chevauchent quand il y en a deux : la carte n'a
              // pas la largeur de deux visages côte à côte.
              marginLeft: i === 0 ? 0 : -14,
              opacity: 0.85,
            }}
          >
            <PlayerAvatar
              name={p.name} path={p.avatarPath} size={TAILLE_JOUEUR}
              backgroundColor={p.mine ? Colors.brand : Colors.primary}
              textColor={p.mine ? Colors.primary : Colors.textOnDark}
              fontFamily={Fonts.uiBlack} fontSize={19} initialsMax={2}
              ring={i === 0 ? undefined : 2} ringColor={Colors.bg}
            />
          </TouchableOpacity>
        ))}
        {reste > 0 && (
          <View style={{
            width: 30, height: 30, borderRadius: 15, marginLeft: -10,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: Colors.borderLight, borderWidth: 2, borderColor: Colors.bg,
          }}>
            <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>
              +{reste}
            </Text>
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={{ maxWidth: '100%', fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.warning }}>
        ⏳ {montres.length === 1 && reste === 0
          ? montres[0].name.split(' ')[0]
          : `${gens.length} demandes`}
      </Text>
      <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
        {gens.length > 1 ? 'à départager' : 'sans réponse'}
      </Text>
    </View>
  );
}

/** La carte d'un binôme, ou d'un joueur qui en cherche un. */
function CartePaire({ pair, onPlayerPress, onJoin, joinLabel }: {
  pair: RegisteredPair;
  onPlayerPress?: (id: string) => void;
  onJoin?: (playerId: string) => void;
  /** « Me proposer » quand je suis inscrit, « M'inscrire avec lui » sinon. */
  joinLabel?: string;
}) {
  const seul = pair.b === null;
  return (
    <View style={{
      flex: 1, minWidth: 0, backgroundColor: Colors.bg, borderRadius: 14,
      paddingVertical: 12, paddingHorizontal: 8, gap: 8,
      borderWidth: 1, borderColor: pair.waiting ? Colors.warning + '55' : Colors.border,
      borderStyle: seul ? 'dashed' : 'solid',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 4 }}>
        <Joueur p={pair.a} onPress={onPlayerPress} />
        {/* Le lien entre les deux DIT SON ÉTAT : l'esperluette jaune pour un
            binôme accepté, un sablier pour une demande encore sans réponse.
            Sans cette distinction, une carte réunie sous sablier se lirait
            comme un binôme formé — et on croirait la place acquise. */}
        <View style={{
          width: 22, height: 22, borderRadius: 11, marginTop: (TAILLE_JOUEUR - 22) / 2,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: seul ? Colors.borderLight
            : pair.tentative ? Colors.warning + '26' : Colors.brand,
          borderWidth: pair.tentative ? 1 : 0, borderColor: Colors.warning + '77',
        }}>
          <Text style={{
            fontSize: pair.tentative ? 10 : 11,
            fontFamily: Fonts.uiBlack,
            color: seul ? Colors.textMuted : pair.tentative ? Colors.warning : Colors.primary,
          }}>
            {pair.tentative ? '⏳' : '&'}
          </Text>
        </View>
        {pair.b ? (
          <Joueur p={pair.b} onPress={onPlayerPress} />
        ) : pair.pending.length > 0 ? (
          // UNE DEMANDE EST EN COURS, ET ELLE ME CONCERNE. Sans ça, deux
          // joueurs qui s'étaient déjà demandés apparaissaient chacun dans sa
          // propre carte « Cherche un binôme » — on croit sa demande perdue,
          // et on en envoie une autre. Le sablier dit qu'il ne manque qu'une
          // réponse.
          <Candidats gens={pair.pending} onPress={onPlayerPress} />
        ) : (
          // La moitié vide garde EXACTEMENT la place d'un joueur : les cartes
          // s'alignent, et ce qui manque se voit sans avoir à comparer.
          <View style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 5 }}>
            <View style={{
              width: TAILLE_JOUEUR, height: TAILLE_JOUEUR, borderRadius: TAILLE_JOUEUR / 2,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.borderDark,
            }}>
              <Icon name="plus" size={17} color={Colors.textMuted} stroke={2.4} />
            </View>
            <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
              Cherche
            </Text>
            <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
              un binôme
            </Text>
          </View>
        )}
      </View>

      {/* Sous sablier, « EN ATTENTE » serait ambigu : on attend une RÉPONSE,
          pas une place. On dit donc ce qu'on attend vraiment. */}
      {pair.tentative ? (
        <Text style={{ fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.4, color: Colors.warning, textAlign: 'center' }}>
          EN ATTENTE DE RÉPONSE
        </Text>
      ) : pair.waiting && (
        <Text style={{ fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.4, color: Colors.warning, textAlign: 'center' }}>
          EN ATTENTE
        </Text>
      )}

      {/* Pas de bouton si une demande est DÉJÀ en cours entre nous : le
          serveur la refuserait (`invite_already_sent`), et proposer un geste
          qui échoue est exactement ce qui vient d'être corrigé ailleurs sur
          cet écran. Le sablier au-dessus dit où on en est. */}
      {seul && onJoin && !pair.a.mine && !pair.pending.some(p => p.mine) && (
        <TouchableOpacity
          onPress={() => onJoin(pair.a.id)}
          activeOpacity={0.85}
          style={{ backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 8, alignItems: 'center' }}
        >
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
            style={{ fontSize: 11.5, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
            {joinLabel ?? 'Me proposer'}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

/** La carte en pointillés des places encore libres. */
function CartePlacesLibres({ free }: { free: number }) {
  return (
    <View style={{
      flex: 1, minWidth: 0, borderRadius: 14, paddingVertical: 18, paddingHorizontal: 10,
      alignItems: 'center', justifyContent: 'center', gap: 5,
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.borderDark,
    }}>
      <Icon name="users" size={20} color={Colors.textMuted} stroke={2} />
      <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.textSecondary, textAlign: 'center' }}>
        {free} place{free > 1 ? 's' : ''} restante{free > 1 ? 's' : ''}
      </Text>
      <Text style={{ fontSize: 10.5, fontFamily: Fonts.ui, color: Colors.textMuted, textAlign: 'center', lineHeight: 14 }}>
        Inscris-toi avec ton binôme{'\n'}ou trouve un partenaire
      </Text>
    </View>
  );
}

export function RegisteredStrip({ pairs, free, onPlayerPress, onJoin, joinLabel, children }: {
  pairs: RegisteredPair[];
  /** Places joueurs encore libres — la carte en pointillés du bout. */
  free: number;
  onPlayerPress?: (playerId: string) => void;
  /** Se proposer à un joueur resté seul. */
  onJoin?: (playerId: string) => void;
  /**
   * Le libellé du bouton — il dépend de MON état.
   *
   * `tournament_join` refuse un appelant non inscrit (`not_registered`), et
   * c'est une règle juste : on ne s'apparie pas depuis l'extérieur. Mais le
   * bouton s'affichait quand même, et un joueur non inscrit qui appuyait
   * recevait « Impossible · Tu n'es pas inscrit à ce tournoi » — un refus pour
   * une condition qu'on ne lui avait jamais annoncée. L'écran dit maintenant
   * ce que le geste va faire, et il le fait.
   */
  joinLabel?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  // Deux par ligne : au-delà, les noms se tronquent et le niveau passe à la
  // ligne — la carte perd ce qui la rend lisible.
  const lignes: (RegisteredPair | null)[][] = [];
  const items: (RegisteredPair | null)[] = [...pairs];
  if (free > 0) items.push(null);
  for (let i = 0; i < items.length; i += 2) lignes.push(items.slice(i, i + 2));

  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: 20, padding: 16, gap: 12,
      shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12,
      shadowOffset: { width: 0, height: 3 }, elevation: 1,
    }}>
      {/* Toute la ligne ouvre / replie la liste (même geste que « Comment ça
          marche ? »), le chevron dit l'état. */}
      <TouchableOpacity
        onPress={() => setOpen(o => !o)}
        disabled={pairs.length === 0}
        activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <Icon name="users" size={22} color={Colors.textPrimary} stroke={2.2} />
        <FitTitle max={19} min={12} color={Colors.textPrimary}>
          {pairs.length > 0 ? `Déjà inscrits (${pairsCountLabel(pairs)})` : 'Déjà inscrits'}
        </FitTitle>
        {pairs.length > 0 && (
          <Icon name="chevronRight" size={20} rotate={open ? 90 : 0} color={Colors.textPrimary} stroke={2.4} />
        )}
      </TouchableOpacity>

      {pairs.length === 0 ? (
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
          Personne encore. Sois le premier.
        </Text>
      ) : open ? (
        <View style={{ gap: 10 }}>
          {lignes.map((ligne, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
              {ligne.map((p, j) => (
                p
                  ? <CartePaire key={p.key} pair={p} onPlayerPress={onPlayerPress} onJoin={onJoin} joinLabel={joinLabel} />
                  : <CartePlacesLibres key={`libre${j}`} free={free} />
              ))}
              {/* Une ligne impaire ne doit pas étirer sa seule carte sur toute
                  la largeur : elle jurerait avec les lignes complètes. */}
              {ligne.length === 1 && <View style={{ flex: 1 }} />}
            </View>
          ))}
        </View>
      ) : (
        <Text numberOfLines={2} style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary, lineHeight: 17 }}>
          {pairs.map(p => (p.b ? `${p.a.name.split(' ')[0]} & ${p.b.name.split(' ')[0]}` : p.a.name.split(' ')[0])).join(' · ')}
        </Text>
      )}

      {children}
    </View>
  );
}

export default RegisteredStrip;
