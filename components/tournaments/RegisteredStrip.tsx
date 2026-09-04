// components/tournaments/RegisteredStrip.tsx — « qui est déjà là », en tête de
// la fiche d'un tournoi ouvert. Implémente `design_handoff_tournois`,
// chantier 1.
//
// La question qu'on se pose avant de s'inscrire à une soirée n'est pas le
// barème de points : c'est « qui vient ». Elle n'avait aucune réponse sur la
// fiche — les inscrits n'apparaissaient nulle part, seuls les joueurs SANS
// binôme étaient listés, tout en bas.
//
// Les initiales empilées SUIVIES DES PRÉNOMS répondent d'un coup d'œil ;
// « Voir les N » déplie la liste complète sur place, sans écran ni modale.
//
// Première version : seules les initiales, et le lien de dépliage n'apparaissait
// qu'au-delà de cinq inscrits. À deux inscrits, on voyait donc deux ronds gris
// et aucun moyen de savoir qui c'était — la question même à laquelle ce bloc
// existe pour répondre.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';

export interface RegisteredPerson {
  id: string;
  name: string;
  /** En liste d'attente : montré à part, il n'a pas (encore) sa place. */
  waiting: boolean;
  mine?: boolean;
}

function Initials({ name, mine, size = 34, overlap }: {
  name: string; mine?: boolean; size?: number; overlap?: boolean;
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: mine ? Colors.brand : Colors.primary,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: Colors.bgCard,
      marginLeft: overlap ? -10 : 0,
    }}>
      <Text style={{
        fontSize: Math.round(size * 0.34), fontFamily: Fonts.uiBlack,
        color: mine ? Colors.primary : Colors.textOnDark,
      }}>
        {(name || '?').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
      </Text>
    </View>
  );
}

export function RegisteredStrip({ people, total, onPlayerPress, children }: {
  people: RegisteredPerson[];
  /** Le nombre de places, en joueurs — pour lire « 12 sur 16 » d'un coup. */
  total: number;
  /** Ouvre le profil d'un inscrit — on veut savoir à qui on a affaire. */
  onPlayerPress?: (playerId: string) => void;
  /** La liste des joueurs seuls, rendue par l'écran sous le bandeau. */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const assis = people.filter(p => !p.waiting);
  const enFile = people.filter(p => p.waiting);
  const apercu = people.slice(0, 5);
  const reste = people.length - apercu.length;

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
        <View style={{ flex: 1 }} />
        {people.length > 0 && (
          <TouchableOpacity onPress={() => setOpen(o => !o)} hitSlop={8}>
            <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiExtraBold, color: Colors.brandDeep }}>
              {open ? 'Réduire' : `Voir les ${people.length}`}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {people.length === 0 ? (
        <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
          Personne encore. Sois le premier.
        </Text>
      ) : !open ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {apercu.map((p, i) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => onPlayerPress?.(p.id)}
                disabled={!onPlayerPress}
                activeOpacity={0.7}
              >
                <Initials name={p.name} mine={p.mine} overlap={i > 0} />
              </TouchableOpacity>
            ))}
            {reste > 0 && (
              <View style={{
                width: 34, height: 34, borderRadius: 17, marginLeft: -10,
                backgroundColor: Colors.bg, borderWidth: 2, borderColor: Colors.bgCard,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontSize: 11, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>
                  +{reste}
                </Text>
              </View>
            )}
          </View>
          {/* Les NOMS, pas seulement des initiales : « qui est inscrit » est
              la question, et deux ronds gris n'y repondent pas. Ils se
              tronquent proprement des que la liste s'allonge, et le
              depliage prend alors le relais. */}
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            {people.map(p => p.name.split(' ')[0]).join(' · ')}
          </Text>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
            {assis.length}/{total}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {people.map(p => (
            <TouchableOpacity
              key={p.id}
              onPress={() => onPlayerPress?.(p.id)}
              disabled={!onPlayerPress}
              activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 }}
            >
              <Initials name={p.name} mine={p.mine} size={30} />
              <Text numberOfLines={1} style={{
                flex: 1, fontSize: 13,
                fontFamily: p.mine ? Fonts.uiBlack : Fonts.uiBold,
                color: Colors.textPrimary,
              }}>
                {p.name}{p.mine ? ' (toi)' : ''}
              </Text>
              {p.waiting && (
                <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiExtraBold, color: Colors.warning }}>
                  EN ATTENTE
                </Text>
              )}
              {onPlayerPress && (
                <Icon name="chevronRight" size={15} color={Colors.textMuted} stroke={2.2} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {children}
    </View>
  );
}

export default RegisteredStrip;
