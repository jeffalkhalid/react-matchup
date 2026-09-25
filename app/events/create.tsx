// app/events/create.tsx — publier un événement de club, en quatre étapes.
//
// Même assistant que celui des tournois (`tournaments/create.tsx`), même
// découpage en quatre, mais EN JAUNE : un tournoi est une compétition qu'on
// ouvre, un événement est une invitation qu'on lance. La couleur le dit avant
// le premier mot lu.
//
// Chaque refus est NOMMÉ (`eventDraftIssue`) plutôt que de griser le bouton :
// un bouton éteint sans raison est une impasse.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../../components/community/icons';
import { ClubDropdown, type ClubOption } from '../../components/tournaments/ClubDropdown';
import { DateSheet, TimeSheet } from '../../components/tournaments/DateTimeSheets';
import {
  createEvent, eventDraftIssue, eventStartsAt, eventKindLabel, eventPriceLabel,
  type EventDraft, type EventKind,
} from '../../lib/events';

const ETAPES = ['C’EST QUOI ?', 'QUAND & OÙ', 'LES DÉTAILS', 'RÉCAPITULATIF'];

const NATURES: { kind: EventKind; titre: string; sous: string }[] = [
  { kind: 'decouverte',      titre: 'Découverte',      sous: 'Faire essayer le padel à des débutants' },
  { kind: 'stage',           titre: 'Stage / cours',   sous: 'Un coach, un thème, un groupe' },
  { kind: 'afterwork',       titre: 'Afterwork',       sous: 'On joue, puis on reste' },
  { kind: 'portes_ouvertes', titre: 'Portes ouvertes', sous: 'Le club reçoit, tout le monde passe' },
  { kind: 'externe',         titre: 'Tournoi externe', sous: 'FRMT ou autre club : on le référence' },
];

const PRIX = [0, 50, 100, 150, 200, 300];

