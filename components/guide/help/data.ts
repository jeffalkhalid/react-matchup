// Données du centre d'aide — refonte « Guide d'aide » (design_handoff_guide_aide).
// 21 rubriques en 6 familles : aucun écran de l'app sans réponse. Chaque étape dit
// OÙ TAPER, avec les libellés exacts de l'app — jamais une description de fonction.
//
// Chaque affirmation reste vérifiée contre le code réel (héritée de la refonte
// 2026-08-16, reconduite ici) — ne rien promettre que l'app ne fait pas :
// - défis = 2v2 (binôme vs binôme, mise ×1.5-3, file d'attente) — plus de défi solo ;
// - validation de score = UN adversaire suffit (lib/matches.ts), pas les 4 joueurs ;
// - litige = contre-proposition résolue par l'auteur du score, arbitre en dernier recours ;
// - il n'existe PAS d'écran « Réglages » : compte/CGU vivent dans le menu ⋯ du profil ;
// - support = support@pagmatch.com (lien dans les CGU).
import type { TourAnchorName } from '../../../lib/tourAnchors';

// ── « Me montrer sur l'écran » — passerelle vers le spotlight ────────────────
// Uniquement les rubriques dont l'ANCRE de la visite guidée existe déjà et est
// stable à l'écran (lib/tourAnchors). Ailleurs, pas de bouton : mieux vaut pas
// de spotlight qu'un spotlight qui rate sa cible.
export type ShowMeKey = 'lobby' | 'partie' | 'creer' | 'notifs';

export interface ShowMeSpec {
  screen: string;                 // route à ouvrir sous l'overlay
  anchor: TourAnchorName;
  fallbackAnchor?: TourAnchorName;
  pad: number;
  radius: number;                 // 999 = cercle
  place: 'below' | 'above';
  kicker: string; title: string; body: string;
}

export const SHOW_ME: Record<ShowMeKey, ShowMeSpec> = {
  lobby: {
    screen: '/(tabs)/lobby', anchor: 'lobby-slot', fallbackAnchor: 'lobby-card',
    pad: 10, radius: 18, place: 'below',
    kicker: 'Rejoindre', title: 'Prends la place libre',
    body: 'Tape l’emplacement en pointillés du camp qui t’intéresse. Le créateur valide, la partie est à toi.',
  },
  partie: {
    screen: '/(tabs)/lobby', anchor: 'lobby-card',
    pad: 8, radius: 22, place: 'below',
    kicker: 'La fiche', title: 'Une partie, une carte',
    body: 'Tape n’importe où sur la carte : la fiche de partie monte, avec les 4 places, le niveau et la mise.',
  },
  creer: {
    screen: '/(tabs)/lobby', anchor: 'tab-create',
    pad: 12, radius: 999, place: 'above',
    kicker: 'Créer', title: 'Le ⊕, au centre de la barre',
    body: 'Club, créneau, niveau : tu publies, les joueurs viennent à toi.',
  },
  notifs: {
    screen: '/(tabs)/lobby', anchor: 'bell-lobby',
    pad: 10, radius: 999, place: 'below',
    kicker: 'La cloche', title: 'Tout ce qui t’attend est là',
    body: 'Place libérée, score à valider, défi reçu : la cloche te prévient, même app fermée.',
  },
};

// ── Rubriques ────────────────────────────────────────────────────────────────
export interface HelpCta {
  label: string;
  // Route expo-router, ou pseudo-route résolue par components/HelpCenter :
  // '@tour' = rejouer la visite guidée · '@profile' = profil du joueur connecté.
  route: string;
}

export interface HelpTopic {
  title: string; sub: string;            // ligne du hub
  kicker: string; head: string; lede: string; // en-tête du détail
  path: string;                          // « Où ça se trouve » — le chemin en toutes lettres
  tab: number;                           // onglet de la tab bar à surligner (0-4), -1 = hors tab bar
  steps: string[];
  cta: HelpCta | null;
  showMe?: ShowMeKey;
}

