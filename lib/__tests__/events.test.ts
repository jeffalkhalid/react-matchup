// Les dérivations d'affichage des événements. Pures : aucune ne touche au
// réseau, et c'est ce qui permet de les exécuter ici plutôt que de les relire.
import { describe, it, expect } from 'vitest';
import {
  eventKindLabel, eventIsFull, eventSpotsLabel, eventPriceLabel, eventRsvpState,
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
