import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts } from '../../lib/theme';

// Hero d'état vide — remplace JoinHeroCard. 1 SEUL CTA principal, jamais culpabilisant.
export function EmptyHero({ variant, subtitle, ctaLabel, onPress }: {
  variant: 'onboarding' | 'expand';
  subtitle: string;
  ctaLabel: string;
  onPress: () => void;
}) {
  const title = variant === 'onboarding' ? 'Crée ton 1ᵉʳ match' : 'Élargis ton cercle';
  const badge = variant === 'onboarding' ? 'BIENVENUE' : 'SEMAINE CALME';
  return (
    <View style={{ borderRadius: 18, padding: 16, marginTop: 14, backgroundColor: Colors.bgDark }}>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 10, color: Colors.brand, letterSpacing: 0.5, marginBottom: 8 }}>{badge}</Text>
      <Text style={{ fontFamily: Fonts.welcome, fontSize: 22, color: Colors.textOnDark, lineHeight: 26 }}>{title}</Text>
      <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 }}>{subtitle}</Text>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}
        style={{ marginTop: 14, borderRadius: 999, paddingVertical: 12, alignItems: 'center', backgroundColor: Colors.brand }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 14, color: Colors.primary }}>{ctaLabel}</Text>
      </TouchableOpacity>
    </View>
  );
}