export const TOPICS: Record<string, HelpTopic> = {
  lobby: {
    title: 'Lobby', sub: 'Explorer, À venir, Historique, filtres',
    kicker: 'Lobby', head: 'Prends la place libre d’une partie',
    lede: 'Trois onglets : Explorer les parties ouvertes, À venir, Historique.',
    path: 'Accueil → « Trouver un match »', tab: 0,
    steps: [
      'Tape « Trouver un match » sur l’Accueil : tu arrives dans Explorer.',
      'Les parties à ton niveau sont en haut, sous « ✨ Pour toi ».',
      'Tape l’emplacement en pointillés du camp qui t’intéresse.',
      'Le créateur valide : la partie passe dans « À venir ».',
    ],
    cta: { label: 'Ouvrir le Lobby', route: '/(tabs)/lobby' },
    showMe: 'lobby',
  },
  partie: {
    title: 'Fiche de partie', sub: 'Rejoindre, inviter, quitter',
    kicker: 'Fiche de partie', head: 'Tout se décide sur la fiche',
    lede: 'Joueurs, niveau, club, mise : la feuille qui s’ouvre au tap sur une partie.',
    path: 'Lobby → tape une carte de partie', tab: 0,
    steps: [
      'Tape n’importe où sur une carte du lobby : la fiche monte.',
      'Tu y vois les 4 places, le niveau demandé, le club et la mise.',
      '« Rejoindre » prend la place ; « Inviter » envoie un joueur dessus.',
      'Déjà inscrit ? « Quitter la partie » libère ta place — les autres sont notifiés.',
    ],
    cta: { label: 'Ouvrir le Lobby', route: '/(tabs)/lobby' },
    showMe: 'partie',
  },
  creer: {
    title: 'Créer une partie', sub: 'Club, créneau, niveau, invitations',
    kicker: 'Créer', head: 'Publie ta partie, les joueurs viennent',
    lede: 'L’assistant t’emmène du type de match jusqu’aux invitations.',
    path: 'Onglet Créer (+), au centre', tab: 2,
    steps: [
      'Tape le + au centre de la tab bar.',
      'Choisis le type : Compétitif, Amical ou Défi.',
      'Renseigne le club, le créneau et la fourchette de niveau.',
      'Invite un joueur précis, ou laisse les places ouvertes à l’Explorer.',
    ],
    cta: { label: 'Créer une partie', route: '/(tabs)/lobby?create=1' },
    showMe: 'creer',
  },
  defis: {
    title: 'Défis', sub: 'Binôme contre binôme, mise en jeu',
    kicker: 'Défis', head: 'Provoque un joueur, à deux contre deux',
    lede: 'Un défi ne se rejoint jamais en solo : on le relève avec son binôme.',
    path: 'Onglet Défi', tab: 3,
    steps: [
      'Tape l’onglet Défi : défis reçus et binômes disponibles.',
      'Pour lancer un défi, ouvre un profil et tape « Défier ».',
      'Choisis ton binôme, puis le binôme adverse.',
      'Ils relèvent : la partie se crée, avec la mise affichée (×1,5 à ×3).',
    ],
    cta: { label: 'Ouvrir les Défis', route: '/(tabs)/matchmaking' },
  },
  recherche: {
    title: 'Recherche de joueurs', sub: 'Qui défier, qui inviter',
    kicker: 'Recherche', head: 'Trouve qui défier, ou qui inviter',
    lede: 'Les profils portent le niveau, la forme, les badges et le rang FRMT.',
    path: 'Accueil → loupe, en haut à gauche', tab: 0,
    steps: [
      'Tape la loupe en haut à gauche de l’Accueil.',
      'Tape un nom, ou descends dans les suggestions de ton niveau.',
      'Ouvre un profil : niveau, forme, badges, rang FRMT ✓.',
      'De là, tu peux le défier ou l’inviter dans ta partie.',
    ],
    cta: { label: 'Ouvrir la recherche', route: '/community/friends' },
  },
  joueur: {
    title: 'Fiche joueur', sub: 'Niveau, forme, badges en vitrine',
    kicker: 'Fiche joueur', head: 'Lire un joueur avant de l’inviter',
    lede: 'Niveau, forme, badges reçus, historique, rang FRMT vérifié.',
    path: 'Tape le nom ou l’avatar d’un joueur', tab: -1,
    steps: [
      'Le nom d’un joueur est cliquable partout : lobby, chat, classement.',
      'La forme des 5 derniers matchs se lit d’un coup d’œil.',
      'Les badges affichés sont ceux qu’il a mis en vitrine.',
      'De là : « Défier », « Inviter », « Message », ou signaler.',
    ],
    cta: { label: 'Chercher un joueur', route: '/community/friends' },
  },
  score: {
    title: 'Saisir & valider le score', sub: 'Sets, validation adverse, litige',
    kicker: 'Score', head: 'Rien ne compte avant la validation',
    lede: 'Le score se saisit une fois, puis se valide par l’équipe adverse.',
    path: 'Accueil → « Score »', tab: 0,
    steps: [
      'Après la partie, tape « Score » sur l’Accueil.',
      'Saisis les sets : le vainqueur se déduit du score.',
      'L’équipe adverse valide (un seul des deux suffit) — le niveau ne bouge qu’après.',
      'Désaccord ? Ils proposent un contre-score, avec un motif. Sans accord, un arbitre tranche.',
    ],
    cta: { label: 'Saisir un score', route: '/score-entry' },
  },
  badges: {
    title: 'Palmarès & Badges', sub: 'Votés par les autres joueurs, sous 48 h',
    kicker: 'Palmarès', head: 'Ta réputation se vote après le match',
    lede: 'Ce sont tes partenaires et tes adversaires qui te notent, pas l’app.',
    path: 'Avatar en haut à droite → Palmarès', tab: -1,
    steps: [
      'Le score validé, une invitation « Distribue tes badges » s’ouvre — 48 h.',
      'Attribue MVP, La Bombe, Fair-Play… aux trois autres joueurs.',
      'Les badges reçus s’empilent sur ton palmarès.',
      'Tu choisis lesquels mettre en vitrine sur ton profil.',
    ],
    cta: { label: 'Voir mon palmarès', route: '@profile' },
  },
  bilan: {
    title: 'Bilan du mois', sub: '7 écrans, partageable dans le fil',
    kicker: 'Bilan', head: 'Ton mois en sept écrans',
    lede: 'Volume, forme, progression, meilleur binôme, meilleur match.',
    path: 'Activité → « Mon bilan »', tab: 1,
    steps: [
      'Chaque mois, ton bilan s’ouvre comme des stories.',
      'Tape à droite pour avancer, à gauche pour revenir ; ça défile seul en 6 s.',
      'Le sélecteur de mois permet de revoir les précédents.',
      'Dernier écran : publie-le dans le fil de tes amis.',
    ],
    cta: { label: 'Ouvrir l’Activité', route: '/(tabs)/activite' },
  },
  ranking: {
    title: 'Classement & Ligues', sub: 'Niveau 1 à 8, cinq ligues, rang FRMT',
    kicker: 'Classement', head: 'Ton niveau monte quand le score est validé',
    lede: 'Échelle 1.00 → 8.00, cinq ligues de Découverte à Diamant.',
    path: 'Accueil → « Classement »', tab: 0,
    steps: [
      'Ton niveau ne bouge qu’après validation du score par l’équipe adverse.',
      'Battre plus fort que toi rapporte plus de points.',
      'Un niveau coûte de plus en plus cher : 7→8 vaut deux fois 2→3.',
      'Un rang FRMT vérifié (✓) ajuste ton point de départ.',
    ],
    cta: { label: 'Voir le classement', route: '/ranking' },
  },
  activite: {
    title: 'Activité & Moments', sub: 'Ta semaine, le fil de tes amis',
    kicker: 'Activité', head: 'Ta semaine, et le fil de tes amis',
    lede: 'Stats de la semaine, classement entre amis, moments partagés.',
    path: 'Onglet Activité', tab: 1,
    steps: [
      'Tape l’onglet Activité : ta semaine en haut, le fil en dessous.',
      'Publie un Moment : photo, résultat, ou proposition de partie.',
      'Le classement entre amis se met à jour à chaque match validé.',
      'Commente les moments des autres : c’est ce qui remplit les parties.',
    ],
    cta: { label: 'Ouvrir l’Activité', route: '/(tabs)/activite' },
  },
  amis: {
    title: 'Amis & invitations', sub: 'Ton cercle, tes invitations de partie',
    kicker: 'Communauté', head: 'Joue d’abord avec ton cercle',
    lede: 'Les amis remontent dans les suggestions de binôme et de partie.',
    path: 'Accueil → icône Communauté', tab: 0,
    steps: [
      'Tape l’icône Communauté en haut à gauche de l’Accueil.',
      'Ajoute des amis : tu vois leurs parties et leur forme en priorité.',
      'Invite un joueur dans une partie précise, ou par lien.',
      'Les amis apparaissent en premier quand tu cherches un binôme.',
    ],
    cta: { label: 'Ouvrir la Communauté', route: '/community' },
  },
  alertes: {
    title: 'Alertes de partie', sub: 'Sur mesure, notifiées en temps réel',
    kicker: 'Alertes', head: 'Laisse le lobby te prévenir',
    lede: 'Une alerte surveille les parties à ta place, en temps réel.',
    path: 'Communauté → « Mes alertes »', tab: 0,
    steps: [
      'Communauté → « Mes alertes », puis « + Créer une alerte ».',
      'Choisis le club, la fourchette de niveau et les créneaux.',
      'Tape « Activer l’alerte » : la surveillance démarre.',
      'Dès qu’une partie correspond, tu reçois une notification.',
    ],
    cta: { label: 'Créer une alerte', route: '/community/alerts' },
  },
  stories: {
    title: 'Stories & Partage', sub: 'Image 9:16, QR « Rejoins-moi »',
    kicker: 'Stories', head: 'Partage ta partie, ramène des joueurs',
    lede: 'Une image 9:16 prête à poster, ton QR d’invitation intégré.',
    path: 'Une partie → « Partager »', tab: -1,
    steps: [
      'Depuis une partie ou ton profil, tape « Partager ».',
      'PagMatch génère l’image 9:16, tu choisis le fond.',
      'Ton QR « Rejoins-moi » est déjà dans l’image.',
      'Tout est généré sur ton téléphone : aucune image n’est stockée sur nos serveurs.',
    ],
    cta: null,
  },
  chats: {
    title: 'Chats de partie', sub: 'Un fil par partie, puis Archivés',
    kicker: 'Chats', head: 'Un fil par partie, pour tout caler',
    lede: 'Heure, terrain, qui apporte les balles : tout se règle avant d’y être.',
    path: 'Onglet Chats', tab: 4,
    steps: [
      'Chaque partie a son fil : tape l’onglet Chats.',
      'Les non-lus remontent en haut, avec un compteur rouge sur l’onglet.',
      'Réagis à un message par un emoji, sans encombrer le fil.',
      'Les parties terminées partent dans « Archivés ».',
    ],
    cta: { label: 'Voir mes chats', route: '/(tabs)/chats' },
  },
  dm: {
    title: 'Messages directs', sub: 'Demandes, qui peut t’écrire, blocage',
    kicker: 'Messages', head: 'Parler à un joueur, hors partie',
    lede: 'Les demandes se filtrent : tu gardes la main sur qui t’écrit.',
    path: 'Onglet Chats → Directs', tab: 4,
    steps: [
      'Les messages directs sont séparés des fils de partie.',
      'Un premier message arrive comme une demande : tu acceptes ou non.',
      'Règle « Qui peut m’envoyer un message » : tout le monde, joueurs croisés, personne.',
      'Un joueur bloqué ne peut plus t’écrire ; débloque-le quand tu veux.',
    ],
    cta: { label: 'Voir mes messages', route: '/(tabs)/chats' },
  },
  notifs: {
    title: 'Notifications', sub: 'La cloche, et quoi y attendre',
    kicker: 'Notifications', head: 'La cloche te dit quoi faire ensuite',
    lede: 'Tout ce qui attend une action de ta part est regroupé là.',
    path: 'Cloche, en haut à droite', tab: -1,
    steps: [
      'Tape la cloche en haut à droite, depuis n’importe quel onglet.',
      'Défi reçu, place libérée, score à valider, badges à distribuer.',
      'Le compteur rouge se vide dès que l’élément est traité.',
      'Refusé au premier lancement ? Réglages du téléphone → Notifications.',
    ],
    cta: { label: 'Voir mes notifications', route: '/notifications' },
    showMe: 'notifs',
  },
  compte: {
    title: 'Profil, vitrine & sécurité', sub: 'Photo, badges en vitrine, blocage, CGU',
    kicker: 'Compte', head: 'Ta page, et tes garde-fous',
    lede: 'Photo, badges en vitrine, blocage, signalement, confidentialité.',
    path: 'Avatar en haut à droite → ton profil', tab: -1,
    steps: [
      'Tape ton avatar en haut à droite pour ouvrir ton profil.',
      'Choisis les badges de ta vitrine, ta photo, ton club.',
      'Un comportement déplacé ? Signale ou bloque depuis le profil du joueur.',
      'CGU, confidentialité et suppression de compte : le menu ⋯ de ton profil.',
    ],
    cta: { label: 'Ouvrir mon profil', route: '@profile' },
  },
  auth: {
    title: 'Connexion & mot de passe', sub: 'Mot de passe oublié, déconnexion',
    kicker: 'Connexion', head: 'Reprendre la main sur ton compte',
    lede: 'Mot de passe oublié, lien de réinitialisation, déconnexion.',
    path: 'Écran de connexion, ou profil → ⋯', tab: -1,
    steps: [
      'Mot de passe oublié : « Mot de passe oublié ? » sur l’écran de connexion.',
      'Tu reçois un lien par e-mail : il rouvre l’app pour en choisir un nouveau.',
      'Rien reçu ? Vérifie les indésirables, puis redemande un lien.',
      'Se déconnecter ou supprimer le compte : le menu ⋯ de ton profil.',
    ],
    cta: null,
  },
  ambassadeur: {
    title: 'Ambassadeur · Cercle des 100', sub: 'La pastille dorée, ton numéro de membre',
    kicker: 'Ambassadeur', head: 'Les 100 premiers, marqués à vie',
    lede: 'Un numéro de membre, une pastille dorée, un écran de révélation.',
    path: 'Pastille dorée, sur ta carte profil', tab: -1,
    steps: [
      'Les 100 premiers membres forment le Cercle des 100.',
      'Ton numéro s’affiche en pastille dorée à côté de ton nom.',
      'Un écran de révélation s’ouvre une fois, après la visite guidée.',
      'Le badge reste, même quand l’app grandit.',
    ],
    cta: { label: 'Voir ma carte', route: '@profile' },
  },
  welcome: {
    title: 'Bienvenue · revoir la visite', sub: 'PagMatch en trois gestes',
    kicker: 'Bienvenue', head: 'PagMatch en trois gestes',
    lede: 'Un niveau juste, des parties à ta mesure, un classement qui suit.',
    path: 'Bouton « ? », depuis n’importe quel écran', tab: -1,
    steps: [
      'Complète ton profil et ton niveau padel : tout part de là.',
      'Rejoins une partie ouverte, ou crée la tienne.',
      'Joue, saisis le score, fais-le valider par tes adversaires.',
      'Ton niveau bouge, ton classement suit.',
    ],
    cta: { label: 'Revoir la visite', route: '@tour' },
  },
};

