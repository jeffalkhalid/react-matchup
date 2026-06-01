/* components/story/StoryPrimitives.tsx
 * Briques partagées : Wordmark, Avatars, BigSets, QR, Invite.
 * QR : utilise `react-native-qrcode-svg` (à installer : `npx expo install react-native-qrcode-svg`).
 *      Encode `invite.qrValue` (deep link / lien de parrainage réel). */
import React from 'react';
import { View, Text } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Fonts, InviteData, leagueColor } from './storyTheme';

const HASH = ['#4f46e5', '#ec4899', '#8b5cf6', '#14b8a6', '#f59e0b', '#10b981'];
const colFor = (n: string) => HASH[[...(n || '')].reduce((a, c) => a + c.charCodeAt(0), 0) % HASH.length];

export function Wordmark({ s, light = true }: { s: (n: number) => number; light?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(14) }}>
      <View style={{ width: s(52), height: s(52), borderRadius: s(14), backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: s(28) }}>🎾</Text>
      </View>
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(26), letterSpacing: s(6), color: light ? 'rgba(255,255,255,0.82)' : 'rgba(10,10,10,0.7)' }}>PAGMATCH</Text>
    </View>
  );
}

export function Avatars({ names, size, dark, s }: { names: string[]; size: number; dark?: boolean; s: (n: number) => number }) {
  return (
    <View style={{ flexDirection: 'row' }}>
      {names.map((n, i) => (
        <View key={i} style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: colFor(n),
          marginLeft: i ? -size * 0.28 : 0, borderWidth: size * 0.05, borderColor: dark ? '#0A0A0A' : '#fff',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ color: '#fff', fontFamily: Fonts.uiBlack, fontSize: size * 0.42 }}>{(n || '?')[0].toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}

/** Score par sets : mon score en avant, score adverse atténué. */
export function BigSets({ sets, accent, mine = '#fff', theirs = 'rgba(255,255,255,0.5)', size, s }:
  { sets: Array<[number, number]>; accent: string; mine?: string; theirs?: string; size: number; s: (n: number) => number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap' }}>
      {sets.map(([a, b], i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: s(15) }}>
          <Text style={{ fontFamily: Fonts.display, fontSize: size, color: mine, letterSpacing: -size * 0.02 }}>{a}</Text>
          <Text style={{ fontFamily: Fonts.display, fontSize: size * 0.42, color: accent, marginHorizontal: s(6) }}>–</Text>
          <Text style={{ fontFamily: Fonts.display, fontSize: size * 0.78, color: theirs }}>{b}</Text>
        </View>
      ))}
    </View>
  );
}

export function Qr({ value, size }: { value: string; size: number }) {
  return (
    <View style={{ backgroundColor: '#fff', padding: size * 0.085, borderRadius: size * 0.13 }}>
      <QRCode value={value} size={size} color="#0A0A0A" backgroundColor="#fff" ecl="M" />
    </View>
  );
}

/** Bloc invitation : QR + "Rejoins-moi sur PagMatch" + lien profil + lien app. */
export function Invite({ invite, s, light = true, accent = Colors.brand, qr = 132 }:
  { invite: InviteData; s: (n: number) => number; light?: boolean; accent?: string; qr?: number }) {
  const sub = light ? 'rgba(255,255,255,0.55)' : 'rgba(10,10,10,0.5)';
  const main = light ? '#fff' : Colors.textPrimary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(26) }}>
      {invite.showQR !== false ? <Qr value={invite.qrValue} size={qr} /> : null}
      <View style={{ alignItems: 'flex-start' }}>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(24), letterSpacing: s(2), color: sub }}>{(invite.cta || '').toUpperCase()}</Text>
        <Text style={{ fontFamily: Fonts.welcome, fontSize: s(56), color: main, textTransform: 'uppercase' }}>PagMatch</Text>
        <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(26), color: accent }}>{invite.link}</Text>
        {invite.showApp !== false && invite.appUrl ? (
          <View style={{ marginTop: s(8), paddingVertical: s(8), paddingHorizontal: s(16), borderRadius: 999, borderWidth: 1.5, borderColor: light ? 'rgba(255,255,255,0.3)' : 'rgba(10,10,10,0.18)' }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: s(20), color: main }}>📲 {invite.appUrl}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export { leagueColor };
