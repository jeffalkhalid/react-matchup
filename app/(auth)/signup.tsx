import { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  Platform, ScrollView, ActivityIndicator, Alert,
  KeyboardAvoidingView, SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import HCaptcha from '@hcaptcha/react-native-hcaptcha';
import { supabase } from '../../lib/supabase';
import { Colors, Spacing, FontSize, Radius } from '../../lib/theme';
import PadelRacketIcon from '../../components/PadelRacketIcon';

const HCAPTCHA_SITE_KEY = process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY!;
const COLLECT_FRMT_IDENTITY = true;
const TOTAL_STEPS = 5;

// ⚠️ DEV : captcha auto-validé pour faciliter les tests de signup.
// Remettre à `true` avant la prod (ou migrer vers Turnstile, cf. mémoire).
// IMPORTANT : nécessite aussi de désactiver le captcha côté Supabase
// (Dashboard → Authentication → Settings → Bot and Abuse Protection → Disabled),
// sinon Supabase rejettera signUp même si on n'envoie pas de captchaToken.
const CAPTCHA_ENABLED = false;

// ── ELO helpers ────────────────────────────────────────────────────────────
const PADEL_ANCHORS: [number, number][] = [
  [0, 1.0], [650, 2.0], [800, 3.0], [950, 4.0],
  [1100, 5.0], [1250, 6.0], [1500, 7.0], [1750, 8.0],
];
function formatPadelLevel(elo: number): string {
  if (elo <= 0) return '1.00';
  if (elo >= 1750) return '8.00';
  for (let i = 0; i < PADEL_ANCHORS.length - 1; i++) {
    const [eL, lL] = PADEL_ANCHORS[i];
    const [eH, lH] = PADEL_ANCHORS[i + 1];
    if (elo >= eL && elo < eH) {
      const t = (elo - eL) / (eH - eL);
      return (Math.round((lL + t * (lH - lL)) * 100) / 100).toFixed(2);
    }
  }
  return '8.00';
}
function parseFrmtRankNumber(rank: string): number | null {
  const m = rank.trim().replace(/\s/g, '').match(/^[Pp]?(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}
function getFrmtBonus(n: number): number {
  if (n <= 25) return 650; if (n <= 100) return 350;
  if (n <= 250) return 200; if (n <= 500) return 100;
  if (n <= 1000) return 50; return 25;
}

// ── Types ──────────────────────────────────────────────────────────────────
interface FormData {
  gender: string; ageGroup: string; handedness: string; preferredSide: string;
  estimatedLevel: string; frequency: string; tournaments: string;
  hasFrmtRank: '' | 'yes' | 'no'; frmtRank: string; frmtFirstName: string; frmtLastName: string;
  techniques: string[]; name: string; email: string; password: string;
}
const INITIAL: FormData = {
  gender: '', ageGroup: '', handedness: '', preferredSide: '',
  estimatedLevel: '', frequency: '', tournaments: '',
  hasFrmtRank: '', frmtRank: '', frmtFirstName: '', frmtLastName: '',
  techniques: [], name: '', email: '', password: '',
};
const TECHNIQUES = [
  { id: 'Vitre',       label: 'Défense avec la vitre' },
  { id: 'Lob',         label: 'Lob profond millimétré' },
  { id: 'Bandeja',     label: 'Bandeja (Sans rebond fort)' },
  { id: 'Vibora',      label: 'Víbora (Gros effet coupé)' },
  { id: 'Chiquita',    label: 'Chiquita (Petite balle courte)' },
  { id: 'Bajada',      label: 'Bajada (Sortie de vitre attaque)' },
  { id: 'Par3',        label: 'Smash Par 3' },
  { id: 'Contrapared', label: 'Contre-Vitre (Contrapared)' },
];

// ── Compact SelectCard ─────────────────────────────────────────────────────
function Card({
  label, value, field, formData, onSet, description = '', icon = '',
}: {
  label: string; value: string; field: keyof FormData;
  formData: FormData; onSet: (f: keyof FormData, v: string) => void;
  description?: string; icon?: string | React.ReactNode;
}) {
  const selected = (formData[field] as string) === value;
  return (
    <TouchableOpacity
      onPress={() => onSet(field, value)}
      style={{
        paddingVertical: 10, paddingHorizontal: 10,
        borderRadius: Radius.md, borderWidth: 2,
        borderColor: selected ? Colors.primary : Colors.border,
        backgroundColor: selected ? `${Colors.primary}18` : Colors.bgCard,
        flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1,
      }}
    >
      {icon ? (typeof icon === 'string' ? <Text style={{ fontSize: 15 }}>{icon}</Text> : icon) : null}
      <View style={{ flex: 1 }}>
        <Text style={{ color: selected ? Colors.primary : Colors.textPrimary, fontWeight: '700', fontSize: FontSize.sm }} numberOfLines={2}>
          {label}
        </Text>
        {description ? <Text style={{ color: Colors.textMuted, fontSize: 10, marginTop: 1 }}>{description}</Text> : null}
      </View>
      {selected ? <Text style={{ color: Colors.primary, fontSize: 13 }}>✓</Text> : null}
    </TouchableOpacity>
  );
}

function Label({ text }: { text: string }) {
  return (
    <Text style={{ color: Colors.textMuted, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>
      {text}
    </Text>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 8 }}>{children}</View>;
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function SignupScreen() {
  const router = useRouter();
  const captchaRef = useRef<HCaptcha>(null);
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // DEV : auto-valide le captcha au mount pour activer le bouton « Créer
  // mon compte » sans avoir à résoudre un défi. UI inchangée (badge ✅).
  useEffect(() => {
    if (!CAPTCHA_ENABLED) setCaptchaToken('dev-bypass');
  }, []);
  const [formData, setFormData] = useState<FormData>(INITIAL);

  const set = (field: keyof FormData, value: string) =>
    setFormData(prev => ({ ...prev, [field]: value }));

  const toggleTechnique = (label: string) =>
    setFormData(prev => ({
      ...prev,
      techniques: prev.techniques.includes(label)
        ? prev.techniques.filter(t => t !== label)
        : [...prev.techniques, label],
    }));

  const getObjSignal = () => {
    const freq = formData.frequency === 'Plusieurs fois par semaine' ? 100
               : formData.frequency === '1 fois par semaine' ? 50 : 0;
    const tour = formData.tournaments === 'Oui, souvent' ? 150
               : formData.tournaments === 'Oui, quelques-uns' ? 50 : 0;
    return freq + tour + formData.techniques.length * 25;
  };

  const getHonestyFactor = () => {
    const MIN_OBJ: Record<string, number> = {
      Novice: 0, Débutant: 0, Amateur: 50, Intermédiaire: 100, Avancé: 200, Expert: 300,
    };
    const minObj = MIN_OBJ[formData.estimatedLevel] ?? 0;
    if (minObj === 0) return 1;
    const obj = getObjSignal();
    return obj >= minObj ? 1 : Math.max(0.5, obj / minObj);
  };

  const calculateInitialScore = () => {
    const LEVEL_BONUS: Record<string, number> = {
      Novice: 0, Débutant: 100, Amateur: 200, Intermédiaire: 400, Avancé: 600, Expert: 800,
    };
    const selfBonus = LEVEL_BONUS[formData.estimatedLevel] ?? 0;
    const selfScore = Math.min(800 + getObjSignal() + Math.round(selfBonus * getHonestyFactor()), 1350);
    let frmtBonus = 0;
    if (formData.hasFrmtRank === 'yes') {
      const n = parseFrmtRankNumber(formData.frmtRank);
      if (n !== null) frmtBonus = getFrmtBonus(n);
    }
    return Math.min(selfScore + frmtBonus, 2400);
  };

  const canProceed = (s: number) => {
    if (s === 1) return !!(formData.gender && formData.ageGroup && formData.handedness && formData.preferredSide);
    if (s === 2) return !!(formData.estimatedLevel && formData.frequency && formData.tournaments);
    if (s === 3) {
      if (!formData.hasFrmtRank) return false;
      if (formData.hasFrmtRank === 'yes') {
        if (!parseFrmtRankNumber(formData.frmtRank)) return false;
        if (COLLECT_FRMT_IDENTITY && (!formData.frmtFirstName.trim() || !formData.frmtLastName.trim())) return false;
      }
      return true;
    }
    return true;
  };

  const handleCaptchaMessage = (event: any) => {
    const data = event?.nativeEvent?.data;
    if (!data) return;
    if (data === 'open') return;
    if (data === 'challenge-closed' || data === 'cancel') { setCaptchaToken(null); return; }
    if (data === 'expired') { setCaptchaToken(null); return; }
    if (data === 'error') { setCaptchaToken(null); Alert.alert('Captcha', 'Une erreur est survenue.'); return; }
    if (data.length > 35) setCaptchaToken(data);
  };

  const handleCreateAccount = async () => {
    if (!captchaToken || !formData.name.trim() || !formData.email || !formData.password) return;
    setIsSubmitting(true);
    try {
      const { count: nameCount, error: nameErr } = await supabase
        .from('players').select('id', { count: 'exact', head: true }).ilike('name', formData.name.trim());
      if (nameErr) throw nameErr;
      if ((nameCount ?? 0) > 0) throw new Error('pseudo_taken');

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email, password: formData.password,
        ...(CAPTCHA_ENABLED && captchaToken ? { options: { captchaToken } } : {}),
      });
      if (authError) throw authError;
      if (!authData.user?.identities || authData.user.identities.length === 0) throw new Error('email_taken');

      const { count: existing } = await supabase
        .from('players').select('id', { count: 'exact', head: true }).eq('user_id', authData.user.id);
      if ((existing ?? 0) > 0) throw new Error('email_taken');

      const payload: Record<string, unknown> = {
        user_id: authData.user.id, name: formData.name.trim(),
        elo_score: calculateInitialScore(), fiability_pct: 50,
        handedness: formData.handedness || null,
        preferred_side: formData.preferredSide || null,
        gender: formData.gender === 'Homme' ? 'male' : formData.gender === 'Femme' ? 'female' : null,
      };
      if (formData.hasFrmtRank === 'yes') {
        const n = parseFrmtRankNumber(formData.frmtRank);
        if (n) payload.federation_rank = String(n);
      }
      if (COLLECT_FRMT_IDENTITY && formData.hasFrmtRank === 'yes' && formData.frmtFirstName.trim() && formData.frmtLastName.trim()) {
        payload.frmt_full_name = `${formData.frmtFirstName.trim()} ${formData.frmtLastName.trim()}`;
      }
      const { error: profileError } = await supabase.from('players').insert([payload]);
      if (profileError) throw profileError;
      setIsSuccess(true);
    } catch (err: unknown) {
      const raw = (err as Error).message;
      const msg = raw === 'pseudo_taken' ? 'Ce pseudo est déjà utilisé.'
        : raw === 'email_taken' || raw.includes('already registered') ? 'Cet email est déjà utilisé.'
        : 'Erreur : ' + raw;
      Alert.alert('Erreur', msg);
      (captchaRef.current as any)?.reset();
      setCaptchaToken(null);
      setIsSubmitting(false);
    }
  };

  const stepLabels = ['Profil', 'Niveau', 'Compét.', 'Technique', 'Compte'];

  // ── Bottom nav buttons per step ──────────────────────────────────────────
  const renderBottomNav = () => {
    if (isSuccess) return null;

    const nextDisabled = !canProceed(step);
    const backStyle = {
      paddingHorizontal: Spacing.lg, paddingVertical: 13,
      borderRadius: Radius.md, backgroundColor: Colors.bgCardAlt,
    };
    const nextStyle = {
      flex: 1 as const, paddingVertical: 13, borderRadius: Radius.md,
      alignItems: 'center' as const,
      backgroundColor: nextDisabled ? Colors.bgCardAlt : Colors.primary,
      opacity: nextDisabled ? 0.5 : 1,
    };

    if (step === 1) return (
      <TouchableOpacity onPress={() => setStep(2)} disabled={nextDisabled} style={nextStyle}>
        <Text style={{ color: '#fff', fontWeight: '900', fontSize: FontSize.base }}>Suivant ➔</Text>
      </TouchableOpacity>
    );
    if (step === 2) return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity onPress={() => setStep(1)} style={backStyle}>
          <Text style={{ color: Colors.textSecondary, fontWeight: '700' }}>Retour</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setStep(3)} disabled={nextDisabled} style={nextStyle}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: FontSize.base }}>Suivant ➔</Text>
        </TouchableOpacity>
      </View>
    );
    if (step === 3) return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity onPress={() => setStep(2)} style={backStyle}>
          <Text style={{ color: Colors.textSecondary, fontWeight: '700' }}>Retour</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setStep(4)} disabled={nextDisabled} style={nextStyle}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: FontSize.base }}>Suivant ➔</Text>
        </TouchableOpacity>
      </View>
    );
    if (step === 4) return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity onPress={() => setStep(3)} style={backStyle}>
          <Text style={{ color: Colors.textSecondary, fontWeight: '700' }}>Retour</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setStep(5)} style={{ ...nextStyle, opacity: 1, backgroundColor: Colors.primary }}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: FontSize.base }}>Voir mon niveau ➔</Text>
        </TouchableOpacity>
      </View>
    );
    if (step === 5) return (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity onPress={() => setStep(4)} style={backStyle}>
          <Text style={{ color: Colors.textSecondary, fontWeight: '700' }}>Retour</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleCreateAccount}
          disabled={isSubmitting || !captchaToken || !formData.name.trim() || !formData.email || formData.password.length < 6}
          style={{
            ...nextStyle,
            backgroundColor: Colors.bgCardAlt,
            opacity: (isSubmitting || !captchaToken || !formData.name.trim() || !formData.email || formData.password.length < 6) ? 0.5 : 1,
          }}
        >
          {isSubmitting
            ? <ActivityIndicator color="#fff" />
            : <Text style={{ color: '#fff', fontWeight: '900', fontSize: FontSize.base }}>Rejoindre le club 🚀</Text>
          }
        </TouchableOpacity>
      </View>
    );
    return null;
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: Colors.bg }}
    >
      {/* HCaptcha — mounted at root, survives step changes */}
      <HCaptcha
        ref={captchaRef}
        siteKey={HCAPTCHA_SITE_KEY}
        baseUrl="https://hcaptcha.com"
        onMessage={handleCaptchaMessage}
        languageCode="fr"
        size="invisible"
      />

      {/* ── Fixed top ── */}
      <View style={{ paddingTop: 52, paddingHorizontal: Spacing.lg, paddingBottom: 8, backgroundColor: Colors.bg }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900' }}>
            <Text style={{ color: '#FACC15' }}>PAG</Text> Match
          </Text>
          <TouchableOpacity onPress={() => router.replace('/')}>
            <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '700' }}>Annuler</Text>
          </TouchableOpacity>
        </View>

        {!isSuccess && (
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 }}>
              {stepLabels.map((label, i) => (
                <Text key={label} style={{
                  fontSize: 10, fontWeight: '700',
                  color: step >= i + 1 ? Colors.primary : Colors.textMuted,
                }}>{label}</Text>
              ))}
            </View>
            <View style={{ height: 5, backgroundColor: Colors.bgCardAlt, borderRadius: Radius.full, overflow: 'hidden' }}>
              <View style={{
                height: '100%', width: `${(step / TOTAL_STEPS) * 100}%`,
                backgroundColor: Colors.primary, borderRadius: Radius.full,
              }} />
            </View>
          </View>
        )}
      </View>

      {/* ── Scrollable content ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── STEP 1: PROFIL ── */}
        {step === 1 && (
          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ fontSize: 28, marginBottom: 2 }}>👤</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: '900' }}>Commençons par les bases</Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2 }}>Pour t'associer aux bons partenaires.</Text>
            </View>

            <View>
              <Label text="Tu es ?" />
              <Row>
                <Card label="Homme" value="Homme" field="gender" formData={formData} onSet={set} />
                <Card label="Femme" value="Femme" field="gender" formData={formData} onSet={set} />
              </Row>
            </View>

            <View>
              <Label text="Âge" />
              <Row>
                {['-25', '26-35', '36-45', '46+'].map(v => (
                  <Card key={v} label={v} value={v} field="ageGroup" formData={formData} onSet={set} />
                ))}
              </Row>
            </View>

            <View>
              <Label text="Main forte" />
              <Row>
                <Card label="Droitier" value="Droitier" field="handedness" formData={formData} onSet={set} icon="✍️" />
                <Card label="Gaucher" value="Gaucher" field="handedness" formData={formData} onSet={set} icon="👈" />
              </Row>
            </View>

            <View>
              <Label text="Côté préféré" />
              <Row>
                <Card label="Gauche" value="Gauche" field="preferredSide" formData={formData} onSet={set} />
                <Card label="Droit" value="Droit" field="preferredSide" formData={formData} onSet={set} />
                <Card label="Peu importe" value="Mixte" field="preferredSide" formData={formData} onSet={set} />
              </Row>
            </View>
          </View>
        )}

        {/* ── STEP 2: EXPÉRIENCE ── */}
        {step === 2 && (
          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ fontSize: 28, marginBottom: 2 }}>📈</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: '900' }}>Ton expérience</Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2 }}>Sois honnête, l'algo a besoin de vraies infos.</Text>
            </View>

            <View>
              <Label text="Niveau estimé" />
              <View style={{ gap: 6 }}>
                <Row>
                  <Card label="Novice" value="Novice" field="estimatedLevel" formData={formData} onSet={set} description="1.0 – 2.5" />
                  <Card label="Débutant" value="Débutant" field="estimatedLevel" formData={formData} onSet={set} description="2.5 – 3.5" />
                </Row>
                <Row>
                  <Card label="Amateur" value="Amateur" field="estimatedLevel" formData={formData} onSet={set} description="3.5 – 4.5" />
                  <Card label="Intermédiaire" value="Intermédiaire" field="estimatedLevel" formData={formData} onSet={set} description="4.5 – 5.5" />
                </Row>
                <Row>
                  <Card label="Avancé" value="Avancé" field="estimatedLevel" formData={formData} onSet={set} description="5.5 – 6.5" />
                  <Card label="Expert" value="Expert" field="estimatedLevel" formData={formData} onSet={set} description="6.5 – 8.0" />
                </Row>
              </View>
            </View>

            <View>
              <Label text="Fréquence de jeu" />
              <View style={{ gap: 6 }}>
                <Row>
                  <Card label="Occasionnel" value="Occasionnel" field="frequency" formData={formData} onSet={set} />
                  <Card label="1x / semaine" value="1 fois par semaine" field="frequency" formData={formData} onSet={set} />
                </Row>
                <Card label="2x par semaine ou +" value="Plusieurs fois par semaine" field="frequency" formData={formData} onSet={set} />
              </View>
            </View>

            <View>
              <Label text="Tournois FRMT ?" />
              <View style={{ gap: 6 }}>
                <Row>
                  <Card label="Jamais" value="Jamais" field="tournaments" formData={formData} onSet={set} />
                  <Card label="Quelques-uns" value="Oui, quelques-uns" field="tournaments" formData={formData} onSet={set} />
                </Row>
                <Card label="Souvent" value="Oui, souvent" field="tournaments" formData={formData} onSet={set} />
              </View>
            </View>
          </View>
        )}

        {/* ── STEP 3: FRMT ── */}
        {step === 3 && (
          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ fontSize: 28, marginBottom: 2 }}>🏆</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: '900' }}>Compétition officielle</Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2 }}>FRMT — Fédération Royale Marocaine de Tennis</Text>
            </View>

            <View>
              <Label text="As-tu un classement FRMT ?" />
              <Row>
                <Card label="Oui, j'ai un classement" value="yes" field="hasFrmtRank" formData={formData} onSet={set} icon="✅" />
                <Card label="Non, je joue en loisir" value="no" field="hasFrmtRank" formData={formData} onSet={set} icon={<PadelRacketIcon size={16} />} />
              </Row>
            </View>

            {formData.hasFrmtRank === 'yes' && (
              <>
                <View>
                  <Label text="Ton rang FRMT" />
                  <TextInput
                    value={formData.frmtRank}
                    onChangeText={v => set('frmtRank', v)}
                    placeholder="Ex : 147 ou 27"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="numeric"
                    style={{
                      backgroundColor: Colors.bgCardAlt, borderRadius: Radius.md,
                      borderWidth: 2, borderColor: Colors.border,
                      color: Colors.textPrimary, fontSize: FontSize.md,
                      padding: Spacing.md, fontWeight: '700',
                    }}
                  />
                  {formData.frmtRank !== '' && !parseFrmtRankNumber(formData.frmtRank) && (
                    <Text style={{ color: Colors.danger, fontSize: FontSize.xs, marginTop: 4, fontWeight: '700' }}>Format invalide.</Text>
                  )}
                </View>

                {COLLECT_FRMT_IDENTITY && (
                  <View style={{
                    backgroundColor: `${Colors.info}15`, borderWidth: 1, borderColor: `${Colors.info}30`,
                    borderRadius: Radius.md, padding: Spacing.md, gap: 8,
                  }}>
                    <Text style={{ color: Colors.info, fontSize: FontSize.sm, fontWeight: '900' }}>Vérification du classement</Text>
                    <Text style={{ color: Colors.textMuted, fontSize: FontSize.xs, lineHeight: 16 }}>
                      Ton nom sera comparé à la base FRMT pour le badge vérifié. Jamais affiché publiquement.
                    </Text>
                    <Row>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', marginBottom: 4 }}>Prénom</Text>
                        <TextInput
                          value={formData.frmtFirstName}
                          onChangeText={v => set('frmtFirstName', v)}
                          placeholder="Prénom"
                          placeholderTextColor={Colors.textMuted}
                          style={{
                            backgroundColor: Colors.bgCard, borderRadius: Radius.sm,
                            borderWidth: 1, borderColor: Colors.border,
                            color: Colors.textPrimary, fontSize: FontSize.sm, padding: 10, fontWeight: '700',
                          }}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: Colors.textSecondary, fontSize: 10, fontWeight: '700', marginBottom: 4 }}>Nom</Text>
                        <TextInput
                          value={formData.frmtLastName}
                          onChangeText={v => set('frmtLastName', v)}
                          placeholder="Nom"
                          placeholderTextColor={Colors.textMuted}
                          style={{
                            backgroundColor: Colors.bgCard, borderRadius: Radius.sm,
                            borderWidth: 1, borderColor: Colors.border,
                            color: Colors.textPrimary, fontSize: FontSize.sm, padding: 10, fontWeight: '700',
                          }}
                        />
                      </View>
                    </Row>
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* ── STEP 4: TECHNIQUE ── */}
        {step === 4 && (
          <View style={{ gap: 14 }}>
            <View>
              <Text style={{ fontSize: 28, marginBottom: 2 }}>🪄</Text>
              <Text style={{ color: Colors.textPrimary, fontSize: FontSize.xl, fontWeight: '900' }}>Le test de vérité</Text>
              <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, marginTop: 2 }}>
                Coups que tu maîtrises <Text style={{ fontWeight: '800' }}>vraiment</Text> en match.
              </Text>
            </View>
            <View style={{ gap: 6 }}>
              {TECHNIQUES.map((tech, i) => {
                if (i % 2 !== 0) return null;
                const next = TECHNIQUES[i + 1];
                const selA = formData.techniques.includes(tech.label);
                const selB = next && formData.techniques.includes(next.label);
                return (
                  <Row key={tech.id}>
                    <TouchableOpacity
                      onPress={() => toggleTechnique(tech.label)}
                      style={{
                        flex: 1, paddingVertical: 10, paddingHorizontal: 10,
                        borderRadius: Radius.md, borderWidth: 2,
                        borderColor: selA ? Colors.primary : Colors.border,
                        backgroundColor: selA ? `${Colors.primary}18` : Colors.bgCard,
                        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                      }}
                    >
                      <Text style={{ color: selA ? Colors.primary : Colors.textPrimary, fontWeight: '700', fontSize: FontSize.xs, flex: 1 }} numberOfLines={2}>
                        {tech.label}
                      </Text>
                      {selA && <Text style={{ color: Colors.primary, fontSize: 13 }}>✓</Text>}
                    </TouchableOpacity>
                    {next ? (
                      <TouchableOpacity
                        onPress={() => toggleTechnique(next.label)}
                        style={{
                          flex: 1, paddingVertical: 10, paddingHorizontal: 10,
                          borderRadius: Radius.md, borderWidth: 2,
                          borderColor: selB ? Colors.primary : Colors.border,
                          backgroundColor: selB ? `${Colors.primary}18` : Colors.bgCard,
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                        }}
                      >
                        <Text style={{ color: selB ? Colors.primary : Colors.textPrimary, fontWeight: '700', fontSize: FontSize.xs, flex: 1 }} numberOfLines={2}>
                          {next.label}
                        </Text>
                        {selB && <Text style={{ color: Colors.primary, fontSize: 13 }}>✓</Text>}
                      </TouchableOpacity>
                    ) : <View style={{ flex: 1 }} />}
                  </Row>
                );
              })}
            </View>
          </View>
        )}

        {/* ── STEP 5: COMPTE ── */}
        {step === 5 && !isSuccess && (
          <View style={{ gap: 14 }}>
            <View style={{ alignItems: 'center', paddingVertical: Spacing.sm }}>
              <View style={{
                backgroundColor: `${Colors.primary}20`, borderRadius: Radius.full,
                paddingHorizontal: 14, paddingVertical: 5, marginBottom: 10,
              }}>
                <Text style={{ color: Colors.primary, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5 }}>
                  Analyse terminée
                </Text>
              </View>
              <Text style={{ color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: '900' }}>Ton niveau de départ :</Text>
              <Text style={{ fontSize: 48, fontWeight: '900', color: Colors.primary, marginVertical: 6 }}>
                Niv. {formatPadelLevel(calculateInitialScore())}
              </Text>
              {formData.hasFrmtRank === 'yes' && (() => {
                const n = parseFrmtRankNumber(formData.frmtRank);
                if (!n) return null;
                return (
                  <View style={{
                    backgroundColor: `${Colors.info}15`, borderWidth: 1, borderColor: `${Colors.info}30`,
                    paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full, marginBottom: 6,
                  }}>
                    <Text style={{ color: Colors.info, fontWeight: '900', fontSize: FontSize.sm }}>🏆 Classé #{n} FRMT</Text>
                  </View>
                );
              })()}
              {getHonestyFactor() < 0.95 && (
                <View style={{
                  backgroundColor: `${Colors.warning}15`, borderWidth: 1, borderColor: `${Colors.warning}30`,
                  borderRadius: Radius.md, padding: Spacing.sm,
                }}>
                  <Text style={{ color: Colors.warning, fontSize: FontSize.xs, lineHeight: 17 }}>
                    ⚠️ Niveau ajusté selon ta fréquence, tournois et coups maîtrisés. Tes résultats te feront progresser vite !
                  </Text>
                </View>
              )}
            </View>

            <TextInput
              value={formData.name}
              onChangeText={v => set('name', v)}
              placeholder="Pseudo d'affichage"
              placeholderTextColor={Colors.textMuted}
              style={{
                backgroundColor: Colors.bgCardAlt, borderRadius: Radius.md,
                borderWidth: 1, borderColor: Colors.border,
                color: Colors.textPrimary, fontSize: FontSize.base, padding: Spacing.md, fontWeight: '700',
              }}
            />
            <TextInput
              value={formData.email}
              onChangeText={v => set('email', v)}
              placeholder="Adresse email"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              style={{
                backgroundColor: Colors.bgCardAlt, borderRadius: Radius.md,
                borderWidth: 1, borderColor: Colors.border,
                color: Colors.textPrimary, fontSize: FontSize.base, padding: Spacing.md,
              }}
            />
            <View>
              <TextInput
                value={formData.password}
                onChangeText={v => set('password', v)}
                placeholder="Mot de passe (6 caractères min.)"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry={!showPassword}
                style={{
                  backgroundColor: Colors.bgCardAlt, borderRadius: Radius.md,
                  borderWidth: 1, borderColor: Colors.border,
                  color: Colors.textPrimary, fontSize: FontSize.base, padding: Spacing.md, paddingRight: 48,
                }}
              />
              <TouchableOpacity
                onPress={() => setShowPassword(v => !v)}
                style={{ position: 'absolute', right: Spacing.md, top: 14 }}
              >
                <Text style={{ color: Colors.textMuted, fontSize: 18 }}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={() => captchaRef.current?.show()}
              style={{
                borderRadius: Radius.md, borderWidth: 1,
                borderColor: captchaToken ? Colors.primary : Colors.border,
                backgroundColor: captchaToken ? `${Colors.primary}15` : Colors.bgCardAlt,
                padding: Spacing.md,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              <Text style={{ fontSize: 16 }}>{captchaToken ? '✅' : '🔒'}</Text>
              <Text style={{ color: captchaToken ? Colors.primary : Colors.textSecondary, fontSize: FontSize.sm, fontWeight: '600' }}>
                {captchaToken ? 'Captcha validé' : 'Je ne suis pas un robot'}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── SUCCESS ── */}
        {isSuccess && (
          <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }}>
            <Text style={{ fontSize: 64, marginBottom: Spacing.lg }}>✉️</Text>
            <Text style={{ color: Colors.textPrimary, fontSize: FontSize.xxl, fontWeight: '900', marginBottom: Spacing.md, textAlign: 'center' }}>
              Vérifie tes emails !
            </Text>
            <Text style={{ color: Colors.textSecondary, fontSize: FontSize.sm, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.xl }}>
              Lien de confirmation envoyé à{'\n'}
              <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>{formData.email}</Text>.{'\n\n'}
              Active ton compte pour rejoindre la piste avec{' '}
              <Text style={{ color: Colors.primary, fontWeight: '700' }}>Niv. {formatPadelLevel(calculateInitialScore())}</Text>.
            </Text>
            <TouchableOpacity
              onPress={() => router.replace('/(auth)/login')}
              style={{ backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: FontSize.base }}>Aller à la connexion</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* ── Fixed bottom navigation ── */}
      {!isSuccess && (
        <View style={{
          paddingHorizontal: Spacing.lg, paddingTop: 10, paddingBottom: 28,
          backgroundColor: Colors.bg, borderTopWidth: 1, borderTopColor: Colors.border,
        }}>
          {renderBottomNav()}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
