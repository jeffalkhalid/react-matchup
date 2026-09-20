import { describe, it, expect } from 'vitest';
import { isMissingRelation } from '../pgErrors';

describe('isMissingRelation — les deux façons de dire « pas encore là »', () => {
  it('Postgres : le code 42P01', () => {
    expect(isMissingRelation({ code: '42P01', message: 'relation "public.predictions" does not exist' })).toBe(true);
  });

  it('PostgREST : le cache de schéma, sans code Postgres', () => {
    expect(isMissingRelation({ code: 'PGRST205', message: "Could not find the table 'public.predictions' in the schema cache" })).toBe(true);
  });

  it('PostgREST : une FONCTION absente, même motif', () => {
    expect(isMissingRelation({ code: 'PGRST202', message: 'Could not find the function public.delete_my_activity' })).toBe(true);
  });

  it('le message suffit, même sans code', () => {
    expect(isMissingRelation({ message: "Could not find the table 'public.x' in the schema cache" })).toBe(true);
  });

  it('une vraie erreur n\'est PAS confondue avec une table absente', () => {
    expect(isMissingRelation({ code: '42501', message: 'new row violates row-level security policy' })).toBe(false);
    expect(isMissingRelation({ code: '23505', message: 'duplicate key value' })).toBe(false);
    expect(isMissingRelation({ message: 'Le match a commencé' })).toBe(false);
  });

  it('pas d\'erreur du tout', () => {
    expect(isMissingRelation(null)).toBe(false);
    expect(isMissingRelation(undefined)).toBe(false);
  });
});
