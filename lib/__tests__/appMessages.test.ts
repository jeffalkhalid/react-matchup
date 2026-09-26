// Le message d'accueil — qui s'affiche, et lequel.
//
// Trois pièges sont testés ici, parce qu'aucun ne se voit à la relecture :
// une version comparée comme du texte ('1.10' < '1.9'), un message déjà vu qui
// revient, et un message bloquant qu'un « déjà vu » ferait disparaître.
import { describe, it, expect } from 'vitest';
import {
  compareVersions, isVisibleFor, pickMessage, isBlocking,
  imageRatio, showsPoster, RATIO_PAR_DEFAUT,
  type AppMessage,
} from '../appMessages';

const MAINTENANT = new Date(2026, 8, 26, 12, 0, 0);

function msg(over: Partial<AppMessage> = {}): AppMessage {
  return {
    id: 'm1', level: 'info', title: 'Titre', body: 'Corps',
    cta_label: null, cta_url: null,
    starts_at: null, ends_at: null,
    min_app_version: null, max_app_version: null,
    image_url: null, image_ratio: null, layout: 'card',
    active: true, priority: 0, created_at: '2026-09-01T10:00:00.000Z',
    ...over,
  };
}

describe('comparer deux versions', () => {
  it('compare des nombres, pas du texte', () => {
    // Le piège : '1.10.0' < '1.9.0' en comparaison de texte.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
  });

  it('une version plus courte vaut la même complétée de zéros', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });

  it('dit laquelle est la plus ancienne', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
  });

  it('ignore ce qui suit le numéro', () => {
    expect(compareVersions('1.2.3-beta.1', '1.2.3')).toBe(0);
  });

  it('traite une version absente comme la plus ancienne', () => {
    expect(compareVersions('', '1.0.0')).toBeLessThan(0);
  });
});

describe('ce message me concerne-t-il', () => {
  it('éteint : jamais', () => {
    expect(isVisibleFor(msg({ active: false }), { now: MAINTENANT, appVersion: '1.0.0' })).toBe(false);
  });

  it('pas encore commencé : pas encore', () => {
    expect(isVisibleFor(msg({ starts_at: '2026-09-27T00:00:00.000Z' }), { now: MAINTENANT, appVersion: '1.0.0' })).toBe(false);
  });

  it('déjà terminé : plus jamais', () => {
    expect(isVisibleFor(msg({ ends_at: '2026-09-25T00:00:00.000Z' }), { now: MAINTENANT, appVersion: '1.0.0' })).toBe(false);
  });

  it('sans dates : tout le temps', () => {
    expect(isVisibleFor(msg(), { now: MAINTENANT, appVersion: '1.0.0' })).toBe(true);
  });

  it('« à partir de 1.2.0 » : une app en 1.1.0 ne le voit pas', () => {
    expect(isVisibleFor(msg({ min_app_version: '1.2.0' }), { now: MAINTENANT, appVersion: '1.1.0' })).toBe(false);
  });

  it('« à partir de 1.2.0 » : une app en 1.2.0 le voit', () => {
    expect(isVisibleFor(msg({ min_app_version: '1.2.0' }), { now: MAINTENANT, appVersion: '1.2.0' })).toBe(true);
  });

  it('« jusqu’à 1.1.0 » : une app en 1.2.0 ne le voit plus', () => {
    // C'est le cas « mets à jour ton app » : seules les anciennes le voient.
    expect(isVisibleFor(msg({ max_app_version: '1.1.0' }), { now: MAINTENANT, appVersion: '1.2.0' })).toBe(false);
  });

  it('« jusqu’à 1.1.0 » : une app en 1.0.0 le voit', () => {
    expect(isVisibleFor(msg({ max_app_version: '1.1.0' }), { now: MAINTENANT, appVersion: '1.0.0' })).toBe(true);
  });

  it('version du téléphone inconnue : on n’applique pas de filtre de version', () => {
    // Mieux vaut montrer une information à tort que bloquer quelqu'un à tort.
    expect(isVisibleFor(msg({ min_app_version: '9.9.9' }), { now: MAINTENANT, appVersion: '' })).toBe(true);
  });
});

