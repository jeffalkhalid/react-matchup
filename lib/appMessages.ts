// lib/appMessages.ts — le message qui s'affiche à l'ouverture de l'app.
//
// POURQUOI CE FICHIER EXISTE : une mise à jour publiée par `eas update` arrive
// en silence. Le joueur ne sait pas qu'une fonctionnalité est arrivée, et nous
// n'avons aucun moyen de lui dire quoi que ce soit entre deux publications.
// Une ligne dans `app_messages` suffit désormais — sans republier l'app.
//
// TROIS NIVEAUX, UNE SEULE TABLE :
//   'info'    — une information, on la ferme ;
//   'feature' — une nouveauté, on la ferme, elle ne revient plus ;
//   'update'  — l'app est trop vieille, on NE PEUT PAS la fermer.
//
// Le dernier est le garde-fou de compatibilité : quand le serveur change d'une
// façon qu'une ancienne app ne sait pas lire, on vise les versions concernées
// et elles seules. C'est le SEUL moyen d'arrêter un client qu'on ne peut plus
// joindre par une publication (cf. le socle figé sur la version du SDK).
//
// Rien ici ne parle à la base ni à l'écran : ce fichier décide, on le teste
// sans téléphone (lib/__tests__/appMessages.test.ts).

export type AppMessageLevel = 'info' | 'feature' | 'update';

export interface AppMessage {
  id: string;
  level: AppMessageLevel;
  title: string;
  body: string;
  /** Libellé du bouton d'action. Sans lui, le message n'a qu'un « Fermer ». */
  cta_label: string | null;
  /** Lien du bouton : adresse d'un store, page web, ou route interne. */
  cta_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  /** Visible à partir de cette version de l'app, celle-ci comprise. */
  min_app_version: string | null;
  /** Visible jusqu'à cette version de l'app, celle-ci comprise. */
  max_app_version: string | null;
  active: boolean;
  priority: number;
  created_at: string;
}

/**
 * Comparer deux numéros de version, segment par segment.
 *
 * Le piège que ça évite : comparées comme du texte, '1.10.0' passe AVANT
 * '1.9.0'. Une app récente se croirait alors périmée et s'afficherait un
 * blocage « mets-toi à jour » dont personne ne pourrait sortir.
 *
 * Ce qui suit le numéro ('1.2.3-beta.1') est ignoré : on compare des paliers
 * de compatibilité, pas des étiquettes de build.
 */
export function compareVersions(a: string, b: string): number {
  const decouper = (v: string) =>
    String(v ?? '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const ga = decouper(a);
  const gb = decouper(b);
  const longueur = Math.max(ga.length, gb.length);
  for (let i = 0; i < longueur; i++) {
    const x = ga[i] ?? 0;
    const y = gb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Une mise à jour obligatoire ne se ferme pas. Les deux autres, si. */
export function isBlocking(m: Pick<AppMessage, 'level'>): boolean {
  return m.level === 'update';
}

export interface MessageContext {
  now: Date;
  /** Version de l'app installée. Chaîne vide quand on n'arrive pas à la lire. */
  appVersion: string;
}

/**
 * Ce message s'adresse-t-il à CETTE app, MAINTENANT ?
 *
 * Quand la version du téléphone est illisible, aucun filtre de version ne
 * s'applique : montrer une information à tort est sans gravité, bloquer
 * quelqu'un à tort l'est beaucoup plus — et un blocage ne se contourne pas.
 */
export function isVisibleFor(m: AppMessage, ctx: MessageContext): boolean {
  if (!m.active) return false;

  const t = ctx.now.getTime();
  if (m.starts_at) {
    const debut = Date.parse(m.starts_at);
    if (Number.isFinite(debut) && t < debut) return false;
  }
  if (m.ends_at) {
    const fin = Date.parse(m.ends_at);
    if (Number.isFinite(fin) && t > fin) return false;
  }

  if (!ctx.appVersion) return true;
  if (m.min_app_version && compareVersions(ctx.appVersion, m.min_app_version) < 0) return false;
  if (m.max_app_version && compareVersions(ctx.appVersion, m.max_app_version) > 0) return false;
  return true;
}

export interface PickContext extends MessageContext {
  /** Les messages que ce joueur a déjà fermés. */
  seenIds: string[];
}

/**
 * Le message à afficher, ou `null`.
 *
 * UN SEUL à la fois : deux fenêtres à la suite à l'ouverture, c'est une app
 * qu'on referme. Les autres attendront la prochaine ouverture.
 *
 * L'ordre : d'abord ce qui bloque, ensuite la priorité, ensuite le plus
 * récent. Un message bloquant ignore le « déjà vu » — sinon un joueur le ferme
 * une fois et continue indéfiniment avec une app que le serveur ne comprend
 * plus.
 */
export function pickMessage(messages: AppMessage[], ctx: PickContext): AppMessage | null {
  const visibles = (messages ?? []).filter(m => isVisibleFor(m, ctx));
  const bloquants = visibles.filter(isBlocking);
  const candidats = bloquants.length > 0
    ? bloquants
    : visibles.filter(m => !ctx.seenIds.includes(m.id));

  if (candidats.length === 0) return null;

  return [...candidats].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return Date.parse(b.created_at ?? '') - Date.parse(a.created_at ?? '');
  })[0];
}
