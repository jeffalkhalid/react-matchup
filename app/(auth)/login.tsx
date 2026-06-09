import { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Image, Dimensions,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';
import TurnstileCaptcha from '../../components/TurnstileCaptcha';
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';
import { Fonts } from '../../lib/theme';
import { useAuthTheme, AUTH_BRAND, AUTH_ERROR_BORDER, AUTH_ERROR_TEXT, type AuthThemeTokens } from '../../lib/auth-theme';

const TURNSTILE_SITE_KEY = process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY!;
// Captcha (Cloudflare Turnstile) ACTIF. Clés en place (.env + Supabase Auth).
// ⚠️ Si désactivation un jour : repasser à false ICI ET dans signup.tsx,
// ET désactiver "Captcha protection" dans Supabase → Auth → Settings.
const CAPTCHA_ENABLED = true;
const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL!;

// Dernier email utilisé — pré-rempli au prochain lancement (l'email n'est pas
// un secret → AsyncStorage). Le mot de passe, lui, reste géré par le
// gestionnaire de mots de passe du téléphone (autofill OS).
const LAST_EMAIL_KEY = 'auth:last_email';

const RACKET = require('../../assets/auth/splash-racket.png');
const TRAILS = require('../../assets/auth/splash-trails.png');
const DECO_TRAILS = require('../../assets/auth/deco-trails.png');

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

// ─── Lockup (raquette + traits + wordmark) — 3 pièces, ratio 364/261 ───
function Lockup({ width, tokens }: { width: number; tokens: AuthThemeTokens }) {
  const ratio = 364 / 261;
  const h = width / ratio;
  return (
    <View style={{ width, height: h, position: 'relative' }}>
      {/* trails — left 14.56% top 17.63% w 35.71% h 42.15% */}
      <Image
        source={TRAILS}
        style={{
          position: 'absolute',
          left: width * 0.1456, top: h * 0.1763,
          width: width * 0.3571, height: h * 0.4215,
        }}
        resizeMode="contain"
      />
      {/* racket — left 47.80% top 0 w 41.48% h 57.85% */}
      <Image
        source={RACKET}
        style={{
          position: 'absolute',
          left: width * 0.478, top: 0,
          width: width * 0.4148, height: h * 0.5785,
        }}
        resizeMode="contain"
      />
      {/* wordmark — left 0 top 59.77% w 100% h 40.23% — bascule selon thème */}
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
  secureTextEntry, rightElement, keyboardType, autoComplete, textContentType,
  importantForAutofill, error, errorMessage,
  tokens,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder: string; icon: React.ReactNode; focused: boolean;
  onFocus: () => void; onBlur: () => void; secureTextEntry?: boolean;
  rightElement?: React.ReactNode; keyboardType?: any; autoComplete?: any;
  textContentType?: any; importantForAutofill?: any;
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
        shadowColor: AUTH_BRAND,
        shadowOpacity: focused && !error ? 0.16 : 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0,
      }}>
        <View style={{ marginRight: 10 }}>{icon}</View>
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
          textContentType={textContentType}
          importantForAutofill={importantForAutofill}
          autoCapitalize="none"
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

function getAuthErrorMessage(message: string): string {
  if (message.includes('captcha'))
    return 'Coche "Je suis un humain" avant de te connecter.';
  if (message.includes('Invalid login credentials') || message.includes('invalid_credentials'))
    return 'Email ou mot de passe incorrect.';
  if (message.includes('Email not confirmed') || message.includes('email_not_confirmed'))
    return 'Compte non activé. Vérifie ta boîte mail et clique sur le lien de confirmation.';
  if (message.includes('User not found'))
    return 'Aucun compte associé à cet email.';
  if (message.includes('Too many requests') || message.includes('rate limit') || message.includes('over_email_send_rate_limit'))
    return 'Trop de tentatives. Attends quelques minutes avant de réessayer.';
  if (message.includes('Network request failed') || message.includes('fetch') || message.includes('network'))
    return 'Erreur de connexion. Vérifie ton réseau et réessaie.';
  if (message.includes('signup_disabled'))
    return 'Les inscriptions sont temporairement désactivées.';
  return 'Connexion impossible. Réessaie dans un instant.';
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Screen ─────────────────────────────────────────────────────────────
export default function LoginScreen() {
  const { tokens, isDark } = useAuthTheme();

  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused,    setPwFocused]    = useState(false);
  const [emailError,   setEmailError]   = useState(false);
  const [pwError,      setPwError]      = useState(false);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef = useRef<any>(null);
  const { refresh } = usePlayer();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  // Pré-remplit l'email du dernier compte connecté.
  useEffect(() => {
    AsyncStorage.getItem(LAST_EMAIL_KEY)
      .then(saved => { if (saved) setEmail(saved); })
      .catch(() => {});
  }, []);

  const handleCaptchaMessage = (event: any) => {
    const data: string = event.nativeEvent?.data ?? '';
    if (data === 'cancel' || data === 'error' || data === 'expired') {
      setCaptchaToken(null);
      return;
    }
    if (data.length > 35) {
      setCaptchaToken(data);
    }
  };

  const handleLogin = async () => {
    const emailOk = EMAIL_REGEX.test(email.trim());
    const pwOk = password.length > 0;
    setEmailError(!emailOk);
    setPwError(!pwOk);
    if (!emailOk || !pwOk) {
      setError(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (authError) {
        setCaptchaToken(null);
        setError(getAuthErrorMessage(authError.message));
        setLoading(false);
        return;
      }
      // Mémorise l'email pour le pré-remplir au prochain lancement.
      AsyncStorage.setItem(LAST_EMAIL_KEY, email.trim()).catch(() => {});
      await refresh();
      router.replace('/(tabs)');
    } catch {
      setCaptchaToken(null);
      setError('Une erreur inattendue est survenue. Réessaie.');
      setLoading(false);
    }
  };

  const screenW = Dimensions.get('window').width;
  const lockupW = screenW * 0.58;

  // Ombre carte : plus prononcée en sombre.
  const cardShadow = isDark
    ? { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 36, shadowOffset: { width: 0, height: 12 }, elevation: 14 }
    : { shadowColor: '#14130F', shadowOpacity: 0.08, shadowRadius: 34, shadowOffset: { width: 0, height: 14 }, elevation: 6 };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }}>
      {/* Décor : traits en bord gauche, ~21% de hauteur */}
      <View pointerEvents="none" style={{
        position: 'absolute', left: -12, top: '21%',
        width: 66, height: 56,
        opacity: isDark ? 1 : 0.85,
      }}>
        <Image source={DECO_TRAILS} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 56,
            paddingBottom: insets.bottom + 26,
            paddingHorizontal: 30,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Lockup logo ── */}
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <Lockup width={lockupW} tokens={tokens} />
          </View>

          {/* ── Titre d'accueil ── */}
          <Text style={{
            textAlign: 'center',
            fontFamily: Fonts.welcome,
            fontSize: 23,
            color: tokens.textPrimary,
            marginBottom: 22,
            includeFontPadding: false,
          }}>
            Bon retour sur la <Text style={{ color: AUTH_BRAND }}>piste</Text> !
          </Text>

          {/* ── Carte formulaire ── */}
          <View style={[{
            backgroundColor: tokens.cardBg,
            borderRadius: 20,
            paddingVertical: 18,
            paddingHorizontal: 16,
            borderWidth: 1.5,
            borderColor: tokens.cardBorder,
          }, cardShadow]}>
            <View style={{ gap: 14 }}>
              <FieldInput
                label="Email"
                value={email}
                onChangeText={(v) => { setEmail(v); if (emailError) setEmailError(false); setError(null); }}
                placeholder="toi@exemple.fr"
                icon={<IconMail size={18} color={emailFocused ? AUTH_BRAND : tokens.fieldIcon} />}
                focused={emailFocused}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                keyboardType="email-address"
                autoComplete="email"
                textContentType="username"
                importantForAutofill="yes"
                error={emailError}
                errorMessage="Adresse email invalide."
                tokens={tokens}
              />

              <FieldInput
                label="Mot de passe"
                value={password}
                onChangeText={(v) => { setPassword(v); if (pwError) setPwError(false); setError(null); }}
                placeholder="Ton mot de passe"
                icon={<IconLock size={18} color={pwFocused ? AUTH_BRAND : tokens.fieldIcon} />}
                focused={pwFocused}
                onFocus={() => setPwFocused(true)}
                onBlur={() => setPwFocused(false)}
                secureTextEntry={!showPassword}
                autoComplete="current-password"
                textContentType="password"
                importantForAutofill="yes"
                rightElement={
                  <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={{ padding: 6 }} hitSlop={8}>
                    {showPassword
                      ? <IconEyeOff size={18} color={AUTH_BRAND} />
                      : <IconEye    size={18} color={tokens.fieldIcon} />}
                  </TouchableOpacity>
                }
                error={pwError}
                errorMessage="Entre ton mot de passe."
                tokens={tokens}
              />
            </View>

            {/* Mot de passe oublié */}
            <View style={{ alignItems: 'flex-end', marginTop: 12 }}>
              <Link href="/(auth)/forgot-password" asChild>
                <TouchableOpacity hitSlop={8}>
                  <Text style={{
                    color: AUTH_BRAND,
                    fontSize: 12.5,
                    fontFamily: Fonts.uiBold,
                  }}>
                    Mot de passe oublié ?
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>

            {/* Captcha — masqué tant que CAPTCHA_ENABLED est false (phase de test). */}
            {CAPTCHA_ENABLED && !captchaToken && (
              <TouchableOpacity
                onPress={() => captchaRef.current?.show()}
                activeOpacity={0.7}
                style={{
                  marginTop: 14,
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
                marginTop: 14,
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

            {CAPTCHA_ENABLED && (
              <TurnstileCaptcha
                ref={captchaRef}
                siteKey={TURNSTILE_SITE_KEY}
                url={SUPABASE_URL}
                languageCode="fr"
                onMessage={handleCaptchaMessage}
              />
            )}

            {error && (
              <View style={{
                marginTop: 12,
                flexDirection: 'row', alignItems: 'flex-start', gap: 8,
                backgroundColor: 'rgba(239,68,68,0.10)',
                borderRadius: 12, borderWidth: 1, borderColor: 'rgba(239,68,68,0.35)',
                paddingVertical: 10, paddingHorizontal: 12,
              }}>
                <View style={{ marginTop: 2 }}>
                  <IconAlertCircle size={14} color={AUTH_ERROR_TEXT} />
                </View>
                <Text style={{ flex: 1, color: AUTH_ERROR_TEXT, fontSize: 13, fontFamily: Fonts.uiSemi, lineHeight: 19 }}>
                  {error}
                </Text>
              </View>
            )}

            {/* CTA Se connecter */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading || (CAPTCHA_ENABLED && !captchaToken)}
              activeOpacity={0.88}
              style={{
                marginTop: 16,
                backgroundColor: tokens.ctaBg,
                borderRadius: 999,
                height: 54,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
                opacity: (loading || (CAPTCHA_ENABLED && !captchaToken)) ? 0.6 : 1,
              }}
            >
              {loading ? (
                <ActivityIndicator color={tokens.ctaText} />
              ) : (
                <>
                  <Text style={{
                    color: tokens.ctaText,
                    fontFamily: Fonts.uiExtraBold,
                    fontSize: 15.5,
                  }}>
                    Se connecter
                  </Text>
                  <IconArrowRight size={18} color={tokens.ctaText} />
                </>
              )}
            </TouchableOpacity>

            {/* Divider + signup */}
            <View style={{
              height: 1, backgroundColor: tokens.cardBorder, marginTop: 18, marginBottom: 14,
            }} />
            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <Text style={{ color: tokens.textSecondary, fontSize: 13, fontFamily: Fonts.ui }}>
                Pas encore de compte ?
              </Text>
              <Link href="/(auth)/signup" asChild>
                <TouchableOpacity hitSlop={6}>
                  <Text style={{ color: AUTH_BRAND, fontFamily: Fonts.uiExtraBold, fontSize: 13 }}>
                    Inscris-toi gratuitement
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>

          {/* Spacer pour pousser "Retour" en bas */}
          <View style={{ flex: 1, minHeight: 24 }} />

          {/* ← Retour à l'accueil — hors carte */}
          <TouchableOpacity
            onPress={() => router.replace('/')}
            style={{ alignItems: 'center', marginTop: 16 }}
            activeOpacity={0.6}
            hitSlop={8}
          >
            <Text style={{
              color: tokens.textSecondary, fontSize: 13, fontFamily: Fonts.uiSemi,
            }}>
              ← Retour à l'accueil
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
