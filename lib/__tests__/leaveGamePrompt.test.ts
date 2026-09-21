// Ce qu'on annonce avant de quitter une partie.
//
// « Ta place sera libérée » était vrai d'une partie ordinaire, faux d'un
// défi : le serveur retire les DEUX coéquipiers, et si c'est le partenaire du
// créateur qui part, il supprime le défi. Quatre personnes perdaient leur
// match derrière une phrase qui parlait d'une seule place.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { leaveGamePrompt } from '../games';

describe('partie ordinaire — inchangé', () => {
  it('une place confirmée se libère', () => {
    expect(leaveGamePrompt({ status: 'accepted' }))
      .toEqual({ title: 'Quitter cette partie ?', message: 'Ta place sera libérée.' });
  });

  it("la liste d'attente se quitte sans conséquence", () => {
    expect(leaveGamePrompt({ status: 'waitlist' }).message).toBe('Tu seras retiré de la liste.');
  });

  it('une candidature pas encore acceptée est simplement annulée', () => {
    expect(leaveGamePrompt({ status: 'pending' }).title).toBe('Retirer ta candidature ?');
  });

  it("la liste d'attente d'un défi reste une liste d'attente", () => {
    // Rien n'est encore engagé : aucun binôme ne tombe avec moi.
    expect(leaveGamePrompt({ isChallenge: true, status: 'waitlist' }).message)
      .toBe('Tu seras retiré de la liste.');
  });
});

describe('défi, binôme releveur (côté B) — on part à deux', () => {
  const partir = (partnerName?: string | null) =>
    leaveGamePrompt({ isChallenge: true, status: 'accepted', side: 'B_GAU', partnerName });

  it('nomme le coéquipier qui perd sa place', () => {
    expect(partir('Kenza El Amrani')).toEqual({
      title: 'Quitter ce défi ?',
      message: 'Vous partez à deux : Kenza perd sa place en même temps que toi.',
    });
  });

  it('ne parle plus d’une seule place', () => {
    expect(partir('Kenza').message).not.toContain('Ta place');
  });

  it('sans nom connu, reste compréhensible', () => {
    expect(partir(null).message).toBe('Vous partez à deux : ton binôme perd sa place en même temps que toi.');
    expect(partir('   ').message).toContain('ton binôme');
  });

  it('le côté se lit quelle que soit la casse du champ', () => {
    expect(leaveGamePrompt({ isChallenge: true, status: 'accepted', side: 'b_dro', partnerName: 'Rita' }).message)
      .toContain('Rita');
  });
});

describe('défi, partenaire du créateur (côté A) — tout s’arrête', () => {
  it('annonce la suppression du défi', () => {
    expect(leaveGamePrompt({ isChallenge: true, status: 'accepted', side: 'A_DRO', partnerName: 'Galan' }))
      .toEqual({ title: 'Quitter ce défi ?', message: 'Le défi sera supprimé pour tout le monde.' });
  });

  it('un côté inconnu annonce la conséquence la plus lourde', () => {
    // Mieux vaut faire hésiter à tort que détruire un match en silence.
    expect(leaveGamePrompt({ isChallenge: true, status: 'accepted', side: null }).message)
      .toBe('Le défi sera supprimé pour tout le monde.');
  });
});
