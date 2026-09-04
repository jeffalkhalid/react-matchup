// « Gérer mes clubs » : favoris (réordonnables par flèches) + liste complète
// avec recherche. Rendu en Modal NATIF (comme ClubsMapModal) : le CreateWizard
// est lui-même un Modal natif, un router.push passerait DERRIÈRE lui et
// l'écran n'apparaîtrait qu'à la fermeture du wizard.
// Source de vérité : lib/clubFavorites. onClose renvoie la liste à jour.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, ActivityIndicator, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { Colors, Spacing, FontSize, Radius, Fonts } from '../lib/theme';
import { Icon } from './community/icons';
import { Avatar } from './community/Avatar';
import { toggleFavorite, moveFavorite, loadClubFavorites, saveClubFavorites } from '../lib/clubFavorites';

type Club = { name: string; city: string | null };

interface Props {
  visible: boolean;
  playerId: string | null;
  /** Fermé par l'utilisateur : renvoie la liste de favoris à jour (ordre inclus). */
  onClose: (favs: string[]) => void;
}

export function ManageClubsModal({ visible, playerId, onClose }: Props) {
  const insets = useSafeAreaInsets();

  const [clubs, setClubs] = useState<Club[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setLoading(true);
    setSearch('');
    (async () => {
      const [{ data: clubRows }, favList] = await Promise.all([
        supabase.from('clubs').select('name, city').order('name'),
        playerId ? loadClubFavorites(playerId) : Promise.resolve([]),
      ]);
      if (!alive) return;
      setClubs((clubRows ?? []).filter((c: any) => c.name) as Club[]);
      setFavs(favList);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [visible, playerId]);

  // Applique une nouvelle liste localement puis persiste (best-effort).
  const apply = (next: string[]) => {
    setFavs(next);
    if (playerId) saveClubFavorites(playerId, next).catch(() => {});
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return clubs;
    return clubs.filter(c => c.name.toLowerCase().includes(q) || (c.city ?? '').toLowerCase().includes(q));
  }, [clubs, search]);

  const Star = ({ active, onPress }: { active: boolean; onPress: () => void }) => (
    <TouchableOpacity onPress={onPress} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="star" size={20} color={active ? Colors.brand : Colors.textMuted}
        stroke={2} fill={active ? Colors.brand : 'none'} />
    </TouchableOpacity>
  );

  const header = (
    <View>
      {/* Mes clubs favoris */}
      <Text style={{ fontSize: 17, fontFamily: Fonts.welcome, color: Colors.textPrimary, marginBottom: 4, paddingRight: 5 }}
        numberOfLines={1} adjustsFontSizeToFit>
        Mes clubs favoris
      </Text>
      <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600', marginBottom: Spacing.md }}>
        {favs.length > 0 ? 'Réorganisez vos clubs avec les flèches' : 'Ajoutez vos clubs avec l’étoile ci-dessous'}
      </Text>

      {favs.map((name, i) => (
        <View key={name} style={{
          flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
          backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
          paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginBottom: Spacing.sm,
        }}>
          {/* Flèches réordonner */}
          <View style={{ gap: 2 }}>
            <TouchableOpacity disabled={i === 0} onPress={() => apply(moveFavorite(favs, name, -1))}
              hitSlop={{ top: 6, bottom: 2, left: 8, right: 8 }} style={{ opacity: i === 0 ? 0.25 : 1 }}>
              <Icon name="chevronDown" size={16} color={Colors.textSecondary} stroke={2.5} rotate={180} />
            </TouchableOpacity>
            <TouchableOpacity disabled={i === favs.length - 1} onPress={() => apply(moveFavorite(favs, name, 1))}
              hitSlop={{ top: 2, bottom: 6, left: 8, right: 8 }} style={{ opacity: i === favs.length - 1 ? 0.25 : 1 }}>
              <Icon name="chevronDown" size={16} color={Colors.textSecondary} stroke={2.5} />
            </TouchableOpacity>
          </View>
          <Avatar name={name} size={38} radius={12} mono="black" />
          <Text style={{ flex: 1, fontSize: 13.5, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>
            {name}
          </Text>
          <Star active onPress={() => apply(toggleFavorite(favs, name))} />
        </View>
      ))}

      {favs.length === 0 && !loading && (
        <View style={{ padding: Spacing.lg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', alignItems: 'center', marginBottom: Spacing.sm }}>
          <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' }}>
            Aucun club favori pour l’instant
          </Text>
        </View>
      )}

      {/* Tous les clubs */}
      <Text style={{ fontSize: 17, fontFamily: Fonts.welcome, color: Colors.textPrimary, marginTop: Spacing.lg, marginBottom: Spacing.md, paddingRight: 5 }}
        numberOfLines={1} adjustsFontSizeToFit>
        Tous les clubs
      </Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
        backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
        paddingHorizontal: Spacing.md, paddingVertical: 10, marginBottom: Spacing.md,
      }}>
        <Icon name="search" size={15} color={Colors.textMuted} stroke={2.2} />
        <TextInput
          value={search} onChangeText={setSearch}
          placeholder="Rechercher un club…" placeholderTextColor={Colors.textMuted}
          style={{ flex: 1, fontSize: 13, color: Colors.textPrimary, padding: 0 }}
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Icon name="x" size={14} color={Colors.textMuted} stroke={2.5} />
          </TouchableOpacity>
        ) : null}
      </View>
      {loading && <ActivityIndicator color={Colors.brand} style={{ marginVertical: Spacing.lg }} />}
    </View>
  );

  const footer = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.md,
      backgroundColor: 'rgba(255,193,26,0.10)', borderRadius: Radius.md, borderWidth: 1,
      borderColor: 'rgba(255,193,26,0.35)', padding: Spacing.md,
    }}>
      <Text style={{ fontSize: 16 }}>💡</Text>
      <Text style={{ flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600', lineHeight: 17 }}>
        Vos clubs favoris apparaîtront en haut de la liste lorsque vous créerez une nouvelle partie.
      </Text>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => onClose(favs)}>
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>
        {/* Header */}
        <View style={{ backgroundColor: Colors.heroBg, paddingTop: insets.top + 8, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.md }}>
            <TouchableOpacity
              onPress={() => onClose(favs)}
              style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: Colors.textOnDark, fontSize: 20, fontWeight: '900' }}>‹</Text>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}
                style={{ color: Colors.textOnDark, fontSize: 24, lineHeight: 31, fontFamily: Fonts.welcome, letterSpacing: -0.5, paddingRight: 5 }}>
                Gérer mes <Text style={{ color: Colors.brand }}>clubs</Text>
              </Text>
              <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, fontWeight: '600' }}>
                Ajoutez, supprimez et organisez vos clubs favoris
              </Text>
            </View>
          </View>
        </View>

        <FlatList
          data={filtered}
          keyExtractor={c => c.name}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={header}
          ListFooterComponent={footer}
          ListEmptyComponent={!loading ? (
            <View style={{ padding: Spacing.lg, alignItems: 'center' }}>
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted, fontWeight: '600' }}>Aucun club trouvé</Text>
            </View>
          ) : null}
          renderItem={({ item }) => {
            const isFav = favs.includes(item.name);
            return (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
                backgroundColor: Colors.bgCard, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border,
                paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginBottom: Spacing.sm,
              }}>
                <Avatar name={item.name} size={38} radius={12} mono="black" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '900', color: Colors.textPrimary }} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.city ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 }}>
                      <Icon name="mapPin" size={10} color={Colors.textMuted} stroke={2.2} />
                      <Text style={{ fontSize: 11, color: Colors.textMuted, fontWeight: '600' }} numberOfLines={1}>
                        {item.city}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Star active={isFav} onPress={() => apply(toggleFavorite(favs, item.name))} />
              </View>
            );
          }}
        />
      </View>
    </Modal>
  );
}
