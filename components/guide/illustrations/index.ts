import { IllustLobby } from './Lobby';
import { IllustRecherche } from './Recherche';
import { IllustDefi } from './Defi';
import { IllustLigues } from './Ligues';
import { IllustBadges } from './Badges';
import { IllustStories } from './Stories';
import { IllustNotif } from './Notif';
import { IllustWelcome } from './Welcome';
import { IllustChats } from './Chats';

// Onboarding (Phase 1) : lobby, recherche, defis, ranking, badges, stories, notif.
// Centre d'aide (Phase 2) ajoute welcome + chats.
export const ILLUST = {
  lobby: IllustLobby,
  recherche: IllustRecherche,
  defis: IllustDefi,
  ranking: IllustLigues,
  badges: IllustBadges,
  stories: IllustStories,
  notif: IllustNotif,
  welcome: IllustWelcome,
  chats: IllustChats,
} as const;

export type IllustKey = keyof typeof ILLUST;
