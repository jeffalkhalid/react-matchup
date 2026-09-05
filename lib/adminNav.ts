// lib/adminNav.ts — la carte de navigation du Panel Arbitre.
//
// Implémente `design_handoff_panel_arbitre`, écran 1a : QUATRE pastilles sur
// une seule ligne — File · Données · Config · Tournois — au lieu des dix
// onglets répartis sur cinq blocs qui mangeaient le tiers haut de l'écran
// avant qu'on ait vu le moindre dossier.
//
// CE QUI A CHANGÉ DE NATURE, ET PAS SEULEMENT DE PLACE : Litiges,
// Signalements et Genre ne sont plus des destinations qu'on choisit. Ce sont
// des ISSUES de la file — on y arrive en tapant un dossier ou un compteur,
// jamais en se demandant « dans quel onglet est-ce que je regarde ». C'est
// tout l'objet de la file : ne plus avoir à poser cette question.
//
// Elles restent donc atteignables, mais comme un approfondissement, avec un
// retour vers la file — pas comme cinq pastilles de plus en permanence.
//
// LE JOURNAL quitte la barre pour l'icône horloge de l'en-tête : on le
// consulte après coup, pas pendant qu'on traite.
//
// L'INVARIANT que ce fichier protège : tout onglet appartient à exactement un
// groupe, sauf le journal. Un onglet oublié ici n'apparaît nulle part — il
// existe, il fonctionne, et personne ne peut plus l'ouvrir. Ça ne se voit pas
// à la relecture, seulement à l'usage. D'où le test.

export type AdminTab =
  | 'queue' | 'journal' | 'disputes' | 'frmt' | 'games'
  | 'gender' | 'reports' | 'players' | 'badges' | 'settings' | 'tournaments';

export type AdminGroup = 'file' | 'donnees' | 'config' | 'tournois';

export interface GroupDef {
  key: AdminGroup;
  label: string;
  /** Le premier est le point d'entrée du groupe. */
  tabs: AdminTab[];
}

export const GROUPS: GroupDef[] = [
  // Les trois écrans de modération vivent DANS la file : on y descend depuis
  // un dossier, on ne les choisit pas d'avance.
  { key: 'file',     label: 'File',     tabs: ['queue', 'disputes', 'reports', 'gender'] },
  { key: 'donnees',  label: 'Données',  tabs: ['frmt', 'players', 'games'] },
  { key: 'config',   label: 'Config',   tabs: ['badges', 'settings'] },
  { key: 'tournois', label: 'Tournois', tabs: ['tournaments'] },
];

/** Le journal se rejoint par l'en-tête, pas par un groupe. */
export const HEADER_TABS: AdminTab[] = ['journal'];

export const ALL_TABS: AdminTab[] = [
  'queue', 'journal', 'disputes', 'frmt', 'games',
  'gender', 'reports', 'players', 'badges', 'settings', 'tournaments',
];

/** Le groupe qui contient cet onglet. `null` pour ceux de l'en-tête. */
export function groupOfTab(tab: AdminTab): AdminGroup | null {
  return GROUPS.find(g => g.tabs.includes(tab))?.key ?? null;
}

/** Le point d'entrée d'un groupe — celui qu'on ouvre en tapant sa pastille. */
export function defaultTab(group: AdminGroup): AdminTab {
  return (GROUPS.find(g => g.key === group) ?? GROUPS[0]).tabs[0];
}

/**
 * Cet onglet est-il un approfondissement de la file ?
 *
 * Vrai pour les trois écrans de modération, faux pour la file elle-même. Sert
 * à afficher le retour « ‹ La file » : sans lui, on descend dans un litige et
 * plus rien ne dit comment remonter.
 */
export function isDrillDown(tab: AdminTab): boolean {
  return groupOfTab(tab) === 'file' && tab !== 'queue';
}

/**
 * La rangée de sous-onglets d'un groupe, ou `[]` quand il n'y en a pas lieu.
 *
 * Vide pour un groupe à un seul onglet — une rangée d'un seul bouton est du
 * bruit — et vide pour la file, dont les destinations se rejoignent par les
 * dossiers, pas par une rangée.
 */
export function subTabs(group: AdminGroup): AdminTab[] {
  if (group === 'file') return [];
  const g = GROUPS.find(x => x.key === group);
  return g && g.tabs.length > 1 ? g.tabs : [];
}

export const TAB_LABEL: Record<AdminTab, string> = {
  queue: 'La file',
  journal: 'Journal',
  disputes: 'Litiges',
  reports: 'Signalements',
  gender: 'Genre',
  frmt: 'FRMT',
  players: 'Joueurs',
  games: 'Parties',
  badges: 'Badges',
  settings: 'Réglages',
  tournaments: 'Tournois',
};
