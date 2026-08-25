import { describe, it, expect } from 'vitest';
import { formatCode } from '../watchLink';

describe('formatCode', () => {
  it('coupe le code en deux groupes de trois pour la lisibilite', () => {
    expect(formatCode('123456')).toBe('123 456');
  });
  it('laisse intact ce qui ne fait pas six chiffres', () => {
    expect(formatCode('12345')).toBe('12345');
    expect(formatCode('')).toBe('');
  });
});
