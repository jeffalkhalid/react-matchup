import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  availabilitySlots, slotLabel, isSlotActive, slotFromKey, AVAILABILITY_TTL_DAYS, AVAILABILITY_DAYS,
  slotShortLabel, slotTitle, missingPlayers, circleVisibilityLabel, suggestedStart, slotFormFields,
  displayedSlot,
} from '../availability';

// Jeudi 17 septembre 2026, 9 h (heure locale du téléphone).
const jeudi9h = new Date(2026, 8, 17, 9, 0, 0);

describe('availabilitySlots — la ligne des sept prochains jours', () => {
  it('propose sept jours, à partir de ce soir', () => {
    const s = availabilitySlots(jeudi9h);
    expect(s).toHaveLength(AVAILABILITY_DAYS);
    expect(s.map(x => x.label)).toEqual(['Ce soir', 'Demain', 'Sam. 19', 'Dim. 20', 'Lun. 21', 'Mar. 22', 'Mer. 23']);
  });

  it('la clé d\'un créneau est son jour, pas un mot-clé', () => {
    const s = availabilitySlots(jeudi9h);
    expect(s[0].key).toBe('2026-09-17');
    expect(s[2].key).toBe('2026-09-19');
  });

  it('le dimanche est proposé — c\'était le trou des trois pastilles', () => {
    const dim = availabilitySlots(jeudi9h).find(x => x.start.getDay() === 0);
    expect(dim).toBeTruthy();
    expect(dim!.start.getDate()).toBe(20);
  });

  it('« Ce soir » va de 18 h à minuit, aujourd\'hui', () => {
    const [ce] = availabilitySlots(jeudi9h);
    expect(ce.start.getDate()).toBe(17);
    expect(ce.start.getHours()).toBe(18);
    expect(ce.end.getDate()).toBe(18);
    expect(ce.end.getHours()).toBe(0);
  });

  it('après 18 h, « Ce soir » part de maintenant — pas d\'un créneau déjà entamé', () => {
    const jeudi20h30 = new Date(2026, 8, 17, 20, 30, 0);
    const [ce] = availabilitySlots(jeudi20h30);
    expect(ce.label).toBe('Ce soir');
    expect(ce.start.getHours()).toBe(20);
    expect(ce.start.getMinutes()).toBe(30);
  });

  it('au milieu de la nuit, « Ce soir » disparaît et la liste reste pleine', () => {
    const vendredi1h = new Date(2026, 8, 18, 1, 0, 0);
    const s = availabilitySlots(vendredi1h);
    expect(s[0].label).toBe('Demain');
    expect(s).toHaveLength(AVAILABILITY_DAYS);
  });

  it('un jour entier va de 8 h à minuit', () => {
    const demain = availabilitySlots(jeudi9h)[1];
    expect(demain.start.getDate()).toBe(18);
    expect(demain.start.getHours()).toBe(8);
    expect(demain.end.getDate()).toBe(19);
    expect(demain.end.getHours()).toBe(0);
  });

  it('les jours se suivent sans trou ni doublon', () => {
    const cles = availabilitySlots(jeudi9h).map(x => x.key);
    expect(new Set(cles).size).toBe(cles.length);
    expect(cles).toEqual([
      '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
      '2026-09-21', '2026-09-22', '2026-09-23',
    ]);
  });

  it('on peut demander moins de jours', () => {
    expect(availabilitySlots(jeudi9h, 3)).toHaveLength(3);
  });
});

describe('slotLabel — la phrase sous un joueur dispo', () => {
  it('nomme le jour et les heures', () => {
    const s = availabilitySlots(jeudi9h);
    expect(slotLabel(s[0], jeudi9h)).toBe('Ce soir · 18h – minuit');
    expect(slotLabel(s[1], jeudi9h)).toBe('Demain · 8h – minuit');
    expect(slotLabel(s[2], jeudi9h)).toBe('Samedi · 8h – minuit');
    expect(slotLabel(s[3], jeudi9h)).toBe('Dimanche · 8h – minuit');
  });
});

