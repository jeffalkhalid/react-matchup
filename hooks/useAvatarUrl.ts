// hooks/useAvatarUrl.ts — « donne-moi l'adresse affichable de cette photo ».
//
// Les photos vivent dans un espace privé : chaque affichage a besoin d'une
// adresse SIGNÉE (cf. lib/avatars). Si chaque rond en demandait une pour lui
// seul, la fiche d'un match ferait quatre appels réseau, la liste des parties
// une trentaine.
//
// Ce crochet REGROUPE : les demandes nées dans la même image (30 ms) partent
// en une seule requête, et chaque rond se redessine quand son adresse arrive.
// Un écran n'a donc rien à orchestrer — il passe le chemin, il reçoit l'adresse
// quand elle est prête, et les initiales s'affichent en attendant.
import { useEffect, useState } from 'react';
import { avatarUrls, cachedAvatarUrl } from '../lib/avatars';

const enAttente = new Set<string>();
const abonnes = new Map<string, Set<() => void>>();
let minuteur: ReturnType<typeof setTimeout> | null = null;

const FENETRE_MS = 30;

function prevenir(path: string): void {
  abonnes.get(path)?.forEach(cb => cb());
}

async function vider(): Promise<void> {
  minuteur = null;
  const lot = [...enAttente];
  enAttente.clear();
  if (lot.length === 0) return;
  await avatarUrls(lot);            // ne lève jamais
  lot.forEach(prevenir);
}

function demander(path: string): void {
  enAttente.add(path);
  if (!minuteur) minuteur = setTimeout(() => { void vider(); }, FENETRE_MS);
}

function abonner(path: string, cb: () => void): () => void {
  const set = abonnes.get(path) ?? new Set();
  set.add(cb);
  abonnes.set(path, set);
  return () => {
    const s = abonnes.get(path);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) abonnes.delete(path);
  };
}

/** Adresse affichable, ou null tant qu'elle n'est pas prête (→ initiales). */
export function useAvatarUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (path ? cachedAvatarUrl(path) : null));

  useEffect(() => {
    if (!path) { setUrl(null); return; }
    const deja = cachedAvatarUrl(path);
    setUrl(deja);
    if (deja) return;
    let vivant = true;
    const desabonner = abonner(path, () => { if (vivant) setUrl(cachedAvatarUrl(path)); });
    demander(path);
    return () => { vivant = false; desabonner(); };
  }, [path]);

  return url;
}
