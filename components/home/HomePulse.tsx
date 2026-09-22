// components/home/HomePulse.tsx — « Ça bouge chez les PAGUISTES ».
//
// Deux cartes côte à côte, à la fin de l'accueil : qui est libre ce soir, et
// sur quel match le club est en train de se prononcer.
//
// Elles ne REFONT pas l'onglet Activité, elles y emmènent — et pas au hasard :
// chaque bouton pointe la chose précise qu'il montre. « Voter » ouvre LE match
// affiché, pas la liste. Un raccourci qui dépose ailleurs qu'à l'endroit promis
// oblige à chercher, et on ne s'en sert plus.
//
// Chaque carte se tait quand elle n'a rien à dire, plutôt que d'afficher un
// zéro : deux encarts vides côte à côte donnent l'impression d'une app morte.
import { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { Icon } from '../community/icons';
import { PlayerAvatar } from '../PlayerAvatar';
import { availabilitySlots, fetchAvailableOnSlot, slotShortLabel, type AvailabilityRow } from '../../lib/availability';
import { MERCATO_LEVEL_BAND } from '../../lib/mercato';
import {
  predictionWindow, fetchClashCandidates, clashesToPredict, withoutMyGames,
  tightestClashId, type Clash,
} from '../../lib/weekendClash';

const CARTE = {
  flex: 1, backgroundColor: Colors.bgCard, borderRadius: 18,
  borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 10,
} as const;

const BOUTON = {
  backgroundColor: Colors.brand, borderRadius: 999,
  paddingVertical: 9, alignItems: 'center', justifyContent: 'center',
  flexDirection: 'row', gap: 5,
} as const;

function Bouton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={BOUTON}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 12.5, color: Colors.primary }}>{label}</Text>
      <Icon name="chevronRight" size={12} color={Colors.primary} stroke={2.6} />
    </TouchableOpacity>
  );
}

function Photos({ rows, max = 4 }: { rows: { id: string; name: string; path?: string | null }[]; max?: number }) {
  const vus = rows.slice(0, max);
  const reste = rows.length - vus.length;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {vus.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i > 0 ? -10 : 0 }}>
          <PlayerAvatar name={p.name} path={p.path} size={34} ring={2} ringColor={Colors.bgCard}
            backgroundColor={Colors.brand} textColor={Colors.primary}
            fontFamily={Fonts.uiBlack} fontSize={13} initialsMax={2} />
        </View>
      ))}
      {reste > 0 && (
        <View style={{
          marginLeft: -10, width: 34, height: 34, borderRadius: 17,
          backgroundColor: Colors.bgCardAlt, borderWidth: 2, borderColor: Colors.bgCard,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11, color: Colors.textSecondary }}>{`+${reste}`}</Text>
        </View>
      )}
    </View>
  );
}

export function HomePulse({ myId, myElo }: { myId: string; myElo: number }) {
  const router = useRouter();
  const [dispos, setDispos] = useState<AvailabilityRow[]>([]);
  const [clash, setClash] = useState<Clash | null>(null);

  const creneau = availabilitySlots()[0] ?? null;

  useFocusEffect(useCallback(() => {
    let vivant = true;
    (async () => {
      if (creneau) {
        const rows = await fetchAvailableOnSlot(creneau, myId);
        if (!vivant) return;
        // « De ton niveau » : la MÊME bande que le mercato, pas un troisième
        // seuil. Un joueur sans niveau connu ne compte pas — on ne peut pas
        // promettre qu'il est à ta hauteur.
        const mien = eloToLevel(myElo);
        setDispos(rows.filter(r => {
          const e = r.player?.elo_score;
          return e != null && Math.abs(eloToLevel(e) - mien) <= MERCATO_LEVEL_BAND;
        }));
      }
      const { start, end } = predictionWindow();
      const parties = await fetchClashCandidates(start, end);
      if (!vivant) return;
      // On ne propose pas de voter sur SON propre match : l'issue dépend de
      // nous, et « 58 % te voient perdre » n'est pas une conversation.
      const liste = withoutMyGames(clashesToPredict(parties), myId);
      const choc = tightestClashId(liste);
      setClash(liste.find(c => c.gameId === choc) ?? liste[0] ?? null);
    })();
    return () => { vivant = false; };
  }, [myId, myElo, creneau?.key]));

  if (dispos.length === 0 && !clash) return null;

  const quand = creneau ? slotShortLabel(creneau) : 'ce soir';

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="users" size={18} color={Colors.textPrimary} stroke={2.2} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: Fonts.welcome, fontSize: 19, lineHeight: 25, color: Colors.textPrimary, paddingRight: 6 }}>
          Ça bouge chez les <Text style={{ color: Colors.brandDeep }}>PAGUISTES</Text>
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        {dispos.length > 0 && (
          <View style={CARTE}>
            <View style={{ gap: 2 }}>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 15, lineHeight: 20, color: Colors.textPrimary, paddingRight: 4 }}>
                {`Dispos ${quand}`}
              </Text>
              <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, lineHeight: 15, color: Colors.textSecondary }}>
                {`${dispos.length} joueur${dispos.length > 1 ? 's' : ''} de ton niveau ${dispos.length > 1 ? 'sont dispos' : 'est dispo'}`}
              </Text>
            </View>
            <Photos rows={dispos.map(r => ({
              id: r.player?.id ?? r.id ?? '', name: r.player?.name ?? 'Joueur', path: r.player?.avatar_path,
            }))} />
            <Bouton label="Voir les joueurs" onPress={() => router.push('/(tabs)/activite?focus=dispo' as any)} />
          </View>
        )}

        {clash && (
          <View style={CARTE}>
            <View style={{ gap: 2 }}>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.welcome, fontSize: 15, lineHeight: 20, color: Colors.textPrimary, paddingRight: 4 }}>
                Votes du moment
              </Text>
              <Text numberOfLines={2} style={{ fontFamily: Fonts.uiSemi, fontSize: 11, lineHeight: 15, color: Colors.textSecondary }}>
                {`${clash.teamA.map(p => p.name.split(' ')[0]).join(' / ')} vs ${clash.teamB.map(p => p.name.split(' ')[0]).join(' / ')}`}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Photos rows={clash.teamA.map(p => ({ id: p.id, name: p.name, path: p.avatarPath }))} max={2} />
              <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10.5, color: Colors.textMuted }}>VS</Text>
              <Photos rows={clash.teamB.map(p => ({ id: p.id, name: p.name, path: p.avatarPath }))} max={2} />
            </View>
            {/* Vers CE match précisément, pas vers la liste : l'onglet place la
                carte en tête du rail (cf. app/(tabs)/activite.tsx). */}
            <Bouton label="Voter" onPress={() => router.push(`/(tabs)/activite?focus=${clash.gameId}` as any)} />
          </View>
        )}
      </View>
    </View>
  );
}
