// components/home/HomeTournaments.tsx — la section « Tournois ouverts » de
// l'accueil. Implémente le handoff design `design_handoff_home_tournaments`
// (direction 1C), dont les valeurs de couleur, typo, rayon et espacement sont
// reprises telles quelles.
//
// Pourquoi cette forme plutôt qu'un bandeau : la version précédente était un
// second aplat jaune juste sous « Trouver un match ». Les deux se disputaient
// le même accent, le tournoi criait plus fort que l'action principale, et rien
// ne disait ni l'échéance ni les places restantes.
//
// Trois états, comme la maquette :
//   0 soirée  -> `null`. Pas d'état vide, pas de placeholder : l'accueil
//                redevient exactement ce qu'il était, et les `flex` existants
//                absorbent la place.
//   1 soirée  -> une carte pleine largeur, mise en page horizontale.
//   2 et plus -> un carrousel horizontal, la première à la une (sombre), les
//                suivantes en version claire — l'alternance dit d'un coup
//                d'œil laquelle est mise en avant.
//
// TROIS ÉCARTS ASSUMÉS avec le handoff, tous parce que le produit dit autre
// chose que la maquette :
//   * la jauge compte en JOUEURS (12/16), pas en binômes (6/8). Toute l'app
//     compte en joueurs depuis le règlement ; deux unités pour la même chose
//     est précisément la divergence qui a coûté le plus cher sur ce chantier ;
//   * « S'inscrire » OUVRE LA FICHE au lieu d'inscrire en un tap : s'inscrire
//     exige de choisir son côté et son mode de consentement, donc une feuille ;
//   * un tournoi complet n'a pas un bouton mort : le serveur accepte la liste
//     d'attente, donc le bouton reste vivant et le dit.
import React from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import {
  daysUntilLabel, shortFormatLabel, formatTournamentDate,
  type HomeTournamentEntry,
} from '../../lib/tournaments';

const CARD_W = 258;
const CARD_GAP = 10;
// La marge horizontale de la colonne de l'accueil (app/(tabs)/index.tsx) : le
// carrousel doit la franchir pour que la carte suivante depasse au lieu d'etre
// coupee. Si cette valeur change la-bas, elle doit changer ici.
const EDGE = 20;

function ctaLabel(e: HomeTournamentEntry): string {
  if (e.state === 'registered') return 'INSCRIT ✓';
  if (e.state === 'waitlisted') return 'EN ATTENTE';
  return e.taken >= e.total ? 'LISTE D’ATTENTE' : 'S’INSCRIRE';
}

/** Jauge de remplissage — piste + barre, aux couleurs du fond qui la porte. */
function Gauge({ taken, total, dark }: { taken: number; total: number; dark: boolean }) {
  const ratio = total > 0 ? Math.min(1, taken / total) : 0;
  return (
    <View style={{ flex: 1, height: 4, borderRadius: 999, overflow: 'hidden', backgroundColor: dark ? 'rgba(255,255,255,0.14)' : Colors.borderLight }}>
      <View style={{ width: `${ratio * 100}%`, height: '100%', borderRadius: 999, backgroundColor: dark ? Colors.brand : Colors.brandDeep }} />
    </View>
  );
}