// ── Familles (6 cartes du hub — ordre fixe : c'est un parcours) ──────────────
export interface HelpFamily { key: string; label: string; icon: string; topics: string[] }

export const FAMILIES: HelpFamily[] = [
  { key: 'jouer',      label: 'Jouer',             icon: 'racket',  topics: ['lobby', 'partie', 'creer', 'defis', 'recherche', 'joueur'] },
  { key: 'apres',      label: 'Après le match',    icon: 'pencil',  topics: ['score', 'badges', 'bilan'] },
  { key: 'progresser', label: 'Progresser',        icon: 'trophy',  topics: ['ranking', 'activite'] },
  { key: 'commu',      label: 'Communauté',        icon: 'users',   topics: ['amis', 'alertes', 'stories'] },
  { key: 'messages',   label: 'Messages & alertes', icon: 'message', topics: ['chats', 'dm', 'notifs'] },
  { key: 'compte',     label: 'Compte',            icon: 'shield',  topics: ['compte', 'auth', 'ambassadeur', 'welcome'] },
];

// Ordre plat des 21 rubriques — navigation ‹ › du détail + compteur « n / 21 ».
export const ORDER: string[] = FAMILIES.flatMap(f => f.topics);

// ── Dépannage / FAQ ──────────────────────────────────────────────────────────
export interface FaqEntry { q: string; a: string; }

