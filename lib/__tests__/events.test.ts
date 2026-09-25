// Les dérivations d'affichage des événements. Pures : aucune ne touche au
// réseau, et c'est ce qui permet de les exécuter ici plutôt que de les relire.
import { describe, it, expect } from 'vitest';
import {
  eventKindLabel, eventIsFull, eventSpotsLabel, eventPriceLabel, eventRsvpState, buildEventsBoard,
} from '../events';

describe('la nature d un evenement', () => {
  it('nomme les cinq natures, et « externe » dit d ou il vient', () => {
    expect(eventKindLabel('decouverte')).toBe('Découverte');
    expect(eventKindLabel('portes_ouvertes')).toBe('Portes ouvertes');
    // « Externe » ne veut rien dire pour un joueur : ce qui compte est que
    // l evenement est officiel et qu il se passe ailleurs.
    expect(eventKindLabel('externe')).toBe('Officiel FRMT');
  });

  it('ne rend jamais une chaine vide sur une nature inconnue', () => {
    // Une nature ajoutee en base et pas encore connue de l app afficherait
    // une pastille vide — pire qu un mot generique.
    expect(eventKindLabel('quelque_chose' as any)).toBe('Événement');
  });
});

describe('les places d un evenement', () => {
  it('ne declare JAMAIS complet un evenement sans limite', () => {
    // `capacity` nul = « Limiter » decoche dans l assistant. Traiter le nul
    // comme un zero fermerait l inscription d un evenement ouvert a tous.
    expect(eventIsFull(null, 0)).toBe(false);
    expect(eventIsFull(null, 999)).toBe(false);
    expect(eventSpotsLabel(null, 12)).toBe('Places libres');
  });

  it('compte les places restantes, et accorde le singulier', () => {
    expect(eventSpotsLabel(8, 5)).toBe('3 places restantes');
    expect(eventSpotsLabel(8, 7)).toBe('1 place restante');
  });

  it('dit « Complet » au dernier siege pris, et au-dela', () => {
    expect(eventIsFull(8, 8)).toBe(true);
    expect(eventSpotsLabel(8, 8)).toBe('Complet');
    // Une capacite baissee apres coup peut laisser plus d inscrits que de
    // places : « -2 places restantes » serait absurde.
    expect(eventSpotsLabel(8, 10)).toBe('Complet');
  });
});

describe('le prix', () => {
  it('dit « Gratuit » plutot que « 0 MAD »', () => {
    expect(eventPriceLabel(0)).toBe('Gratuit');
    expect(eventPriceLabel(150)).toBe('150 MAD / personne');
  });
});

describe('ou j en suis avec cet evenement', () => {
  it('distingue les trois situations, dont l absence de reponse', () => {
    expect(eventRsvpState(null)).toBe('aucun');
    expect(eventRsvpState({ notify_on_free: false } as any)).toBe('jy_serai');
    expect(eventRsvpState({ notify_on_free: true } as any)).toBe('me_prevenir');
  });
});

describe('le tableau des evenements a venir', () => {
  const E = (o: any = {}) => ({
    id: 'e1', kind: 'stage', title: 'Stage', club_id: null,
    starts_at: '2026-10-01T18:00:00.000Z', ends_at: null, capacity: null,
    price_mad: 0, description: null, external_url: null, status: 'PUBLIE',
    cancel_reason: null, created_by: 'orga', created_at: '2026-09-01T10:00:00.000Z', ...o,
  });
  const R = (event_id: string, player_id: string, notify_on_free = false) =>
    ({ event_id, player_id, notify_on_free, created_at: '2026-09-02T10:00:00.000Z' } as any);

  it('met le plus proche en avant, et garde les autres en dessous', () => {
    const b = buildEventsBoard(
      [E({ id: 'tard', starts_at: '2026-10-20T18:00:00.000Z' }),
       E({ id: 'tot', starts_at: '2026-10-02T18:00:00.000Z' })],
      [], 'moi');
    expect(b.next?.event.id).toBe('tot');
    expect(b.others.map(r => r.event.id)).toEqual(['tard']);
  });

  it('ne met JAMAIS un evenement annule en avant, mais ne le cache pas', () => {
    // « La soiree du 3 est annulee » est precisement ce qu on vient verifier :
    // le faire disparaitre passerait pour un bug de l app.
    const b = buildEventsBoard(
      [E({ id: 'annule', starts_at: '2026-10-02T18:00:00.000Z', status: 'ANNULE' }),
       E({ id: 'vivant', starts_at: '2026-10-09T18:00:00.000Z' })],
      [], 'moi');
    expect(b.next?.event.id).toBe('vivant');
    expect(b.others.map(r => r.event.id)).toEqual(['annule']);
  });

  it('compte les venants sans compter les « Me prevenir », et dit ou j en suis', () => {
    const b = buildEventsBoard(
      [E({ id: 'e1', capacity: 4 })],
      [R('e1', 'amine'), R('e1', 'karim'), R('e1', 'moi', true)],
      'moi');
    expect(b.next?.attending).toBe(2);
    expect(b.next?.mine).toBe('me_prevenir');
  });

  it('rend un tableau vide sans rien inventer', () => {
    const b = buildEventsBoard([], [], 'moi');
    expect(b.next).toBe(null);
    expect(b.others).toEqual([]);
  });
});
