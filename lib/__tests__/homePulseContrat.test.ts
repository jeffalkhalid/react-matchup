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
import { PULSE_IDEAL, PULSE_MIN } from '../homeLayout';

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

  it('elle vaut exactement ce que le composant dessine : 197', () => {
    // Mesuré sur le rendu :
    //   en-tête de section 25 + espace 10
    //   + carte : rembourrage 28 + zone haute 96 + espace 10 + bouton 28 = 162
    //   = 197
    // La zone haute (96) = en-tête de carte 52 + espace 10 + visages 34, et
    // c'est exactement le seuil « forme complète » du composant — ce qui rend
    // cette forme atteignable, ce qu'elle n'était pas à 185.
    //
    // Le calculateur annonçait 185 : il oubliait l'espace entre le contenu de
    // la carte et son bouton, et comptait l'en-tête de section à 21 pour un
    // interligne de 25. La carte restait donc bloquée sur sa forme
    // intermédiaire, même sur un grand écran.
    const intrinseque = 25 + 10 + (28 + (52 + 10 + 34) + 10 + 28);
    expect(intrinseque).toBe(197);
    expect(PULSE_IDEAL).toBe(intrinseque);
  });

  it('le minimum aussi : la carte doit pouvoir montrer son titre', () => {
    // 133 = le même cadre, avec un en-tête de carte réduit à sa pastille (32).
    // Il valait 111, ce qui ne laissait que 10 points à la zone haute : le
    // titre y était coupé. Un minimum sous lequel le bloc ne sait plus
    // s'afficher doit au moins permettre de l'afficher.
    const cadre = 25 + 10 + 28 + 10 + 28;
    expect(PULSE_MIN).toBe(cadre + 32);
    expect(PULSE_MIN).toBe(133);
  });
});
