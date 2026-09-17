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
import { avatarUrls, cachedAvatarUrl, forgetAvatarUrl } from '../lib/avatars';

const enAttente = new Set<string>();
const abonnes = new Map<string, Set<() => void>>();
let minuteur: ReturnType<typeof setTimeout> | null = null;

const FENETRE_MS = 30;

// Nouvelles tentatives. Une demande qui échoue une fois (réseau lent au
// démarrage, coupure) laissait TOUTES les photos de l'écran en initiales pour
// de bon : « des fois les photos ne chargent pas ». On réessaie, en espaçant,
// tant qu'un rond attend encore cette photo — sans insister indéfiniment sur un
// fichier réellement absent.
const MAX_ESSAIS = 3;
const essais = new Map<string, number>();

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
  for (const p of lot) {
    if (cachedAvatarUrl(p)) { essais.delete(p); continue; }
    reessayer(p);
  }
}

function reessayer(path: string): void {
  const n = (essais.get(path) ?? 0) + 1;
  essais.set(path, n);
  if (n >= MAX_ESSAIS) return;
  setTimeout(() => { if (abonnes.has(path)) demander(path); }, 1500 * n);
}

/** L'image n'a pas pu s'afficher (adresse périmée, téléchargement coupé) :
 *  on oublie l'adresse et on en redemande une, dans la limite des essais. */
export function relancerAvatar(path: string): void {
  forgetAvatarUrl(path);
  reessayer(path);
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
