import { describe, it, expect } from 'vitest';
import { shouldOfferWelcomePhoto, WELCOME_PHOTO_SEEN_KEY, WELCOME_PHOTO_MAX_AGE_DAYS } from '../welcomePhoto';

const now = Date.parse('2026-09-19T12:00:00Z');
const jours = (n: number) => new Date(now - n * 86_400_000).toISOString();

describe('shouldOfferWelcomePhoto — l’écran « Ta photo » après la création du compte', () => {
  it('compte tout neuf, sans photo, jamais proposé → on propose', () => {
    expect(shouldOfferWelcomePhoto({ avatarPath: null, createdAt: jours(0), seen: false, now })).toBe(true);
  });
  it('déjà une photo → jamais', () => {
    expect(shouldOfferWelcomePhoto({ avatarPath: 'p/1.jpg', createdAt: jours(0), seen: false, now })).toBe(false);
  });
  it('déjà proposé une fois (même « Plus tard ») → jamais une deuxième', () => {
    expect(shouldOfferWelcomePhoto({ avatarPath: null, createdAt: jours(0), seen: true, now })).toBe(false);
  });
  it('les comptes anciens ne sont pas relancés : seulement les comptes récents', () => {
    expect(shouldOfferWelcomePhoto({ avatarPath: null, createdAt: jours(WELCOME_PHOTO_MAX_AGE_DAYS - 1), seen: false, now })).toBe(true);
    expect(shouldOfferWelcomePhoto({ avatarPath: null, createdAt: jours(WELCOME_PHOTO_MAX_AGE_DAYS + 1), seen: false, now })).toBe(false);
    expect(shouldOfferWelcomePhoto({ avatarPath: null, createdAt: null, seen: false, now })).toBe(false);
  });
  it('une clé par joueur (plusieurs comptes sur un même téléphone)', () => {
    expect(WELCOME_PHOTO_SEEN_KEY('a')).not.toBe(WELCOME_PHOTO_SEEN_KEY('b'));
  });
});