describe('isSlotActive — retrouver mes jours déjà déclarés', () => {
  const s = availabilitySlots(jeudi9h);

  it('reconnaît un créneau déclaré', () => {
    const mine = [{ slot_start: s[0].start.toISOString(), slot_end: s[0].end.toISOString() }];
    expect(isSlotActive(s[0], mine)).toBe(true);
    expect(isSlotActive(s[1], mine)).toBe(false);
  });

  it('reste vrai quand l\'heure a avancé dans la soirée', () => {
    // Déclaré à 18 h ; on regarde l'écran à 21 h, « Ce soir » part de 21 h.
    const declare = [{ slot_start: new Date(2026, 8, 17, 18, 0, 0).toISOString(), slot_end: new Date(2026, 8, 18, 0, 0, 0).toISOString() }];
    const plusTard = availabilitySlots(new Date(2026, 8, 17, 21, 0, 0))[0];
    expect(isSlotActive(plusTard, declare)).toBe(true);
  });

  it('ignore une date illisible', () => {
    expect(isSlotActive(s[0], [{ slot_start: 'nawak', slot_end: 'nawak' }])).toBe(false);
  });

  it('aucune dispo → aucun créneau actif', () => {
    expect(isSlotActive(s[0], [])).toBe(false);
  });
});

describe('slotFromKey — retrouver un créneau par son jour', () => {
  it('rend le créneau si le jour est encore proposé', () => {
    expect(slotFromKey('2026-09-17', jeudi9h)?.label).toBe('Ce soir');
    expect(slotFromKey('2026-09-20', jeudi9h)?.label).toBe('Dim. 20');
  });
  it('rend null pour un jour hors de la ligne', () => {
    expect(slotFromKey('2026-09-17', new Date(2026, 8, 18, 1, 0, 0))).toBe(null);
    expect(slotFromKey('2026-10-30', jeudi9h)).toBe(null);
  });
});

describe('slotShortLabel / slotTitle — libellés de la carte Dispos', () => {
  const s = availabilitySlots(jeudi9h);

  it('dit ce soir, demain, puis nomme le jour', () => {
    expect(slotShortLabel(s[0], jeudi9h)).toBe('ce soir');
    expect(slotShortLabel(s[1], jeudi9h)).toBe('demain');
    expect(slotShortLabel(s[2], jeudi9h)).toBe('samedi');
    expect(slotShortLabel(s[3], jeudi9h)).toBe('dimanche');
  });

  it('le titre de la carte suit le créneau affiché', () => {
    expect(slotTitle(s[0], jeudi9h)).toBe('Dispos ce soir');
    expect(slotTitle(s[3], jeudi9h)).toBe('Dispos dimanche');
  });
});

describe('missingPlayers — combien il en manque pour jouer', () => {
  it('quatre joueurs font une partie, moi compris', () => {
    expect(missingPlayers(0)).toBe(3);
    expect(missingPlayers(3)).toBe(0);
    expect(missingPlayers(5)).toBe(0);
  });
});

describe('circleVisibilityLabel — qui voit ma dispo', () => {
  it('sans abonné, la phrase le dit et propose d inviter', () => {
    expect(circleVisibilityLabel(0)).toMatch(/Personne ne te suit/);
  });
  it('au singulier comme au pluriel', () => {
    // Le compte porte sur mes ABONNES : ce sont eux qui voient ma dispo, pas
    // ceux que je suis. Suivre quelqu'un ne lui montre rien de moi.
    expect(circleVisibilityLabel(1)).toBe('Ton abonné le voit tout de suite.');
    expect(circleVisibilityLabel(6)).toBe('Tes 6 abonnés le voient tout de suite.');
    expect(circleVisibilityLabel(0)).toMatch(/Personne ne te suit/);
  });
});

describe('durée de vie d\'une dispo', () => {
  it('couvre la ligne des sept jours', () => {
    expect(AVAILABILITY_TTL_DAYS).toBeGreaterThan(AVAILABILITY_DAYS);
  });
});

