// L'accueil ne défile pas : tout doit tenir, sur tous les téléphones.
//
// Ce test est la garantie. Il balaie une matrice de hauteurs et d'états et
// vérifie à chaque fois le seul invariant qui compte :
//
//     Σ hauteurs + Σ espaces  ≤  hauteur disponible
//
// La version précédente du budget donnait à chaque bloc une part ET un
// plancher. Une part se partage toujours ; un plancher permet à un bloc de
// REFUSER sa part — et quand la somme des planchers dépassait l'écran, le
// dernier bloc passait sous la barre d'onglets. Six corrections ont suivi,
// chacune sur une constante différente. Le problème était le modèle.
import { describe, it, expect } from 'vitest';
import {
  solveHomeLayout, occupiedHeight, homeSections, ctaHeightFor, gapFor,
  CTA_MIN, MATCH_MIN, TOURNOIS_MIN, PULSE_MIN, PULSE_IDEAL,
  type HomeLayoutInput,
} from '../homeLayout';

/** Les hauteurs de colonne qu'on rencontre vraiment, du plus petit au plus grand. */
const HAUTEURS = [380, 440, 500, 560, 620, 680, 740];
const LARGEURS = [320, 360, 393, 412, 430];

/** Les sept combinaisons de l'écran. */
const ETATS: { nom: string; etat: Partial<HomeLayoutInput> }[] = [
  { nom: 'match + tournoi + pulse', etat: { hasNextMatch: true, hasTournaments: true, hasPulse: true } },
  { nom: 'match + tournoi',         etat: { hasNextMatch: true, hasTournaments: true, hasPulse: false } },
  { nom: 'match + pulse',           etat: { hasNextMatch: true, hasTournaments: false, hasPulse: true } },
  { nom: 'tournoi + pulse',         etat: { hasNextMatch: false, hasTournaments: true, hasPulse: true } },
  { nom: 'match seul',              etat: { hasNextMatch: true, hasTournaments: false, hasPulse: false } },
  { nom: 'tournoi seul',            etat: { hasNextMatch: false, hasTournaments: true, hasPulse: false } },
  { nom: 'pulse seul',              etat: { hasNextMatch: false, hasTournaments: false, hasPulse: true } },
  { nom: 'soirée en cours',         etat: { hasNextMatch: true, hasTournaments: true, hasPulse: true, hasLiveBanner: true } },
  // « Ça se joue bientôt » : sa hauteur ARRIVE MESURÉE. Les deux valeurs
  // encadrent ce qu'un téléphone rend vraiment — carte courte (amical) et
  // carte longue (compétitif, qui porte une ligne d'enjeu de plus).
  { nom: 'suggestions + pulse',     etat: { hasNextMatch: false, hasTournaments: false, hasPulse: true, openGamesHeight: 232 } },
  { nom: 'suggestions hautes',      etat: { hasNextMatch: false, hasTournaments: false, hasPulse: true, openGamesHeight: 300 } },
];

const entree = (h: number, w: number, etat: Partial<HomeLayoutInput>): HomeLayoutInput => ({
  availableHeight: h, availableWidth: w,
  hasTournaments: false, hasNextMatch: false, ...etat,
});

