// lib/__tests__/circleAlert.test.ts — « Prévenir mon cercle ».
//
// Le bouton sonne chez TOUS mes abonnés. Deux choses comptent : que le message
// dise les bons jours, et qu'un deuxième tap ne reparte pas.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const magasin = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => magasin.get(k) ?? null,
    setItem: async (k: string, v: string) => { magasin.set(k, v); },
  },
}));
vi.mock('../supabase', () => ({ supabase: {} }));

import {
  announcedSlots, announcementLabel, alertBody, cooldownLeft, cooldownLabel,
  readLastAlert, markAlertSent, CIRCLE_ALERT_COOLDOWN_MS,
} from '../circleAlert';
import { availabilitySlots, type Slot } from '../availability';

// Un lundi matin : « Ce soir » tient encore, la ligne propose 7 jours.
const LUNDI = new Date('2026-09-21T09:30:00');
const creneaux = () => availabilitySlots(LUNDI);
/** Une dispo déclarée, telle que la base la rend. */
const dispo = (s: Slot) => ({ slot_start: s.start.toISOString(), slot_end: s.end.toISOString() });

describe('les jours annoncés sont ceux que j ai cochés', () => {
  it('ne retient que les créneaux déclarés', () => {
    const tous = creneaux();
    const miennes = [dispo(tous[1]), dispo(tous[2])];
    expect(announcedSlots(tous, miennes).map(s => s.key)).toEqual([tous[1].key, tous[2].key]);
  });

  it('rien de coché, rien à annoncer', () => {
    expect(announcedSlots(creneaux(), [])).toEqual([]);
  });

  it('le message suit la sélection, pas le créneau le plus proche', () => {
    // C'était le bug : coché demain + mercredi, annoncé « ce soir ».
    const tous = creneaux();
    const choisis = announcedSlots(tous, [dispo(tous[1]), dispo(tous[2])]);
    const phrase = alertBody(choisis, LUNDI);
    expect(phrase).toBe('Dispo demain et mercredi — tape pour te déclarer aussi.');
    expect(phrase).not.toContain('ce soir');
  });
});

describe('la phrase des jours', () => {
  it('un seul jour se dit tout simplement', () => {
    const tous = creneaux();
    expect(announcementLabel([tous[0]], LUNDI)).toBe('ce soir');
  });

  it('deux jours prennent un « et »', () => {
    const tous = creneaux();
    expect(announcementLabel([tous[0], tous[1]], LUNDI)).toBe('ce soir et demain');
  });

  it('trois jours gardent la virgule', () => {
    const tous = creneaux();
    expect(announcementLabel([tous[0], tous[1], tous[2]], LUNDI)).toBe('ce soir, demain et mercredi');
  });

  it('au-delà de trois, on résume', () => {
    expect(announcementLabel(creneaux(), LUNDI)).toMatch(/^ce soir, demain et \d+ autres jours$/);
  });

  it('sans jour, pas de phrase', () => {
    expect(announcementLabel([], LUNDI)).toBe('');
  });
});

describe('le silence entre deux annonces', () => {
  const T = 1_700_000_000_000;

  it('jamais envoyé : la voie est libre', () => {
    expect(cooldownLeft(null, T)).toBe(0);
  });

  it('juste envoyé : il faut attendre la tranche entière', () => {
    expect(cooldownLeft(T, T)).toBe(CIRCLE_ALERT_COOLDOWN_MS);
  });

  it('le temps passé se déduit', () => {
    const uneHeure = 60 * 60 * 1000;
    expect(cooldownLeft(T, T + uneHeure)).toBe(CIRCLE_ALERT_COOLDOWN_MS - uneHeure);
  });

  it('la tranche écoulée rouvre la voie', () => {
    expect(cooldownLeft(T, T + CIRCLE_ALERT_COOLDOWN_MS)).toBe(0);
    expect(cooldownLeft(T, T + CIRCLE_ALERT_COOLDOWN_MS + 1)).toBe(0);
  });

  it('une horloge qui recule ne bâillonne pas pour des mois', () => {
    expect(cooldownLeft(T + 86_400_000, T)).toBe(0);
  });

  it('une valeur abîmée est ignorée', () => {
    expect(cooldownLeft(NaN, T)).toBe(0);
  });
});

describe('le compte à rebours affiché', () => {
  it('sous l heure, on compte en minutes', () => {
    expect(cooldownLabel(25 * 60_000)).toBe('25 min');
  });

  it('au-dessus, on compte en heures', () => {
    expect(cooldownLabel(3 * 60 * 60_000)).toBe('3 h');
  });

  it('on arrondit au-dessus — jamais promettre plus tôt que vrai', () => {
    expect(cooldownLabel(90_001)).toBe('2 min');
    expect(cooldownLabel(3.2 * 60 * 60_000)).toBe('4 h');
  });

  it('plus rien à attendre, plus rien à dire', () => {
    expect(cooldownLabel(0)).toBe('');
    expect(cooldownLabel(-5)).toBe('');
  });
});

describe('la trace du dernier envoi', () => {
  beforeEach(() => magasin.clear());

  it('rien au départ', async () => {
    expect(await readLastAlert('omar')).toBeNull();
  });

  it('un envoi se relit', async () => {
    await markAlertSent('omar', 1234);
    expect(await readLastAlert('omar')).toBe(1234);
  });

  it('chaque joueur a son propre silence — un téléphone, plusieurs comptes', async () => {
    await markAlertSent('omar', 1234);
    expect(await readLastAlert('rita')).toBeNull();
  });

  it('sans joueur, on ne touche à rien', async () => {
    await markAlertSent('', 1234);
    expect(magasin.size).toBe(0);
    expect(await readLastAlert('')).toBeNull();
  });
});
