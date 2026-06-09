import { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, Alert,
  KeyboardAvoidingView, Image, Dimensions, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';
import TurnstileCaptcha from '../../components/TurnstileCaptcha';
import { supabase } from '../../lib/supabase';
import { LEGAL } from '../../lib/legal';
import { Fonts } from '../../lib/theme';
import { useAuthTheme, AUTH_BRAND, AUTH_ERROR_BORDER, AUTH_ERROR_TEXT, type AuthThemeTokens } from '../../lib/auth-theme';

const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY!;
// Captcha (Cloudflare Turnstile) ACTIF. Clés en place (.env + Supabase Auth).
// ⚠️ Si désactivation un jour : repasser à false ICI ET dans login.tsx,
// ET désactiver "Captcha protection" dans Supabase → Auth → Settings.
const CAPTCHA_ENABLED = true;
const COLLECT_FRMT_IDENTITY = true;
const TOTAL_STEPS = 5;

const RACKET = require('../../assets/auth/splash-racket.png');
const TRAILS = require('../../assets/auth/splash-trails.png');
const DECO_TRAILS = require('../../assets/auth/deco-trails.png');

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

// ─── Icons ──────────────────────────────────────────────────────────────
const IconMail = ({ size = 18, color = '#9A9AA2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Rect x="2" y="4" width="20" height="16" rx="2" />
    <Path d="m22 7-10 5L2 7" />
  </Svg>
);

const IconLock = ({ size = 18, color = '#9A9AA2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Rect x="3" y="11" width="18" height="11" rx="2" />
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Svg>
);

const IconEye = ({ size = 18, color = '#9A9AA2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <Circle cx="12" cy="12" r="3" />
  </Svg>
);

const IconEyeOff = ({ size = 18, color = '#9A9AA2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <Path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <Path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <Path d="M2 2L22 22" />
  </Svg>
);

const IconUser = ({ size = 18, color = '#9A9AA2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <Circle cx="12" cy="7" r="4" />
  </Svg>
);

const IconArrowRight = ({ size = 18, color = '#0A0A0A' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Line x1="5" y1="12" x2="19" y2="12" />
    <Path d="m13 6 6 6-6 6" />
  </Svg>
);

const IconArrowLeft = ({ size = 18, color = '#9A9AA2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Line x1="19" y1="12" x2="5" y2="12" />
    <Path d="m11 18-6-6 6-6" />
  </Svg>
);

const IconAlertCircle = ({ size = 14, color = '#F87171' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="12" r="10" />
    <Path d="M12 8v4" />
    <Path d="M12 16h.01" />
  </Svg>
);

const IconCheck = ({ size = 28, color = '#FFC11A' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M20 6 9 17l-5-5" />
  </Svg>
);

// ─── Lockup (raquette + traits + wordmark) — 3 pièces, ratio 364/261 ───
function Lockup({ width, tokens }: { width: number; tokens: AuthThemeTokens }) {
  const ratio = 364 / 261;
  const h = width / ratio;
  return (
    <View style={{ width, height: h, position: 'relative' }}>
      <Image
        source={TRAILS}
        style={{
          position: 'absolute',
          left: width * 0.1456, top: h * 0.1763,
          width: width * 0.3571, height: h * 0.4215,
        }}
        resizeMode="contain"
      />
      <Image
        source={RACKET}
        style={{
          position: 'absolute',
          left: width * 0.478, top: 0,
          width: width * 0.4148, height: h * 0.5785,
        }}
        resizeMode="contain"
      />
      <Image
        source={tokens.wordmarkAsset}
        style={{
          position: 'absolute',
          left: 0, top: h * 0.5977,
          width, height: h * 0.4023,
        }}
        resizeMode="contain"
      />
    </View>
  );
}

// ─── Field Input (52px height, 14px radius, focus halo jaune) ──────────
function FieldInput({
  label, value, onChangeText, placeholder, icon, focused, onFocus, onBlur,
  secureTextEntry, rightElement, keyboardType, autoComplete, autoCapitalize,
  error, errorMessage, tokens,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder: string; icon?: React.ReactNode; focused: boolean;
  onFocus: () => void; onBlur: () => void; secureTextEntry?: boolean;
  rightElement?: React.ReactNode; keyboardType?: any; autoComplete?: any;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  error?: boolean; errorMessage?: string;
  tokens: AuthThemeTokens;
}) {
  const borderColor = error ? AUTH_ERROR_BORDER : focused ? AUTH_BRAND : tokens.fieldBorder;
  const bg = focused ? tokens.fieldFocusBg : tokens.fieldBg;

  return (
    <View>
      <Text style={{
        fontFamily: Fonts.uiExtraBold,
        fontSize: 11, color: tokens.label,
        textTransform: 'uppercase', letterSpacing: 1.32,
        marginBottom: 8,
      }}>
        {label}
      </Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: bg,
        borderRadius: 14,
        borderWidth: 1.6,
        borderColor,
        paddingHorizontal: 14,
        height: 52,
      }}>
        {icon ? <View style={{ marginRight: 10 }}>{icon}</View> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={tokens.placeholder}
          onFocus={onFocus}
          onBlur={onBlur}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          autoCapitalize={autoCapitalize ?? 'none'}
          style={{
            flex: 1, color: tokens.textPrimary, fontSize: 15,
            fontFamily: Fonts.ui,
            paddingVertical: 0,
          }}
        />
        {rightElement}
      </View>
      {error && errorMessage && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <IconAlertCircle size={12} color={AUTH_ERROR_TEXT} />
          <Text style={{ color: AUTH_ERROR_TEXT, fontSize: 12, fontFamily: Fonts.uiSemi }}>
            {errorMessage}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── SelectCard — bouton de sélection ───────────────────────────────────
function SelectCard({
  label, value, field, formData, onSet, description = '', tokens,
}: {
  label: string; value: string; field: keyof FormData;
  formData: FormData; onSet: (f: keyof FormData, v: string) => void;
  description?: string; tokens: AuthThemeTokens;
}) {
  const selected = (formData[field] as string) === value;
  return (
    <TouchableOpacity
      onPress={() => onSet(field, value)}
      activeOpacity={0.85}
      style={{
        paddingVertical: 12, paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected ? AUTH_BRAND : tokens.fieldBorder,
        backgroundColor: selected ? 'rgba(255,193,26,0.10)' : tokens.fieldBg,
        flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: tokens.textPrimary,
            fontFamily: selected ? Fonts.uiExtraBold : Fonts.uiSemi,
            fontSize: 13,
          }}
          numberOfLines={2}
        >
          {label}
        </Text>
        {description ? (
          <Text style={{ color: tokens.label, fontSize: 10.5, marginTop: 2, fontFamily: Fonts.ui }}>
            {description}
          </Text>
        ) : null}
      </View>
      {selected ? (
        <Text style={{ color: AUTH_BRAND, fontSize: 14, fontFamily: Fonts.uiBlack }}>✓</Text>
      ) : null}
    </TouchableOpacity>
  );
}

// ─── Technique toggle (multi-select chip) ───────────────────────────────
function TechniqueCard({
  label, selected, onToggle, tokens,
}: {
  label: string; selected: boolean; onToggle: () => void; tokens: AuthThemeTokens;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.85}
      style={{
        flex: 1, paddingVertical: 12, paddingHorizontal: 12,
        borderRadius: 14,
        borderWidth: selected ? 2 : 1.5,
        borderColor: selected ? AUTH_BRAND : tokens.fieldBorder,
        backgroundColor: selected ? 'rgba(255,193,26,0.10)' : tokens.fieldBg,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}
    >
      <Text
        style={{
          color: tokens.textPrimary,
          fontFamily: selected ? Fonts.uiExtraBold : Fonts.uiSemi,
          fontSize: 12.5, flex: 1,
        }}
        numberOfLines={2}
      >
        {label}
      </Text>
      {selected && <Text style={{ color: AUTH_BRAND, fontSize: 14, fontFamily: Fonts.uiBlack }}>✓</Text>}
    </TouchableOpacity>
  );
}

function Label({ text, tokens }: { text: string; tokens: AuthThemeTokens }) {
  return (
    <Text style={{
      fontFamily: Fonts.uiExtraBold,
      fontSize: 11, color: tokens.label,
      textTransform: 'uppercase', letterSpacing: 1.32,
      marginBottom: 8,
    }}>
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
  const insets = useSafeAreaInsets();
  const { tokens, isDark } = useAuthTheme();
  const captchaRef = useRef<any>(null);
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState<FormData>(INITIAL);

  // Focus flags for step 5 fields
  const [nameFocused, setNameFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [frmtRankFocused, setFrmtRankFocused] = useState(false);
  const [frmtFirstFocused, setFrmtFirstFocused] = useState(false);
  const [frmtLastFocused, setFrmtLastFocused] = useState(false);

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
      Novice: 0, Débutant: 50, Amateur: 100, Intermédiaire: 175, Avancé: 275, Expert: 375,
    };
    const minObj = MIN_OBJ[formData.estimatedLevel] ?? 0;
    if (minObj === 0) return 1;
    const obj = getObjSignal();
    return obj >= minObj ? 1 : Math.max(0.3, obj / minObj);
  };

  const calculateInitialScore = () => {
    // Bonus = ELO au-dessus du plancher 800 si déclaration validée (honnêteté 1).
    // Calé pour atterrir : Novice→800(niv1.7), Déb→920(2.5), Amateur→1050(3.3),
    // Inter→1220(4.1), Avancé→1380(4.9), Expert→1525(5.5 = plafond auto-déclaré).
    const LEVEL_BONUS: Record<string, number> = {
      Novice: 0, Débutant: 120, Amateur: 250, Intermédiaire: 420, Avancé: 580, Expert: 725,
    };
    const selfBonus = LEVEL_BONUS[formData.estimatedLevel] ?? 0;
    // Le NIVEAU déclaré est le seul driver. L'activité (getObjSignal) ne s'ajoute
    // PAS : elle sert uniquement à VALIDER le niveau via getHonestyFactor (une
    // déclaration non soutenue par l'activité est revue à la baisse).
    // Plafond = niveau 5.5 (ELO 1525, cf. PADEL_ANCHORS) : sans FRMT vérifié on
    // ne dépasse pas un bon amateur ; l'élite se prouve sur le terrain ou via FRMT.
    const selfScore = Math.min(800 + Math.round(selfBonus * getHonestyFactor()), 1525);
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
    // Garde de sécurité (défense en profondeur, en plus du bouton désactivé) :
    // âge confirmé + captcha + champs requis avant toute création de compte.
    if ((CAPTCHA_ENABLED && !captchaToken) || !ageConfirmed || !formData.name.trim() || !formData.email || !formData.password) return;
    setIsSubmitting(true);
    try {
      const { count: nameCount, error: nameErr } = await supabase
        .from('players').select('id', { count: 'exact', head: true }).ilike('name', formData.name.trim());
      if (nameErr) throw nameErr;
      if ((nameCount ?? 0) > 0) throw new Error('pseudo_taken');

      // La fiche `players` est créée côté serveur par le trigger DEFINER
      // handle_new_user (cf. supabase/migrations/signup_player_trigger.sql),
      // qui lit ces métadonnées dans auth.users.raw_user_meta_data. Raison :
      // avec confirmation email active, signUp ne renvoie pas de session, donc
      // un insert client serait bloqué par la RLS (rôle anon).
      const meta: Record<string, unknown> = {
        name: formData.name.trim(),
        elo_score: calculateInitialScore(), fiability_pct: 10,
        handedness: formData.handedness || null,
        court_side: formData.preferredSide || null,
        gender: formData.gender === 'Homme' ? 'male' : formData.gender === 'Femme' ? 'female' : null,
      };
      if (formData.hasFrmtRank === 'yes') {
        const n = parseFrmtRankNumber(formData.frmtRank);
        if (n) meta.frmt_rank = String(n);
      }
      if (COLLECT_FRMT_IDENTITY && formData.hasFrmtRank === 'yes' && formData.frmtFirstName.trim() && formData.frmtLastName.trim()) {
        meta.frmt_full_name = `${formData.frmtFirstName.trim()} ${formData.frmtLastName.trim()}`;
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email, password: formData.password,
        options: {
          data: meta,
          ...(CAPTCHA_ENABLED && captchaToken ? { captchaToken } : {}),
        },
      });
      if (authError) throw authError;
      if (!authData.user?.identities || authData.user.identities.length === 0) throw new Error('email_taken');

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
  const stepTitles: { prefix: string; accent: string; suffix?: string }[] = [
    { prefix: 'Parle-nous de ', accent: 'toi' },
    { prefix: 'Ton ', accent: 'niveau' },
    { prefix: 'Classement ', accent: 'officiel' },
    { prefix: 'Tes ', accent: 'techniques' },
    { prefix: 'Ton ', accent: 'compte' },
  ];

  const screenW = Dimensions.get('window').width;
  const lockupW = screenW * 0.42;

  const cardShadow = isDark
    ? { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 36, shadowOffset: { width: 0, height: 12 }, elevation: 14 }
    : { shadowColor: '#14130F', shadowOpacity: 0.08, shadowRadius: 34, shadowOffset: { width: 0, height: 14 }, elevation: 6 };

  // ── Bottom nav buttons per step ──────────────────────────────────────────
  const renderBottomNav = () => {
    if (isSuccess) return null;

    const nextDisabled = !canProceed(step);

    const backBtn = (
      <TouchableOpacity
        onPress={() => setStep(s => Math.max(1, s - 1))}
        activeOpacity={0.85}
        style={{
          paddingHorizontal: 20, height: 54,
          borderRadius: 999,
          borderWidth: 1.5,
          borderColor: tokens.fieldBorder,
          backgroundColor: tokens.fieldBg,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}
      >
        <IconArrowLeft size={16} color={tokens.textSecondary} />
        <Text style={{ color: tokens.textPrimary, fontFamily: Fonts.uiExtraBold, fontSize: 14 }}>
          Précédent
        </Text>
      </TouchableOpacity>
    );

    const nextBtn = (label: string, onPress: () => void, disabled = false, loading = false) => (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.88}
        style={{
          flex: 1, height: 54,
          backgroundColor: tokens.ctaBg,
          borderRadius: 999,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator color={tokens.ctaText} />
        ) : (
          <>
            <Text style={{ color: tokens.ctaText, fontFamily: Fonts.uiExtraBold, fontSize: 15.5 }}>
              {label}
            </Text>
            <IconArrowRight size={18} color={tokens.ctaText} />
          </>
        )}
      </TouchableOpacity>
    );

    if (step === 1) return nextBtn('Suivant', () => setStep(2), nextDisabled);
    if (step === 2) return (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {backBtn}
        {nextBtn('Suivant', () => setStep(3), nextDisabled)}
      </View>
    );
    if (step === 3) return (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {backBtn}
        {nextBtn('Suivant', () => setStep(4), nextDisabled)}
      </View>
    );
    if (step === 4) return (
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {backBtn}
        {nextBtn('Voir mon niveau', () => setStep(5), false)}
      </View>
    );
    if (step === 5) {
      const finalDisabled = isSubmitting || (CAPTCHA_ENABLED && !captchaToken) || !ageConfirmed || !formData.name.trim() || !formData.email || formData.password.length < 6;
      return (
        <View style={{ gap: 12 }}>
          {/* Confirmation d'âge (obligatoire) — exigence légale (loi 09-08 / stores). */}
          <TouchableOpacity onPress={() => setAgeConfirmed(v => !v)} activeOpacity={0.7}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
              borderColor: ageConfirmed ? AUTH_BRAND : tokens.fieldBorder,
              backgroundColor: ageConfirmed ? AUTH_BRAND : 'transparent',
              alignItems: 'center', justifyContent: 'center',
            }}>
              {ageConfirmed && <Text style={{ color: '#0A0A0A', fontSize: 13, fontFamily: Fonts.uiBlack }}>✓</Text>}
            </View>
            <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 17, color: tokens.textSecondary, fontFamily: Fonts.ui }}>
              Je certifie avoir au moins {LEGAL.minAge} ans.
            </Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {backBtn}
            {nextBtn("S'inscrire", handleCreateAccount, finalDisabled, isSubmitting)}
          </View>
          <Text style={{ fontSize: 11, lineHeight: 16, color: tokens.placeholder, fontFamily: Fonts.ui, textAlign: 'center' }}>
            En vous inscrivant, vous acceptez nos{' '}
            <Text
              onPress={() => router.push('/legal/cgu' as any)}
              style={{ color: AUTH_BRAND, fontFamily: Fonts.uiBold }}
            >
              conditions d’utilisation
            </Text>
            {' '}et notre{' '}
            <Text
              onPress={() => router.push('/legal/confidentialite' as any)}
              style={{ color: AUTH_BRAND, fontFamily: Fonts.uiBold }}
            >
              politique de confidentialité
            </Text>
            .
          </Text>
        </View>
      );
    }
    return null;
  };

  const currentTitle = stepTitles[step - 1];

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? tokens.bg : '#FFFFFF' }}>
      {/* Décor traits bord gauche */}
      <View pointerEvents="none" style={{
        position: 'absolute', left: -12, top: '21%',
        width: 66, height: 56, opacity: isDark ? 1 : 0.85,
      }}>
        <Image source={DECO_TRAILS} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
      </View>

      {/* Turnstile — masqué tant que CAPTCHA_ENABLED est false (clés non posées) */}
      {CAPTCHA_ENABLED && (
        <TurnstileCaptcha
          ref={captchaRef}
          siteKey={TURNSTILE_SITE_KEY}
          url={process.env.EXPO_PUBLIC_SUPABASE_URL}
          onMessage={handleCaptchaMessage}
          languageCode="fr"
        />
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 16,
            paddingHorizontal: 30,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Lockup logo ── */}
          <View style={{ alignItems: 'center', marginBottom: 10 }}>
            <Lockup width={lockupW} tokens={tokens} />
          </View>

          {/* Titre + progress */}
          {!isSuccess && (
            <>
              <Text style={{
                textAlign: 'center',
                fontFamily: Fonts.welcome,
                fontSize: 22,
                color: tokens.textPrimary,
                marginTop: 0,
                marginBottom: 10,
                includeFontPadding: false,
              }}>
                {currentTitle.prefix}
                <Text style={{ color: AUTH_BRAND }}>{currentTitle.accent}</Text>
                {currentTitle.suffix ?? ''}
              </Text>

              {/* Progression */}
              <View style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  {stepLabels.map((label, i) => (
                    <Text key={label} style={{
                      fontFamily: Fonts.uiExtraBold,
                      fontSize: 9.5,
                      textTransform: 'uppercase',
                      letterSpacing: 0.8,
                      color: step >= i + 1 ? AUTH_BRAND : tokens.placeholder,
                    }}>{label}</Text>
                  ))}
                </View>
                <View style={{
                  height: 4, backgroundColor: tokens.fieldBg, borderRadius: 999, overflow: 'hidden',
                }}>
                  <View style={{
                    height: '100%',
                    width: `${(step / TOTAL_STEPS) * 100}%`,
                    backgroundColor: AUTH_BRAND, borderRadius: 999,
                  }} />
                </View>
              </View>
            </>
          )}

          {/* ── Carte étape ── */}
          {!isSuccess && (
            <View style={[{
              backgroundColor: tokens.cardBg,
              borderRadius: 20,
              paddingVertical: 14,
              paddingHorizontal: 16,
              borderWidth: 1.5,
              borderColor: tokens.cardBorder,
            }, cardShadow]}>
              {/* STEP 1 */}
              {step === 1 && (
                <View style={{ gap: 12 }}>
                  <Text style={{
                    color: tokens.label, fontFamily: Fonts.ui, fontSize: 13, lineHeight: 19,
                  }}>
                    Quelques infos pour t'associer aux bons partenaires.
                  </Text>

                  <View>
                    <Label text="Tu es ?" tokens={tokens} />
                    <Row>
                      <SelectCard label="Homme" value="Homme" field="gender" formData={formData} onSet={set} tokens={tokens} />
                      <SelectCard label="Femme" value="Femme" field="gender" formData={formData} onSet={set} tokens={tokens} />
                    </Row>
                  </View>

                  <View>
                    <Label text="Âge" tokens={tokens} />
                    <Row>
                      {['-25', '26-35', '36-45', '46+'].map(v => (
                        <SelectCard key={v} label={v} value={v} field="ageGroup" formData={formData} onSet={set} tokens={tokens} />
                      ))}
                    </Row>
                  </View>

                  <View>
                    <Label text="Main forte" tokens={tokens} />
                    <Row>
                      <SelectCard label="Droitier" value="right" field="handedness" formData={formData} onSet={set} tokens={tokens} />
                      <SelectCard label="Gaucher" value="left" field="handedness" formData={formData} onSet={set} tokens={tokens} />
                    </Row>
                  </View>

                  <View>
                    <Label text="Côté préféré" tokens={tokens} />
                    <Row>
                      <SelectCard label="Gauche" value="left" field="preferredSide" formData={formData} onSet={set} tokens={tokens} />
                      <SelectCard label="Droit" value="right" field="preferredSide" formData={formData} onSet={set} tokens={tokens} />
                      <SelectCard label="Peu importe" value="both" field="preferredSide" formData={formData} onSet={set} tokens={tokens} />
                    </Row>
                  </View>
                </View>
              )}

              {/* STEP 2 */}
              {step === 2 && (
                <View style={{ gap: 12 }}>
                  <View style={{
                    backgroundColor: 'rgba(255,193,26,0.10)',
                    borderWidth: 1, borderColor: 'rgba(255,193,26,0.35)',
                    borderRadius: 12, padding: 12, flexDirection: 'row', gap: 9,
                  }}>
                    <View style={{ marginTop: 1 }}>
                      <IconAlertCircle size={15} color={AUTH_BRAND} />
                    </View>
                    <Text style={{ flex: 1, color: tokens.label, fontFamily: Fonts.ui, fontSize: 12.5, lineHeight: 18 }}>
                      <Text style={{ fontFamily: Fonts.uiExtraBold, color: tokens.textPrimary }}>Sois honnête sur ton niveau.</Text> Il s'ajuste vite : dès tes premiers matchs, ton score se cale tout seul. Et le scoring est <Text style={{ fontFamily: Fonts.uiExtraBold, color: AUTH_ERROR_TEXT }}>très pénalisant</Text> si tu te surestimes — un faux niveau élevé te fait perdre gros jusqu'à retomber à ta vraie place.
                    </Text>
                  </View>

                  <View>
                    <Label text="Niveau estimé" tokens={tokens} />
                    <View style={{ gap: 8 }}>
                      <Row>
                        <SelectCard label="Novice" value="Novice" field="estimatedLevel" formData={formData} onSet={set} description="1.5 – 2.0" tokens={tokens} />
                        <SelectCard label="Débutant" value="Débutant" field="estimatedLevel" formData={formData} onSet={set} description="2.0 – 2.5" tokens={tokens} />
                      </Row>
                      <Row>
                        <SelectCard label="Amateur" value="Amateur" field="estimatedLevel" formData={formData} onSet={set} description="2.5 – 3.3" tokens={tokens} />
                        <SelectCard label="Intermédiaire" value="Intermédiaire" field="estimatedLevel" formData={formData} onSet={set} description="3.3 – 4.1" tokens={tokens} />
                      </Row>
                      <Row>
                        <SelectCard label="Avancé" value="Avancé" field="estimatedLevel" formData={formData} onSet={set} description="4.1 – 4.9" tokens={tokens} />
                        <SelectCard label="Expert" value="Expert" field="estimatedLevel" formData={formData} onSet={set} description="4.9 – 5.5" tokens={tokens} />
                      </Row>
                    </View>
                  </View>

                  <View>
                    <Label text="Fréquence de jeu" tokens={tokens} />
                    <View style={{ gap: 8 }}>
                      <Row>
                        <SelectCard label="Occasionnel" value="Occasionnel" field="frequency" formData={formData} onSet={set} tokens={tokens} />
                        <SelectCard label="1x / semaine" value="1 fois par semaine" field="frequency" formData={formData} onSet={set} tokens={tokens} />
                      </Row>
                      <SelectCard label="2x par semaine ou +" value="Plusieurs fois par semaine" field="frequency" formData={formData} onSet={set} tokens={tokens} />
                    </View>
                  </View>

                  <View>
                    <Label text="Tournois FRMT ?" tokens={tokens} />
                    <View style={{ gap: 8 }}>
                      <Row>
                        <SelectCard label="Jamais" value="Jamais" field="tournaments" formData={formData} onSet={set} tokens={tokens} />
                        <SelectCard label="Quelques-uns" value="Oui, quelques-uns" field="tournaments" formData={formData} onSet={set} tokens={tokens} />
                      </Row>
                      <SelectCard label="Souvent" value="Oui, souvent" field="tournaments" formData={formData} onSet={set} tokens={tokens} />
                    </View>
                  </View>
                </View>
              )}

              {/* STEP 3 */}
              {step === 3 && (
                <View style={{ gap: 12 }}>
                  <Text style={{
                    color: tokens.label, fontFamily: Fonts.ui, fontSize: 13, lineHeight: 19,
                  }}>
                    FRMT — Fédération Royale Marocaine de Tennis.
                  </Text>

                  <View>
                    <Label text="As-tu un classement FRMT ?" tokens={tokens} />
                    <Row>
                      <SelectCard label="Oui, classé(e)" value="yes" field="hasFrmtRank" formData={formData} onSet={set} tokens={tokens} />
                      <SelectCard label="Non, loisir" value="no" field="hasFrmtRank" formData={formData} onSet={set} tokens={tokens} />
                    </Row>
                  </View>

                  {formData.hasFrmtRank === 'yes' && (
                    <>
                      <FieldInput
                        label="Ton rang FRMT"
                        value={formData.frmtRank}
                        onChangeText={v => set('frmtRank', v)}
                        placeholder="Ex : 147 ou 27"
                        focused={frmtRankFocused}
                        onFocus={() => setFrmtRankFocused(true)}
                        onBlur={() => setFrmtRankFocused(false)}
                        keyboardType="numeric"
                        error={formData.frmtRank !== '' && !parseFrmtRankNumber(formData.frmtRank)}
                        errorMessage="Format invalide."
                        tokens={tokens}
                      />

                      {COLLECT_FRMT_IDENTITY && (
                        <View style={{
                          backgroundColor: 'rgba(255,193,26,0.08)',
                          borderWidth: 1, borderColor: 'rgba(255,193,26,0.35)',
                          borderRadius: 14, padding: 12, gap: 10,
                        }}>
                          <Text style={{
                            color: AUTH_BRAND, fontSize: 11, fontFamily: Fonts.uiExtraBold,
                            textTransform: 'uppercase', letterSpacing: 1.32,
                          }}>
                            Vérification du classement
                          </Text>
                          <Text style={{ color: tokens.label, fontSize: 12, lineHeight: 17, fontFamily: Fonts.ui }}>
                            Ton nom sera comparé à la base FRMT pour le badge vérifié. Jamais affiché publiquement.
                          </Text>
                          <Row>
                            <View style={{ flex: 1 }}>
                              <FieldInput
                                label="Prénom"
                                value={formData.frmtFirstName}
                                onChangeText={v => set('frmtFirstName', v)}
                                placeholder="Prénom"
                                focused={frmtFirstFocused}
                                onFocus={() => setFrmtFirstFocused(true)}
                                onBlur={() => setFrmtFirstFocused(false)}
                                autoCapitalize="words"
                                tokens={tokens}
                              />
                            </View>
                            <View style={{ flex: 1 }}>
                              <FieldInput
                                label="Nom"
                                value={formData.frmtLastName}
                                onChangeText={v => set('frmtLastName', v)}
                                placeholder="Nom"
                                focused={frmtLastFocused}
                                onFocus={() => setFrmtLastFocused(true)}
                                onBlur={() => setFrmtLastFocused(false)}
                                autoCapitalize="words"
                                tokens={tokens}
                              />
                            </View>
                          </Row>
                        </View>
                      )}
                    </>
                  )}
                </View>
              )}

              {/* STEP 4 */}
              {step === 4 && (
                <View style={{ gap: 12 }}>
                  <Text style={{
                    color: tokens.label, fontFamily: Fonts.ui, fontSize: 13, lineHeight: 19,
                  }}>
                    Coche les coups que tu maîtrises <Text style={{ fontFamily: Fonts.uiExtraBold, color: tokens.textPrimary }}>vraiment</Text> en match.
                  </Text>

                  <View style={{ gap: 8 }}>
                    {TECHNIQUES.map((tech, i) => {
                      if (i % 2 !== 0) return null;
                      const next = TECHNIQUES[i + 1];
                      const selA = formData.techniques.includes(tech.label);
                      const selB = next ? formData.techniques.includes(next.label) : false;
                      return (
                        <Row key={tech.id}>
                          <TechniqueCard
                            label={tech.label}
                            selected={selA}
                            onToggle={() => toggleTechnique(tech.label)}
                            tokens={tokens}
                          />
                          {next ? (
                            <TechniqueCard
                              label={next.label}
                              selected={selB}
                              onToggle={() => toggleTechnique(next.label)}
                              tokens={tokens}
                            />
                          ) : <View style={{ flex: 1 }} />}
                        </Row>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* STEP 5 */}
              {step === 5 && (
                <View style={{ gap: 12 }}>
                  {/* Récap niveau */}
                  <View style={{ alignItems: 'center', paddingVertical: 4 }}>
                    <View style={{
                      backgroundColor: 'rgba(255,193,26,0.14)',
                      borderWidth: 1, borderColor: AUTH_BRAND,
                      paddingHorizontal: 12, paddingVertical: 5,
                      borderRadius: 999, marginBottom: 10,
                    }}>
                      <Text style={{
                        color: AUTH_BRAND, fontSize: 10, fontFamily: Fonts.uiExtraBold,
                        textTransform: 'uppercase', letterSpacing: 1.2,
                      }}>
                        Analyse terminée
                      </Text>
                    </View>
                    <Text style={{
                      color: tokens.label, fontFamily: Fonts.uiSemi, fontSize: 12,
                      textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
                    }}>
                      Ton niveau de départ
                    </Text>
                    <Text style={{
                      fontFamily: Fonts.welcome, fontSize: 44,
                      color: AUTH_BRAND, includeFontPadding: false,
                    }}>
                      Niv. {formatPadelLevel(calculateInitialScore())}
                    </Text>
                    {formData.hasFrmtRank === 'yes' && (() => {
                      const n = parseFrmtRankNumber(formData.frmtRank);
                      if (!n) return null;
                      return (
                        <View style={{
                          marginTop: 8,
                          backgroundColor: 'rgba(255,193,26,0.10)',
                          borderWidth: 1, borderColor: 'rgba(255,193,26,0.35)',
                          paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
                        }}>
                          <Text style={{ color: AUTH_BRAND, fontFamily: Fonts.uiExtraBold, fontSize: 12 }}>
                            Classé #{n} FRMT
                          </Text>
                        </View>
                      );
                    })()}
                    {getHonestyFactor() < 0.95 && (
                      <View style={{
                        marginTop: 10,
                        backgroundColor: 'rgba(239,68,68,0.10)',
                        borderWidth: 1, borderColor: 'rgba(239,68,68,0.30)',
                        borderRadius: 12, padding: 10, flexDirection: 'row', gap: 8,
                      }}>
                        <View style={{ marginTop: 2 }}>
                          <IconAlertCircle size={13} color={AUTH_ERROR_TEXT} />
                        </View>
                        <Text style={{ flex: 1, color: AUTH_ERROR_TEXT, fontSize: 12, fontFamily: Fonts.uiSemi, lineHeight: 17 }}>
                          Niveau ajusté selon ta fréquence, tournois et coups maîtrisés. Tes résultats te feront progresser vite !
                        </Text>
                      </View>
                    )}
                  </View>

                  <FieldInput
                    label="Pseudo"
                    value={formData.name}
                    onChangeText={v => set('name', v)}
                    placeholder="Pseudo d'affichage"
                    icon={<IconUser size={18} color={nameFocused ? AUTH_BRAND : tokens.fieldIcon} />}
                    focused={nameFocused}
                    onFocus={() => setNameFocused(true)}
                    onBlur={() => setNameFocused(false)}
                    tokens={tokens}
                  />

                  <FieldInput
                    label="Email"
                    value={formData.email}
                    onChangeText={v => set('email', v)}
                    placeholder="toi@exemple.fr"
                    icon={<IconMail size={18} color={emailFocused ? AUTH_BRAND : tokens.fieldIcon} />}
                    focused={emailFocused}
                    onFocus={() => setEmailFocused(true)}
                    onBlur={() => setEmailFocused(false)}
                    keyboardType="email-address"
                    autoComplete="email"
                    tokens={tokens}
                  />

                  <FieldInput
                    label="Mot de passe"
                    value={formData.password}
                    onChangeText={v => set('password', v)}
                    placeholder="8 caractères min."
                    icon={<IconLock size={18} color={pwFocused ? AUTH_BRAND : tokens.fieldIcon} />}
                    focused={pwFocused}
                    onFocus={() => setPwFocused(true)}
                    onBlur={() => setPwFocused(false)}
                    secureTextEntry={!showPassword}
                    rightElement={
                      <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={{ padding: 6 }} hitSlop={8}>
                        {showPassword
                          ? <IconEyeOff size={18} color={AUTH_BRAND} />
                          : <IconEye size={18} color={tokens.fieldIcon} />}
                      </TouchableOpacity>
                    }
                    tokens={tokens}
                  />

                  {/* Captcha — masqué tant que CAPTCHA_ENABLED est false (phase de test) */}
                  {CAPTCHA_ENABLED && !captchaToken && (
                    <TouchableOpacity
                      onPress={() => captchaRef.current?.show()}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center',
                        borderWidth: 1, borderColor: tokens.fieldBorder, borderRadius: 12,
                        paddingHorizontal: 12, paddingVertical: 10, gap: 10,
                        backgroundColor: tokens.fieldBg,
                      }}
                    >
                      <View style={{
                        width: 20, height: 20, borderRadius: 5,
                        borderWidth: 1.5,
                        borderColor: tokens.fieldBorder,
                        backgroundColor: tokens.fieldFocusBg,
                      }} />
                      <Text style={{ flex: 1, color: tokens.label, fontSize: 12.5, fontFamily: Fonts.uiSemi }}>
                        Je ne suis pas un robot
                      </Text>
                      <Text style={{ fontSize: 8, color: tokens.placeholder, fontFamily: Fonts.uiBold }}>Turnstile</Text>
                    </TouchableOpacity>
                  )}
                  {captchaToken && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 8,
                      borderWidth: 1, borderColor: AUTH_BRAND, borderRadius: 12,
                      paddingHorizontal: 12, paddingVertical: 10,
                      backgroundColor: 'rgba(255,193,26,0.10)',
                    }}>
                      <Text style={{ color: AUTH_BRAND, fontSize: 13, fontFamily: Fonts.uiBlack }}>✓</Text>
                      <Text style={{ flex: 1, color: tokens.textPrimary, fontSize: 12.5, fontFamily: Fonts.uiSemi }}>
                        Vérification humaine OK
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Bottom nav inside card */}
              <View style={{ marginTop: 14 }}>
                {renderBottomNav()}
                {step <= 3 && !canProceed(step) && (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 6, marginTop: 10,
                  }}>
                    <IconAlertCircle size={12} color={tokens.label} />
                    <Text style={{ color: tokens.label, fontSize: 12, fontFamily: Fonts.uiSemi, textAlign: 'center' }}>
                      Sélectionne tous les champs pour continuer
                    </Text>
                  </View>
                )}
              </View>
            </View>
          )}

          {/* ── SUCCESS ── */}
          {isSuccess && (
            <View style={[{
              backgroundColor: tokens.cardBg,
              borderRadius: 20,
              paddingVertical: 24,
              paddingHorizontal: 18,
              borderWidth: 1.5,
              borderColor: tokens.cardBorder,
              alignItems: 'center',
            }, cardShadow]}>
              <View style={{
                width: 64, height: 64, borderRadius: 999,
                backgroundColor: 'rgba(255,193,26,0.14)',
                borderWidth: 1.5, borderColor: AUTH_BRAND,
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 16,
              }}>
                <IconCheck size={32} color={AUTH_BRAND} />
              </View>
              <Text style={{
                color: tokens.textPrimary,
                fontFamily: Fonts.welcome,
                fontSize: 24,
                marginBottom: 8, textAlign: 'center', includeFontPadding: false,
              }}>
                Compte <Text style={{ color: AUTH_BRAND }}>créé</Text> !
              </Text>
              <Text style={{
                color: tokens.label, fontFamily: Fonts.ui,
                fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 6,
              }}>
                Lien de confirmation envoyé à{'\n'}
                <Text style={{ color: tokens.textPrimary, fontFamily: Fonts.uiExtraBold }}>{formData.email}</Text>.
              </Text>
              <Text style={{
                color: tokens.label, fontFamily: Fonts.ui,
                fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 18,
              }}>
                Active ton compte pour rejoindre la piste avec{' '}
                <Text style={{ color: AUTH_BRAND, fontFamily: Fonts.uiExtraBold }}>Niv. {formatPadelLevel(calculateInitialScore())}</Text>.
              </Text>
              <TouchableOpacity
                onPress={() => router.replace('/(auth)/login')}
                activeOpacity={0.88}
                style={{
                  backgroundColor: tokens.ctaBg,
                  borderRadius: 999, height: 54, width: '100%',
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                }}
              >
                <Text style={{ color: tokens.ctaText, fontFamily: Fonts.uiExtraBold, fontSize: 15.5 }}>
                  Aller à la connexion
                </Text>
                <IconArrowRight size={18} color={tokens.ctaText} />
              </TouchableOpacity>
            </View>
          )}

          <View style={{ flex: 1 }} />

          {/* Bas — Annuler / retour accueil */}
          <TouchableOpacity
            onPress={() => router.replace('/')}
            style={{ alignItems: 'center', marginTop: 12 }}
            activeOpacity={0.6}
            hitSlop={8}
          >
            <Text style={{ color: tokens.textSecondary, fontSize: 13, fontFamily: Fonts.uiSemi }}>
              ← Retour à l'accueil
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
