import { describe, it, expect } from 'vitest';
import {
  homeSectionSizes, totalMinHeight, fitsWithoutScroll,
  ANDROID_COLUMN_H, NON_COMPACT_COLUMN_H,
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

  it('SANS match, la carte n est pas rendue du tout', () => {
    // Elle disait « Aucun match programme · explore les parties ouvertes »
    // avec une fleche vers le lobby, juste sous le bouton « Trouver un
    // match » qui dit la meme chose et mene au meme endroit.
    const vide = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: false });
    const pleine = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true });
    expect(vide.nextMatch).toBe(null);
    expect(pleine.nextMatch).not.toBe(null);
    // Et ce qu'elle occupait est vraiment rendu, pas juste redistribue.
    expect(totalMinHeight(vide)).toBeLessThan(totalMinHeight(pleine));
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
    expect(c.nextMatch?.flex).toBe(p.nextMatch?.flex);
    expect(c.tournaments?.flex).toBe(p.tournaments?.flex);
  });
});

describe('somme des planchers', () => {
  it('compte les espaces ENTRE les sections, pas apres la derniere', () => {
    const s = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: false });
    // hero + boutons + tournois + vide = 4 sections rendues -> 3 espaces
    const planchers = s.hero.minHeight + s.ctas.minHeight
      + s.tournaments!.minHeight + s.filler!.minHeight;
    expect(totalMinHeight(s)).toBe(planchers + 3 * s.gap);
  });

  it('un ecran plus court que le budget fait defiler, et on le dit', () => {
    expect(fitsWithoutScroll(sizes(), 300)).toBe(false);
  });
});

describe('le cas le plus charge — la limite haute du handoff', () => {
  it('un match programme ET des tournois ouverts TIENNENT sans defilement', () => {
    // Le handoff designe ce cas comme la limite haute de l'ecran. Avant le
    // resserrage il reclamait 572 dp pour une colonne de 517.
    const charge = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true });
    expect(fitsWithoutScroll(charge, ANDROID_COLUMN_H)).toBe(true);
  });

  it('les quatre combinaisons tiennent', () => {
    for (const hasTournaments of [true, false]) {
      for (const hasNextMatch of [true, false]) {
        for (const openGames of [0, 2]) {
          const s = homeSectionSizes({ compact: true, hasTournaments, hasNextMatch, openGames });
          expect(
            fitsWithoutScroll(s, ANDROID_COLUMN_H),
            `deborde : tournois=${hasTournaments} match=${hasNextMatch} parties=${openGames} -> ${totalMinHeight(s)}dp`,
          ).toBe(true);
        }
      }
    }
  });

  it('les proportions PLEINES tiennent aussi, sur l ecran qui vient juste d y passer', () => {
    // Rien ne verifiait ce cote-la : les planchers pleins n'etaient compares a
    // aucune hauteur. Un ecran juste au-dessus du seuil prend les proportions
    // pleines et n'a, par definition, pas un pixel de marge en plus.
    for (const hasTournaments of [true, false]) {
      for (const hasNextMatch of [true, false]) {
        for (const openGames of [0, 2]) {
          const s = homeSectionSizes({ compact: false, hasTournaments, hasNextMatch, openGames });
          expect(
            fitsWithoutScroll(s, NON_COMPACT_COLUMN_H),
            `deborde : tournois=${hasTournaments} match=${hasNextMatch} parties=${openGames} -> ${totalMinHeight(s)}dp`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('la banniere de soiree en cours', () => {
  it('n existe QUE pendant une soiree', () => {
    expect(homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true }).liveBanner)
      .toBe(null);
    expect(homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true, hasLiveTournament: true }).liveBanner)
      .not.toBe(null);
  });

  it('a une hauteur FIXE : une banniere ne s etire pas', () => {
    // Avec une part (flex > 0) elle prendrait sa portion d'ecran comme une
    // carte, et volerait au hero la place qu'on vient de lui rendre.
    expect(homeSectionSizes({ compact: true, hasTournaments: false, hasNextMatch: true, hasLiveTournament: true }).liveBanner!.flex)
      .toBe(0);
  });

  it('le cas le plus charge tient TOUJOURS, banniere comprise', () => {
    // Elle s'ajoute a un ecran deja plein : c'est exactement le piege paye
    // deux fois sur ce fichier — une section ajoutee sans etre comptee.
    for (const compact of [true, false]) {
      const s = homeSectionSizes({
        compact, hasTournaments: true, hasNextMatch: true, hasLiveTournament: true,
      });
      expect(
        fitsWithoutScroll(s, compact ? ANDROID_COLUMN_H : NON_COMPACT_COLUMN_H),
        `deborde : compact=${compact} -> ${totalMinHeight(s)}dp`,
      ).toBe(true);
    }
  });
});

describe('le texte des boutons grossit quand l ecran se degarnit', () => {
  it('deux sections de cartes : taille d origine, on ne touche a rien', () => {
    // Un match programme ET des tournois ouverts : c'est le cas le plus
    // charge, il n'y a rien a rendre.
    expect(homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true }).ctas.textScale)
      .toBe(1);
    expect(homeSectionSizes({ compact: false, hasTournaments: true, hasNextMatch: true }).ctas.textScale)
      .toBe(1);
  });

  it('une seule section de cartes : le texte monte', () => {
    for (const [hasTournaments, hasNextMatch] of [[true, false], [false, true], [false, false]] as const) {
      const s = homeSectionSizes({ compact: false, hasTournaments, hasNextMatch, openGames: 1 });
      expect(s.ctas.textScale, `tournois=${hasTournaments} match=${hasNextMatch}`)
        .toBeGreaterThan(1);
    }
  });

  it('le compact leve moins haut que le plein ecran', () => {
    // Sur un petit telephone, la marge qu'on croit avoir est celle qui
    // manquera a la carte du dessous.
    const petit = homeSectionSizes({ compact: true,  hasTournaments: true, hasNextMatch: false });
    const grand = homeSectionSizes({ compact: false, hasTournaments: true, hasNextMatch: false });
    expect(petit.ctas.textScale).toBeGreaterThan(1);
    expect(petit.ctas.textScale).toBeLessThan(grand.ctas.textScale);
  });

  it('la rangee reserve la hauteur du texte agrandi', () => {
    // Sans ca, le texte grossit dans une rangee restee a sa taille d'avant :
    // il deborde ou `adjustsFontSizeToFit` le redescend aussitot, et
    // l'agrandissement ne se voit jamais.
    const large = homeSectionSizes({ compact: false, hasTournaments: true, hasNextMatch: false });
    const serre = homeSectionSizes({ compact: false, hasTournaments: true, hasNextMatch: true });
    expect(large.ctas.minHeight).toBeGreaterThan(serre.ctas.minHeight);
  });
});

