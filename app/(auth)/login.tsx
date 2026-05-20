import { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { Hcaptcha } from '@hcaptcha/react-native-hcaptcha';
import { supabase } from '../../lib/supabase';
import { usePlayer } from '../../hooks/usePlayer';

const HCAPTCHA_SITE_KEY = process.env.EXPO_PUBLIC_HCAPTCHA_SITE_KEY!;
const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL!;

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
  const captchaRef = useRef<any>(null);
  const { refresh } = usePlayer();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

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
    if (!email.trim() || !password) {
      setError('Remplis ton email et ton mot de passe.');
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
      await refresh();
      router.replace('/(tabs)');
    } catch {
      setCaptchaToken(null);
      setError('Une erreur inattendue est survenue. Réessaie.');
      setLoading(false);
    }
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
              <Text style={{ fontSize: 26, fontWeight: '900', color: '#0f172a', letterSpacing: -0.5 }}>
                Matchup<Text style={{ color: '#6366f1' }}>Padel</Text>
              </Text>
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

            {/* Case à cocher hCaptcha — tape pour ouvrir le popup */}
            <TouchableOpacity
              onPress={() => { if (!captchaToken) captchaRef.current?.show(); }}
              activeOpacity={captchaToken ? 1 : 0.7}
              style={{
                marginTop: 20,
                flexDirection: 'row', alignItems: 'center',
                borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 12,
                paddingHorizontal: 14, paddingVertical: 12, gap: 12,
                backgroundColor: '#fafafa',
              }}
            >
              {/* Checkbox */}
              <View style={{
                width: 24, height: 24, borderRadius: 5,
                borderWidth: 2,
                borderColor: captchaToken ? '#6366f1' : '#cbd5e1',
                backgroundColor: captchaToken ? '#6366f1' : '#fff',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {captchaToken && (
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '900', lineHeight: 16 }}>✓</Text>
                )}
              </View>

              <Text style={{ flex: 1, color: '#374151', fontSize: 14, fontWeight: '500' }}>
                Je suis un humain
              </Text>

              {/* Logo hCaptcha */}
              <View style={{ alignItems: 'center', gap: 2 }}>
                <Text style={{ fontSize: 18 }}>🤚</Text>
                <Text style={{ fontSize: 8, color: '#94a3b8', fontWeight: '700' }}>hCaptcha</Text>
              </View>
            </TouchableOpacity>

            {/* WebView hCaptcha — s'ouvre en popup via ref.show() */}
            <Hcaptcha
              ref={captchaRef}
              siteKey={HCAPTCHA_SITE_KEY}
              size="invisible"
              url={SUPABASE_URL}
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
