import { NativeModules, Platform } from 'react-native';

/**
 * Force Android à committer le contexte de saisie automatique pour déclencher
 * la fenêtre « Enregistrer le mot de passe dans Google ? ».
 *
 * À appeler juste après une connexion/inscription réussie, AVANT de naviguer
 * (les champs email/mot de passe doivent encore être montés). No-op sur iOS,
 * où le trousseau gère l'enregistrement tout seul.
 */
export async function commitAutofill(): Promise<string> {
  if (Platform.OS !== 'android') return 'not-android';
  try {
    const mod = NativeModules.AutofillBridge;
    if (!mod?.commit) return 'no-module';        // pont absent (Expo Go / interop New Arch KO)
    return await mod.commit();
  } catch (e) {
    return 'exception:' + String(e);
  }
}