/** Demain, 18:00 — un événement se prépare, il ne s'improvise pas pour dans l'heure. */
function demain(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CreateEventScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();
  const scroll = useRef<ScrollView>(null);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [clubsCharges, setClubsCharges] = useState(false);
  const [club, setClub] = useState<ClubOption | null>(null);
  const [listeOuverte, setListeOuverte] = useState(false);
  const [feuilleDate, setFeuilleDate] = useState(false);
  const [feuilleDebut, setFeuilleDebut] = useState(false);
  const [feuilleFin, setFeuilleFin] = useState(false);

  const [draft, setDraft] = useState<EventDraft>({
    kind: null, title: '', clubId: null, date: demain(), start: '18:00', end: null,
    limit: false, capacity: 12, priceMad: 0, description: '', externalUrl: '',
  });
  const maj = (p: Partial<EventDraft>) => setDraft(d => ({ ...d, ...p }));

  useEffect(() => {
    (async () => {
      const { supabase } = await import('../../lib/supabase');
      const { data } = await supabase.from('clubs').select('id,name,city').order('name');
      setClubs((data ?? []) as ClubOption[]);
      setClubsCharges(true);
    })();
  }, []);

  useEffect(() => { maj({ clubId: club?.id ?? null }); }, [club]);

  const souci = useMemo(() => eventDraftIssue(step, draft), [step, draft]);

  const suivant = useCallback(() => {
    if (souci) { Alert.alert('Il manque quelque chose', souci); return; }
    setStep(s => Math.min(ETAPES.length - 1, s + 1));
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [souci]);

  const publier = useCallback(async () => {
    if (!player?.id || !draft.kind) return;
    setBusy(true);
    try {
      const res = await createEvent({
        kind: draft.kind,
        title: draft.title,
        clubId: draft.clubId,
        startsAt: eventStartsAt(draft.date, draft.start),
        endsAt: draft.end ? eventStartsAt(draft.date, draft.end) : null,
        capacity: draft.limit ? draft.capacity : null,
        priceMad: draft.priceMad,
        description: draft.description,
        externalUrl: draft.externalUrl,
      }, player.id);

      if (!res.ok) { Alert.alert('Impossible de publier', res.reason); return; }
      // On remplace l'assistant par la fiche : revenir en arrière depuis un
      // événement publié ne doit pas rouvrir le formulaire qui l'a créé.
      router.replace(`/events/${res.id}` as any);
    } finally { setBusy(false); }
  }, [draft, player?.id, router]);

  const externe = draft.kind === 'externe';

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── L'en-tête JAUNE : on lance une invitation, pas une compétition ── */}
      <View style={{
        backgroundColor: Colors.brand,
        paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 14, gap: 10,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity
            onPress={() => (step === 0 ? router.back() : setStep(s => s - 1))}
            hitSlop={10}
          >
            <Icon name={step === 0 ? 'x' : 'chevronLeft'} size={22} color={Colors.primary} stroke={2.2} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontFamily: Fonts.uiBlack, letterSpacing: 0.6, color: Colors.primary }}>
              {step === 0 ? 'NOUVEL ÉVÉNEMENT' : ETAPES[step]}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: 'rgba(10,10,10,0.6)' }}>
              Ce qui se passe au club, hors compétition
            </Text>
          </View>
          <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.primary }}>
            {step + 1} / {ETAPES.length}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 4 }}>
          {ETAPES.map((_, i) => (
            <View key={i} style={{
              flex: 1, height: 3, borderRadius: 999,
              backgroundColor: i <= step ? Colors.primary : 'rgba(10,10,10,0.18)',
            }} />
          ))}
        </View>
      </View>

      <ScrollView
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 110, gap: 12 }}
      >
        {/* ── 1. C'est quoi ── */}
        {step === 0 && NATURES.map(n => {
          const choisi = draft.kind === n.kind;
          return (
            <TouchableOpacity
              key={n.kind}
              onPress={() => maj({ kind: n.kind })}
              activeOpacity={0.8}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12,
                backgroundColor: choisi ? Colors.brand : Colors.bgCard,
                borderWidth: choisi ? 2 : 1,
                borderColor: choisi ? Colors.primary : Colors.border,
                borderRadius: 16, padding: 14,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{n.titre}</Text>
                <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: choisi ? 'rgba(10,10,10,0.65)' : Colors.textSecondary }}>
                  {n.sous}
                </Text>
              </View>
              <View style={{
                width: 20, height: 20, borderRadius: 10, borderWidth: 2,
                borderColor: choisi ? Colors.primary : Colors.border,
                alignItems: 'center', justifyContent: 'center',
              }}>
                {choisi && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary }} />}
              </View>
            </TouchableOpacity>
          );
        })}

        {/* ── 2. Quand & où ── */}
        {step === 1 && (
          <>
            <Bloc titre="LE TITRE">
              <TextInput
                value={draft.title}
                onChangeText={t => maj({ title: t })}
                maxLength={28}
                placeholder="Matinée découverte"
                placeholderTextColor={Colors.textMuted}
                style={champ}
              />
              <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.textMuted, textAlign: 'right' }}>
                {draft.title.length} / 28 — il doit tenir sur une ligne
              </Text>
            </Bloc>

            <Bloc titre="QUAND">
              <TouchableOpacity onPress={() => setFeuilleDate(true)} style={champTouche}>
                <Text style={valeur}>
                  {new Date(`${draft.date}T12:00:00`).toLocaleDateString('fr-FR',
                    { weekday: 'long', day: 'numeric', month: 'long' })}
                </Text>
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity onPress={() => setFeuilleDebut(true)} style={[champTouche, { flex: 1 }]}>
                  <Text style={valeur}>{draft.start}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setFeuilleFin(true)} style={[champTouche, { flex: 1 }]}>
                  <Text style={[valeur, !draft.end && { color: Colors.textMuted }]}>
                    {draft.end ?? 'fin (facultatif)'}
                  </Text>
                </TouchableOpacity>
              </View>
              {draft.end && (
                <TouchableOpacity onPress={() => maj({ end: null })} hitSlop={8} style={{ alignSelf: 'flex-end' }}>
                  <Text style={{ fontSize: 11, fontFamily: Fonts.uiBold, color: Colors.textMuted, textDecorationLine: 'underline' }}>
                    Retirer l’heure de fin
                  </Text>
                </TouchableOpacity>
              )}
            </Bloc>

            <Bloc titre="OÙ">
              <ClubDropdown
                clubs={clubs} value={club} onChange={setClub}
                loading={!clubsCharges}
                onOpenChange={setListeOuverte}
                onReveal={({ animated }) => scroll.current?.scrollToEnd({ animated })}
              />
            </Bloc>
          </>
        )}

        {/* ── 3. Les détails ── */}
        {step === 2 && (
          <>
            {externe ? (
              <Bloc titre="LE LIEN">
                <TextInput
                  value={draft.externalUrl}
                  onChangeText={t => maj({ externalUrl: t })}
                  autoCapitalize="none"
                  keyboardType="url"
                  placeholder="https://frmt.ma/…"
                  placeholderTextColor={Colors.textMuted}
                  style={champ}
                />
                <Text style={aide}>
                  L’app ne gère pas cet événement : elle le référence et renvoie
                  vers le site qui l’organise.
                </Text>
              </Bloc>
            ) : (
              <>
                <Bloc titre="LES PLACES">
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Text style={{ flex: 1, fontSize: 13, fontFamily: Fonts.uiBold, color: Colors.textPrimary }}>
                      Limiter le nombre de places
                    </Text>
                    <Switch
                      value={draft.limit}
                      onValueChange={v => maj({ limit: v })}
                      trackColor={{ true: Colors.brand, false: Colors.borderLight }}
                      thumbColor={Colors.bgCard}
                    />
                  </View>
                  {draft.limit ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, alignSelf: 'center' }}>
                      <Pas signe="−" onPress={() => maj({ capacity: Math.max(1, draft.capacity - 1) })} />
                      <Text style={{ fontSize: 26, fontFamily: Fonts.display, color: Colors.textPrimary, minWidth: 44, textAlign: 'center' }}>
                        {draft.capacity}
                      </Text>
                      <Pas signe="+" onPress={() => maj({ capacity: Math.min(200, draft.capacity + 1) })} />
                    </View>
                  ) : (
                    <Text style={aide}>Tout le monde peut venir — aucune place n’est comptée.</Text>
                  )}
                </Bloc>

                <Bloc titre="LE PRIX">
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {PRIX.map(p => {
                      const choisi = draft.priceMad === p;
                      return (
                        <TouchableOpacity
                          key={p}
                          onPress={() => maj({ priceMad: p })}
                          style={{
                            paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
                            backgroundColor: choisi ? Colors.brand : Colors.bgCardAlt,
                          }}
                        >
                          <Text style={{
                            fontSize: 12, fontFamily: Fonts.uiBlack,
                            color: choisi ? Colors.primary : Colors.textSecondary,
                          }}>
                            {p === 0 ? 'Gratuit' : `${p} MAD`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={aide}>Affiché seulement : l’app n’encaisse rien, on paie sur place.</Text>
                </Bloc>
              </>
            )}

            <Bloc titre="DEUX LIGNES POUR DIRE CE QUE C’EST">
              <TextInput
                value={draft.description}
                onChangeText={t => maj({ description: t })}
                maxLength={280}
                multiline
                placeholder="Raquettes prêtées, balles fournies. On tourne toutes les 20 min."
                placeholderTextColor={Colors.textMuted}
                style={[champ, { minHeight: 76, textAlignVertical: 'top' }]}
              />
            </Bloc>
          </>
        )}

        {/* ── 4. Récapitulatif ── */}
        {step === 3 && draft.kind && (
          <>
            <Text style={aide}>Voilà exactement la carte que les joueurs verront.</Text>

            <View style={{ backgroundColor: Colors.brand, borderRadius: 22, padding: 16, gap: 8 }}>
              <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, letterSpacing: 1, color: Colors.primary }}>
                {eventKindLabel(draft.kind).toUpperCase()}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}
                style={{ fontSize: 22, fontFamily: Fonts.welcome, color: Colors.primary, paddingRight: 6, alignSelf: 'stretch' }}>
                {draft.title.trim()}
              </Text>
              <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: 'rgba(10,10,10,0.65)' }}>
                {new Date(`${draft.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}
                {' · '}{draft.start}{draft.end ? ` – ${draft.end}` : ''}
                {club ? ` · ${club.name}` : ''}
              </Text>
              {!externe && (
                <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBlack, color: Colors.primary }}>
                  {eventPriceLabel(draft.priceMad)}
                  {draft.limit ? ` · ${draft.capacity} places` : ' · places non limitées'}
                </Text>
              )}
              {draft.description.trim() !== '' && (
                <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: 'rgba(10,10,10,0.7)', lineHeight: 17 }}>
                  {draft.description.trim()}
                </Text>
              )}
            </View>

            <Bloc titre="ENSUITE">
              <Text style={aide}>
                {externe
                  ? 'Les joueurs verront le lien et pourront dire qu’ils y vont. Rien d’autre n’est géré ici.'
                  : 'Les joueurs répondent « J’y serai » d’un tap. Quand c’est complet, ils peuvent demander à être prévenus si une place se libère.'}
              </Text>
            </Bloc>
          </>
        )}
      </ScrollView>

      {/* La barre disparaît pendant la recherche de club : sur Android elle
          remonte avec le clavier, par-dessus la liste des résultats. */}
      {!listeOuverte && (
        <View style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12,
          backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: Colors.border, gap: 8,
        }}>
          {souci && (
            <Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted, textAlign: 'center' }}>
              {souci}
            </Text>
          )}
          <TouchableOpacity
            onPress={step === ETAPES.length - 1 ? publier : suivant}
            disabled={busy}
            activeOpacity={0.85}
            style={{
              backgroundColor: Colors.primary, borderRadius: 16,
              paddingVertical: 16, alignItems: 'center', opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? <ActivityIndicator color={Colors.textOnDark} /> : (
              <Text style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.6, color: Colors.textOnDark }}>
                {step === ETAPES.length - 1 ? 'PUBLIER' : 'CONTINUER →'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      <DateSheet
        visible={feuilleDate} value={draft.date}
        onPick={iso => maj({ date: iso })} onClose={() => setFeuilleDate(false)}
      />
      <TimeSheet
        visible={feuilleDebut} value={draft.start}
        onPick={h => maj({ start: h })} onClose={() => setFeuilleDebut(false)}
      />
      <TimeSheet
        visible={feuilleFin} value={draft.end ?? draft.start}
        onPick={h => maj({ end: h })} onClose={() => setFeuilleFin(false)}
      />
    </View>
  );
}

function Bloc({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBlack, letterSpacing: 1, color: Colors.textMuted }}>
        {titre}
      </Text>
      <View style={{
        backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1,
        borderColor: Colors.border, padding: 14, gap: 10,
      }}>
        {children}
      </View>
    </View>
  );
}

function Pas({ signe, onPress }: { signe: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={10}
      style={{
        width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
        backgroundColor: Colors.bgCardAlt,
      }}
    >
      <Text style={{ fontSize: 20, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>{signe}</Text>
    </TouchableOpacity>
  );
}

const champ = {
  backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
  borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
  fontSize: 14, fontFamily: Fonts.uiBold, color: Colors.textPrimary,
} as const;

const champTouche = {
  backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border,
  borderRadius: 12, paddingHorizontal: 12, paddingVertical: 13,
} as const;

const valeur = {
  fontSize: 14, fontFamily: Fonts.uiBold, color: Colors.textPrimary,
} as const;

const aide = {
  fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 17,
} as const;
