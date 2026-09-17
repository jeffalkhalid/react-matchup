// lib/avatars.ts — les photos de profil.
//
// RÈGLE DE VISIBILITÉ (décision utilisateur 2026-09-16) : une photo n'est
// visible que des joueurs CONNECTÉS. L'espace de stockage est donc privé et
// rien n'a d'adresse publique : l'app demande des adresses SIGNÉES, valables
// une heure, et les garde en mémoire. Les pages de partage web, qui n'ont pas
// de compte, continuent d'afficher les initiales.
//
// Le joueur porte le CHEMIN de sa photo (`players.avatar_path`), jamais une
// adresse : une adresse signée expire, elle ne se stocke pas.
//
// Côté serveur : supabase/migrations/avatars.sql (espace privé, écriture
// limitée à son propre dossier, ménage automatique du fichier remplacé).
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { supabase } from './supabase';

export const AVATAR_BUCKET = 'avatars';
/** Durée de vie demandée pour une adresse signée. */
export const SIGNED_TTL_SECONDS = 3600;
/** On re-signe un peu avant l'expiration : une image à moitié chargée au
 *  moment où l'adresse expire afficherait un carré vide. */
export const REFRESH_MARGIN_MS = 5 * 60_000;

// ─── Chemins ────────────────────────────────────────────────────────────────

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Extension acceptée par l'espace de stockage ; jpg par défaut. */
export function extFromMime(mime: string | null | undefined): string {
  return EXT_BY_MIME[(mime ?? '').toLowerCase()] ?? 'jpg';
}

/** « <id du joueur>/<horodatage>.jpg ».
 *  Le PREMIER dossier identifie le propriétaire : c'est ce que vérifient les
 *  règles du serveur. Le nom change à chaque envoi pour que les caches
 *  d'images ne servent pas l'ancienne photo. */
export function newAvatarPath(playerId: string, mime?: string | null, now: number = Date.now()): string {
  return `${playerId}/${now}.${extFromMime(mime)}`;
}

/** Le chemin appartient-il bien à ce joueur ? (garde-fou côté app ; le serveur
 *  refuse de toute façon un dossier qui n'est pas le sien). */
export function ownsAvatarPath(playerId: string, path: string | null | undefined): boolean {
  return !!path && path.split('/')[0] === playerId;
}

// ─── Adresses signées, gardées en mémoire ───────────────────────────────────

type Entry = { url: string; expiresAt: number };
const cache = new Map<string, Entry>();

/** Adresse encore valable pour ce chemin, sinon null. */
export function cachedAvatarUrl(path: string, now: number = Date.now()): string | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (hit.expiresAt <= now) { cache.delete(path); return null; }
  return hit.url;
}

export function rememberAvatarUrl(path: string, url: string, now: number = Date.now()): void {
  cache.set(path, { url, expiresAt: now + SIGNED_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS });
}

/** Ce qu'on a déjà, et ce qu'il reste à demander au serveur. */
export function splitAvatarPaths(
  paths: (string | null | undefined)[],
  now: number = Date.now(),
): { ready: Map<string, string>; missing: string[] } {
  const ready = new Map<string, string>();
  const missing: string[] = [];
  for (const p of paths) {
    if (!p) continue;
    if (ready.has(p) || missing.includes(p)) continue;   // même joueur deux fois à l'écran
    const url = cachedAvatarUrl(p, now);
    if (url) ready.set(p, url); else missing.push(p);
  }
  return { ready, missing };
}

/** Vide le cache — changement de compte, ou tests. */
export function resetAvatarUrlCache(): void {
  cache.clear();
}

/**
 * Adresses affichables pour une liste de chemins. UNE seule requête pour tout
 * un écran : signer les photos une par une ferait quatre appels réseau rien
 * que pour la fiche d'un match.
 *
 * Ne lève jamais : une photo qu'on n'arrive pas à signer devient des initiales.
 */
export async function avatarUrls(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  const { ready, missing } = splitAvatarPaths(paths);
  if (missing.length === 0) return ready;
  try {
    const { data, error } = await supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrls(missing, SIGNED_TTL_SECONDS);
    if (error) { console.warn('[avatars] createSignedUrls', error); return ready; }
    for (const row of data ?? []) {
      const path = (row as any).path as string | null;
      const url = (row as any).signedUrl as string | null;
      if (path && url) { rememberAvatarUrl(path, url); ready.set(path, url); }
    }
  } catch (e) {
    console.warn('[avatars] createSignedUrls', e);
  }
  return ready;
}

/** Adresse d'une seule photo (profil, en-tête). */
export async function avatarUrl(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const m = await avatarUrls([path]);
  return m.get(path) ?? null;
}

// ─── Choisir, envoyer, retirer ──────────────────────────────────────────────

export type PickedImage = { uri: string; mime: string };