describe('suggestedStart / slotFormFields — l\'heure proposée à la création', () => {
  it('avant le créneau, propose son début', () => {
    const [ce] = availabilitySlots(jeudi9h);           // ce soir, 18 h
    expect(suggestedStart(ce, jeudi9h).getHours()).toBe(18);
  });

  it('créneau déjà commencé : au moins une heure devant soi', () => {
    const maintenant = new Date(2026, 8, 17, 20, 10, 0);
    const [ce] = availabilitySlots(maintenant);
    const propose = suggestedStart(ce, maintenant);
    expect(propose.getTime()).toBeGreaterThanOrEqual(maintenant.getTime() + 60 * 60_000);
  });

  it('toujours sur une demi-heure ronde', () => {
    const maintenant = new Date(2026, 8, 17, 20, 10, 0);
    const [ce] = availabilitySlots(maintenant);
    expect([0, 30]).toContain(suggestedStart(ce, maintenant).getMinutes());
  });

  it('rend les deux champs de l\'assistant', () => {
    const [ce] = availabilitySlots(jeudi9h);
    expect(slotFormFields(ce, jeudi9h)).toEqual({ day: '2026-09-17', time: '18:00' });
  });

  it('un jour entier commence à 8 h', () => {
    const demain = availabilitySlots(jeudi9h)[1];
    expect(slotFormFields(demain, jeudi9h)).toEqual({ day: '2026-09-18', time: '08:00' });
  });
});

describe('« Ce soir » disparaît quand il est trop tard pour jouer', () => {
  const ce = (h: number, min = 0) => availabilitySlots(new Date(2026, 8, 17, h, min, 0))[0];

  it('à 20 h, il reste de quoi jouer', () => {
    expect(ce(20).label).toBe('Ce soir');
  });

  it('à 21 h 30, c\'est la limite — le temps d\'y aller plus un match', () => {
    expect(ce(21, 30).label).toBe('Ce soir');
  });

  it('à 22 h, « ce soir » n\'est plus proposé', () => {
    expect(ce(22).label).toBe('Demain');
  });

  it('à 23 h non plus — le cas qui a motivé la règle', () => {
    expect(ce(23).label).toBe('Demain');
  });

  it('la ligne reste pleine quand la soirée tombe', () => {
    expect(availabilitySlots(new Date(2026, 8, 17, 23, 0, 0))).toHaveLength(AVAILABILITY_DAYS);
  });

  it('l\'après-midi, rien ne change', () => {
    expect(ce(14).label).toBe('Ce soir');
  });
});

describe("displayedSlot — la carte montre MON premier jour declare", () => {
  const LUNDI = new Date(2026, 8, 21, 9, 30, 0);
  const jours = () => availabilitySlots(LUNDI);
  const declare = (s: { start: Date; end: Date }) => ({
    slot_start: s.start.toISOString(), slot_end: s.end.toISOString(),
  });

  it("saute le soir meme quand je ne suis pas dispo ce soir", () => {
    // Le bug : coche demain + mercredi, la carte affichait « Dispos ce soir »
    // et les joueurs d'un soir ou l'on ne joue pas.
    const j = jours();
    const vu = displayedSlot(j, [declare(j[1]), declare(j[2])]);
    expect(vu?.key).toBe(j[1].key);
    expect(slotTitle(vu!, LUNDI)).toBe("Dispos demain");
  });

  it("prend le PREMIER declare, pas le dernier", () => {
    const j = jours();
    const vu = displayedSlot(j, [declare(j[4]), declare(j[2])]);
    expect(vu?.key).toBe(j[2].key);
  });

  it("garde le soir meme quand je m y suis declare", () => {
    const j = jours();
    expect(displayedSlot(j, [declare(j[0])])?.key).toBe(j[0].key);
  });

  it("sans aucune declaration, retombe sur le plus proche", () => {
    const j = jours();
    expect(displayedSlot(j, [])?.key).toBe(j[0].key);
  });

  it("une dispo abimee ne fait pas derailler le choix", () => {
    const j = jours();
    expect(displayedSlot(j, [{ slot_start: "nawak", slot_end: "nawak" }])?.key).toBe(j[0].key);
  });

  it("sans creneau du tout, rien a montrer", () => {
    expect(displayedSlot([], [])).toBeNull();
  });
});
