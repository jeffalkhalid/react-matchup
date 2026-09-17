// components/tournaments/ClubDropdown.tsx — le choix du club à la création d'un
// tournoi : un champ qui se déplie en liste, avec une recherche.
//
// Avant : TOUS les clubs empilés en cartes dans l'étape « Quand & où ». Avec
// une centaine de clubs, il fallait faire défiler l'écran entier pour trouver
// le sien, et le reste de l'étape disparaissait sous la liste.
//
// La recherche ignore les accents et la casse, et regarde le nom ET la ville :
// « casa » trouve les clubs de Casablanca, « evasion » trouve « Évasion ».
//
// LE CLAVIER. Il ne s'ouvre QUE si on touche la recherche : ouvrir la liste
// sert d'abord à la parcourir. Quand il s'ouvre, il ne doit rien cacher :
//   - l'écran parent remonte le champ en haut (`onReveal`) ;
//   - la liste se raccourcit à la place qui reste au-dessus du clavier,
//     mesurée sur l'écran réel (pas une hauteur supposée du téléphone).
//
// Liste DÉPLIÉE SUR PLACE, pas une <Modal> native : l'assistant est déjà dans
// un ScrollView, et une modale native ferait passer une navigation derrière
// elle (cf. feedback_nav_depuis_modal_native).
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Keyboard } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';

export type ClubOption = { id: string; name: string; city: string | null };

/** Minuscules, sans accents : la forme sous laquelle on compare.
 *  Table explicite plutôt que `normalize('NFD')` seul : selon la compilation
 *  du moteur JS du téléphone, `normalize` peut manquer ou ne rien faire. */
const ACCENTS: Record<string, string> = {
  à: 'a', â: 'a', ä: 'a', á: 'a', ç: 'c', é: 'e', è: 'e', ê: 'e', ë: 'e',
  î: 'i', ï: 'i', í: 'i', ô: 'o', ö: 'o', ó: 'o', ù: 'u', û: 'u', ü: 'u', ú: 'u', ÿ: 'y', ñ: 'n',
};
export function plain(s: string): string {
  return s.toLowerCase().replace(/[àâäáçéèêëîïíôöóùûüúÿñ]/g, ch => ACCENTS[ch] ?? ch).trim();
}

/** Hauteur de la liste : au plus LIST_MAX clavier fermé ; clavier ouvert, la
 *  place réellement libre au-dessus de lui, sans descendre sous LIST_MIN
 *  (quelques lignes restent toujours visibles). */
const LIST_MAX = 300;
const LIST_MIN = 130;
/** Écart gardé entre le bas de la liste et le haut du clavier. */
const KEYBOARD_GAP = 12;

