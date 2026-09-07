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
import { eloToLevel } from '../../lib/theme';
import { pairsCountLabel, type RegisteredPair, type PairedPlayer } from '../../lib/tournaments';

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
      <View style={{
        width: 46, height: 46, borderRadius: 23,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: p.mine ? Colors.brand : Colors.primary,
      }}>
        <Text style={{
          fontSize: 16, fontFamily: Fonts.uiBlack,
          color: p.mine ? Colors.primary : Colors.textOnDark,
        }}>
          {initiales(p.name)}
        </Text>
      </View>
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

/** La carte d'un binôme, ou d'un joueur qui en cherche un. */
function CartePaire({ pair, onPlayerPress, onJoin }: {
  pair: RegisteredPair;
  onPlayerPress?: (id: string) => void;
  onJoin?: (playerId: string) => void;
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
        <View style={{
          width: 22, height: 22, borderRadius: 11, marginTop: 12,
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: seul ? Colors.borderLight : Colors.brand,
        }}>
          <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: seul ? Colors.textMuted : Colors.primary }}>
            &
          </Text>
        </View>
        {pair.b ? (
          <Joueur p={pair.b} onPress={onPlayerPress} />
        ) : (
          // La moitié vide garde EXACTEMENT la place d'un joueur : les cartes
          // s'alignent, et ce qui manque se voit sans avoir à comparer.
          <View style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 5 }}>
            <View style={{
              width: 46, height: 46, borderRadius: 23,
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

      {pair.waiting && (
        <Text style={{ fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.4, color: Colors.warning, textAlign: 'center' }}>
          EN ATTENTE
        </Text>
      )}

      {seul && onJoin && !pair.a.mine && (
        <TouchableOpacity
          onPress={() => onJoin(pair.a.id)}
          activeOpacity={0.85}
          style={{ backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 8, alignItems: 'center' }}
        >
          <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
            Me proposer
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

export function RegisteredStrip({ pairs, free, onPlayerPress, onJoin, children }: {
  pairs: RegisteredPair[];
  /** Places joueurs encore libres — la carte en pointillés du bout. */
  free: number;
  onPlayerPress?: (playerId: string) => void;
  /** Se proposer à un joueur resté seul. */
  onJoin?: (playerId: string) => void;
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
      backgroundColor: Colors.bgCard, borderRadius: 18, padding: 14, gap: 12,
      borderWidth: 1, borderColor: Colors.border,
      shadowColor: '#0A0A0A', shadowOpacity: 0.04, shadowRadius: 4,
      shadowOffset: { width: 0, height: 1 }, elevation: 1,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="users" size={14} color={Colors.brandDeep} stroke={2.3} />
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.6, color: Colors.textPrimary }}>
          DÉJÀ INSCRITS
        </Text>
        {pairs.length > 0 && (
          <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
            ({pairsCountLabel(pairs)})
          </Text>
        )}
        <View style={{ flex: 1 }} />
        {pairs.length > 0 && (
          <TouchableOpacity onPress={() => setOpen(o => !o)} hitSlop={8}>
            <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiExtraBold, color: Colors.brandDeep }}>
              {open ? 'Réduire' : 'Voir'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

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
                  ? <CartePaire key={p.key} pair={p} onPlayerPress={onPlayerPress} onJoin={onJoin} />
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
