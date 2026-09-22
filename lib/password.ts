// lib/password.ts — ce qu'on exige d'un mot de passe, et pourquoi on le refuse.
//
// La règle était écrite deux fois et différemment : l'inscription activait son
// bouton à 6 caractères sous un champ qui annonçait « 8 caractères min. », et
// l'écran de changement exigeait 6. Trois chiffres pour une seule règle.
//
// Elle vit ici, une fois, et sert aussi bien à bloquer qu'à EXPLIQUER : un
// « mot de passe refusé » sans dire ce qui manque oblige à deviner.
//
// ⚠️ Supabase a le dernier mot côté serveur. Son minimum est réglé dans la
// console (Authentication → Policies) et doit rester ≤ PASSWORD_MIN, sinon
// l'app annonce une règle que le serveur n'applique pas — exactement le
// défaut qu'on corrige ici.

/** Longueur minimale. */
export const PASSWORD_MIN = 8;

/** Une exigence, telle qu'on l'affiche dans la liste sous le champ. */
export interface PasswordRule {
  key: 'length' | 'upper' | 'lower' | 'digit';
  /** Ce qu'on demande, à la deuxième personne. */
  label: string;
  ok: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { key: 'length', label: `${PASSWORD_MIN} caractères minimum`, ok: pw => pw.length >= PASSWORD_MIN },
  { key: 'upper', label: 'une majuscule', ok: pw => /[A-ZÀ-ÖØ-Þ]/.test(pw) },
  { key: 'lower', label: 'une minuscule', ok: pw => /[a-zà-öø-ÿ]/.test(pw) },
  { key: 'digit', label: 'un chiffre', ok: pw => /[0-9]/.test(pw) },
];

/** Les exigences NON satisfaites, dans l'ordre d'affichage. */
export function passwordProblems(pw: string): PasswordRule[] {
  return PASSWORD_RULES.filter(r => !r.ok(pw ?? ''));
}

/** Ce mot de passe est-il acceptable ? */
export function isPasswordValid(pw: string): boolean {
  return passwordProblems(pw).length === 0;
}

/**
 * La phrase qui dit CE QUI MANQUE, ou `null` si tout est bon.
 *
 * On énumère tout ce qui manque d'un coup : corriger un défaut pour en
 * découvrir un autre au tap suivant est le meilleur moyen de faire abandonner.
 */
export function passwordError(pw: string): string | null {
  const manques = passwordProblems(pw);
  if (manques.length === 0) return null;
  const noms = manques.map(r => r.label);
  const liste = noms.length === 1
    ? noms[0]
    : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
  return `Il manque ${liste}.`;
}

/**
 * Traduit un refus VENU DU SERVEUR.
 *
 * Supabase répond en anglais et de façon vague ; on ne relaie jamais son
 * message tel quel. Quand il refuse pour faiblesse, on redonne la règle
 * complète plutôt qu'un « choisis-en un plus long » qui n'aide pas.
 */
export function passwordServerError(message: string | null | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('different from the old')) {
    return 'Choisis un mot de passe différent de l’ancien.';
  }
  if (m.includes('password') && (m.includes('short') || m.includes('weak') || m.includes('least') || m.includes('requirements'))) {
    return `Mot de passe refusé : il faut ${PASSWORD_MIN} caractères minimum, une majuscule, une minuscule et un chiffre.`;
  }
  if (m.includes('same') && m.includes('password')) {
    return 'Choisis un mot de passe différent de l’ancien.';
  }
  return 'Impossible de mettre à jour le mot de passe. Réessaie.';
}

// ─── Changer son mot de passe depuis l'app ──────────────────────────────────

/**
 * Le changement passe TOUJOURS par un lien envoye par email, jamais par une
 * saisie directe dans l'app.
 *
 * Deux raisons : un telephone deverrouille laisse a un tiers suffit sinon a
 * prendre le compte, et l'email est le seul facteur qu'on sait deja verifie.
 * C'est exactement le circuit de « mot de passe oublie », declenche depuis
 * l'interieur, avec l'adresse du compte — on ne la redemande pas.
 *
 * ⚠️ Il depend de l'envoi d'emails d'authentification, aujourd'hui limite tant
 * que le SMTP dedie n'est pas en place : d'ou la traduction explicite du refus
 * pour depassement de quota, qui serait sinon incomprehensible.
 */
export function passwordResetSendError(message: string | null | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('rate limit') || m.includes('over_email_send_rate_limit') || m.includes('too many')) {
    return 'Trop de demandes en peu de temps. Patiente quelques minutes puis réessaie.';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Erreur de connexion. Vérifie ton réseau et réessaie.';
  }
  return "L'email n'a pas pu être envoyé. Réessaie dans un instant.";
}
