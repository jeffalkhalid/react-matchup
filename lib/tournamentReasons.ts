// lib/tournamentReasons.ts — les REFUS DU SERVEUR, en français.
//
// Toutes les fonctions `tournament_*` de `supabase/migrations/tournaments_rpcs.sql`
// rendent `{ok:true, ...}` ou `{ok:false, reason:'...'}` : aucune ne lève pour un
// refus métier. Un écran qui affiche `data.reason` tel quel montre donc du code
// brut au joueur (« waitlist_mismatch »).
//
// CE MODULE EST LA SOURCE UNIQUE de ces libellés, pour TOUS les écrans de
// tournoi — y compris ceux qui n'existent pas encore (déroulement, clôture).
// Les tournois sont un monde étanche : une raison non traduite est un bug
// d'affichage qui ne se voit qu'en production, sur l'écran de quelqu'un d'autre.
// D'où la table COMPLÈTE ci-dessous, et non les seules raisons de l'inscription.
//
// `lib/__tests__/tournamentReasons.test.ts` relit le fichier SQL et exige une
// traduction pour CHAQUE raison qu'il contient : ajouter un refus côté serveur
// sans le traduire ici fait tomber la suite.
//
// Pas de dépendance : module PUR, testable sans base ni environnement Expo.

/** Texte rendu quand la raison est inconnue (ou absente). Lisible par un
 *  joueur : jamais un code, jamais un message d'erreur technique. */
export const GENERIC_REASON = "Action impossible pour le moment. Réessaie dans un instant.";

/** Les refus de `tournaments_rpcs.sql` (46 à l'origine, plus ceux de la Task 11
 *  : `tournament_create`), dans l'ordre alphabétique du SQL.
 *  Formulés du point de vue du JOUEUR, à la deuxième personne comme le reste
 *  de l'app. */
export const TOURNAMENT_REASONS: Record<string, string> = {
  already_confirmed:             'Ce score est déjà confirmé.',
  already_finished:              'Ce tournoi est déjà terminé.',
  already_in_team:               'Tu fais déjà partie d’un binôme sur ce tournoi.',
  already_registered:            'Tu es déjà inscrit à ce tournoi.',
  already_started:               'Le tournoi a déjà commencé.',
  already_validated:             'Le classement de ce tournoi est déjà validé.',
  already_withdrawn:             'Ce binôme a déjà quitté le tournoi.',
  bye_match:                     'Ce tour est un repos : il n’y a pas de score à saisir.',
  club_not_found:                'Ce club est introuvable.',
  draw_not_allowed:              'Un match ne peut pas finir à égalité : le point décisif s’inscrit comme un jeu, il faut un vainqueur.',
  feature_disabled:              'Les tournois ne sont pas encore ouverts.',
  final_round_already_generated: 'La rotation de classement a déjà été lancée.',
  forfeited_match:               'Ce match a été soldé par un forfait.',
  invalid_court_count:           'Le nombre de terrains doit être un entier positif.',
  invalid_level_range:           'La plage de niveau n’est pas valable.',
  invalid_name:                  'Donne un nom à ce tournoi.',
  invalid_partner:               'Ce partenaire n’est pas valable.',
  invalid_points_scale:          'Le barème de points n’est pas valable : aucun rang ne peut recevoir un nombre négatif.',
  invalid_price:                 'Le prix affiché doit être un entier positif ou nul.',
  invalid_round_count:           'Le nombre de rotations doit être un entier positif.',
  invalid_score:                 'Ce score n’est pas valable.',
  invalid_side:                  'Choisis ton côté : gauche, droit, ou les deux.',
  invalid_starts_at:             'Indique une date de début valable.',
  match_not_found:               'Ce match est introuvable.',
  matches_already_generated:     'Les matchs sont déjà tirés : les binômes ne bougent plus.',
  no_complete_round:             'Aucune rotation n’est encore terminée.',
  no_dispute:                    'Il n’y a aucun désaccord à trancher sur ce match.',
  no_results:                    'Aucun résultat n’a encore été enregistré.',
  no_teams:                      'Aucun binôme n’est encore formé sur ce tournoi.',
  not_a_participant:             'Tu ne joues pas ce match.',
  not_authenticated:             'Reconnecte-toi pour continuer.',
  not_confirmed:                 'Ce score n’est pas encore confirmé par les deux camps.',
  not_enough_teams:              'Il n’y a pas assez de binômes pour lancer le tournoi.',
  not_in_team:                   'Tu n’as pas encore de binôme sur ce tournoi.',
  not_open_to_join:              'Ta demande est déjà partie : il faut son accord.',
  not_registered:                'Tu n’es pas inscrit à ce tournoi.',
  not_the_final_round:           'Ce n’est pas la rotation de classement.',
  not_the_organizer:             'Seul l’organisateur peut faire ça.',
  not_yet_the_final_round:       'Ce n’est pas encore la rotation de classement.',
  partner_already_registered:    'Ce joueur est déjà inscrit, ou déjà en binôme.',
  partner_not_found:             'Ce joueur est introuvable, ou il n’est pas inscrit à ce tournoi.',
  request_not_found:             'Cette demande n’existe plus.',
  round_already_generated:       'Cette rotation a déjà été tirée.',
  round_incomplete:              'La rotation en cours n’est pas terminée.',
  score_out_of_range:            'Ce score sort des valeurs autorisées.',
  team_not_found:                'Ce binôme est introuvable.',
  team_not_seated:               'Ce binôme n’a pas de place dans le tournoi.',
  tournament_not_finished:       'Le tournoi n’est pas encore terminé.',
  tournament_not_found:          'Ce tournoi est introuvable.',
  tournament_not_live:           'Le tournoi n’est pas en cours.',
  tournament_not_open:           'Les inscriptions sont fermées.',
  tournament_not_started:        'Le tournoi n’a pas encore commencé.',
  tournament_over:               'Toutes les rotations ont déjà été jouées.',
  waitlist_mismatch:             'Impossible : l’un de vous a sa place, l’autre est en liste d’attente.',
};

/** Le libellé français d'un refus serveur.
 *
 *  Une raison inconnue rend un texte GÉNÉRIQUE ET LISIBLE — jamais le code
 *  brut — et laisse une trace de développement : c'est ainsi qu'un refus
 *  ajouté côté serveur se signale, au lieu de s'afficher tel quel au joueur. */
export function reasonLabel(reason?: string | null): string {
  if (!reason) return GENERIC_REASON;
  const label = TOURNAMENT_REASONS[reason];
  if (label) return label;
  console.warn(`[tournois] refus serveur sans traduction : « ${reason} » — cf. lib/tournamentReasons.ts`);
  return GENERIC_REASON;
}

/** Vrai si la raison a une traduction. Utile aux tests et aux écrans qui
 *  veulent distinguer « refus connu » de « imprévu ». */
export function hasReasonLabel(reason: string): boolean {
  return Object.prototype.hasOwnProperty.call(TOURNAMENT_REASONS, reason);
}