describe('l emplacement du milieu, selon ce qui est vrai', () => {
  const parts = (s: ReturnType<typeof homeSectionSizes>) =>
    [s.hero, s.ctas, s.tournaments, s.nextMatch, s.openGames, s.filler]
      .reduce((n, x) => n + (x?.flex ?? 0), 0);

  it('un seul occupant a la fois, jamais deux', () => {
    // Trois occupants possibles pour une seule place : si deux se reservent de
    // la hauteur en meme temps, la colonne deborde et l'accueil se met a
    // defiler — le symptome, une fois de plus, ne ressemblera pas a un
    // probleme de hauteur.
    for (const hasTournaments of [true, false]) {
      for (const hasNextMatch of [true, false]) {
        for (const openGames of [0, 2]) {
          const s = homeSectionSizes({ compact: true, hasTournaments, hasNextMatch, openGames });
          const occupants = [s.nextMatch, s.openGames, s.filler].filter(x => x !== null);
          expect(occupants, `tournois=${hasTournaments} match=${hasNextMatch}`).toHaveLength(1);
        }
      }
    }
  });

  it('un match programme prend la place, quoi qu il arrive', () => {
    const s = homeSectionSizes({ compact: true, hasTournaments: false, hasNextMatch: true, openGames: 2 });
    expect(s.nextMatch).not.toBe(null);
    expect(s.openGames).toBe(null);
  });

  it('des tournois ouverts : c est le vide qui prend la place, pas des suggestions', () => {
    // Empiler des parties SOUS une section Tournois surchargerait l'ecran au
    // lieu de l'aerer.
    const s = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: false, openGames: 2 });
    expect(s.filler).not.toBe(null);
    expect(s.openGames).toBe(null);
  });

  it('le vide ne reserve AUCUN plancher : il cede des que ca serre', () => {
    expect(homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: false }).filler!.minHeight)
      .toBe(0);
  });

  it('rend a l ecran « tournois sans match » les parts qu il avait avec la carte vide', () => {
    // La carte vide valait 1,1 part. Le vide en reprend 0,8 et le hero 0,3 :
    // ce total-la ne doit pas bouger, sinon la place rendue est repartie
    // ailleurs que dans le vide et les cartes se deforment.
    expect(parts(homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: false })))
      .toBeCloseTo(6.4);
  });

  it('« cree le tien » ne reclame pas la place de deux vignettes', () => {
    // Meme pli que « Prochain match » : ce qui a deux lignes a dire ne prend
    // pas la hauteur de ce qui en a dix.
    const avec = homeSectionSizes({ compact: true, hasTournaments: false, hasNextMatch: false, openGames: 2 });
    const sans = homeSectionSizes({ compact: true, hasTournaments: false, hasNextMatch: false, openGames: 0 });
    expect(sans.openGames!.minHeight).toBeLessThan(avec.openGames!.minHeight);
    expect(sans.openGames!.flex).toBeLessThan(avec.openGames!.flex);
  });

  it('quand on suggere, le hero ne gonfle pas : il est relaye', () => {
    // Le hero ne prend sa part supplementaire que si PERSONNE ne le relaie.
    const suggere = homeSectionSizes({ compact: true, hasTournaments: false, hasNextMatch: false, openGames: 2 });
    const vide    = homeSectionSizes({ compact: true, hasTournaments: true,  hasNextMatch: false });
    expect(suggere.hero.flex).toBeLessThan(vide.hero.flex);
  });
});

describe('l air rendu par la rangee de raccourcis', () => {
  it('reste de l air : le pire cas garde une vraie marge', () => {
    // La rangee « Classement · Score » du bas a ete retiree et ses ~52 dp
    // repartis sur les sections. Le risque, plus tard, est qu'une nouvelle
    // section les reprenne en silence et qu'on revienne a la colonne au ras
    // du bord — le symptome ne ressemblera pas a un probleme de hauteur, il
    // ressemblera a « le haut du hero est coupe ». D'ou ce garde-fou.
    const charge = homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true });
    expect(ANDROID_COLUMN_H - totalMinHeight(charge)).toBeGreaterThanOrEqual(24);
  });

  it('en a mis une part dans les espaces entre cartes', () => {
    // C'est ce qu'« aerer » veut dire ici : ce n'est pas une carte de plus,
    // c'est du vide entre celles qui restent.
    expect(homeSectionSizes({ compact: true, hasTournaments: true, hasNextMatch: true }).gap)
      .toBeGreaterThan(6);
  });
});
