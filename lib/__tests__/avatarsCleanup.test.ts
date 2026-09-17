// Remplacer / retirer une photo : l'ancien fichier est effacé par l'API de
// stockage, APRÈS la mise à jour de la fiche, et jamais si elle échoue.
//
// Bug d'origine (2026-09-17) : un déclencheur serveur effaçait l'ancien fichier
// directement dans les tables de stockage ; Supabase le refuse, et tout
// remplacement de photo échouait (« Direct deletion from storage tables is not
// allowed »).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const journal: string[] = [];
let echecFiche = false;

vi.mock('../supabase', () => ({
  supabase: {
    storage: {
      from: () => ({
        upload: async (path: string) => { journal.push(`upload ${path}`); return { error: null }; },
        remove: async (paths: string[]) => { journal.push(`remove ${paths.join(',')}`); return { error: null }; },
      }),
    },
    from: () => ({
      update: (v: { avatar_path: string | null }) => ({
        eq: async () => {
          journal.push(`fiche ${v.avatar_path}`);
          return { error: echecFiche ? { message: 'refus' } : null };
        },
      }),
    }),
  },
}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-file-system', () => ({ File: class { async arrayBuffer() { return new ArrayBuffer(1); } } }));

import { uploadAvatar, removeAvatar, deleteAvatarFiles } from '../avatars';

const JOUEUR = 'ae45e6f3-b09e-42ee-afb9-f3774478c345';
const ANCIEN = `${JOUEUR}/1700000000000.jpg`;

beforeEach(() => { journal.length = 0; echecFiche = false; });

describe('remplacer sa photo', () => {
  it("envoie, met la fiche à jour, PUIS efface l'ancien fichier", async () => {
    const nouveau = await uploadAvatar(JOUEUR, { uri: 'file:///x.jpg', mime: 'image/jpeg' }, ANCIEN);
    expect(journal).toEqual([`upload ${nouveau}`, `fiche ${nouveau}`, `remove ${ANCIEN}`]);
  });

  it("fiche refusée : on retire le NOUVEAU fichier, l'ancien reste intact", async () => {
    echecFiche = true;
    await expect(uploadAvatar(JOUEUR, { uri: 'file:///x.jpg', mime: 'image/jpeg' }, ANCIEN)).rejects.toBeTruthy();
    expect(journal.some(l => l.includes(ANCIEN))).toBe(false);
    expect(journal[journal.length - 1]).toMatch(/^remove /);
  });

  it('première photo : rien à effacer', async () => {
    await uploadAvatar(JOUEUR, { uri: 'file:///x.jpg', mime: 'image/jpeg' }, null);
    expect(journal.filter(l => l.startsWith('remove'))).toEqual([]);
  });
});

describe('retirer sa photo', () => {
  it('fiche en initiales, puis fichier effacé', async () => {
    await removeAvatar(JOUEUR, ANCIEN);
    expect(journal).toEqual(['fiche null', `remove ${ANCIEN}`]);
  });
});

describe('effacement jamais bloquant', () => {
  it('ignore les chemins vides', async () => {
    await deleteAvatarFiles([null, undefined, '']);
    expect(journal).toEqual([]);
  });
});
