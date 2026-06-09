import { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Image, Dimensions,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect, Line } from 'react-native-svg';
import { supabase } from '../../lib/supabase';
import { Fonts } from '../../lib/theme';
import { useAuthTheme, AUTH_BRAND, AUTH_ERROR_BORDER, AUTH_ERROR_TEXT, type AuthThemeTokens } from '../../lib/auth-theme';

const RACKET = require('../../assets/auth/splash-racket.png');
const TRAILS = require('../../assets/auth/splash-trails.png');
const DECO_TRAILS = require('../../assets/auth/deco-trails.png');

const IconMail = ({ size = 18, color = '#9A9AA2' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <Rect x="2" y="4" width="20" height="16" rx="2" />
    <Path d="m22 7-10 5L2 7" />
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

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const { tokens, isDark } = useAuthTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [focused, setFocused] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = email.trim();
    const ok = EMAIL_REGEX.test(trimmed);
    setEmailError(!ok);
    if (!ok) {
      setError(null);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // redirectTo = deep link de l'app → ouvre l'écran reset-password avec un
      // `?code=…` (PKCE). Cette URL doit être autorisée dans Supabase →
      // Authentication → URL Configuration → Redirect URLs.
      const { error: rErr } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: 'pagmatch://reset-password',
      });
      if (rErr) {
        setError('Envoi impossible. Réessaie dans un instant.');
        setLoading(false);
        return;
      }
      setSent(true);
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

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bg }}>
      <View pointerEvents="none" style={{
        position: 'absolute', left: -12, top: '21%',
        width: 66, height: 56, opacity: isDark ? 1 : 0.85,
      }}>
        <Image source={DECO_TRAILS} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
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
          <View style={{ alignItems: 'center', marginBottom: 14 }}>
            <Lockup width={lockupW} tokens={tokens} />
          </View>

          <Text style={{
            textAlign: 'center',
            fontFamily: Fonts.welcome,
            fontSize: 23,
            color: tokens.textPrimary,
            marginBottom: 22,
            includeFontPadding: false,
          }}>
            Mot de passe <Text style={{ color: AUTH_BRAND }}>oublié</Text> ?
          </Text>

          <View style={[{
            backgroundColor: tokens.cardBg,
            borderRadius: 20,
            paddingVertical: 18,
            paddingHorizontal: 16,
            borderWidth: 1.5,
            borderColor: tokens.cardBorder,
          }, cardShadow]}>
            {sent ? (
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <View style={{
                  width: 56, height: 56, borderRadius: 999,
                  backgroundColor: 'rgba(255,193,26,0.14)',
                  borderWidth: 1.5, borderColor: AUTH_BRAND,
                  alignItems: 'center', justifyContent: 'center',
                  marginBottom: 14,
                }}>
                  <IconCheck size={28} color={AUTH_BRAND} />
                </View>
                <Text style={{
                  color: tokens.textPrimary, fontFamily: Fonts.uiExtraBold,
                  fontSize: 17, marginBottom: 6, textAlign: 'center',
                }}>
                  Email envoyé
                </Text>
                <Text style={{
                  color: tokens.label, fontFamily: Fonts.ui,
                  fontSize: 13, lineHeight: 20, textAlign: 'center', marginBottom: 16,
                }}>
                  Si un compte existe avec cette adresse, tu vas recevoir un lien
                  pour réinitialiser ton mot de passe.
                </Text>
                <TouchableOpacity
                  onPress={() => router.replace('/(auth)/login')}
                  activeOpacity={0.88}
                  style={{
                    backgroundColor: tokens.ctaBg,
                    borderRadius: 999,
                    height: 54,
                    width: '100%',
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 10,
                  }}
                >
                  <Text style={{ color: tokens.ctaText, fontFamily: Fonts.uiExtraBold, fontSize: 15.5 }}>
                    Retour à la connexion
                  </Text>
                  <IconArrowRight size={18} color={tokens.ctaText} />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={{
                  color: tokens.label, fontFamily: Fonts.ui,
                  fontSize: 13, lineHeight: 20, marginBottom: 14,
                }}>
                  Entre ton email. On t'envoie un lien pour créer un nouveau mot de passe.
                </Text>

                <Text style={{
                  fontFamily: Fonts.uiExtraBold,
                  fontSize: 11, color: tokens.label,
                  textTransform: 'uppercase', letterSpacing: 1.32, marginBottom: 8,
                }}>
                  Email
                </Text>
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: focused ? tokens.fieldFocusBg : tokens.fieldBg,
                  borderRadius: 14,
                  borderWidth: 1.6,
                  borderColor: emailError ? AUTH_ERROR_BORDER : focused ? AUTH_BRAND : tokens.fieldBorder,
                  paddingHorizontal: 14, height: 52,
                }}>
                  <View style={{ marginRight: 10 }}>
                    <IconMail size={18} color={focused ? AUTH_BRAND : tokens.fieldIcon} />
                  </View>
                  <TextInput
                    value={email}
                    onChangeText={(v) => { setEmail(v); if (emailError) setEmailError(false); setError(null); }}
                    placeholder="toi@exemple.fr"
                    placeholderTextColor={tokens.placeholder}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    keyboardType="email-address"
                    autoComplete="email"
                    autoCapitalize="none"
                    style={{
                      flex: 1, color: tokens.textPrimary, fontSize: 15,
                      fontFamily: Fonts.ui, paddingVertical: 0,
                    }}
                  />
                </View>
                {emailError && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                    <IconAlertCircle size={12} color={AUTH_ERROR_TEXT} />
                    <Text style={{ color: AUTH_ERROR_TEXT, fontSize: 12, fontFamily: Fonts.uiSemi }}>
                      Adresse email invalide.
                    </Text>
                  </View>
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

                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={loading}
                  activeOpacity={0.88}
                  style={{
                    marginTop: 18,
                    backgroundColor: tokens.ctaBg,
                    borderRadius: 999, height: 54,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 10, opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color={tokens.ctaText} />
                  ) : (
                    <>
                      <Text style={{ color: tokens.ctaText, fontFamily: Fonts.uiExtraBold, fontSize: 15.5 }}>
                        Envoyer le lien
                      </Text>
                      <IconArrowRight size={18} color={tokens.ctaText} />
                    </>
                  )}
                </TouchableOpacity>

                <View style={{ height: 1, backgroundColor: tokens.cardBorder, marginTop: 18, marginBottom: 14 }} />

                <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <Text style={{ color: tokens.textSecondary, fontSize: 13, fontFamily: Fonts.ui }}>
                    Tu te souviens ?
                  </Text>
                  <Link href="/(auth)/login" asChild>
                    <TouchableOpacity hitSlop={6}>
                      <Text style={{ color: AUTH_BRAND, fontFamily: Fonts.uiExtraBold, fontSize: 13 }}>
                        Se connecter
                      </Text>
                    </TouchableOpacity>
                  </Link>
                </View>
              </>
            )}
          </View>

          <View style={{ flex: 1, minHeight: 24 }} />

          <TouchableOpacity
            onPress={() => router.replace('/')}
            style={{ alignItems: 'center', marginTop: 16 }}
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