export const FAQ: FaqEntry[] = [
  { q: 'Mon niveau n’a pas bougé après mon match.',
    a: 'Le score doit d’abord être validé par l’équipe adverse (un seul des deux suffit). Tant qu’il est en attente ou contesté, le niveau ne bouge pas.' },
  { q: 'Personne ne valide notre score.',
    a: 'Relance les adversaires dans le chat de la partie : un seul des deux suffit pour valider. La saisie du score reste ouverte 48 h après le match.' },
  { q: 'On n’est pas d’accord sur le score.',
    a: 'L’adversaire conteste en proposant sa version, avec un motif. L’auteur du score accepte leur version, ou maintient la sienne : le match passe alors en litige et un arbitre PagMatch tranche.' },
  { q: 'Ma partie n’apparaît plus dans le lobby.',
    a: 'Elle est sûrement masquée par un filtre (type de partie ou « Urgent »). Réinitialise les filtres en haut du Lobby — et si tu y participes, retrouve-la dans « À venir ».' },
  { q: 'Je ne reçois pas de défis.',
    a: 'Active les notifications, et complète ton profil et ton niveau padel : c’est ce qui te fait apparaître dans les suggestions des autres joueurs.' },
  { q: 'Je ne reçois pas de notifications.',
    a: 'Si tu les as refusées au premier lancement, seul le réglage du téléphone peut les réactiver : Réglages → PagMatch → Notifications. C’est la cloche qui te prévient : défis reçus, places libérées, scores à valider.' },
  { q: 'Un autre problème ?',
    a: 'Rouvre ce guide à tout moment via le bouton « ? ». Pour le support : support@pagmatch.com (lien dans les Conditions d’utilisation, menu du profil).' },
];

