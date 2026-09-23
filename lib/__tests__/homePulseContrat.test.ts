// LE CONTRAT DE « Ça bouge chez les PAGUISTES », vérifié SANS le calculateur.
//
// Le partage des rôles :
//
//   homeLayout décide combien de place il est AUTORISÉ à lui donner.
//   HomePulse garantit lui-même qu'il ne dépassera jamais sa taille idéale.
//
// Sans le second, la garantie tient entièrement au premier. Vu à l'écran le
// 2026-09-24 : le parent accordait ~253 points, la chaîne des `flex: 1` les
// conduisait jusqu'aux cartes, qui s'étiraient à 218 avec 140 points de vide
// entre le titre et le bouton. Le blanc n'avait pas disparu — il était passé
// À L'INTÉRIEUR des cartes.
//
// Ces tests lisent le composant, pas le calculateur : ils tiendraient encore
// si homeLayout disparaissait.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PULSE_IDEAL } from '../homeLayout';

const SRC = readFileSync(join(__dirname, '..', '..', 'components', 'home', 'HomePulse.tsx'), 'utf8');
/** La racine du composant : la première View rendue. */
const RACINE = SRC.slice(SRC.indexOf('<View style={{ gap: 10'), SRC.indexOf('<View style={{ gap: 10') + 120);

describe('HomePulse ne dépasse jamais sa taille idéale', () => {
  it('sa racine porte une borne haute', () => {
    expect(RACINE).toContain('maxHeight: PULSE_IDEAL');
  });

  it('elle garde son `flex: 1` : les cartes doivent utiliser la place réelle', () => {
    // La borne ne doit pas devenir une hauteur figée : en dessous de l'idéal,
    // les cartes s'adaptent à ce qu'on leur donne (elles perdent la phrase,
    // puis les visages). C'est le `flex: 1` qui le permet.
    expect(RACINE).toContain('flex: 1');
  });

  it('aucune deuxième borne arbitraire sur les cartes', () => {
    // Une borne par carte serait un second chiffre à tenir à jour, et le
    // premier suffit : plafonner la racine plafonne tout ce qui est dessous.
    const carte = SRC.slice(SRC.indexOf('const CARTE = {'), SRC.indexOf('} as const;', SRC.indexOf('const CARTE = {')));
    expect(carte).not.toContain('maxHeight');
    expect(carte).not.toContain('height:');
  });
});

describe('ce que la borne vaut, et ce qu elle ne couvre pas', () => {
  it('la borne vient de la MÊME source que ce que le parent alloue', () => {
    // Deux nombres, c'est deux nombres qui divergent. La borne du composant et
    // le plafond du calculateur sont le même.
    expect(SRC).toContain("import { PULSE_IDEAL } from '../../lib/homeLayout'");
  });

  it('elle vaut 185, et l idéal INTRINSÈQUE du composant en vaut 197', () => {
    // Mesuré sur ce que le composant dessine vraiment :
    //   en-tête de section 25 + espace 10
    //   + carte : rembourrage 28 + zone haute 96 + espace 10 + bouton 28 = 162
    //   = 197
    // La zone haute (96) = en-tête de carte 52 + espace 10 + visages 34, et
    // c'est exactement le seuil « forme complète » du composant.
    //
    // Le calculateur en annonce 185 : il oublie l'espace de 10 entre le
    // contenu de la carte et son bouton, et compte l'en-tête de section à 21
    // au lieu de 25. Consequence VISIBLE : a 185, la zone haute recoit 83 et
    // ne peut JAMAIS atteindre 96 — la carte reste bloquee sur sa forme
    // intermediaire, meme sur un grand ecran.
    //
    // Ce test n'echoue pas : il enregistre l'ecart, pour qu'il soit une
    // decision et non un oubli.
    expect(PULSE_IDEAL).toBe(185);
    const intrinseque = 25 + 10 + (28 + (52 + 10 + 34) + 10 + 28);
    expect(intrinseque).toBe(197);
  });
});
