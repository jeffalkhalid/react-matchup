// components/auth/PasswordRules.tsx — ce qu'il manque encore au mot de passe.
//
// Affiché sous le champ, il se coche au fur et à mesure de la saisie. Sans
// lui, on découvrait la règle en se faisant refuser — et une exigence à la
// fois, ce qui donne envie d'abandonner.
//
// Les deux écrans d'authentification ont leurs propres couleurs (thème clair
// ou sombre) : elles se passent en paramètre plutôt que d'être décidées ici.
import { View, Text } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { PASSWORD_RULES } from '../../lib/password';

function Coche({ ok, color }: { ok: boolean; color: string }) {
  return (
    <Svg width={13} height={13} viewBox="0 0 24 24" fill="none">
      {ok
        ? <Path d="M20 6 9 17l-5-5" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        : <Circle cx={12} cy={12} r={4} fill={color} />}
    </Svg>
  );
}

export function PasswordRules({ password, doneColor, todoColor }: {
  password: string;
  /** Couleur d'une exigence satisfaite. */
  doneColor: string;
  /** Couleur d'une exigence encore à remplir. */
  todoColor: string;
}) {
  return (
    <View style={{ gap: 5, marginTop: 8 }}>
      {PASSWORD_RULES.map(r => {
        const ok = r.ok(password);
        return (
          <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Coche ok={ok} color={ok ? doneColor : todoColor} />
            <Text style={{
              fontFamily: ok ? Fonts.uiExtraBold : Fonts.ui,
              fontSize: 12, color: ok ? doneColor : todoColor,
            }}>
              {r.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