// ── Contextualisation ────────────────────────────────────────────────────────
// Segment de route courant → rubrique surlignée dans le hub (« Tu es ici »).
// Une entrée par écran de l'app — le « ? » ne vit aujourd'hui que sur les 5
// onglets, mais requestHelpOpen() permet de l'ouvrir d'ailleurs demain.
export const ROUTE_TO_RUBRIC: Record<string, string> = {
  '(tabs)': 'welcome',
  index: 'welcome',
  lobby: 'lobby',
  GameDetailsSheet: 'partie',
  CreateWizard: 'creer',
  matchmaking: 'defis',
  activite: 'activite',
  chats: 'chats',
  ranking: 'ranking',
  'score-entry': 'score',
  notifications: 'notifs',
  community: 'amis',
  friends: 'recherche',
  invite: 'amis',
  alerts: 'alertes',
  'alert-new': 'alertes',
  'dm-settings': 'dm',
  '[conversationId]': 'dm',
  '[gameId]': 'chats',
  'archived-chats': 'chats',
  '[id]': 'joueur',
  '[month]': 'bilan',
  'ambassador-welcome': 'ambassadeur',
};

// Carte « Tu es ici » en tête du hub : le guide répond d'abord à l'écran d'où
// on l'ouvre. `links` = raccourcis vers les rubriques les plus probables.
export interface HelpContext {
  label: string;                 // « Le Lobby »
  question: string;              // « Tu cherches une partie à ton niveau ? »
  links: { label: string; topic: string }[];
  showMe?: ShowMeKey;
}

