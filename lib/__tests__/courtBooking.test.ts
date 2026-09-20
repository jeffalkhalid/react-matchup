// « Terrain réservé » / « Terrain à réserver » : le réglage de la création
// doit se retrouver sur la partie, sans jamais affirmer ce qu'on ignore.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { courtBooking } from '../games';

describe('courtBooking', () => {
  it('terrain réservé', () => {
    expect(courtBooking({ has_reservation: true })).toEqual({
      booked: true, short: 'Réservé', long: 'Terrain réservé',
    });
  });

  it('terrain à réserver', () => {
    expect(courtBooking({ has_reservation: false })).toEqual({
      booked: false, short: 'À réserver', long: 'Terrain à réserver',
    });
  });

  it('partie muette sur le sujet → on n\'affiche rien plutôt qu\'une affirmation fausse', () => {
    expect(courtBooking({ has_reservation: null })).toBeNull();
    expect(courtBooking({})).toBeNull();
    expect(courtBooking(undefined as any)).toBeNull();
  });

  it('le libellé court tient sur une pastille', () => {
    for (const v of [true, false]) {
      expect(courtBooking({ has_reservation: v })!.short.length).toBeLessThanOrEqual(11);
    }
  });
});
