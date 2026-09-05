// components/lobby/ExploreFilterSheet.tsx — le volet de filtres de l'Explorer.
//
// L'Explorer portait quatre filtres en pastilles posées à même l'écran. Ils
// tenaient tant qu'ils étaient quatre ; à neuf, ils mangeraient la liste
// qu'ils servent à trouver.
//
// Le volet répond à ça : on y entre, on règle, on ressort avec un résultat.
// Le bouton du bas annonce le NOMBRE de parties avant même de fermer — sans
// lui, on règle à l'aveugle et on découvre une liste vide après coup.
//
// Ce qui n'est PAS ici, et c'est délibéré : les clubs organisateurs (la notion
// n'existe pas en base) et les « top joueurs » (calculable, mais l'agrégat
// n'est pas écrit). Un filtre qui ne filtre rien coûte plus qu'il ne rapporte.
//
// Toute la logique — périodes, tranches horaires, refus — vit dans
// lib/exploreFilters avec ses tests. Ici, il n'y a que du rendu.
import React, { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Switch,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';
import {
  alertCoverage, canAlert, suggestFilterName, type SavedFilter,
} from '../../lib/savedFilters';
import {
  NO_EXPLORE_FILTERS, activeExploreFilterCount, weekendDates, allowedGenderFilters,
  type ExploreFilters, type DatePreset, type TimeSlot,
  type TypeFilter, type LevelFilter, type GenderFilter, type PlayerGender,
} from '../../lib/exploreFilters';

export interface ClubRef { name: string; city: string | null }

/** Une pastille de choix. */
function Chip({ label, sub, active, onPress, flex }: {
  label: string; sub?: string; active: boolean; onPress: () => void; flex?: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        flex, alignItems: 'center', justifyContent: 'center',
        paddingVertical: sub ? 9 : 11, paddingHorizontal: 14, borderRadius: 12,
        backgroundColor: active ? Colors.primary : Colors.bgCard,
        borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
      }}
    >
      <Text numberOfLines={1} style={{
        fontSize: 12.5, fontFamily: Fonts.uiBlack,
        color: active ? Colors.textOnDark : Colors.textSecondary,
      }}>
        {label}
      </Text>
      {!!sub && (
        <Text numberOfLines={1} style={{
          fontSize: 10, fontFamily: Fonts.uiBold, marginTop: 1,
          color: active ? Colors.brand : Colors.textMuted,
        }}>
          {sub}
        </Text>
      )}
    </TouchableOpacity>
  );
}

