// Photos de profil : chemins et cache des adresses signées.
//
// Ce qui se teste ici est la partie qui décide SANS réseau : où va le fichier,
// à qui il appartient, et quelles adresses il faut (re)demander au serveur.
// L'envoi lui-même s'essaie sur téléphone.
import { describe, it, expect, beforeEach, vi } from 'vitest';
// lib/avatars importe le client Supabase et le sélecteur d'images : on les
// neutralise, les fonctions testées ici ne s'en servent pas.
vi.mock('../supabase', () => ({ supabase: {} }));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-file-system', () => ({ File: class {} }));

import {
  extFromMime, newAvatarPath, ownsAvatarPath,
  cachedAvatarUrl, rememberAvatarUrl, splitAvatarPaths, resetAvatarUrlCache,
  SIGNED_TTL_SECONDS, REFRESH_MARGIN_MS,
} from '../avatars';

const JOUEUR = 'ae45e6f3-b09e-42ee-afb9-f3774478c345';
const T0 = 1_700_000_000_000;

beforeEach(() => resetAvatarUrlCache());

describe('chemin de la photo', () => {
  it('range la photo dans le dossier du joueur', () => {
    const p = newAvatarPath(JOUEUR, 'image/jpeg', T0);
    expect(p).toBe(`${JOUEUR}/${T0}.jpg`);
    expect(p.split('/')[0]).toBe(JOUEUR);   // ce que vérifie le serveur
  });

  it('change de nom à chaque envoi (sinon l’ancienne photo reste en cache)', () => {
    expect(newAvatarPath(JOUEUR, 'image/jpeg', T0))
      .not.toBe(newAvatarPath(JOUEUR, 'image/jpeg', T0 + 1));
  });

  it('garde l’extension des formats acceptés, jpg sinon', () => {
    expect(extFromMime('image/png')).toBe('png');
    expect(extFromMime('image/webp')).toBe('webp');
    expect(extFromMime('image/heic')).toBe('jpg');
    expect(extFromMime(null)).toBe('jpg');
  });

  it('reconnaît le propriétaire d’un chemin', () => {
    expect(ownsAvatarPath(JOUEUR, `${JOUEUR}/1.jpg`)).toBe(true);
    expect(ownsAvatarPath(JOUEUR, 'quelquun-dautre/1.jpg')).toBe(false);
    expect(ownsAvatarPath(JOUEUR, null)).toBe(false);
  });
});

describe('adresses signées gardées en mémoire', () => {
  it('sert une adresse encore valable', () => {
    rememberAvatarUrl('a/1.jpg', 'https://x/1', T0);
    expect(cachedAvatarUrl('a/1.jpg', T0 + 60_000)).toBe('https://x/1');
  });

  it('oublie l’adresse AVANT son expiration réelle', () => {
    rememberAvatarUrl('a/1.jpg', 'https://x/1', T0);
    // Marge de sécurité : une image qui commence à charger juste avant
    // l'expiration afficherait un carré vide.
    const justeAvantLaMarge = T0 + SIGNED_TTL_SECONDS * 1000 - REFRESH_MARGIN_MS - 1;
    expect(cachedAvatarUrl('a/1.jpg', justeAvantLaMarge)).toBe('https://x/1');
    expect(cachedAvatarUrl('a/1.jpg', justeAvantLaMarge + 2)).toBeNull();
  });

  it('ne demande au serveur que ce qui manque', () => {
    rememberAvatarUrl('a/1.jpg', 'https://x/1', T0);
    const { ready, missing } = splitAvatarPaths(['a/1.jpg', 'b/2.jpg', null, undefined], T0 + 1000);
    expect([...ready.keys()]).toEqual(['a/1.jpg']);
    expect(missing).toEqual(['b/2.jpg']);
  });

  it('ne demande pas deux fois le même joueur présent deux fois à l’écran', () => {
    const { missing } = splitAvatarPaths(['b/2.jpg', 'b/2.jpg', 'c/3.jpg'], T0);
    expect(missing).toEqual(['b/2.jpg', 'c/3.jpg']);
  });

  it('un joueur sans photo ne déclenche aucune demande', () => {
    const { ready, missing } = splitAvatarPaths([null, undefined, ''], T0);
    expect(ready.size).toBe(0);
    expect(missing).toEqual([]);
  });
});
