// app/tournaments/create.tsx — l'assistant de création d'un tournoi.
// Implémente `design_handoff_tournois`, chantier 2.
//
// Il sort la création du panel arbitre, où elle était une pile de champs
// séparés : nom, date, heure, terrains, rotations, niveau min, niveau max,
// prix, barème. Rien ne disait qu'on publiait une soirée à 16 places en
// réservant 4 terrains — on remplissait des cases.
//
// ÉCART ASSUMÉ AVEC LE HANDOFF : quatre étapes, pas cinq. La quatrième qu'il
// prévoyait (« ouverture des inscriptions, appariement des joueurs seuls »)
// ne collecte RIEN que `tournament_create` accepte — les inscriptions ouvrent
// à la création, et l'appariement se fait le soir même depuis le panel, sur
// des inscrits qui n'existent pas encore ici. Une étape qui ne recueille rien
// est une étape qui coûte un tap.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../../components/community/icons';
import { DateSheet, TimeSheet } from '../../components/tournaments/DateTimeSheets';
import {
  createTournament, teamCount, seatCount, ROUND_MINUTES,
  ROUND_MINUTES_CHOICES, totalDurationMinutes,
  defaultPointsScale, isoDay, priceLabel, levelRangeLabel,
} from '../../lib/tournaments';

type Club = { id: string; name: string; city: string | null };

const STEPS = ['QUAND & OÙ', 'LE TYPE', 'LE FORMAT', 'RÉCAPITULATIF'];

/** Les créneaux proposés d'un tap — le reste passe par la liste complète. */
const QUICK_TIMES = ['18:00', '19:00', '20:00', '21:00'];

/** Les rotations proposées, avec la durée qu'elles impliquent. */
const ROUND_CHOICES = [4, 5, 6, 8];

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function Section({ title, right, children }: {
  title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.8, color: Colors.textPrimary }}>
          {title}
        </Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Un choix parmi plusieurs, en pastilles — le motif de tout l'assistant. */
