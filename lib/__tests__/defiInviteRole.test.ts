// « Tu as été défié ! » ou « X t'invite comme binôme » ?
//
// Deux invitations très différentes portaient le même texte, et la même
// phrase d'explication : « Tu choisiras ton binôme juste après ». Pour le
// binôme invité par un joueur qui vient de relever, c'est faux — son
// partenaire, c'est justement celui qui l'invite.
//
// Le côté A/B ne suffit pas à distinguer : depuis que l'adversaire désigné
// amène son propre binôme, ce binôme est en équipe B, comme le joueur défié.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../supabase', () => ({ supabase: {} }));
import { defiInviteRole } from '../games';

const invite = (id: string, side: string) =>
  ({ player_id: id, status: 'invited', team_side: side, player: { name: id } });
const accepte = (id: string, side: string) =>
  ({ player_id: id, status: 'accepted', team_side: side, player: { name: id } });

const defi = (participants: any[]) => ({
  is_challenge: true, creator_id: 'khalid', creator_side: 'A_GAU',
  creator: { name: 'Khalid' }, participants,
});

describe('ce qu on me propose', () => {
  it('mon camp est vide : on me DEFIE, j amenerai quelqu un', () => {
    const r = defiInviteRole(defi([accepte('kay2', 'A_DRO'), invite('moi', 'B_GAU')]), 'moi');
    expect(r).toEqual({ role: 'defie', coequipier: null });
  });

  it('quelqu un occupe deja mon camp : il m invite comme BINOME', () => {
    // Le cas qui s affichait « Tu as ete defie ! » alors qu Alamine venait de
    // relever le defi et m avait choisi.
    const r = defiInviteRole(defi([accepte('alamine', 'B_DRO'), invite('moi', 'B_GAU')]), 'moi');
    expect(r).toEqual({ role: 'binome', coequipier: 'alamine' });
  });

  it('invite dans le camp du CREATEUR : c est lui qui me prend comme binome', () => {
    // Le createur n a pas de ligne participants : sans le lire, on croirait
    // le camp vide et on annoncerait un defi.
    const r = defiInviteRole(defi([invite('moi', 'A_DRO')]), 'moi');
    expect(r).toEqual({ role: 'binome', coequipier: 'Khalid' });
  });

  it('createur en equipe B : son camp reste le sien', () => {
    const g = { ...defi([invite('moi', 'B_DRO')]), creator_side: 'B_GAU' };
    expect(defiInviteRole(g, 'moi')).toEqual({ role: 'binome', coequipier: 'Khalid' });
  });

  it('un coequipier qui s est desiste ne compte pas', () => {
    const parti = { player_id: 'parti', status: 'declined', team_side: 'B_DRO', player: { name: 'Parti' } };
    expect(defiInviteRole(defi([parti, invite('moi', 'B_GAU')]), 'moi')?.role).toBe('defie');
  });

  it('pas un defi, ou je n y suis pas : rien a dire', () => {
    expect(defiInviteRole({ ...defi([invite('moi', 'B_GAU')]), is_challenge: false }, 'moi')).toBeNull();
    expect(defiInviteRole(defi([invite('autre', 'B_GAU')]), 'moi')).toBeNull();
  });
});
