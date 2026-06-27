// Données du centre d'aide — port de design_handoff_onboarding_aide/guide.jsx.
import type { IllustKey } from '../illustrations';

export interface HelpEntry {
  illust?: IllustKey;
  steps: string[];
  cta: { label: string; route: string } | null;
}

// Routes Expo réelles de l'app (la recherche de joueurs vit dans /(tabs)/ranking).
export const HELP: Record<string, HelpEntry> = {
  welcome: {
    illust: 'welcome',
    steps: [
      'Complète ton profil et indique ton niveau padel.',
      'Rejoins ou crée une partie depuis le Lobby.',
      'Joue, saisis le score, et grimpe le classement ELO.',
    ],
    cta: null,
  },
  recherche: {
    illust: 'recherche',
    steps: [
      'Ouvre la recherche et tape un nom, ou parcours les suggestions.',
      'Filtre par niveau, ville ou disponibilité.',
      'Ouvre un profil pour voir niveau, forme et badges (rang FRMT ✓ vérifié).',
      'Défie le joueur, ou invite-le à rejoindre ta partie.',
    ],
    cta: { label: 'Chercher un joueur', route: '/(tabs)/ranking' },
  },
  lobby: {
    illust: 'lobby',
    steps: [
      'Ouvre le Lobby pour voir les parties autour de toi.',
      'Filtre par niveau, date ou club.',
      'Tape « Rejoindre », ou « Créer » pour lancer la tienne.',
      'Une partie 🆘 Urgent commence sous 6 h et cherche 1 joueur.',
    ],
    cta: { label: 'Voir le lobby', route: '/(tabs)/lobby' },
  },
  defis: {
    illust: 'defis',
    steps: [
      'Ouvre le profil d’un joueur, ou regarde les suggestions.',
      'Tape « Défier » et propose un créneau.',
      'Il accepte → la partie se crée automatiquement.',
      'Jouez : le résultat ajuste vos deux niveaux.',
    ],
    cta: { label: 'Voir les défis', route: '/(tabs)/matchmaking' },
  },
  ranking: {
    illust: 'ranking',
    steps: [
      'Ton niveau bouge à chaque match validé par les 4 joueurs.',
      'Battre plus fort que toi rapporte plus de points.',
      'Tu passes de ligue en ligue : Découverte → Diamant.',
      'Suis ta forme et ta progression sur ton profil.',
    ],
    cta: { label: 'Voir le classement', route: '/(tabs)/ranking' },
  },
  chats: {
    illust: 'chats',
    steps: [
      'Chaque partie a son propre fil de discussion.',
      'Cale l’heure, le lieu, qui amène les balles.',
      'Réagis aux messages avec des emojis.',
      'Les conversations non lues remontent en premier.',
    ],
    cta: { label: 'Voir mes chats', route: '/(tabs)/chats' },
  },
  badges: {
    illust: 'badges',
    steps: [
      'Après chaque match, note tes adversaires.',
      'Attribue des badges : MVP 👑, La Bombe 💥, Fair-Play 🤝…',
      'Les badges reçus s’affichent sur ton palmarès.',
      'Une réputation se construit, match après match.',
    ],
    cta: null,
  },
  stories: {
    illust: 'stories',
    steps: [
      'Choisis ton profil, un résultat de match, ou une photo.',
      'PagMatch génère une story 9:16 prête à poster.',
      'Un QR d’invitation « Rejoins-moi » est intégré à ta story.',
      'Partage en story Insta, ou envoie le lien sur WhatsApp.',
      'Chaque scan de ton QR te rapproche de nouveaux partenaires.',
    ],
    cta: null,
  },
};

export interface FaqEntry { q: string; a: string; }

export const FAQ: FaqEntry[] = [
  { q: 'Mon niveau (ELO) n’a pas bougé après mon match.',
    a: 'Les 4 joueurs doivent valider le score pour que l’ELO soit distribué. Vérifie qu’aucun litige n’est en cours sur la partie.' },
  { q: 'Ma partie n’apparaît plus dans le lobby.',
    a: 'Elle est sûrement masquée par un filtre. Réinitialise les filtres de niveau, de date et de club en haut du Lobby.' },
  { q: 'Je ne reçois pas de défis.',
    a: 'Active les notifications dans les réglages, et complète ton profil et ton niveau pour apparaître dans les suggestions.' },
  { q: 'Un joueur ne valide pas le score.',
    a: 'Relance-le dans le chat de la partie. Sans réponse, ouvre un litige : un administrateur tranchera.' },
  { q: 'Un autre problème ?',
    a: 'Rouvre ce guide à tout moment via le bouton « ? », ou contacte le support depuis Réglages › Aide.' },
];

// Ordre des rubriques dans le hub + navigation Précédent/Suivant.
export const HUB_RUBRICS = ['lobby', 'recherche', 'defis', 'ranking', 'chats', 'badges', 'stories', 'welcome'];

// Segment de route courant → rubrique mise en avant (« Tu es ici »).
export const ROUTE_TO_RUBRIC: Record<string, string> = {
  lobby: 'lobby',
  matchmaking: 'defis',
  ranking: 'ranking',
  chats: 'chats',
};
