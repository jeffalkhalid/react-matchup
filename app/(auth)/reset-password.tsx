import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Image, Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams, Link } from 'expo-router';
import * as Linking from 'expo-linking';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { Fonts } from '../../lib/theme';
import { useAuthTheme, AUTH_BRAND, AUTH_ERROR_BORDER, AUTH_ERROR_TEXT, type AuthThemeTokens } from '../../lib/auth-theme';

const RACKET = require('../../assets/auth/splash-racket.png');
const TRAILS = require('../../assets/auth/splash-trails.png');
const DECO_TRAILS = require('../../assets/auth/deco-trails.png');

// ─── Icons ──────────────────────────────────────────────────────────────
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

const IconArrowRight = ({ size = 18, color = '#0A0A0A' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <Line x1="5" y1="12" x2="19" y2="12" />
    <Path d="m13 6 6 6-6 6" />
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

function Lockup({ width, tokens }: { width: number; tokens: AuthThemeTokens }) {
  const ratio = 364 / 261;
  const h = width / ratio;
  return (
    <View style={{ width, height: h, position: 'relative' }}>
      <Image source={TRAILS} style={{ position: 'absolute', left: width * 0.1456, top: h * 0.1763, width: width * 0.3571, height: h * 0.4215 }} resizeMode="contain" />
      <Image source={RACKET} style={{ position: 'absolute', left: width * 0.478, top: 0, width: width * 0.4148, height: h * 0.5785 }} resizeMode="contain" />
      <Image source={tokens.wordmarkAsset} style={{ position: 'absolute', left: 0, top: h * 0.5977, width, height: h * 0.4023 }} resizeMode="contain" />
    </View>
  );
}

const MIN_PASSWORD = 6;

type Phase = 'verifying' | 'form' | 'invalid' | 'done';

export default function ResetPasswordScreen() {
  const { tokens, isDark } = useAuthTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ code?: string; error_description?: string }>();

  const exchangedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('verifying');

  const [password,   setPassword]   = useState('');
  const [confirm,    setConfirm]    = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [pwFocused,  setPwFocused]  = useState(false);
  const [cfFocused,  setCfFocused]  = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  // ── Échange du code de récupération (PKCE) contre une session ──────────
  useEffect(() => {
    if (exchangedRef.current) return;
    (async () => {
      let code = params.code;
      // Cold start : le param peut ne pas être encore propagé par le router →
      // on relit l'URL initiale qui a ouvert l'app.
      if (!code) {
        const initial = await Linking.getInitialURL().catch(() => null);
        if (initial) {
          const parsed = Linking.parse(initial);
          code = (parsed.queryParams?.code as string | undefined) ?? undefined;
        }
      }
      if (!code) {
        // Pas encore de code : on attend une éventuelle propagation du param.
        // Si rien n'arrive, le lien est invalide.
        if (params.error_description) setPhase('invalid');
        return;
      }
      exchangedRef.current = true;
      const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
      if (exErr) { setPhase('invalid'); return; }
      setPhase('form');
    })();
  }, [params.code, params.error_description]);

  // Si après un court délai aucun code n'a été reçu, on bascule en "invalide".
  useEffect(() => {
    if (phase !== 'verifying') return;
    const t = setTimeout(() => {
      if (!exchangedRef.current) setPhase('invalid');
    }, 4000);
    return () => clearTimeout(t);
  }, [phase]);

  const handleSubmit = async () => {
    if (password.length < MIN_PASSWORD) {
      setError(`Le mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`);
      return;
    }
    if (password !== confirm) {
      setError('Les deux mots de passe ne correspondent pas.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: upErr } = await supabase.auth.updateUser({ password });
      if (upErr) {
        setError(upErr.message.includes('different from the old')
          ? 'Choisis un mot de passe différent de l’ancien.'
          : 'Impossible de mettre à jour le mot de passe. Réessaie.');
        setLoading(false);
        return;
      }
      setPhase('done');
      setLoading(false);
    } catch {
      setError('Erreur de connexion. Vérifie ton réseau.');
      setLoading(false);
    }
  };

  const screenW = Dimensions.get('window').width;
  const lockupW = screenW * 0.58;

  const cardShadow = isDark
    ? { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 36, shadowOffset: { width: 0, height: 12 }, elevation: 14 }
    : { shadowColor: '#14130F', shadowOpacity: 0.08, shadowRadius: 34, shadowOffset: { width: 0, height: 14 }, elevation: 6 };

  const title =
    phase === 'done'    ? <>Mot de passe <Text style={{ color: AUTH_BRAND }}>mis à jour</Text></>
    : phase === 'invalid' ? <>Lien <Text style={{ color: AUTH_BRAND }}>invalide</Text></>
    : <>Nouveau <Text style={{ color: AUTH_BRAND }}>mot de passe</Text></>;

  const renderPasswordField = (
    label: string, value: string, onChange: (v: string) => void,
    placeholder: string, focused: boolean, onFocus: () => void, onBlur: () => void,
    withToggle: boolean,
  ) => (
    <View>
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 11, color: tokens.label, textTransform: 'uppercase', letterSpacing: 1.32, marginBottom: 8 }}>
        {label}
      </Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: focused ? tokens.fieldFocusBg : tokens.fieldBg,
        borderRadius: 14, borderWidth: 1.6,
        borderColor: error ? AUTH_ERROR_BORDER : focused ? AUTH_BRAND : tokens.fieldBorder,
        paddingHorizontal: 14, height: 52,
      }}>
        <View style={{ marginRight: 10 }}>
          <IconLock size={18} color={focused ? AUTH_BRAND : tokens.fieldIcon} />
        </View>
        <TextInput
          value={value}
          onChangeText={(v) => { onChange(v); if (error) setError(null); }}
          placeholder={placeholder}
          placeholderTextColor={tokens.placeholder}
          onFocus={onFocus}
          onBlur={onBlur}
          secureTextEntry={!showPw}
          autoCapitalize="none"
          autoComplete="password-new"
          textContentType="newPassword"
          style={{ flex: 1, color: tokens.textPrimary, fontSize: 15, fontFamily: Fonts.ui, paddingVertical: 0 }}
        />
        {withToggle && (
          <TouchableOpacity onPress={() => setShowPw(v => !v)} style={{ padding: 6 }} hitSlop={8}>
            {showPw ? <IconEyeOff size={18} color={AUTH_BRAND} /> : <IconEye size={18} color={tokens.fieldIcon} />}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: -12, top: '21%', width: 66, height: 56, opacity: isDark ? 1 : 0.85 }}>
        <Image source={DECO_TRAILS} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 56, paddingBottom: insets.bottom + 26, paddingHorizontal: 30 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <Lockup width={lockupW} tokens={tokens} />
          </View>

          <Text style={{ textAlign: 'center', fontFamily: Fonts.welcome, fontSize: 23, color: tokens.textPrimary, marginBottom: 22, includeFontPadding: false }}>
            {title} ?
          </Text>

          <View style={[{
            backgroundColor: tokens.cardBg, borderRadius: 20,
            paddingVertical: 18, paddingHorizontal: 16,
            borderWidth: 1.5, borderColor: tokens.cardBorder,
          }, cardShadow]}>

            {/* ── Vérification du lien ── */}
            {phase === 'verifying' && (
              <View style={{ alignItems: 'center', paddingVertical: 24 }}>
                <ActivityIndicator color={AUTH_BRAND} />
                <Text style={{ color: tokens.label, fontFamily: Fonts.ui, fontSize: 13, marginTop: 14 }}>
                  Vérification du lien…
                </Text>
              </View>
            )}

            {/* ── Lien invalide / expiré ── */}
            {phase === 'invalid' && (
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <View style={{ width: 56, height: 56, borderRadius: 999, backgroundColor: 'rgba(239,68,68,0.12)', borderWidth: 1.5, borderColor: 'rgba(239,68,68,0.45)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <IconAlertCircle size={26} color={AUTH_ERROR_TEXT} />
                </View>
                <Text style={{ color: tokens.textPrimary, fontFamily: Fonts.uiExtraBold, fontSize: 17, marginBottom: 6, textAlign: 'center' }}>
                  Lien invalide ou expiré
                </Text>
                <Text style={{ color: tokens.label, fontFamily: Fonts.ui, fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 16 }}>
                  Ce lien de réinitialisation n’est plus valable. Demande-en un nouveau.
                </Text>
                <TouchableOpacity
                  onPress={() => router.replace('/(auth)/forgot-password')}
                  activeOpacity={0.88}
                  style={{ backgroundColor: tokens.ctaBg, borderRadius: 999, height: 54, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                >
                  <Text style={{ color: tokens.ctaText, fontFamily: Fonts.uiExtraBold, fontSize: 15.5 }}>
                    Demander un nouveau lien
                  </Text>
                  <IconArrowRight size={18} color={tokens.ctaText} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Succès ── */}
            {phase === 'done' && (
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <View style={{ width: 56, height: 56, borderRadius: 999, backgroundColor: 'rgba(255,193,26,0.14)', borderWidth: 1.5, borderColor: AUTH_BRAND, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <IconCheck size={28} color={AUTH_BRAND} />
                </View>
                <Text style={{ color: tokens.textPrimary, fontFamily: Fonts.uiExtraBold, fontSize: 17, marginBottom: 6, textAlign: 'center' }}>
                  C’est fait !
                </Text>
                <Text style={{ color: tokens.label, fontFamily: Fonts.ui, fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 16 }}>
                  Ton mot de passe a été modifié. Tu es connecté.
                </Text>
                <TouchableOpacity
                  onPress={() => router.replace('/(tabs)')}
                  activeOpacity={0.88}
                  style={{ backgroundColor: tokens.ctaBg, borderRadius: 999, height: 54, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                >
                  <Text style={{ color: tokens.ctaText, fontFamily: Fonts.uiExtraBold, fontSize: 15.5 }}>
                    Accéder à l’app
                  </Text>
                  <IconArrowRight size={18} color={tokens.ctaText} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Formulaire nouveau mot de passe ── */}
            {phase === 'form' && (
              <>
                <Text style={{ color: tokens.label, fontFamily: Fonts.ui, fontSize: 13, lineHeight: 20, marginBottom: 14 }}>
                  Choisis ton nouveau mot de passe ({MIN_PASSWORD} caractères minimum).
                </Text>

                <View style={{ gap: 14 }}>
                  {renderPasswordField('Nouveau mot de passe', password, setPassword, 'Ton nouveau mot de passe', pwFocused, () => setPwFocused(true), () => setPwFocused(false), true)}
                  {renderPasswordField('Confirme le mot de passe', confirm, setConfirm, 'Retape-le', cfFocused, () => setCfFocused(true), () => setCfFocused(false), false)}
                </View>

                {error && (
                  <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(239,68,68,0.10)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)', paddingVertical: 10, paddingHorizontal: 12 }}>
                    <View style={{ marginTop: 2 }}>
                      <IconAlertCircle size={14} color={AUTH_ERROR_TEXT} />
                    </View>
                    <Text style={{ flex: 1, color: AUTH_ERROR_TEXT, fontSize: 13, fontFamily: Fonts.uiSemi, lineHeight: 19 }}>
                      {error}
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={loading}
                  activeOpacity={0.88}
                  style={{ marginTop: 18, backgroundColor: tokens.ctaBg, borderRadius: 999, height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, opacity: loading ? 0.7 : 1 }}
                >
                  {loading ? (
                    <ActivityIndicator color={tokens.ctaText} />
                  ) : (
                    <>
                      <Text style={{ color: tokens.ctaText, fontFamily: Fonts.uiExtraBold, fontSize: 15.5 }}>
                        Mettre à jour
                      </Text>
                      <IconArrowRight size={18} color={tokens.ctaText} />
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>

          <View style={{ flex: 1, minHeight: 24 }} />

          {phase !== 'done' && (
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity style={{ alignItems: 'center', marginTop: 16 }} activeOpacity={0.6} hitSlop={8}>
                <Text style={{ color: tokens.textSecondary, fontSize: 13, fontFamily: Fonts.uiSemi }}>
                  ← Retour à la connexion
                </Text>
              </TouchableOpacity>
            </Link>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
