// Informations légales centralisées — utilisées par les écrans
// app/legal/confidentialite.tsx et app/legal/cgu.tsx.
//
// ⚠️ À COMPLÉTER AVANT PUBLICATION : remplacer les valeurs entre crochets.
// Vérifier la région Supabase dans Dashboard → Project Settings → General.
export const LEGAL = {
  /** Marque. */
  brand: 'Padel Active Game',
  /** Nom de l'application. */
  appName: 'PAG MATCH',
  /** Responsable du traitement des données (politique de confidentialité). */
  responsable: '[RESPONSABLE — nom / raison sociale]',
  /** Éditeur de l'application (CGU). */
  editor: '[EDITEUR — nom / raison sociale]',
  /** E-mail de contact (données + modération). */
  contactEmail: 'support@padelactivegame.com',
  /** Région d'hébergement Supabase (transfert hors Maroc). */
  supabaseRegion: '[RÉGION_SUPABASE — ex. Union européenne]',
  /** Âge minimum pour utiliser le service. */
  minAge: 18,
  /** Date de dernière mise à jour affichée en haut des écrans légaux. */
  lastUpdate: '5 juin 2026',
} as const;
