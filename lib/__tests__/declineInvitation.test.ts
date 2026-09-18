import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { declineInvitationPlan } from '../games';

describe('declineInvitationPlan — ce que fait « Refuser »', () => {
  it('une vraie invitation : refusée, sa place rendue, l\'organisateur prévenu', () => {
    expect(declineInvitationPlan({ status: 'invited', auto_declined: false }))
      .toEqual({ update: { status: 'declined', auto_declined: false }, freeSpot: true, notifyCreator: true });
  });
  it('une invitation REPROPOSÉE (retirée automatiquement, créneau pris ailleurs) : on la cache pour de bon', () => {
    // Avant : « Refuser » réécrivait 'declined' sans toucher au marqueur
    // auto_declined → le lobby la reproposait aussitôt, et chaque appui
    // rendait une place de plus au compteur.
    expect(declineInvitationPlan({ status: 'declined', auto_declined: true }))
      .toEqual({ update: { auto_declined: false }, freeSpot: false, notifyCreator: false });
  });
});
