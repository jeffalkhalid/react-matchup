// « Cette partie approche sans terrain » — le signalement visuel.
//
// Une partie sans terrain à trois heures du début, c'est une partie qui
// n'aura pas lieu. Rien ne le signalait : on le découvrait en arrivant.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { courtNeedsAttention, COURT_ALERT_MS } from '../games';

const MAINTENANT = new Date(2026, 8, 22, 18, 0, 0);
const dans = (ms: number) => new Date(MAINTENANT.getTime() + ms).toISOString();
const h = (n: number) => n * 60 * 60 * 1000;

describe('quand on alerte', () => {
  it('dans deux heures sans terrain : on alerte', () => {
    expect(courtNeedsAttention({ has_reservation: false, match_date: dans(h(2)) }, MAINTENANT)).toBe(true);
  });

  it('terrain jamais renseigné : on alerte aussi', () => {
    // Une colonne vide veut dire qu'aucun terrain n'a été confirmé — même
    // lecture que côté serveur.
    expect(courtNeedsAttention({ match_date: dans(h(2)) }, MAINTENANT)).toBe(true);
    expect(courtNeedsAttention({ has_reservation: null, match_date: dans(h(2)) }, MAINTENANT)).toBe(true);
  });

  it('pile à la limite des trois heures : encore dedans', () => {
    expect(courtNeedsAttention({ has_reservation: false, match_date: dans(COURT_ALERT_MS) }, MAINTENANT)).toBe(true);
  });
});

describe('quand on se tait', () => {
  it('le terrain est réservé', () => {
    expect(courtNeedsAttention({ has_reservation: true, match_date: dans(h(1)) }, MAINTENANT)).toBe(false);
  });

  it('la partie est encore loin', () => {
    // Alerter trois jours avant n'aide personne : on ne peut pas encore agir,
    // et le signal devient du bruit qu on apprend a ignorer.
    expect(courtNeedsAttention({ has_reservation: false, match_date: dans(h(4)) }, MAINTENANT)).toBe(false);
  });

  it('la partie est passée', () => {
    expect(courtNeedsAttention({ has_reservation: false, match_date: dans(-h(1)) }, MAINTENANT)).toBe(false);
  });

  it('la partie est annulée ou déjà scorée', () => {
    expect(courtNeedsAttention({ has_reservation: false, match_date: dans(h(1)), status: 'cancelled' }, MAINTENANT)).toBe(false);
    expect(courtNeedsAttention({ has_reservation: false, match_date: dans(h(1)), status: 'closed' }, MAINTENANT)).toBe(false);
  });

  it('sans date connue, on ne dit rien', () => {
    expect(courtNeedsAttention({ has_reservation: false, match_date: null }, MAINTENANT)).toBe(false);
    expect(courtNeedsAttention({ has_reservation: false, match_date: 'nawak' }, MAINTENANT)).toBe(false);
  });
});

describe('le seuil est partagé avec le serveur', () => {
  it('trois heures, la même valeur que le rappel poussé', () => {
    // court_reservation_reminder.sql envoie a T-3h : si l une bouge, l app
    // crierait avant ou apres la notification.
    expect(COURT_ALERT_MS).toBe(3 * 60 * 60 * 1000);
  });
});
