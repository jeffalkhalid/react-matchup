import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import {
  availabilitySlots, slotLabel, isSlotActive, slotFromKey, AVAILABILITY_TTL_DAYS,
  slotShortLabel, slotTitle, missingPlayers, circleVisibilityLabel,
} from '../availability';

// Jeudi 17 septembre 2026, 9 h (heure locale du téléphone).
const jeudi9h = new Date(2026, 8, 17, 9, 0, 0);

describe('availabilitySlots — les trois créneaux proposés dans le header', () => {
  it('propose Ce soir, Demain et le prochain samedi matin', () => {
    const s = availabilitySlots(jeudi9h);
    expect(s.map(x => x.key)).toEqual(['tonight', 'tomorrow', 'saturday']);
    expect(s.map(x => x.label)).toEqual(['Ce soir', 'Demain', 'Sam. matin']);
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
    expect(ce.start.getHours()).toBe(20);
    expect(ce.start.getMinutes()).toBe(30);
  });

  it('passé minuit, « Ce soir » disparaît : on propose Demain et samedi', () => {
    const vendredi1h = new Date(2026, 8, 18, 1, 0, 0);
    expect(availabilitySlots(vendredi1h).map(x => x.key)).toEqual(['tomorrow', 'saturday']);
  });

  it('« Demain » couvre toute la journée de demain', () => {
    const demain = availabilitySlots(jeudi9h)[1];
    expect(demain.start.getDate()).toBe(18);
    expect(demain.start.getHours()).toBe(8);
    expect(demain.end.getDate()).toBe(19);
    expect(demain.end.getHours()).toBe(0);
  });

  it('un samedi, « Sam. matin » est aujourd\'hui ; un dimanche, c\'est samedi prochain', () => {
    const samedi7h = new Date(2026, 8, 19, 7, 0, 0);
    const sam = availabilitySlots(samedi7h).find(x => x.key === 'saturday')!;
    expect(sam.start.getDate()).toBe(19);
    expect(sam.start.getHours()).toBe(8);
    expect(sam.end.getHours()).toBe(13);

    const dimanche = new Date(2026, 8, 20, 10, 0, 0);
    const sam2 = availabilitySlots(dimanche).find(x => x.key === 'saturday')!;
    expect(sam2.start.getDate()).toBe(26);
  });

  it('un samedi après-midi, le créneau du matin est passé : on vise samedi prochain', () => {
    const samedi15h = new Date(2026, 8, 19, 15, 0, 0);
    const sam = availabilitySlots(samedi15h).find(x => x.key === 'saturday')!;
    expect(sam.start.getDate()).toBe(26);
  });
});

describe('slotLabel — la phrase sous un joueur dispo', () => {
  it('dit le jour et l\'heure, sans jargon', () => {
    const s = availabilitySlots(jeudi9h);
    expect(slotLabel(s[0], jeudi9h)).toBe('Ce soir · 18h – minuit');
    expect(slotLabel(s[1], jeudi9h)).toBe('Demain · 8h – minuit');
    expect(slotLabel(s[2], jeudi9h)).toBe('Samedi · 8h – 13h');
  });
});

describe('isSlotActive — une dispo déjà déclarée retrouve sa pastille', () => {
  const s = availabilitySlots(jeudi9h);
  it('reconnaît une dispo enregistrée pour le même créneau', () => {
    expect(isSlotActive(s[0], [{ slot_start: s[0].start.toISOString(), slot_end: s[0].end.toISOString() }])).toBe(true);
    expect(isSlotActive(s[1], [{ slot_start: s[0].start.toISOString(), slot_end: s[0].end.toISOString() }])).toBe(false);
  });
  it('tolère quelques minutes d\'écart (l\'heure a avancé depuis la déclaration)', () => {
    const presque = new Date(s[0].start.getTime() + 20 * 60_000).toISOString();
    expect(isSlotActive(s[0], [{ slot_start: presque, slot_end: s[0].end.toISOString() }])).toBe(true);
  });
});

describe('slotFromKey — retrouver un créneau par sa clé', () => {
  it('rend le créneau du jour, ou null s\'il n\'est plus proposé', () => {
    expect(slotFromKey('tonight', jeudi9h)?.label).toBe('Ce soir');
    expect(slotFromKey('tonight', new Date(2026, 8, 18, 1, 0, 0))).toBe(null);
  });
});

describe('durée de vie', () => {
  it('une dispo ne traîne pas : elle expire au bout de quelques jours', () => {
    expect(AVAILABILITY_TTL_DAYS).toBeLessThanOrEqual(8);
  });
});

describe('slotShortLabel / slotTitle — libellés de la carte Dispos', () => {
  it('donne une forme courte par créneau', () => {
    expect(slotShortLabel('tonight')).toBe('ce soir');
    expect(slotShortLabel('tomorrow')).toBe('demain');
    expect(slotShortLabel('saturday')).toBe('samedi matin');
  });
  it('« Dispos {créneau} » pour le titre de carte', () => {
    expect(slotTitle('tonight')).toBe('Dispos ce soir');
    expect(slotTitle('saturday')).toBe('Dispos samedi matin');
  });
});

describe('missingPlayers — combien il manque pour former une partie à 4', () => {
  it('me compte comme un des 4', () => {
    expect(missingPlayers(0)).toBe(3);
    expect(missingPlayers(2)).toBe(1);
    expect(missingPlayers(3)).toBe(0);
  });
  it('ne descend jamais sous 0 (plus de 4 dispos)', () => {
    expect(missingPlayers(6)).toBe(0);
  });
});

describe('circleVisibilityLabel — qui voit ma dispo', () => {
  it('invite à suivre des joueurs quand je n\'ai encore personne', () => {
    expect(circleVisibilityLabel(0)).toMatch(/Suis des joueurs/);
  });
  it('accorde singulier/pluriel', () => {
    expect(circleVisibilityLabel(1)).toBe('Ton ami le voit tout de suite.');
    expect(circleVisibilityLabel(6)).toBe('Tes 6 amis le voient tout de suite.');
  });
});
