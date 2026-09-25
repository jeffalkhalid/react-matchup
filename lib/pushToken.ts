// Le jeton de notification, et où il vit.
//
// Il vivait dans `players.push_token`. Or la fiche joueur est lisible SANS
// COMPTE — il faut bien afficher le classement et les profils — donc l'adresse
// du téléphone de chacun était publique. Mesuré le 2026-09-21 : 4 jetons sur 4
// lus par un inconnu, qui pouvait alors notifier n'importe qui directement,
// sans passer par le serveur (faille C5).
//
// Il vit désormais dans `player_push_tokens`, lisible seulement par son
// propriétaire, par l'arbitre et par le serveur.
//
// LA CLÉ DE CETTE TABLE EST LE JETON, PAS LE JOUEUR, parce qu'un jeton désigne
// un APPAREIL. Deux comptes sur le même téléphone partagent le même jeton :
// rangé par joueur, l'ancien compte gardait une ligne morte et recevait les
// notifications du nouveau. Ici, s'enregistrer se l'attribue.
//
// Ce module est séparé du hook exprès : `usePushNotifications` importe
// `usePlayer`, et `usePlayer` a besoin de libérer le jeton à la déconnexion.
// Les faire s'importer l'un l'autre créerait une boucle.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/** Le jeton que CET appareil a enregistré. */
const CLE_MON_JETON = 'notif:mon-jeton';

/** Enregistre le jeton de cet appareil pour ce joueur. */
export async function enregistrerMonJeton(playerId: string, token: string): Promise<string | null> {
  const { error } = await supabase
    .from('player_push_tokens')
    .upsert({ token, player_id: playerId, updated_at: new Date().toISOString() },
            { onConflict: 'token' });
  if (!error) {
    try { await AsyncStorage.setItem(CLE_MON_JETON, token); } catch { /* sans gravité */ }
  }
  return error ? error.message : null;
}

/**
 * Libère le jeton de CET appareil, à la déconnexion.
 *
 * On ne supprime pas tous les jetons du joueur : il peut avoir un deuxième
 * téléphone, qui n'a aucune raison de devenir muet parce qu'on s'est déconnecté
 * ici. On ne retire donc que celui qu'on a soi-même enregistré.
 *
 * Si le stockage local est vide (réinstallation), on ne retire rien : le jeton
 * reste attribué jusqu'à ce que quelqu'un se connecte sur cet appareil — et il
 * lui sera alors réattribué, puisque la clé de la table est le jeton.
 */
export async function libererMonJeton(playerId: string): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(CLE_MON_JETON);
    if (!token) return;
    await supabase.from('player_push_tokens').delete()
      .eq('token', token).eq('player_id', playerId);
    await AsyncStorage.removeItem(CLE_MON_JETON);
  } catch {
    // Une notification de trop vaut mieux qu'une déconnexion bloquée.
  }
}