describe('choisir le message à montrer', () => {
  const ctx = { now: MAINTENANT, appVersion: '1.0.0', seenIds: [] as string[] };

  it('rien à montrer : rien', () => {
    expect(pickMessage([], ctx)).toBeNull();
  });

  it('un message déjà vu ne revient pas', () => {
    expect(pickMessage([msg({ id: 'a' })], { ...ctx, seenIds: ['a'] })).toBeNull();
  });

  it('la priorité la plus haute passe devant', () => {
    const choisi = pickMessage([msg({ id: 'a', priority: 1 }), msg({ id: 'b', priority: 5 })], ctx);
    expect(choisi?.id).toBe('b');
  });

  it('à priorité égale, le plus récent passe devant', () => {
    const choisi = pickMessage([
      msg({ id: 'vieux', created_at: '2026-09-01T10:00:00.000Z' }),
      msg({ id: 'neuf', created_at: '2026-09-20T10:00:00.000Z' }),
    ], ctx);
    expect(choisi?.id).toBe('neuf');
  });

  it('un message bloquant passe avant tout, même moins prioritaire', () => {
    const choisi = pickMessage([
      msg({ id: 'info', priority: 99 }),
      msg({ id: 'maj', level: 'update', priority: 0 }),
    ], ctx);
    expect(choisi?.id).toBe('maj');
  });

  it('un message bloquant revient même s’il a été vu', () => {
    // Sinon un joueur ferme une fois et continue avec une app incompatible.
    const choisi = pickMessage([msg({ id: 'maj', level: 'update' })], { ...ctx, seenIds: ['maj'] });
    expect(choisi?.id).toBe('maj');
  });

  it('un message bloquant hors de sa plage de versions ne bloque personne', () => {
    const choisi = pickMessage([msg({ id: 'maj', level: 'update', max_app_version: '0.9.0' })], ctx);
    expect(choisi).toBeNull();
  });
});

describe('la place réservée à l’affiche', () => {
  it('sans mesure : une proportion raisonnable par défaut', () => {
    // Sans elle, la carte grandirait d'un coup quand l'image se pose.
    expect(imageRatio(msg())).toBe(RATIO_PAR_DEFAUT);
  });

  it('une mesure normale est respectée', () => {
    expect(imageRatio(msg({ image_ratio: 0.8 }))).toBeCloseTo(0.8);
  });

  it('une image démesurément haute est ramenée dans les clous', () => {
    // Une affiche 1000 × 5000 occuperait cinq écrans : on la borne.
    expect(imageRatio(msg({ image_ratio: 0.2 }))).toBeGreaterThanOrEqual(0.5);
  });

  it('une image démesurément large aussi', () => {
    expect(imageRatio(msg({ image_ratio: 9 }))).toBeLessThanOrEqual(2);
  });

  it('une mesure absurde vaut une absence de mesure', () => {
    expect(imageRatio(msg({ image_ratio: 0 }))).toBe(RATIO_PAR_DEFAUT);
    expect(imageRatio(msg({ image_ratio: Number.NaN }))).toBe(RATIO_PAR_DEFAUT);
  });
});

describe('afficher en mode affiche', () => {
  it('mise en page affiche AVEC image : oui', () => {
    expect(showsPoster(msg({ layout: 'poster', image_url: 'https://x/a.jpg' }))).toBe(true);
  });

  it('mise en page affiche SANS image : non, on retombe sur la carte', () => {
    // Le titre et le texte sont toujours là : la fenêtre ne peut pas être vide.
    expect(showsPoster(msg({ layout: 'poster', image_url: null }))).toBe(false);
  });

  it('mise en page carte avec une image : ce n’est pas une affiche', () => {
    expect(showsPoster(msg({ layout: 'card', image_url: 'https://x/a.jpg' }))).toBe(false);
  });
});

describe('savoir si on peut fermer', () => {
  it('une information se ferme', () => {
    expect(isBlocking(msg({ level: 'info' }))).toBe(false);
  });

  it('une nouveauté se ferme', () => {
    expect(isBlocking(msg({ level: 'feature' }))).toBe(false);
  });

  it('une mise à jour obligatoire ne se ferme pas', () => {
    expect(isBlocking(msg({ level: 'update' }))).toBe(true);
  });
});
