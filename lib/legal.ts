// Informations légales centralisées — utilisées par les écrans
// app/legal/confidentialite.tsx et app/legal/cgu.tsx.
//
// Renseigné pour QUARTZTEC SARL AU (2026-06-10). Garder synchronisé avec
// activegame-landing/lib/legal.ts (mêmes valeurs).
export const LEGAL = {
  /** Marque. */
  brand: 'Padel Active Game',
  /** Nom de l'application. */
  appName: 'PAG MATCH',
  /** Responsable du traitement des données (politique de confidentialité). */
  responsable: 'QUARTZTEC, SARL à associé unique au capital de 100 000 MAD, immatriculée au registre du commerce de Casablanca sous le n° 521941',
  /** Éditeur de l'application (CGU). */
  editor: 'QUARTZTEC, SARL à associé unique au capital de 100 000 MAD, immatriculée au registre du commerce de Casablanca sous le n° 521941',
  /** E-mail de contact (données + modération). */
  contactEmail: 'support@pagmatch.com',
  /** Région d'hébergement Supabase (transfert hors Maroc). */
  supabaseRegion: 'Union européenne (Irlande — eu-west-1)',
  /** Âge minimum pour utiliser le service. */
  minAge: 18,
  /** Date de dernière mise à jour affichée en haut des écrans légaux. */
  lastUpdate: '10 juin 2026',
} as const;