/** Recadrage CARRÉ imposé et compression : une photo de téléphone fait 3 à
 *  5 Mo, l'espace de stockage plafonne à 2 Mo, et un rond de 40 dp n'a besoin
 *  que de quelques dizaines de Ko. */
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: true,
  aspect: [1, 1],
  quality: 0.6,
};

/**
 * Résultat d'un choix de photo.
 *
 * On DISTINGUE « annulé » de « refusé » : les deux rendaient `null`, donc
 * l'écran ne disait rien dans les deux cas — un joueur qui avait refusé l'accès
 * aux photos tapait le bouton et il ne se passait rien, sans la moindre
 * explication.
 */
export type AvatarPick =
  | { ok: true; image: PickedImage }
  | { ok: false; raison: 'annule' | 'permission' };

function fromAsset(res: ImagePicker.ImagePickerResult): AvatarPick {
  const a = res.canceled ? null : res.assets?.[0];
  if (!a) return { ok: false, raison: 'annule' };
  return { ok: true, image: { uri: a.uri, mime: a.mimeType ?? 'image/jpeg' } };
}

/**
 * CHOISIR une photo ne demande aucune autorisation sur les téléphones récents :
 * le sélecteur du système tourne hors de l'application, qui ne reçoit que
 * l'image choisie (iOS ≥ 11, Android ≥ 13). Demander l'autorisation d'abord,
 * comme on le faisait, revenait à bloquer le bouton chez tous ceux qui avaient
 * refusé l'accès aux photos un jour — constaté sur iPhone le 2026-09-16 :
 * « Accès aux photos refusé » alors que la galerie se serait ouverte.
 *
 * On lance donc le sélecteur DIRECTEMENT. Ce n'est qu'en cas d'échec (Android
 * ancien, qui exige encore l'ancienne autorisation de lecture) qu'on la demande
 * et qu'on retente.
 */
export async function pickAvatarFromLibrary(): Promise<AvatarPick> {
  try {
    return fromAsset(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
  } catch {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { ok: false, raison: 'permission' };
    return fromAsset(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
  }
}

export async function takeAvatarWithCamera(): Promise<AvatarPick> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, raison: 'permission' };
  return fromAsset(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
}

/**
 * Android : pendant que la galerie est ouverte, le système peut détruire
 * l'écran de l'app pour récupérer de la mémoire. Au retour, la promesse du
 * choix est perdue — le joueur a bien choisi sa photo et il ne se passe RIEN
 * (piège documenté par expo-image-picker, `getPendingResultAsync`).
 *
 * Le résultat orphelin est récupérable une fois, au retour sur l'écran.
 */
export async function pendingAvatarPick(): Promise<PickedImage | null> {
  try {
    const res = await ImagePicker.getPendingResultAsync();
    if (!res || (res as any).code) return null;       // absent, ou erreur native
    const pick = fromAsset(res as ImagePicker.ImagePickerResult);
    return pick.ok ? pick.image : null;
  } catch {
    return null;
  }
}

/**
 * Envoie la photo et l'attache au joueur. Rend le nouveau chemin.
 *
 * L'ancien fichier n'est PAS supprimé ici : le serveur s'en charge dès que
 * `avatar_path` change (déclencheur de la migration). Un client qui perd le
 * réseau au mauvais moment ne peut donc pas laisser d'image orpheline.
 */
export async function uploadAvatar(playerId: string, image: PickedImage): Promise<string> {
  const bytes = await new File(image.uri).arrayBuffer();
  const path = newAvatarPath(playerId, image.mime);
  const { error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, bytes, { contentType: image.mime, upsert: false });
  if (error) throw error;

  const { error: dbError } = await supabase
    .from('players')
    .update({ avatar_path: path })
    .eq('id', playerId);
  if (dbError) {
    // La fiche n'a pas été mise à jour : on retire le fichier qu'on vient
    // d'envoyer, sinon il resterait sans propriétaire.
    await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {});
    throw dbError;
  }
  rememberAvatarUrlInvalidate(path);
  return path;
}

/** Retire la photo : le serveur efface le fichier au passage à NULL. */
export async function removeAvatar(playerId: string, currentPath?: string | null): Promise<void> {
  const { error } = await supabase.from('players').update({ avatar_path: null }).eq('id', playerId);
  if (error) throw error;
  if (currentPath) cache.delete(currentPath);
}

/** Une nouvelle photo ne doit pas hériter d'une adresse en cache. */
function rememberAvatarUrlInvalidate(path: string): void {
  cache.delete(path);
}

/** Signaler la photo d'un joueur (table de signalements existante). */
export async function reportAvatar(reporterId: string, playerId: string, reason?: string): Promise<void> {
  const { error } = await supabase.from('content_reports').insert({
    reporter_id: reporterId,
    target_type: 'avatar',
    target_id: playerId,
    reported_player_id: playerId,
    reason: reason ?? null,
  });
  if (error) throw error;
}

/** Retrait par l'arbitre (panel). */
export async function adminRemoveAvatar(playerId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_remove_avatar', { p_player_id: playerId });
  if (error) throw error;
}
