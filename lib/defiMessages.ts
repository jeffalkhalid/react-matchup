// lib/defiMessages.ts — traduire les refus du serveur sur un défi.
//
// Les RPC `defi_apply` / `defi_accept` lèvent des messages techniques en
// anglais (« binome out of level band »). Ils étaient traduits à UN seul
// endroit — la candidature — si bien qu'en acceptant une invitation depuis le
// lobby, le joueur lisait le texte brut du serveur, sans savoir quoi faire
// (vu sur device le 2026-09-16).
//
// Un seul traducteur, utilisé partout où l'on candidate, accepte ou rejoint la
// file : un refus doit toujours dire CE QUI bloque et CE QU'ON PEUT FAIRE.
import { eloToLevel } from './theme';

export interface DefiBandGame {
  min_elo?: number | null;
  max_elo?: number | null;
}

export interface RefusMessage { title: string; body: string }

const niveau = (elo: number | null | undefined): string =>
  elo == null ? '?' : eloToLevel(elo).toFixed(1);

/**
 * Message à afficher pour un refus connu, ou `null` si ce n'en est pas un
 * (l'appelant garde alors son message générique).
 *
 * `pairAverageElo` : la moyenne de la paire, quand on la connaît — la donner
 * évite au joueur de la calculer pour comprendre l'écart.
 */
export function defiRefusalMessage(
  error: unknown,
  game?: DefiBandGame | null,
  pairAverageElo?: number | null,
): RefusMessage | null {
  const msg = String((error as any)?.message ?? error ?? '');

  if (msg.includes('out of level band')) {
    const lo = niveau(game?.min_elo);
    const hi = niveau(game?.max_elo);
    const moyenne = pairAverageElo != null ? ` La moyenne de votre paire est de ${niveau(pairAverageElo)}.` : '';
    // Fourchette nulle : ce n'est pas le binôme qui est mauvais, c'est le défi
    // qui est impossible à relever. On le dit, sinon le joueur cherche en vain
    // un partenaire qui conviendrait.
    if (game?.min_elo != null && game.min_elo === game.max_elo) {
      return {
        title: 'Défi impossible à relever',
        body: `Ce défi n'accepte qu'une moyenne de très exactement ${lo}.${moyenne}\n\nC'est un réglage trop étroit de son créateur : préviens-le, il peut l'élargir en recréant le défi.`,
      };
    }
    return {
      title: 'Niveau de la paire',
      body: `Pour relever ce défi, la moyenne de la paire doit être comprise entre ${lo} et ${hi}.${moyenne}\n\nChoisis un partenaire qui rapproche la moyenne de cette fourchette.`,
    };
  }

  if (msg.includes('already in game')) {
    return {
      title: 'Déjà engagés',
      body: 'Toi ou ton partenaire êtes déjà engagés sur ce défi.',
    };
  }

  if (msg.includes('not open') || msg.includes('game not open')) {
    return {
      title: 'Défi fermé',
      body: 'Ce défi n’accepte plus de candidature : il est complet, annulé ou déjà passé.',
    };
  }

  return null;
}
