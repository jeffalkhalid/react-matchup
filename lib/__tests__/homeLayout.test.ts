import { describe, it, expect } from 'vitest';
import {
  homeSectionSizes, totalMinHeight, fitsWithoutScroll, ANDROID_COLUMN_H,
} from '../homeLayout';

const sizes = (o: Partial<Parameters<typeof homeSectionSizes>[0]> = {}) =>
  homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: false, ...o });

describe('le budget doit tenir dans l ecran', () => {
  it('SANS match programme, avec des tournois : AUCUN defilement', () => {
    // Le cas le plus frequent, et celui qui a echoue : la carte vide reclamait
    // 2,2 parts sur 8,3, la colonne debordait, l'accueil se mettait a defiler
    // et le haut du hero passait sous l'en-tete.
    expect(fitsWithoutScroll(sizes(), ANDROID_COLUMN_H)).toBe(true);
  });

  it('SANS match et SANS tournoi : encore plus de marge', () => {
    expect(fitsWithoutScroll(sizes({ hasTournaments: false }), ANDROID_COLUMN_H)).toBe(true);
  });

  it('une carte VIDE reclame nettement moins qu une carte pleine', () => {
    // C'est tout le correctif : deux lignes de texte n'ont pas besoin de la
    // place de quatre creneaux de joueurs.
    const vide = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: false });
    const pleine = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true });
    expect(vide.nextMatch.minHeight).toBeLessThan(pleine.nextMatch.minHeight);
    expect(vide.nextMatch.flex).toBeLessThan(pleine.nextMatch.flex);
    expect(totalMinHeight(pleine) - totalMinHeight(vide)).toBeGreaterThanOrEqual(60);
  });

  it('la section Tournois COUTE de la place, et on la compte', () => {
    // Piege paye une premiere fois : la section avait ete ajoutee sans etre
    // retiree du budget, et l'accueil s'etait mis a defiler.
    const avec = sizes({ hasTournaments: true });
    const sans = sizes({ hasTournaments: false });
    expect(totalMinHeight(avec)).toBeGreaterThan(totalMinHeight(sans));
    expect(avec.tournaments).not.toBe(null);
    expect(sans.tournaments).toBe(null);
  });
});

describe('mode compact', () => {
  it('reduit tous les planchers', () => {
    const c = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true });
    const p = homeSectionSizes({ compact: false, hasTournaments: true, hasNextMatch: true });
    expect(totalMinHeight(c)).toBeLessThan(totalMinHeight(p));
  });

  it('garde les MEMES parts : seules les hauteurs changent, pas les proportions', () => {
    // Le compact resserre, il ne redessine pas la page.
    const c = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true });
    const p = homeSectionSizes({ compact: false, hasTournaments: true, hasNextMatch: true });
    expect(c.hero.flex).toBe(p.hero.flex);
    expect(c.nextMatch.flex).toBe(p.nextMatch.flex);
    expect(c.tournaments?.flex).toBe(p.tournaments?.flex);
  });
});

describe('somme des planchers', () => {
  it('compte les espaces ENTRE les sections, pas apres la derniere', () => {
    const s = homeSectionSizes({ compact: true, hasTournaments: false, hasNextMatch: false });
    // 4 sections rendues -> 3 espaces
    const planchers = s.hero.minHeight + s.ctas.minHeight + s.nextMatch.minHeight + s.chips.minHeight;
    expect(totalMinHeight(s)).toBe(planchers + 3 * s.gap);
  });

  it('un ecran plus court que le budget fait defiler, et on le dit', () => {
    expect(fitsWithoutScroll(sizes(), 300)).toBe(false);
  });
});