export function ClubDropdown({ clubs, value, onChange, loading, onReveal, onOpenChange }: {
  clubs: ClubOption[];
  value: ClubOption | null;
  /** `null` = « Sans club » : un tournoi peut se créer sans club. */
  onChange: (club: ClubOption | null) => void;
  loading?: boolean;
  /** Demande à l'écran parent d'amener le champ en haut de l'écran.
   *  `animated: false` quand le clavier arrive : la liste se mesure juste
   *  après, et elle doit être à sa place définitive à ce moment-là. */
  onReveal?: (opts: { animated: boolean }) => void;
  /** La liste s'ouvre / se ferme (le parent masque sa barre d'action pendant
   *  la recherche : sur Android elle remonte avec le clavier, par-dessus). */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState('');
  const [listMax, setListMax] = useState(LIST_MAX);
  const listBox = useRef<View>(null);
  // La dernière version de `onReveal`, lue depuis l'écoute du clavier (posée
  // une seule fois à l'ouverture de la liste).
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
    if (next) onReveal?.({ animated: true });
    else { Keyboard.dismiss(); setListMax(LIST_MAX); }
  };

  // Clavier ouvert : la liste prend la place qui reste au-dessus de lui.
  useEffect(() => {
    if (!open) return;
    const show = Keyboard.addListener('keyboardDidShow', e => {
      const keyboardTop = e.endCoordinates.screenY;
      // L'écran n'a rétréci qu'À CET INSTANT (iPhone surtout) : le défilement
      // demandé au toucher de la recherche a pu être bloqué faute de place.
      // On le redemande, puis on mesure à l'image suivante, une fois en place.
      onRevealRef.current?.({ animated: false });
      requestAnimationFrame(() => {
        listBox.current?.measureInWindow((_x, y) => {
          const room = keyboardTop - y - KEYBOARD_GAP;
          setListMax(Math.max(LIST_MIN, Math.min(LIST_MAX, room)));
        });
      });
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setListMax(LIST_MAX));
    return () => { show.remove(); hide.remove(); };
  }, [open]);

  // Démontage liste ouverte (changement d'étape) : le parent ne doit pas
  // rester sur « liste ouverte ».
  useEffect(() => () => onOpenChange?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = plain(query);
    if (!q) return clubs;
    return clubs.filter(c => plain(c.name).includes(q) || plain(c.city ?? '').includes(q));
  }, [clubs, query]);

  const choose = (c: ClubOption | null) => {
    onChange(c);
    setOpen(false);
    setQuery('');
  };

  const actif = open || !!value;

  return (
    <View style={{ gap: 8 }}>
      {/* ── Le champ ── */}
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        activeOpacity={0.85}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12,
          backgroundColor: Colors.bgCard, borderRadius: 16, padding: 12,
          borderWidth: actif ? 1.5 : 1, borderColor: actif ? Colors.primary : Colors.border,
        }}
      >
        <View style={{
          width: 40, height: 40, borderRadius: 13,
          backgroundColor: value ? Colors.primary : Colors.bg,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="mapPin" size={19} color={value ? Colors.brand : Colors.textMuted} stroke={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: value ? Colors.textPrimary : Colors.textMuted }}>
            {value ? value.name : 'Choisir un club'}
          </Text>
          {value ? (
            value.city ? (
              <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                {value.city}
              </Text>
            ) : null
          ) : (
            <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
              Recherche par nom ou par ville
            </Text>
          )}
        </View>
        {value && !open && (
          <TouchableOpacity
            onPress={() => onChange(null)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Retirer le club"
          >
            <Icon name="x" size={16} color={Colors.textMuted} stroke={2.4} />
          </TouchableOpacity>
        )}
        <Icon name="chevronDown" size={18} rotate={open ? 180 : 0} color={Colors.textSecondary} stroke={2.4} />
      </TouchableOpacity>

      {/* ── La liste dépliée ── */}
      {open && (
        <View style={{
          backgroundColor: Colors.bgCard, borderRadius: 16, overflow: 'hidden',
          borderWidth: 1, borderColor: Colors.border,
        }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 14, paddingVertical: 11,
            borderBottomWidth: 1, borderBottomColor: Colors.border,
          }}>
            <Icon name="search" size={16} color={Colors.textMuted} stroke={2.2} />
            {/* Pas d'autoFocus : le clavier ne vient que si on touche ici. */}
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={() => onReveal?.({ animated: false })}
              placeholder="Rechercher un club ou une ville…"
              placeholderTextColor={Colors.textMuted}
              autoCorrect={false}
              returnKeyType="search"
              style={{ flex: 1, fontSize: 14.5, fontFamily: Fonts.ui, color: Colors.textPrimary, padding: 0 }}
            />
            {query ? (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Icon name="x" size={15} color={Colors.textMuted} stroke={2.4} />
              </TouchableOpacity>
            ) : null}
          </View>

          <View ref={listBox} collapsable={false}>
            <ScrollView style={{ maxHeight: listMax }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {value && !query && (
                <TouchableOpacity
                  onPress={() => choose(null)}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 }}
                >
                  <Icon name="x" size={15} color={Colors.textSecondary} stroke={2.4} />
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
                    Sans club
                  </Text>
                </TouchableOpacity>
              )}

              {loading ? (
                <ActivityIndicator color={Colors.primary} style={{ marginVertical: 18 }} />
              ) : filtered.length === 0 ? (
                <Text style={{ fontSize: 13, fontFamily: Fonts.uiBold, color: Colors.textMuted, paddingHorizontal: 14, paddingVertical: 16 }}>
                  {query ? `Aucun club ne correspond à « ${query.trim()} ».` : 'Aucun club disponible.'}
                </Text>
              ) : (
                filtered.map((c, i) => {
                  const active = value?.id === c.id;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => choose(c)}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        paddingHorizontal: 14, paddingVertical: 11,
                        borderTopWidth: i === 0 && !(value && !query) ? 0 : 1, borderTopColor: Colors.borderLight,
                        backgroundColor: active ? 'rgba(255,193,26,0.14)' : 'transparent',
                      }}
                    >
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                          {c.name}
                        </Text>
                        {c.city ? (
                          <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                            {c.city}
                          </Text>
                        ) : null}
                      </View>
                      {active && <Icon name="check" size={17} color={Colors.primary} stroke={2.8} />}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}