function Choice({ label, sub, active, disabled, onPress, flex }: {
  label: string; sub?: string; active: boolean; disabled?: boolean; onPress: () => void; flex?: number;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      style={{
        flex, alignItems: 'center', justifyContent: 'center',
        paddingVertical: 12, paddingHorizontal: 10, borderRadius: 14,
        backgroundColor: active ? Colors.primary : Colors.bgCard,
        borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{
        fontSize: 17, fontFamily: Fonts.display,
        color: active ? Colors.brand : Colors.textPrimary,
      }}>
        {label}
      </Text>
      {sub && (
        <Text style={{
          fontSize: 10.5, fontFamily: Fonts.uiBold, marginTop: 1,
          color: active ? 'rgba(255,255,255,0.6)' : Colors.textMuted,
        }}>
          {sub}
        </Text>
      )}
    </TouchableOpacity>
  );
}

export default function CreateTournamentScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { player } = usePlayer();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [date, setDate] = useState(() => {
    const d = new Date();
    return isoDay(d.getFullYear(), d.getMonth(), d.getDate());
  });
  const [time, setTime] = useState('19:00');
  const [dateSheet, setDateSheet] = useState(false);
  const [timeSheet, setTimeSheet] = useState(false);

  const [clubs, setClubs] = useState<Club[]>([]);
  const [club, setClub] = useState<Club | null>(null);
  const [clubsError, setClubsError] = useState(false);

  const [courts, setCourts] = useState(4);
  const [rounds, setRounds] = useState(6);
  const [levelMin, setLevelMin] = useState('');
  const [levelMax, setLevelMax] = useState('');
  const [price, setPrice] = useState('0');

  useEffect(() => {
    supabase.from('clubs').select('id,name,city').order('name').then(({ data, error }) => {
      // Sans `error` lu, un refus réseau laisserait la liste vide EN SILENCE et
      // le tournoi se créerait sans club sans qu'on sache pourquoi.
      if (error) setClubsError(true);
      setClubs((data ?? []) as Club[]);
    });
  }, []);

  const startsAt = useMemo(() => new Date(`${date}T${time}`), [date, time]);
  // La duree n'est plus une consequence du nombre de rotations : on reserve un
  // terrain pour un creneau, et selon le club une rotation dure 12, 15 ou 20
  // minutes. Les deux se disent, la duree se calcule.
  const [roundMinutes, setRoundMinutes] = useState<number>(ROUND_MINUTES);
  const duration = totalDurationMinutes(rounds, roundMinutes);

  const canContinue = useMemo(() => {
    if (step === 0) return name.trim().length > 0 && !isNaN(startsAt.getTime());
    if (step === 2) {
      const lo = levelMin === '' ? null : Number(levelMin);
      const hi = levelMax === '' ? null : Number(levelMax);
      if (lo != null && hi != null && lo > hi) return false;
      return courts > 0 && rounds > 0;
    }
    return true;
  }, [step, name, startsAt, levelMin, levelMax, courts, rounds]);

  const publish = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const t = await createTournament({
        name: name.trim(),
        startsAt: startsAt.toISOString(),
        clubId: club?.id ?? null,
        courtCount: courts,
        roundCount: rounds,
      roundMinutes,
        levelMin: levelMin === '' ? null : Number(levelMin),
        levelMax: levelMax === '' ? null : Number(levelMax),
        priceMad: Number(price) || 0,
        pointsScale: defaultPointsScale(teamCount(courts)),
        // Vestige du type : la RPC ne le lit pas, elle pose `created_by`
        // elle-meme via current_player_id(). On le fournit pour satisfaire
        // `TournamentCreateInput` sans toucher a son contrat.
        createdBy: player?.id ?? '',
      });
      router.replace(`/tournaments/${t.id}` as any);
    } catch (e: any) {
      // Le message arrive déjà traduit par lib/tournamentReasons.ts.
      Alert.alert('Création impossible', e?.message ?? 'Réessaie.');
    } finally {
      setSaving(false);
    }
  }, [saving, name, startsAt, club, courts, rounds, levelMin, levelMax, price, player, router]);

  // Les quatre soirs qui viennent, proposés d'un tap ; le calendrier reste
  // accessible pour tout le reste.
  const nextDays = useMemo(() => Array.from({ length: 4 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return {
      iso: isoDay(d.getFullYear(), d.getMonth(), d.getDate()),
      dow: d.toLocaleDateString('fr-FR', { weekday: 'short' }).slice(0, 3).toUpperCase(),
      num: String(d.getDate()),
    };
  }), []);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      {/* ── En-tête sombre + barre de progression ── */}
      <View style={{
        backgroundColor: Colors.heroBg,
        paddingTop: insets.top + 10, paddingHorizontal: 16, paddingBottom: 14,
        borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 12,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity
            onPress={() => (step === 0 ? router.back() : setStep(s => s - 1))}
            hitSlop={10}
          >
            <Icon name={step === 0 ? 'x' : 'chevronLeft'} size={22} color={Colors.textOnDark} stroke={2.2} />
          </TouchableOpacity>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} adjustsFontSizeToFit style={{
              alignSelf: 'stretch', fontSize: 21, fontFamily: Fonts.welcome,
              color: Colors.textOnDark, includeFontPadding: false, paddingRight: 8,
            }}>
              {step === 0 ? 'NOUVEAU TOURNOI' : STEPS[step]}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 11.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.5)' }}>
              {step === 0
                ? 'Montante / descente'
                : `${new Date(`${date}T${time}`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}${club ? ` · ${club.name}` : ''}`}
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, color: Colors.brand }}>
            {step + 1} / {STEPS.length}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 6 }}>
          {STEPS.map((_, i) => (
            <View key={i} style={{
              flex: 1, height: 4, borderRadius: 999,
              backgroundColor: i <= step ? Colors.brand : 'rgba(255,255,255,0.18)',
            }} />
          ))}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 110, gap: 22 }}>

          {/* ── 1. Quand & où ── */}
          {step === 0 && (
            <>
              <Section
                title="NOM DU TOURNOI"
                right={<Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>{name.length} / 40</Text>}
              >
                <TextInput
                  value={name}
                  onChangeText={t => setName(t.slice(0, 40))}
                  placeholder="Soirée du vendredi"
                  placeholderTextColor={Colors.textMuted}
                  style={{
                    backgroundColor: Colors.bgCard, borderRadius: 14,
                    borderWidth: 1, borderColor: Colors.border,
                    paddingHorizontal: 16, paddingVertical: 14,
                    fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary,
                  }}
                />
              </Section>

              <Section title="QUEL SOIR">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {nextDays.map(d => (
                    <Choice
                      key={d.iso}
                      flex={1}
                      label={d.num}
                      sub={d.dow}
                      active={date === d.iso}
                      onPress={() => setDate(d.iso)}
                    />
                  ))}
                  <TouchableOpacity
                    onPress={() => setDateSheet(true)}
                    activeOpacity={0.85}
                    style={{
                      width: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 14,
                      backgroundColor: Colors.bgCard, borderWidth: 1,
                      borderColor: nextDays.some(d => d.iso === date) ? Colors.border : Colors.primary,
                    }}
                  >
                    <Icon name="calendar" size={20} color={Colors.textSecondary} stroke={2.2} />
                  </TouchableOpacity>
                </View>
              </Section>

              <Section title="COUP D’ENVOI">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {QUICK_TIMES.map(h => (
                    <Choice key={h} flex={1} label={h} active={time === h} onPress={() => setTime(h)} />
                  ))}
                </View>
                <TouchableOpacity onPress={() => setTimeSheet(true)} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
                  <Text style={{ fontSize: 12, fontFamily: Fonts.uiExtraBold, color: Colors.brandDeep }}>
                    Autre horaire…
                  </Text>
                </TouchableOpacity>
              </Section>

              <Section title="LE CLUB">
                {clubsError && (
                  <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.warning }}>
                    La liste des clubs n’a pas pu être chargée. Tu peux créer le tournoi sans club.
                  </Text>
                )}
                <View style={{ gap: 8 }}>
                  {clubs.map(c => {
                    const active = club?.id === c.id;
                    return (
                      <TouchableOpacity
                        key={c.id}
                        onPress={() => setClub(active ? null : c)}
                        activeOpacity={0.85}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 12,
                          backgroundColor: Colors.bgCard, borderRadius: 16, padding: 12,
                          borderWidth: active ? 1.5 : 1, borderColor: active ? Colors.primary : Colors.border,
                        }}
                      >
                        <View style={{
                          width: 40, height: 40, borderRadius: 13,
                          backgroundColor: active ? Colors.primary : Colors.bg,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Icon name="mapPin" size={19} color={active ? Colors.brand : Colors.textMuted} stroke={2.2} />
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>
                            {c.name}
                          </Text>
                          {c.city && (
                            <Text numberOfLines={1} style={{ fontSize: 12, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                              {c.city}
                            </Text>
                          )}
                        </View>
                        {active && <Icon name="check" size={18} color={Colors.primary} stroke={2.8} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </Section>
            </>
          )}

          {/* ── 2. Le type ── */}
          {step === 1 && (
            <Section title="TYPE DE TOURNOI">
              <View style={{ gap: 10 }}>
                {[
                  { k: 'md', nom: 'Montante / descente', desc: 'Tu montes d’un terrain en gagnant, tu descends en perdant. Binôme fixe.', ok: true },
                  { k: 'am', nom: 'Américano', desc: 'Le partenaire change à chaque tour, classement individuel.', ok: false },
                  { k: 'pt', nom: 'Poules + tableau', desc: 'Des poules, puis un tableau à élimination.', ok: false },
                  { k: 'ed', nom: 'Élimination directe', desc: 'Un match perdu, on sort.', ok: false },
                ].map(t => (
                  <View
                    key={t.k}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      backgroundColor: t.ok ? Colors.primary : Colors.bgCard,
                      borderRadius: 16, padding: 14,
                      borderWidth: 1, borderColor: t.ok ? Colors.primary : Colors.border,
                      opacity: t.ok ? 1 : 0.55,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={{ fontSize: 15, fontFamily: Fonts.uiBlack, color: t.ok ? Colors.textOnDark : Colors.textPrimary }}>
                        {t.nom}
                      </Text>
                      <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, lineHeight: 16, color: t.ok ? 'rgba(255,255,255,0.6)' : Colors.textMuted }}>
                        {t.desc}
                      </Text>
                    </View>
                    {t.ok ? (
                      <Icon name="check" size={20} color={Colors.brand} stroke={2.8} />
                    ) : (
                      <View style={{ backgroundColor: Colors.bg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, color: Colors.textMuted }}>BIENTÔT</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
              {/* Les trois autres sont MONTRES plutot que caches : l'etape ne
                  changera pas de forme le jour ou on les branche. */}
            </Section>
          )}

          {/* ── 3. Le format ── */}
          {step === 2 && (
            <>
              <Section
                title="TERRAINS RÉSERVÉS"
                right={<Text style={{ fontSize: 11.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>
                  {club ? club.name : 'Sans club'}
                </Text>}
              >
                {/* La carte qui recalcule EN DIRECT : personne ne publie plus
                    une soiree a 16 places en croyant en ouvrir 8. */}
                <View style={{ backgroundColor: Colors.heroBg, borderRadius: 20, overflow: 'hidden' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, gap: 16 }}>
                    <TouchableOpacity
                      onPress={() => setCourts(c => Math.max(1, c - 1))}
                      activeOpacity={0.8}
                      style={{
                        width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
                      }}
                    >
                      <Text style={{ fontSize: 24, color: Colors.textOnDark, marginTop: -3 }}>−</Text>
                    </TouchableOpacity>

                    <View style={{ flex: 1, alignItems: 'center' }}>
                      <Text style={{ fontSize: 40, lineHeight: 44, fontFamily: Fonts.display, color: Colors.brand }}>
                        {courts}
                      </Text>
                      <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, letterSpacing: 1.4, color: 'rgba(255,255,255,0.5)' }}>
                        TERRAIN{courts > 1 ? 'S' : ''}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => setCourts(c => Math.min(20, c + 1))}
                      activeOpacity={0.8}
                      style={{
                        width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
                        backgroundColor: Colors.brand,
                      }}
                    >
                      <Text style={{ fontSize: 26, color: Colors.primary, marginTop: -3 }}>+</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.10)', marginHorizontal: 16 }} />

                  <View style={{ flexDirection: 'row', paddingVertical: 14 }}>
                    {[
                      { v: String(teamCount(courts)), l: 'BINÔMES' },
                      { v: String(seatCount(courts)), l: 'PLACES JOUEURS' },
                      { v: hhmm(duration), l: 'DURÉE' },
                    ].map(x => (
                      <View key={x.l} style={{ flex: 1, alignItems: 'center' }}>
                        <Text style={{ fontSize: 21, fontFamily: Fonts.display, color: '#FFFFFF' }}>{x.v}</Text>
                        <Text style={{ fontSize: 8.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.8, color: 'rgba(255,255,255,0.45)', marginTop: 1 }}>
                          {x.l}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              </Section>

              <Section title="ROTATIONS">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {ROUND_CHOICES.map(r => (
                    <Choice
                      key={r}
                      flex={1}
                      label={String(r)}
                      sub={hhmm(totalDurationMinutes(r, roundMinutes))}
                      active={rounds === r}
                      onPress={() => setRounds(r)}
                    />
                  ))}
                </View>
              </Section>

              <Section title="DURÉE D'UNE ROTATION">
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {ROUND_MINUTES_CHOICES.map(m => (
                    <Choice
                      key={m}
                      flex={1}
                      label={String(m)}
                      sub="min"
                      active={roundMinutes === m}
                      onPress={() => setRoundMinutes(m)}
                    />
                  ))}
                </View>
                <Text style={{ fontSize: 11.5, fontFamily: Fonts.ui, color: Colors.textSecondary, lineHeight: 16, marginTop: 8 }}>
                  {rounds} × {roundMinutes} min = {hhmm(duration)} de jeu. C'est ce
                  que tu dois avoir réservé au club.
                </Text>
              </Section>

              <Section
                title="NIVEAU ACCEPTÉ"
                right={<Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, color: Colors.brandDeep }}>
                  {levelRangeLabel(levelMin === '' ? null : Number(levelMin), levelMax === '' ? null : Number(levelMax))}
                </Text>}
              >
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {([['Min', levelMin, setLevelMin], ['Max', levelMax, setLevelMax]] as const).map(([lab, val, set]) => (
                    <View key={lab} style={{ flex: 1 }}>
                      <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBold, color: Colors.textMuted, marginBottom: 5 }}>
                        {lab} (optionnel)
                      </Text>
                      <TextInput
                        value={val}
                        onChangeText={v => set(v.replace(/[^0-9.]/g, ''))}
                        keyboardType="decimal-pad"
                        placeholder="—"
                        placeholderTextColor={Colors.textMuted}
                        style={{
                          backgroundColor: Colors.bgCard, borderRadius: 14,
                          borderWidth: 1, borderColor: Colors.border,
                          paddingHorizontal: 14, paddingVertical: 12,
                          fontSize: 16, fontFamily: Fonts.uiBlack, color: Colors.textPrimary, textAlign: 'center',
                        }}
                      />
                    </View>
                  ))}
                </View>
              </Section>

              <Section title="PARTICIPATION">
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: Colors.bgCard, borderRadius: 16,
                  borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12,
                }}>
                  <TextInput
                    value={price}
                    onChangeText={v => setPrice(v.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    style={{ fontSize: 24, fontFamily: Fonts.display, color: Colors.textPrimary, minWidth: 62 }}
                  />
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
                    MAD par joueur
                  </Text>
                  <View style={{ backgroundColor: Colors.bg, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 10.5, fontFamily: Fonts.uiBlack, color: Colors.textSecondary }}>SUR PLACE</Text>
                  </View>
                </View>
              </Section>
            </>
          )}

          {/* ── 4. Récapitulatif ── */}
          {step === 3 && (
            <Section title="CE QUE LES JOUEURS VERRONT">
              <View style={{
                backgroundColor: Colors.heroBg, borderRadius: 20, padding: 18, gap: 6,
              }}>
                <Text numberOfLines={2} style={{ fontSize: 24, lineHeight: 27, fontFamily: Fonts.welcome, color: '#FFFFFF' }}>
                  {name.trim() || 'Sans nom'}
                </Text>
                <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiSemi, color: 'rgba(255,255,255,0.62)' }}>
                  {startsAt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · {time}
                  {club ? ` · ${club.name}` : ''}
                </Text>
              </View>

              <View style={{ backgroundColor: Colors.bgCard, borderRadius: 16, borderWidth: 1, borderColor: Colors.border }}>
                {[
                  ['Format', `Montante / descente · ${teamCount(courts)} binômes`],
                  ['Terrains', `${courts} terrain${courts > 1 ? 's' : ''}`],
                  ['Places', `${seatCount(courts)} joueurs`],
                  ['Rotations', `${rounds} × ${roundMinutes} min · ${hhmm(duration)}`],
                  ['Niveau', levelRangeLabel(levelMin === '' ? null : Number(levelMin), levelMax === '' ? null : Number(levelMax))],
                  ['Participation', priceLabel(Number(price) || 0)],
                ].map(([k, v], i) => (
                  <View key={k} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    paddingHorizontal: 16, paddingVertical: 12,
                    borderTopWidth: i === 0 ? 0 : 1, borderTopColor: Colors.borderLight,
                  }}>
                    <Text style={{ flex: 1, fontSize: 12.5, fontFamily: Fonts.uiBold, color: Colors.textMuted }}>{k}</Text>
                    <Text style={{ fontSize: 13.5, fontFamily: Fonts.uiBlack, color: Colors.textPrimary }}>{v}</Text>
                  </View>
                ))}
              </View>

              <Text style={{ fontSize: 12, fontFamily: Fonts.ui, lineHeight: 17, color: Colors.textSecondary }}>
                Les inscriptions ouvrent dès la publication. Tu pourras apparier les joueurs
                seuls et lancer la soirée depuis le panel arbitre.
              </Text>
            </Section>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Barre d'action fixe ── */}
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        paddingHorizontal: 16, paddingTop: 12, paddingBottom: insets.bottom + 12,
        backgroundColor: Colors.bgCard, borderTopWidth: 1, borderTopColor: Colors.border,
      }}>
        <TouchableOpacity
          onPress={() => (step === STEPS.length - 1 ? publish() : setStep(s => s + 1))}
          disabled={!canContinue || saving}
          activeOpacity={0.85}
          style={{
            backgroundColor: Colors.primary, borderRadius: 16, paddingVertical: 16,
            alignItems: 'center', opacity: !canContinue || saving ? 0.5 : 1,
          }}
        >
          {saving ? (
            <ActivityIndicator color={Colors.textOnDark} />
          ) : (
            <Text style={{ fontSize: 15.5, fontFamily: Fonts.welcome, letterSpacing: 0.5, color: Colors.textOnDark }}>
              {step === STEPS.length - 1 ? 'PUBLIER LE TOURNOI' : 'CONTINUER  →'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <DateSheet visible={dateSheet} value={date} onPick={setDate} onClose={() => setDateSheet(false)} />
      <TimeSheet visible={timeSheet} value={time} onPick={setTime} onClose={() => setTimeSheet(false)} />
    </View>
  );
}
