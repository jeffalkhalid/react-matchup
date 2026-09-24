// lib/courtAlarm.ts — les deux sonneries d'un terrain, sur CE téléphone.
//
// POURQUOI SUR LE TÉLÉPHONE. Une notification programmée localement tombe à la
// seconde près et part même si le réseau du club est mauvais à cet instant. Le
// serveur, lui, ne s'occupe que de ce qui concerne les AUTRES (la rotation, le
// terrain muet) : quatre cents notifications par soirée pour un compte à
// rebours que chaque appareil sait tenir seul, c'est du bruit et de la latence.
//
// LA RÈGLE QUI COMPTE : une sonnerie qui ne s'annule pas est PIRE que pas de
// sonnerie — elle sonne pendant la rotation suivante, au milieu d'un point.
// D'où `hasScore` : dès qu'un score est saisi, tout est annulé.
//
// Rien d'Expo ici : la porte (`AlarmPort`) est injectée, donc ce module se
// teste sans appareil et sans permission système.

/** Ce que ce module demande au système, et rien de plus. */
export interface AlarmPort {
  schedule(o: { title: string; body: string; seconds: number }): Promise<string>;
  cancel(id: string): Promise<void>;
}

/** Minutes entre la fin du temps et la relance (spec §5). */
const RELANCE_MIN = 3;

/**
 * Met les sonneries de CE téléphone d'accord avec l'état du terrain.
 *
 * `memoire` associe un match aux identifiants de ses notifications posées.
 * Elle vit au-dessus (un `useRef` dans l'écran) : ce module ne garde aucun
 * état global, donc deux comptes sur un même appareil ne se marchent pas
 * dessus.
 */
export async function syncCourtAlarms(
  etat: { matchId: string | null; courtNo: number; secondsLeft: number | null; hasScore: boolean },
  port: AlarmPort,
  memoire: Map<string, string[]>,
): Promise<void> {
  // 1. Tout ce qui ne concerne plus le terrain courant s'annule — rotation
  //    passée, match rouvert, abandon.
  for (const [id, notifs] of [...memoire.entries()]) {
    const obsolete = id !== etat.matchId || etat.hasScore || etat.secondsLeft === null;
    if (!obsolete) continue;
    memoire.delete(id);
    for (const n of notifs) {
      try { await port.cancel(n); } catch { /* notifications coupées : rien à annuler */ }
    }
  }

  // 2. Rien à poser si je ne joue pas, si le score est déjà là, ou si les
  //    sonneries de ce match sont déjà posées (app rouverte : on ne double pas).
  if (!etat.matchId || etat.hasScore || etat.secondsLeft === null) return;
  if (memoire.has(etat.matchId)) return;

  const fin = Math.max(0, etat.secondsLeft);
  const relance = Math.max(0, etat.secondsLeft + RELANCE_MIN * 60);
  const poses: string[] = [];
  try {
    if (etat.secondsLeft > 0) {
      poses.push(await port.schedule({
        title: `Terrain ${etat.courtNo} — temps écoulé`,
        body: 'Entrez le score, la rotation suivante attend.',
        seconds: fin,
      }));
    }
    if (relance > 0) {
      poses.push(await port.schedule({
        title: `Terrain ${etat.courtNo} — score attendu`,
        body: 'Personne n’a encore rentré le score de votre match.',
        seconds: relance,
      }));
    }
  } catch {
    // Notifications refusées : le compte à rebours reste à l'écran, et rien
    // n'est bloqué. On ne mémorise pas : on retentera à la prochaine rotation.
    return;
  }
  if (poses.length > 0) memoire.set(etat.matchId, poses);
}

/** La porte réelle, branchée sur expo-notifications. Non testée en Vitest :
 *  elle n'a pas de logique, et l'essai qui compte est celui sur appareil. */
export async function expoAlarmPort(): Promise<AlarmPort> {
  const Notifications = await import('expo-notifications');
  return {
    schedule: (o) => Notifications.scheduleNotificationAsync({
      content: { title: o.title, body: o.body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(o.seconds)),
        repeats: false,
      },
    }),
    cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  };
}