function Section({ title, icon, children }: {
  title: string; icon: React.ComponentProps<typeof Icon>['name']; children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={15} color={Colors.textPrimary} stroke={2.3} />
        <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** Une rangée de pastilles qui passe à la ligne plutôt que de déborder. */
function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

const jourCourt = (d: Date) =>
  d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export function ExploreFilterSheet({
  visible, initial, saved, onUseSaved, onDeleteSaved, onSave,
  clubs, activeClubNames, myGender, resultCount, onApply, onClose,
}: {
  visible: boolean;
  initial: ExploreFilters;
  /** Les filtres enregistrés du joueur. */
  saved: SavedFilter[];
  onUseSaved: (f: SavedFilter) => void;
  onDeleteSaved: (id: string) => void;
  onSave: (name: string, criteria: ExploreFilters, alert: boolean) => void;
  /** Les clubs connus, pour les pastilles de club et de ville. */
  clubs: ClubRef[];
  /** Les lieux qui accueillent AU MOINS une partie visible en ce moment. */
  activeClubNames: string[];
  /** Le genre du joueur — on ne propose pas un filtre qui ne rend rien. */
  myGender: PlayerGender;
  /** Combien de parties passent le brouillon en cours — calculé par l'écran. */
  resultCount: (draft: ExploreFilters) => number;
  onApply: (f: ExploreFilters) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  // On travaille sur un BROUILLON : fermer sans appliquer doit laisser la liste
  // exactement comme on l'a trouvée.
  const [draft, setDraft] = useState<ExploreFilters>(initial);
  const [clubSearch, setClubSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveAlert, setSaveAlert] = useState(true);

  // Le volet se rouvre sur les filtres réellement actifs, pas sur le brouillon
  // abandonné la fois d'avant.
  React.useEffect(() => {
    if (visible) { setDraft(initial); setClubSearch(''); setSaving(false); }
  }, [visible, initial]);

  const set = <K extends keyof ExploreFilters>(k: K, v: ExploreFilters[K]) =>
    setDraft(d => ({ ...d, [k]: v }));

  const toggleIn = (liste: string[], v: string) =>
    liste.includes(v) ? liste.filter(x => x !== v) : [...liste, v];

  const [samedi, dimanche] = weekendDates();
  // Seules les villes qui ACCUEILLENT des parties. Lister les trente villes du
  // referentiel donnait un mur de pastilles dont vingt-cinq rendaient une liste
  // vide — un filtre qui ne peut rien rendre n'est pas un filtre.
  const villes = useMemo(() => {
    const actifs = new Set(activeClubNames);
    const v = new Set<string>();
    for (const c of clubs) if (c.city && actifs.has(c.name)) v.add(c.city);
    // Une ville deja cochee reste visible meme si plus aucune partie ne s'y
    // joue : sinon on ne peut plus la decocher.
    for (const x of draft.cities) v.add(x);
    return [...v].sort((a, b) => a.localeCompare(b, 'fr'));
  }, [clubs, activeClubNames, draft.cities]);

  const clubsVisibles = useMemo(() => {
    const q = clubSearch.trim().toLowerCase();
    // Sans recherche, on ne montre QUE les clubs ou il se passe quelque chose.
    // Les 108 du referentiel restent atteignables en tapant leur nom.
    const actifs = new Set(activeClubNames);
    const socle = q ? clubs : clubs.filter(c => actifs.has(c.name));
    const base = draft.cities.length > 0
      ? socle.filter(c => c.city && draft.cities.includes(c.city))
      : socle;
    const filtres = q ? base.filter(c => c.name.toLowerCase().includes(q)) : base;
    // Les clubs déjà cochés restent visibles même si la recherche ne les
    // ramène plus : sinon on décoche à l'aveugle.
    const coches = clubs.filter(c => draft.clubs.includes(c.name));
    const vus = new Set(filtres.map(c => c.name));
    return [...filtres.slice(0, q ? 40 : 20), ...coches.filter(c => !vus.has(c.name))];
  }, [clubs, activeClubNames, clubSearch, draft.cities, draft.clubs]);

  const n = resultCount(draft);
  const actifs = activeExploreFilterCount(draft);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#00000066', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: Colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
          maxHeight: '92%', paddingBottom: insets.bottom + 8,
        }}>
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 38, height: 4, borderRadius: 2, backgroundColor: Colors.border }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 18, paddingBottom: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 24, fontFamily: Fonts.welcome, color: Colors.textPrimary }}>
                Filtres
              </Text>
              <Text style={{ fontSize: 12, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2 }}>
                Affine ta recherche pour trouver la partie idéale
              </Text>
            </View>
            {actifs > 0 && (
              <TouchableOpacity
                onPress={() => setDraft(NO_EXPLORE_FILTERS)}
                activeOpacity={0.8}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  backgroundColor: Colors.bgCard, borderRadius: 999,
                  paddingHorizontal: 12, paddingVertical: 8,
                  borderWidth: 1, borderColor: Colors.border,
                }}
              >
                <Icon name="repeat" size={12} color={Colors.textSecondary} stroke={2.3} />
                <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiExtraBold, color: Colors.textSecondary }}>
                  Réinitialiser
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={10} activeOpacity={0.75} style={{ paddingTop: 4 }}>
              <Icon name="x" size={20} color={Colors.textPrimary} stroke={2.4} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 18, gap: 22 }}>
            {saved.length > 0 && (
              <Section title="Mes filtres" icon="bookOpen">
                <Row>
                  {saved.map(sf => (
                    <View
                      key={sf.id}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        backgroundColor: Colors.bgCard, borderRadius: 12,
                        borderWidth: 1, borderColor: sf.alert ? Colors.brand : Colors.border,
                      }}
                    >
                      <TouchableOpacity
                        onPress={() => onUseSaved(sf)}
                        activeOpacity={0.8}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, paddingLeft: 12 }}
                      >
                        {/* La cloche dit d'un coup d'œil lesquels VEILLENT. */}
                        <Icon
                          name={sf.alert ? 'bellRing' : 'star'}
                          size={13}
                          color={sf.alert ? Colors.brandDeep : Colors.textMuted}
                          stroke={2.3}
                        />
                        <Text numberOfLines={1} style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, maxWidth: 150 }}>
                          {sf.name}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => onDeleteSaved(sf.id)}
                        hitSlop={8}
                        activeOpacity={0.7}
                        style={{ paddingHorizontal: 10, paddingVertical: 10 }}
                      >
                        <Icon name="x" size={13} color={Colors.textMuted} stroke={2.4} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </Row>
              </Section>
            )}

            <Section title="Date" icon="calendar">
              <Row>
                <Chip label="Toutes" active={draft.date === 'any'} onPress={() => set('date', 'any')} />
                <Chip label="Aujourd’hui" active={draft.date === 'today'} onPress={() => set('date', 'today')} />
                <Chip label="Demain" active={draft.date === 'tomorrow'} onPress={() => set('date', 'tomorrow')} />
                <Chip label="Cette semaine" sub="7 jours" active={draft.date === 'week'} onPress={() => set('date', 'week')} />
                <Chip
                  label="Week-end"
                  sub={`${jourCourt(samedi)} – ${jourCourt(dimanche)}`}
                  active={draft.date === 'weekend'}
                  onPress={() => set('date', 'weekend')}
                />
              </Row>
            </Section>

            <Section title="Plage horaire" icon="clock">
              <Row>
                <Chip label="Toute la journée" active={draft.slot === 'any'} onPress={() => set('slot', 'any')} />
                <Chip label="Matin" sub="06 h – 12 h" active={draft.slot === 'morning'} onPress={() => set('slot', 'morning')} />
                <Chip label="Après-midi" sub="12 h – 18 h" active={draft.slot === 'afternoon'} onPress={() => set('slot', 'afternoon')} />
                <Chip label="Soir" sub="18 h – 00 h" active={draft.slot === 'evening'} onPress={() => set('slot', 'evening')} />
                <Chip label="Nuit" sub="00 h – 06 h" active={draft.slot === 'night'} onPress={() => set('slot', 'night')} />
              </Row>
            </Section>

            <Section title="Lieu" icon="mapPin">
              <Row>
                <Chip label="Toutes les villes" active={draft.cities.length === 0} onPress={() => set('cities', [])} />
                {villes.map(v => (
                  <Chip
                    key={v}
                    label={v}
                    active={draft.cities.includes(v)}
                    onPress={() => set('cities', toggleIn(draft.cities, v))}
                  />
                ))}
              </Row>

              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: Colors.bgCard, borderRadius: 12,
                borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12,
              }}>
                <Icon name="search" size={14} color={Colors.textMuted} stroke={2.3} />
                <TextInput
                  value={clubSearch}
                  onChangeText={setClubSearch}
                  placeholder="Chercher un club…"
                  placeholderTextColor={Colors.textMuted}
                  autoCorrect={false}
                  style={{ flex: 1, paddingVertical: 10, fontSize: 13, color: Colors.textPrimary }}
                />
                {clubSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setClubSearch('')} hitSlop={10}>
                    <Icon name="x" size={14} color={Colors.textMuted} stroke={2.4} />
                  </TouchableOpacity>
                )}
              </View>

              <Row>
                {clubsVisibles.map(c => (
                  <Chip
                    key={c.name}
                    label={c.name}
                    sub={c.city ?? undefined}
                    active={draft.clubs.includes(c.name)}
                    onPress={() => set('clubs', toggleIn(draft.clubs, c.name))}
                  />
                ))}
              </Row>
              {draft.clubs.length > 0 && (
                <TouchableOpacity onPress={() => set('clubs', [])} activeOpacity={0.75}>
                  <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiExtraBold, color: Colors.brandDeep }}>
                    Retirer les {draft.clubs.length} clubs choisis
                  </Text>
                </TouchableOpacity>
              )}
            </Section>

            <Section title="Type de match" icon="swords">
              <Row>
                {([['all', 'Tous'], ['competitive', 'Compétitif'], ['friendly', 'Amical'], ['challenge', 'Défi']] as [TypeFilter, string][])
                  .map(([v, l]) => (
                    <Chip key={v} label={l} active={draft.type === v} onPress={() => set('type', v)} />
                  ))}
              </Row>
            </Section>

            <Section title="Niveau" icon="trendingUp">
              <Row>
                {([['all', 'Tous'], ['mine', 'Mon niveau'], ['outside', 'Hors mon niveau']] as [LevelFilter, string][])
                  .map(([v, l]) => (
                    <Chip key={v} label={l} active={draft.level === v} onPress={() => set('level', v)} />
                  ))}
              </Row>
            </Section>

            <Section title="Genre" icon="users">
              <Row>
                {(([['all', 'Tous'], ['men', 'Hommes'], ['women', 'Femmes'], ['mixed', 'Mixte']] as [GenderFilter, string][])
                  .filter(([v]) => allowedGenderFilters(myGender).includes(v)))
                  .map(([v, l]) => (
                    <Chip key={v} label={l} active={draft.gender === v} onPress={() => set('gender', v)} />
                  ))}
              </Row>
            </Section>

            <Section title="Places disponibles" icon="users">
              <Row>
                <Chip label="Toutes" flex={1} active={draft.spots === null} onPress={() => set('spots', null)} />
                {[1, 2, 3].map(k => (
                  <Chip
                    key={k}
                    flex={1}
                    label={`${k} place${k > 1 ? 's' : ''}`}
                    active={draft.spots === k}
                    onPress={() => set('spots', k)}
                  />
                ))}
              </Row>
            </Section>

            <Section title="Urgent" icon="flame">
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: Colors.bgCard, borderRadius: 14, padding: 14,
                borderWidth: 1, borderColor: Colors.border,
              }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
                    Il manque une personne
                  </Text>
                  <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 2, lineHeight: 16 }}>
                    Une seule place libre, et ça se joue dans les 6 heures.
                  </Text>
                </View>
                <Switch
                  value={draft.urgentOnly}
                  onValueChange={v => set('urgentOnly', v)}
                  trackColor={{ false: Colors.border, true: Colors.brand }}
                  thumbColor={Colors.bgCard}
                />
              </View>
            </Section>
          </ScrollView>

          {/* Enregistrer ce filtre — en disant CE QUE L'ALERTE SURVEILLERA.
              Croire qu'on sera prévenu sur « ce week-end », alors que personne
              ne peut surveiller une date relative, est pire que pas d'alerte. */}
          {saving && (
            <View style={{
              marginHorizontal: 18, marginBottom: 10, padding: 14, borderRadius: 16,
              backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, gap: 10,
            }}>
              <TextInput
                value={saveName}
                onChangeText={setSaveName}
                placeholder={suggestFilterName(draft)}
                placeholderTextColor={Colors.textMuted}
                maxLength={40}
                autoFocus
                style={{
                  borderWidth: 1, borderColor: Colors.border, borderRadius: 11,
                  paddingHorizontal: 12, paddingVertical: 10,
                  fontSize: 13.5, color: Colors.textPrimary, backgroundColor: Colors.bg,
                }}
              />
              {canAlert(draft) ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
                        Me prévenir
                      </Text>
                      <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textSecondary, marginTop: 1, lineHeight: 15 }}>
                        Surveille : {alertCoverage(draft).watched.join(' · ')}
                      </Text>
                    </View>
                    <Switch
                      value={saveAlert}
                      onValueChange={setSaveAlert}
                      trackColor={{ false: Colors.border, true: Colors.brand }}
                      thumbColor={Colors.bgCard}
                    />
                  </View>
                  {saveAlert && alertCoverage(draft).ignored.length > 0 && (
                    <Text style={{ fontSize: 10.5, fontFamily: Fonts.ui, color: Colors.textMuted, lineHeight: 15 }}>
                      Ne tiendra pas compte de {alertCoverage(draft).ignored.join(', ').toLowerCase()} :
                      ça dépend du moment où on regarde, pas de la partie.
                    </Text>
                  )}
                </>
              ) : (
                <Text style={{ fontSize: 11, fontFamily: Fonts.ui, color: Colors.textMuted, lineHeight: 15 }}>
                  Pas d’alerte possible ici : ce filtre ne retient qu’une date ou une
                  disponibilité, qui changent d’un instant à l’autre. Ajoute un club,
                  une ville, un type ou une plage horaire pour être prévenu.
                </Text>
              )}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setSaving(false)}
                  activeOpacity={0.8}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11,
                    borderWidth: 1, borderColor: Colors.border,
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: Fonts.uiExtraBold, color: Colors.textSecondary }}>
                    Annuler
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { onSave(saveName, draft, saveAlert && canAlert(draft)); setSaving(false); setSaveName(''); }}
                  activeOpacity={0.85}
                  style={{
                    flex: 1, alignItems: 'center', paddingVertical: 11,
                    borderRadius: 11, backgroundColor: Colors.primary,
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.textOnDark }}>
                    Enregistrer
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {!saving && actifs > 0 && (
            <TouchableOpacity
              onPress={() => { setSaveName(''); setSaveAlert(canAlert(draft)); setSaving(true); }}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
                marginHorizontal: 18, marginBottom: 10, paddingVertical: 12, borderRadius: 12,
                backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border,
              }}
            >
              <Icon name="bellRing" size={14} color={Colors.brandDeep} stroke={2.3} />
              <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
                Enregistrer ce filtre
              </Text>
            </TouchableOpacity>
          )}

          {/* Le nombre AVANT de fermer : sans lui on règle à l'aveugle et on
              découvre une liste vide une fois le volet refermé. */}
          <View style={{
            flexDirection: 'row', gap: 10, paddingHorizontal: 18, paddingTop: 12,
            borderTopWidth: 1, borderTopColor: Colors.border,
          }}>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.8}
              style={{
                paddingVertical: 15, paddingHorizontal: 22, borderRadius: 14,
                borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bgCard,
              }}
            >
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
                Annuler
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onApply(draft)}
              activeOpacity={0.85}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 15, borderRadius: 14,
                backgroundColor: n === 0 ? Colors.primary : Colors.brand,
              }}
            >
              <Text style={{
                fontSize: 14, fontFamily: Fonts.uiBlack,
                color: n === 0 ? Colors.textOnDark : Colors.textOnBrand,
              }}>
                {n === 0 ? 'Aucune partie — voir quand même' : `Voir les ${n} partie${n > 1 ? 's' : ''}`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export default ExploreFilterSheet;