describe('rien ne peut déborder', () => {
  it('sur toute la matrice hauteurs × largeurs × états', () => {
    const fautifs: string[] = [];
    for (const h of HAUTEURS) {
      for (const w of LARGEURS) {
        for (const { nom, etat } of ETATS) {
          const r = solveHomeLayout(entree(h, w, etat));
          const total = occupiedHeight(r);
          if (total > h + 0.01) fautifs.push(`${nom} ${w}x${h} → ${total.toFixed(1)}`);
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('aucun bloc ne depasse sa taille juste, jamais', () => {
    // C'est le pendant de l'invariant. Sans ce plafond, le surplus se
    // redistribuait et les tuiles atteignaient 438 points pour un ideal de
    // 157 — les « tuiles geantes », revenues par un autre chemin. Le surplus
    // doit rester du BLANC.
    const fautifs: string[] = [];
    for (const h of HAUTEURS) {
      for (const w of LARGEURS) {
        for (const { nom, etat } of ETATS) {
          const e = entree(h, w, etat);
          const r = solveHomeLayout(e);
          for (const s of homeSections(e)) {
            const recu = r.heights[s.key] ?? 0;
            if (recu > s.ideal + 0.01) fautifs.push(`${nom} ${w}x${h} ${s.key} ${recu.toFixed(0)}>${s.ideal}`);
          }
        }
      }
    }
    expect(fautifs).toEqual([]);
  });

  it('le surplus reste du blanc, il ne gonfle personne', () => {
    // Un grand ecran sans match ni Pulse : deux blocs seulement. Ils gardent
    // leur taille, le reste est de l'espace.
    const r = solveHomeLayout(entree(740, 412, { hasNextMatch: false, hasTournaments: true, hasPulse: false }));
    expect(occupiedHeight(r)).toBeLessThan(740);
    expect(r.heights.ctas).toBeLessThanOrEqual(ctaHeightFor(412) + 0.01);
  });

  it('une hauteur pas encore mesurée ne rend rien', () => {
    const r = solveHomeLayout(entree(0, 393, { hasNextMatch: true, hasTournaments: true }));
    expect(occupiedHeight(r)).toBe(0);
    expect(r.contraint).toBe(true);
  });
});

describe('la hiérarchie de compression', () => {
  const charge = { hasNextMatch: true, hasTournaments: true, hasPulse: true };

  it('les blocs essentiels gardent leur minimum tant que Pulse est là pour céder', () => {
    for (const h of HAUTEURS) {
      const r = solveHomeLayout(entree(h, 360, charge));
      if (r.contraint) continue;   // écran minuscule : cas 3, traité plus bas
      expect(r.heights.ctas, `ctas à ${h}`).toBeGreaterThanOrEqual(CTA_MIN - 0.01);
      expect(r.heights.tournaments, `tournois à ${h}`).toBeGreaterThanOrEqual(TOURNOIS_MIN - 0.01);
      expect(r.heights.nextMatch, `match à ${h}`).toBeGreaterThanOrEqual(MATCH_MIN - 0.01);
    }
  });

  it('Pulse se réduit AVANT de disparaître', () => {
    // Large : il a sa forme complète. Serré : il tombe vers son minimum.
    const large = solveHomeLayout(entree(740, 393, charge));
    const serre = solveHomeLayout(entree(560, 393, charge));
    expect(large.heights.pulse).toBeGreaterThan(serre.heights.pulse);
    expect(serre.heights.pulse).toBeGreaterThanOrEqual(PULSE_MIN - 0.01);
  });

  it('Pulse disparaît plutôt que de couper « Prochain match »', () => {
    // Juste assez pour les essentiels, pas pour Pulse.
    const h = CTA_MIN + TOURNOIS_MIN + MATCH_MIN + 2 * gapFor(420) + 10;
    const r = solveHomeLayout(entree(h, 360, charge));
    expect(r.heights.pulse).toBe(0);
    expect(r.heights.nextMatch).toBeGreaterThanOrEqual(MATCH_MIN - 0.01);
    expect(occupiedHeight(r)).toBeLessThanOrEqual(h + 0.01);
  });

  it('écran vraiment minuscule : tout rétrécit ensemble, rien ne déborde', () => {
    const r = solveHomeLayout(entree(260, 360, charge));
    expect(r.contraint).toBe(true);
    expect(r.heights.pulse).toBe(0);
    expect(occupiedHeight(r)).toBeLessThanOrEqual(260 + 0.01);
    expect(r.heights.ctas).toBeGreaterThan(0);
  });

  it('seul Pulse peut céder', () => {
    const cedables = homeSections(entree(680, 393, charge)).filter(s => s.yields).map(s => s.key);
    expect(cedables).toEqual(['pulse']);
  });
});

describe('« Ça se joue bientôt » : sa hauteur est MESURÉE, jamais estimée ici', () => {
  // Le bloc dessine la carte du lobby (`GameCard`), qui ne nous appartient
  // pas. Sa hauteur dépend du match affiché (un compétitif porte une ligne
  // d'enjeu de plus), de la largeur, ET de la taille de police du téléphone —
  // les textes de la carte sont du CONTENU, ils suivent le réglage système
  // (cf. lib/uiText). Aucune constante écrite ici ne peut être vraie pour les
  // trois. Le chiffre arrive donc d'un `onLayout`, et ce fichier n'en connaît
  // ni la composition ni l'ordre de grandeur.
  const suggestions = { hasNextMatch: false, hasTournaments: false, hasPulse: true };

  it('la hauteur annoncée est prise telle quelle : ni rabotée, ni gonflée', () => {
    const r = solveHomeLayout(entree(740, 412, { ...suggestions, openGamesHeight: 232 }));
    expect(r.heights.openGames).toBeCloseTo(232, 5);
  });

  it('une carte plus haute obtient plus, sans que le calculateur sache pourquoi', () => {
    // C'est la propriété qui remplace `GEO.parties` : changer la carte change
    // la place qu'elle reçoit, sans toucher une ligne de ce fichier.
    const court = solveHomeLayout(entree(740, 412, { ...suggestions, openGamesHeight: 232 }));
    const long = solveHomeLayout(entree(740, 412, { ...suggestions, openGamesHeight: 300 }));
    expect(long.heights.openGames - court.heights.openGames).toBeCloseTo(68, 5);
  });

  it('le surplus ne le gonfle jamais, même seul sur un grand écran', () => {
    const r = solveHomeLayout(entree(740, 412, { hasNextMatch: false, hasTournaments: false, hasPulse: false, openGamesHeight: 232 }));
    expect(r.heights.openGames).toBeCloseTo(232, 5);
    expect(occupiedHeight(r)).toBeLessThan(740);
  });

  it('min et ideal sont le MÊME nombre : une seule forme mesurée', () => {
    const s = homeSections(entree(680, 393, { ...suggestions, openGamesHeight: 232 })).find(x => x.key === 'openGames')!;
    expect(s.min).toBe(s.ideal);
    expect(s.min).toBe(232);
  });

  it('trop haut pour l écran : Pulse cède, et rien ne déborde', () => {
    const r = solveHomeLayout(entree(500, 360, { ...suggestions, openGamesHeight: 300 }));
    expect(r.heights.pulse).toBe(0);
    expect(occupiedHeight(r)).toBeLessThanOrEqual(500 + 0.01);
  });
});

describe('les tuiles suivent la LARGEUR, pas un plancher choisi à la main', () => {
  it('un écran plus large donne des tuiles plus hautes', () => {
    expect(ctaHeightFor(430)).toBeGreaterThan(ctaHeightFor(360));
  });

  it('jamais sous ce que leur contenu réclame', () => {
    const r = solveHomeLayout(entree(680, 320, { hasNextMatch: true, hasTournaments: true, hasPulse: true }));
    expect(r.heights.ctas).toBeGreaterThanOrEqual(CTA_MIN - 0.01);
  });
});

describe('la place se partage, elle ne se gaspille pas', () => {
  it('sur un grand écran, Pulse prend sa forme complète', () => {
    const r = solveHomeLayout(entree(740, 412, { hasNextMatch: true, hasTournaments: true, hasPulse: true }));
    expect(r.heights.pulse).toBeGreaterThanOrEqual(PULSE_IDEAL - 0.01);
  });

  it('l espace entre blocs ne dépend que de la place, pas du modèle de téléphone', () => {
    expect(gapFor(500)).toBeLessThan(gapFor(700));
  });
});

describe('les blocs presents suivent ce qui est vrai', () => {
  it('sans match ni tournoi, l emplacement du milieu revient aux suggestions', () => {
    const cles = homeSections(entree(680, 393, { hasNextMatch: false, hasTournaments: false, openGamesHeight: 232 })).map(s => s.key);
    expect(cles).toContain('openGames');
    expect(cles).not.toContain('nextMatch');
  });

  it('avec un match, pas de suggestions', () => {
    const cles = homeSections(entree(680, 393, { hasNextMatch: true, hasTournaments: false })).map(s => s.key);
    expect(cles).toContain('nextMatch');
    expect(cles).not.toContain('openGames');
  });

  it('tant que « Ça se joue bientôt » n est pas MESURÉ, il ne réserve rien', () => {
    // Pas de valeur de repli : une estimation de secours redeviendrait la
    // constante magique, simplement plus discrète. Le bloc n'existe pas pour
    // le budget tant qu'un vrai onLayout n'a pas parlé.
    const cles = homeSections(entree(680, 393, { hasNextMatch: false, hasTournaments: false })).map(s => s.key);
    expect(cles).not.toContain('openGames');
    const r = solveHomeLayout(entree(680, 393, { hasNextMatch: false, hasTournaments: false }));
    expect(r.heights.openGames ?? 0).toBe(0);
  });

  it('pendant une soirée, la bannière remplace le bandeau Tournois', () => {
    const cles = homeSections(entree(680, 393, { hasNextMatch: true, hasTournaments: true, hasLiveBanner: true })).map(s => s.key);
    expect(cles).toContain('liveBanner');
    expect(cles).not.toContain('tournaments');
  });
});