const CONTEXT_HOME: HelpContext = {
  label: 'l’Accueil',
  question: 'Par où commencer ?',
  links: [
    { label: 'Trouver une partie', topic: 'lobby' },
    { label: 'Lancer un défi', topic: 'defis' },
  ],
};

export const CONTEXT: Record<string, HelpContext> = {
  '(tabs)': CONTEXT_HOME,
  index: CONTEXT_HOME,
  lobby: {
    label: 'le Lobby',
    question: 'Tu cherches une partie à ton niveau ?',
    links: [
      { label: 'Prendre une place libre', topic: 'lobby' },
      { label: 'Créer ma partie', topic: 'creer' },
    ],
    showMe: 'lobby',
  },
  activite: {
    label: 'l’Activité',
    question: 'Ta semaine, et le fil de tes amis',
    links: [
      { label: 'Publier un moment', topic: 'activite' },
      { label: 'Voir mon bilan du mois', topic: 'bilan' },
    ],
  },
  matchmaking: {
    label: 'les Défis',
    question: 'Prêt à provoquer un binôme ?',
    links: [
      { label: 'Lancer ou relever un défi', topic: 'defis' },
      { label: 'Trouver mon binôme', topic: 'recherche' },
    ],
  },
  chats: {
    label: 'les Chats',
    question: 'Un fil par partie, pour tout caler',
    links: [
      { label: 'Chats de partie', topic: 'chats' },
      { label: 'Messages directs', topic: 'dm' },
    ],
  },
};
