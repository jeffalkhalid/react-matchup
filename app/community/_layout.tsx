import { Stack } from 'expo-router';
import { Colors } from '../../lib/theme';

// Pile d'écrans Communauté (push/back) : hub → amis | alertes → nouvelle alerte | inviter.
export default function CommunityLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="friends" />
      <Stack.Screen name="alerts" />
      <Stack.Screen name="alert-new" />
      <Stack.Screen name="invite" />
      <Stack.Screen name="comments/[eventId]" />
    </Stack>
  );
}
