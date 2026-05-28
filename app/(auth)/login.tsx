import { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import HCaptcha from '@hcaptcha/react-native-hcaptcha';
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';

const HCAPTCHA_SITE_KEY = process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY!;

// ⚠️ DEV : captcha désactivé pour faciliter login/logout pendant les tests.
// Remettre à `true` avant la prod (ou migrer vers Turnstile, cf. mémoire).
// IMPORTANT : nécessite aussi de désactiver le captcha côté Supabase
// (Dashboard → Authentication → Settings → Bot and Abuse Protection → Disabled),
// sinon Supabase rejettera les signinWithPassword sans token.
const CAPTCHA_ENABLED = false;

// ─── Icons ────────────────────────────────────────────────────
const IconMail = ({ size = 16, color = '#94a3b8' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Rect x="2" y="4" width="20" height="16" rx="2" />
    <Path d="m22 7-10 5L2 7" />
  </Svg>
);

const IconLock = ({ size = 16, color = '#94a3b8' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Rect x="3" y="11" width="18" height="11" rx="2" />
    <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Svg>
);

const IconEye = ({ size = 16, color = '#94a3b8' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <Circle cx="12" cy="12" r="3" />
  </Svg>
);

const IconEyeOff = ({ size = 16, color = '#94a3b8' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <Path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <Path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <Path d="M2 2L22 22" />
  </Svg>
);

const IconAlertCircle = ({ size = 14, color = '#dc2626' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Circle cx="12" cy="12" r="10" />
    <Path d="M12 8v4" />
    <Path d="M12 16h.01" />
  </Svg>
);

// ─── Field Input ──────────────────────────────────────────────
function FieldInput({
  label, value, onChangeText, placeholder, icon, focused, onFocus, onBlur,
  secureTextEntry, rightElement, keyboardType, autoComplete,
}: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder: string; icon: React.ReactNode; focused: boolean;
  onFocus: () => void; onBlur: () => void; secureTextEntry?: boolean;
  rightElement?: React.ReactNode; keyboardType?: any; autoComplete?: any;
}) {
  return (
    <View>
      <Text style={{
        fontSize: 10, fontWeight: '900', color: '#64748b',
        textTransform: 'uppercase', letterSpacing: 2, marginBottom: 7,
      }}>
        {label}
      </Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: focused ? '#fff' : '#f8fafc',
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: focused ? '#6366f1' : '#e2e8f0',
        paddingHorizontal: 16,
        shadowColor: '#6366f1',
        shadowOpacity: focused ? 0.12 : 0,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
        elevation: focused ? 2 : 0,
      }}>
        <View style={{ marginRight: 10 }}>{icon}</View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94a3b8"
          onFocus={onFocus}
          onBlur={onBlur}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          autoCapitalize="none"
          style={{
            flex: 1, color: '#0f172a', fontSize: 14,
            fontWeight: '600', paddingVertical: 15,
          }}
        />
        {rightElement}
      </View>
    </View>
  );
}

function getAuthErrorMessage(message: string): string {
  if (message.includes('captcha') || message.includes('hcaptcha'))
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

// ─── Screen ───────────────────────────────────────────────────
export default function LoginScreen() {
  const [email,       setEmail]       = useState('');
  const [password,    setPassword]    = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused,    setPwFocused]    = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaRef    = useRef<any>(null);
  // Vrai pendant qu'un tap sur « Se connecter » attend le token captcha
  // pour enchaîner automatiquement le signIn.
  const pendingLoginRef = useRef(false);
  const { refresh } = usePlayer();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  const handleCaptchaMessage = (event: any) => {
    const data: string = event.nativeEvent?.data ?? '';
    if (data === 'open') return; // ouverture du modal, on ignore
    if (data === 'cancel' || data === 'error' || data === 'expired') {
      setCaptchaToken(null);
      captchaRef.current?.hide();
      if (pendingLoginRef.current) {
        pendingLoginRef.current = false;
        setLoading(false);
        if (data === 'cancel') {
          setError('Vérification annulée. Réessaie pour te connecter.');
        } else {
          setError('Vérification échouée. Réessaie.');
        }
      }
      return;
    }
    if (data.length > 35) {
      setCaptchaToken(data);
      captchaRef.current?.hide();
      // Si un login était en attente du token, on enchaîne tout de suite.
      if (pendingLoginRef.current) {
        pendingLoginRef.current = false;
        performSignIn(data);
      }
    }
  };

  const performSignIn = async (token: string | null) => {
    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        ...(token ? { options: { captchaToken: token } } : {}),
      });
      if (authError) {
        // Token à usage unique : on l'oublie. Au prochain tap sur
        // « Se connecter », un nouveau modal captcha s'ouvrira.
        setCaptchaToken(null);
        setError(getAuthErrorMessage(authError.message));
        setLoading(false);
        return;
      }
      await refresh();
      router.replace('/(tabs)');
    } catch {
      setCaptchaToken(null);
      setError('Une erreur inattendue est survenue. Réessaie.');
      setLoading(false);
    }
  };

  const handleLogin = () => {
    if (!email.trim() || !password) {
      setError('Remplis ton email et ton mot de passe.');
      return;
    }
    setError(null);
    // Captcha désactivé (dev) → signIn direct sans token.
    if (!CAPTCHA_ENABLED) {
      performSignIn(null);
      return;
    }
    // Token déjà disponible (rare) → signIn direct.
    if (captchaToken) {
      performSignIn(captchaToken);
      return;
    }
    // Sinon, on déclenche le captcha. Le signIn enchaîne dès que le
    // token arrive via handleCaptchaMessage.
    pendingLoginRef.current = true;
    setLoading(true);
    captchaRef.current?.show();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#ECECF5' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + 40,
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: 20,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Logo + titre ── */}
          <View style={{ alignItems: 'center', marginBottom: 36 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <Image
                source={require('../../assets/icon.png')}
                style={{ width: 52, height: 52, borderRadius: 16 }}
                resizeMode="cover"
              />
              <View>
                <Text style={{ fontSize: 26, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5 }}>
                  <Text style={{ color: '#FACC15' }}>PAG</Text> Match
                </Text>
                <Text style={{ color: '#94a3b8', fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 2 }}>
                  by PadelActiveGame
                </Text>
              </View>
            </View>
            <Text style={{ color: '#64748b', fontSize: 15, fontWeight: '500' }}>
              Bon retour sur la piste
            </Text>
          </View>

          {/* ── Card blanche ── */}
          <View style={{
            backgroundColor: '#fff',
            borderRadius: 24,
            padding: 24,
            shadowColor: '#000',
            shadowOpacity: 0.06,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}>
            <View style={{ gap: 16 }}>
              <FieldInput
                label="Email"
                value={email}
                onChangeText={(v) => { setEmail(v); setError(null); }}
                placeholder="toi@exemple.fr"
                icon={<IconMail size={16} color={emailFocused ? '#6366f1' : '#94a3b8'} />}
                focused={emailFocused}
                onFocus={() => setEmailFocused(true)}
                onBlur={() => setEmailFocused(false)}
                keyboardType="email-address"
                autoComplete="email"
              />

              <FieldInput
                label="Mot de passe"
                value={password}
                onChangeText={(v) => { setPassword(v); setError(null); }}
                placeholder="••••••••"
                icon={<IconLock size={16} color={pwFocused ? '#6366f1' : '#94a3b8'} />}
                focused={pwFocused}
                onFocus={() => setPwFocused(true)}
                onBlur={() => setPwFocused(false)}
                secureTextEntry={!showPassword}
                rightElement={
                  <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={{ padding: 4 }}>
                    {showPassword
                      ? <IconEyeOff size={16} color="#94a3b8" />
                      : <IconEye    size={16} color="#94a3b8" />}
                  </TouchableOpacity>
                }
              />
            </View>

            {/* hCaptcha — déclenché par le bouton « Se connecter ».
                Le modal s'ouvre brièvement ; si la vérification passive
                passe, il se referme tout seul et le signIn enchaîne.
                Si un défi est nécessaire, l'utilisateur peut le résoudre
                dans le modal plein écran. */}
            <HCaptcha
              ref={captchaRef}
              siteKey={HCAPTCHA_SITE_KEY}
              size="invisible"
              baseUrl="https://hcaptcha.com"
              languageCode="fr"
              onMessage={handleCaptchaMessage}
            />

            {/* Erreur */}
            {error && (
              <View style={{
                marginTop: 14,
                flexDirection: 'row', alignItems: 'flex-start', gap: 8,
                backgroundColor: '#fef2f2',
                borderRadius: 12, borderWidth: 1, borderColor: '#fecaca',
                paddingVertical: 12, paddingHorizontal: 14,
              }}>
                <View style={{ marginTop: 1 }}>
                  <IconAlertCircle size={14} color="#dc2626" />
                </View>
                <Text style={{ flex: 1, color: '#dc2626', fontSize: 13, fontWeight: '700', lineHeight: 19 }}>
                  {error}
                </Text>
              </View>
            )}

            {/* Bouton connexion — non bloqué par le captcha */}
            <TouchableOpacity
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.85}
              style={{
                marginTop: 20,
                backgroundColor: '#6366f1',
                borderRadius: 999,
                paddingVertical: 17,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: loading ? 0.65 : 1,
                shadowColor: '#6366f1',
                shadowOpacity: 0.3, shadowRadius: 10,
                shadowOffset: { width: 0, height: 5 }, elevation: 5,
              }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>Se connecter</Text>
              }
            </TouchableOpacity>

            {/* Séparateur */}
            <View style={{
              height: 1, backgroundColor: '#f1f5f9', marginVertical: 20,
            }} />

            {/* Inscription */}
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '500' }}>
                Pas encore de compte ?
              </Text>
              <Link href="/(auth)/signup" asChild>
                <TouchableOpacity>
                  <Text style={{ color: '#6366f1', fontWeight: '900', fontSize: 14 }}>
                    Inscris-toi gratuitement
                  </Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>

          {/* Retour accueil */}
          <TouchableOpacity
            onPress={() => router.replace('/')}
            style={{ alignItems: 'center', marginTop: 24 }}
            activeOpacity={0.6}
          >
            <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600' }}>
              ← Retour à l'accueil
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
