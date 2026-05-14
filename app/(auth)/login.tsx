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
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

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
type FieldInputProps = {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  icon: React.ReactNode;
  focused: boolean;
  onFocus: () => void;
  onBlur: () => void;
  secureTextEntry?: boolean;
  rightElement?: React.ReactNode;
  keyboardType?: any;
  autoComplete?: any;
};

function FieldInput({
  label, value, onChangeText, placeholder, icon, focused, onFocus, onBlur,
  secureTextEntry, rightElement, keyboardType, autoComplete,
}: FieldInputProps) {
  return (
    <View>
      <Text style={{
        fontSize: 10, fontWeight: '900', color: '#64748b',
        textTransform: 'uppercase', letterSpacing: 2, marginBottom: 7,
      }}>{label}</Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: focused ? '#fff' : '#f8fafc',
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: focused ? '#4f46e5' : '#e2e8f0',
        paddingHorizontal: 12,
        shadowColor: '#4f46e5',
        shadowOpacity: focused ? 0.14 : 0,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 0 },
        elevation: focused ? 3 : 0,
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
            fontWeight: '600', paddingVertical: 14,
          }}
        />
        {rightElement}
      </View>
    </View>
  );
}

function getAuthErrorMessage(message: string): string {
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const captchaResetFn = useRef<(() => void) | null>(null);
  const { refresh } = usePlayer();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleCaptchaMessage = (event: any) => {
    if (typeof event.reset === 'function') {
      captchaResetFn.current = event.reset;
    }
    const data: string = event.nativeEvent?.data ?? '';
    if (data.length > 35) {
      setCaptchaToken(data);
      event.markUsed?.();
    } else {
      setCaptchaToken(null);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Remplis ton email et ton mot de passe.');
      return;
    }
    if (!captchaToken) {
      setError('Valide le captcha avant de continuer.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
        options: { captchaToken },
      });
      if (authError) {
        captchaResetFn.current?.();
        setCaptchaToken(null);
        setError(getAuthErrorMessage(authError.message));
        setLoading(false);
        return;
      }
      await refresh();
      router.replace('/(tabs)');
    } catch {
      captchaResetFn.current?.();
      setCaptchaToken(null);
      setError('Une erreur inattendue est survenue. Réessaie.');
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#4f46e5' }}>
      {/* Decorative orbs */}
      <View style={{
        position: 'absolute', top: -40, right: -40,
        width: 200, height: 200, borderRadius: 100,
        backgroundColor: 'rgba(255,255,255,0.15)',
      }} />
      <View style={{
        position: 'absolute', top: 130, left: -50,
        width: 160, height: 160, borderRadius: 80,
        backgroundColor: 'rgba(16,185,129,0.3)',
      }} />

      {/* Hero */}
      <View style={{
        paddingTop: insets.top + 24,
        paddingBottom: 32,
        alignItems: 'center',
        paddingHorizontal: 24,
      }}>
        <Image
          source={require('../../assets/icon.png')}
          style={{
            width: 68, height: 68, borderRadius: 20,
            marginBottom: 18,
            shadowColor: '#000',
            shadowOpacity: 0.2, shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
          }}
          resizeMode="cover"
        />
        <Text style={{
          fontSize: 26, fontWeight: '900', color: '#fff',
          letterSpacing: -0.5, marginBottom: 6,
        }}>
          MatchupPadel
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 15, fontWeight: '600' }}>
          Bon retour sur la piste 🎾
        </Text>
      </View>

      {/* White bottom sheet */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={{
            flex: 1,
            backgroundColor: '#fff',
            borderTopLeftRadius: 32, borderTopRightRadius: 32,
          }}
          contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 28 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Drag handle */}
          <View style={{
            width: 40, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2,
            alignSelf: 'center', marginBottom: 22,
          }} />

          <Text style={{
            fontSize: 22, fontWeight: '900', color: '#0f172a',
            letterSpacing: -0.5, marginBottom: 22,
          }}>Connexion</Text>

          <View style={{ gap: 16 }}>
            <FieldInput
              label="Email"
              value={email}
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder="toi@exemple.fr"
              icon={<IconMail size={16} color={emailFocused ? '#4f46e5' : '#94a3b8'} />}
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
              icon={<IconLock size={16} color={pwFocused ? '#4f46e5' : '#94a3b8'} />}
              focused={pwFocused}
              onFocus={() => setPwFocused(true)}
              onBlur={() => setPwFocused(false)}
              secureTextEntry={!showPassword}
              rightElement={
                <TouchableOpacity onPress={() => setShowPassword(v => !v)} style={{ padding: 4 }}>
                  {showPassword
                    ? <IconEyeOff size={16} color="#94a3b8" />
                    : <IconEye size={16} color="#94a3b8" />}
                </TouchableOpacity>
              }
            />
          </View>

          {/* hCaptcha widget */}
          <View style={{ height: 80, marginTop: 16, overflow: 'hidden' }}>
            <Hcaptcha
              siteKey={HCAPTCHA_SITE_KEY}
              size="compact"
              url={SUPABASE_URL}
              languageCode="fr"
              showLoading
              loadingIndicatorColor="#4f46e5"
              onMessage={handleCaptchaMessage}
            />
          </View>

          {error && (
            <View style={{
              marginTop: 12,
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 8,
              backgroundColor: '#fef2f2',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: '#fecaca',
              paddingVertical: 12,
              paddingHorizontal: 14,
            }}>
              <View style={{ marginTop: 1 }}>
                <IconAlertCircle size={14} color="#dc2626" />
              </View>
              <Text style={{ flex: 1, color: '#dc2626', fontSize: 13, fontWeight: '700', lineHeight: 19 }}>
                {error}
              </Text>
            </View>
          )}

          {/* Forgot password */}
          <View style={{ alignItems: 'flex-end', marginTop: 10 }}>
            <TouchableOpacity>
              <Text style={{ color: '#4f46e5', fontSize: 12, fontWeight: '800' }}>
                Mot de passe oublié ?
              </Text>
            </TouchableOpacity>
          </View>

          {/* Submit */}
          <TouchableOpacity
            onPress={handleLogin}
            disabled={loading || !captchaToken}
            style={{
              marginTop: 22,
              backgroundColor: '#4f46e5',
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: (loading || !captchaToken) ? 0.5 : 1,
              shadowColor: '#4f46e5',
              shadowOpacity: 0.35, shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 }, elevation: 6,
            }}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>Se connecter</Text>
            }
          </TouchableOpacity>

          {/* Sign up */}
          <View style={{ marginTop: 20, flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
            <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '500' }}>
              Pas de compte ?
            </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity>
                <Text style={{ color: '#4f46e5', fontWeight: '900', fontSize: 13 }}>
                  S'inscrire
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