/** La carte du carrousel — sombre « à la une », claire pour les suivantes. */
function CarouselCard({ entry, dark, onOpen }: {
  entry: HomeTournamentEntry; dark: boolean; onOpen: () => void;
}) {
  const t = entry.tournament;
  const titre = dark ? '#FFFFFF' : Colors.textPrimary;
  const meta  = dark ? 'rgba(255,255,255,0.5)' : Colors.textMuted;
  const date  = dark ? 'rgba(255,255,255,0.62)' : Colors.textSecondary;

  return (
    <TouchableOpacity
      onPress={onOpen}
      activeOpacity={0.88}
      style={{
        width: CARD_W, borderRadius: 20, overflow: 'hidden', position: 'relative',
        paddingVertical: 10, paddingHorizontal: 12, gap: 7,
        backgroundColor: dark ? Colors.heroBg : Colors.bgCard,
        borderWidth: dark ? 0 : 1, borderColor: Colors.border,
        shadowColor: dark ? '#000' : '#0F172A', shadowOpacity: dark ? 0.18 : 0.06,
        shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 3,
      }}
    >
      {/* Liseré de marque sur le flanc gauche. */}
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: Colors.brand }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 8.5, fontFamily: Fonts.uiBlack, letterSpacing: 1.2, color: meta }}>
          {shortFormatLabel(t.level_min, t.level_max)}
        </Text>
        <View style={{
          borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2,
          backgroundColor: dark ? Colors.brand : Colors.borderLight,
        }}>
          <Text style={{ fontSize: 9, fontFamily: Fonts.uiBlack, color: dark ? Colors.primary : Colors.textSecondary }}>
            {daysUntilLabel(t.starts_at)}
          </Text>
        </View>
      </View>

      <Text numberOfLines={1} style={{ fontSize: 19, lineHeight: 20, fontFamily: Fonts.welcome, letterSpacing: 0.3, color: titre }}>
        {t.name}
      </Text>

      <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: Fonts.uiSemi, color: date }}>
        {formatTournamentDate(t.starts_at)}
        {t.club?.name ? ` · ${t.club.name}` : ''}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Gauge taken={entry.taken} total={entry.total} dark={dark} />
        <Text style={{ fontSize: 9.5, fontFamily: Fonts.uiExtraBold, color: dark ? Colors.brand : Colors.brandDeep }}>
          {entry.taken}/{entry.total}
        </Text>
      </View>

      <View style={{
        borderRadius: 12, paddingVertical: 7, alignItems: 'center',
        backgroundColor: entry.state === 'open' ? Colors.brand : 'transparent',
        borderWidth: entry.state === 'open' ? 0 : 1.5,
        borderColor: dark ? 'rgba(255,255,255,0.35)' : Colors.primary,
      }}>
        <Text style={{
          fontSize: 13, fontFamily: Fonts.welcome, letterSpacing: 0.4,
          color: entry.state === 'open' ? Colors.primary : titre,
        }}>
          {ctaLabel(entry)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/** La carte pleine largeur — quand il n'y a qu'une seule soirée annoncée. */
function WideCard({ entry, onOpen }: { entry: HomeTournamentEntry; onOpen: () => void }) {
  const t = entry.tournament;
  const restantes = Math.max(0, entry.total - entry.taken);

  return (
    <TouchableOpacity
      onPress={onOpen}
      activeOpacity={0.88}
      style={{
        flex: 1, borderRadius: 20, overflow: 'hidden', position: 'relative',
        backgroundColor: Colors.heroBg,
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingTop: 9, paddingBottom: 9, paddingLeft: 16, paddingRight: 14,
        shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 }, elevation: 3,
      }}
    >
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: Colors.brand }} />

      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: 8.5, fontFamily: Fonts.uiBlack, letterSpacing: 1.2, color: 'rgba(255,255,255,0.5)' }}>
            {shortFormatLabel(t.level_min, t.level_max)}
          </Text>
          <View style={{ borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2, backgroundColor: Colors.brand }}>
            <Text style={{ fontSize: 9, fontFamily: Fonts.uiBlack, color: Colors.primary }}>
              {daysUntilLabel(t.starts_at)}
            </Text>
          </View>
        </View>

        <Text numberOfLines={1} style={{ fontSize: 21, lineHeight: 22, fontFamily: Fonts.welcome, letterSpacing: 0.3, color: '#FFFFFF' }}>
          {t.name}
        </Text>

        <Text numberOfLines={1} style={{ fontSize: 10.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.62)' }}>
          {formatTournamentDate(t.starts_at)}
          {t.club?.name ? ` · ${t.club.name}` : ''}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Gauge taken={entry.taken} total={entry.total} dark />
          <Text numberOfLines={1} style={{ fontSize: 10, fontFamily: Fonts.uiExtraBold, color: Colors.brand }}>
            {entry.state === 'registered' ? 'Tu es inscrit'
              : entry.state === 'waitlisted' ? 'En liste d’attente'
              : restantes > 0 ? `${restantes} place${restantes > 1 ? 's' : ''} restante${restantes > 1 ? 's' : ''}`
              : 'Complet — liste d’attente'}
          </Text>
        </View>
      </View>

      <View style={{
        borderRadius: 13, paddingHorizontal: 12, paddingVertical: 10,
        backgroundColor: entry.state === 'open' ? Colors.brand : 'transparent',
        borderWidth: entry.state === 'open' ? 0 : 1.5, borderColor: 'rgba(255,255,255,0.35)',
      }}>
        <Text style={{
          fontSize: 13, fontFamily: Fonts.welcome, letterSpacing: 0.4,
          color: entry.state === 'open' ? Colors.primary : '#FFFFFF',
        }}>
          {ctaLabel(entry)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export function HomeTournaments({ entries, onOpen, onSeeAll }: {
  entries: HomeTournamentEntry[];
  onOpen: (id: string) => void;
  onSeeAll: () => void;
}) {
  if (entries.length === 0) return null;   // pas d'état vide, par décision du handoff
  const seul = entries.length === 1;

  return (
    <View style={{ flex: 1, gap: 7 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="medal" size={15} color={Colors.brandDeep} stroke={2.2} />
        <Text style={{ fontSize: 14.5, fontFamily: Fonts.welcome, letterSpacing: 0.5, color: Colors.textPrimary }}>
          {seul ? 'TOURNOI OUVERT' : 'TOURNOIS OUVERTS'}
        </Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onSeeAll} hitSlop={8}>
          <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiExtraBold, color: Colors.brandDeep }}>
            {seul ? 'Voir' : 'Tout voir'}
          </Text>
        </TouchableOpacity>
      </View>

      {seul ? (
        <WideCard entry={entries[0]} onOpen={() => onOpen(entries[0].tournament.id)} />
      ) : (
        // Le carrousel SORT de la colonne a marges de l'accueil (marginHorizontal
        // negatif + padding equivalent dans le contenu) : enferme dedans, la
        // carte suivante etait tranchee net au bord, ce qui se lit comme un
        // defaut d'affichage et non comme « ca continue ».
        //
        // `snapToInterval` la fait s'arreter carte par carte plutot que de
        // finir n'importe ou : on voit toujours une carte entiere, et un
        // fragment de la suivante qui INVITE a pousser.
        <FlatList
          horizontal
          data={entries}
          keyExtractor={e => e.tournament.id}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={CARD_W + CARD_GAP}
          snapToAlignment="start"
          style={{ marginHorizontal: -EDGE }}
          contentContainerStyle={{ paddingHorizontal: EDGE, gap: CARD_GAP }}
          renderItem={({ item, index }) => (
            <CarouselCard
              entry={item}
              dark={index === 0}
              onOpen={() => onOpen(item.tournament.id)}
            />
          )}
        />
      )}
    </View>
  );
}

export default HomeTournaments;
