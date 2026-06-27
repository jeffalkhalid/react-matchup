import { NativeModules, Platform } from 'react-native';

/**
 * Pont vers l'API Credential Manager (Google Password Manager) côté natif Android.
 * Solution fiable d'enregistrement/récupération du mot de passe, indépendante du
 * framework autofill automatique (qui ne sauvegarde pas sur certains Samsung).
 * No-op sur iOS (le trousseau gère l'autofill nativement).
 */

type SavedCredential = { username: string; password: string };

// Affiche « Enregistrer le mot de passe ? » et le stocke dans Google Password
// Manager. À appeler après une connexion/inscription réussie.
export async function savePassword(username: string, password: string): Promise<string> {
  if (Platform.OS !== 'android') return 'not-android';
  try {
    const mod = NativeModules.CredentialManagerBridge;
    if (!mod?.savePassword) return 'no-module';
    return await mod.savePassword(username, password);
  } catch (e) {
    return 'error:' + String(e);
  }
}

// Affiche le sélecteur d'identifiants enregistrés (s'il y en a) et renvoie le
// couple choisi, ou null si aucun / annulé. À appeler sur l'écran de connexion.
export async function getSavedPassword(): Promise<SavedCredential | null> {
  if (Platform.OS !== 'android') return null;
  try {
    const mod = NativeModules.CredentialManagerBridge;
    if (!mod?.getPassword) return null;
    return (await mod.getPassword()) as SavedCredential | null;
  } catch {
    return null;
  }
}
