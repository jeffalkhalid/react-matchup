// Filtre de gros mots/insultes — base FR + darija (translittérée).
// Volontairement court : c'est une base de lancement, à enrichir selon le terrain.
// Côté client uniquement : sert au refus instantané avant l'appel RPC.

const BANNED = [
  // FR
  'connard', 'connasse', 'salope', 'pute', 'putain', 'enculé', 'enculer',
  'pd', 'pédé', 'tapette', 'batard', 'batarde', 'ntm', 'fdp', 'merde',
  'bouffon', 'abruti', 'debile', 'cretin',
  // darija / arabe translittéré
  'zamel', 'qahba', 'kahba', '9ahba', 'khra', '5ra', 'nik', 'niquer',
  'tabon', 'hmar', '7mar', 'mok', 'kelb',
];

// Normalise : minuscules, sans accents, leetspeak basique, lettres répétées compactées.
export function normalize(text: string): string {
  return text
    .toLowerCase()
    // accents -> base (caractères précomposés, sûrs sur Hermes)
    .replace(/[áàâäã]/g, 'a').replace(/[éèêë]/g, 'e').replace(/[íìîï]/g, 'i')
    .replace(/[óòôöõ]/g, 'o').replace(/[úùûü]/g, 'u').replace(/ç/g, 'c')
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 'h')
    .replace(/9/g, 'q')
    .replace(/\$/g, 's')
    .replace(/(.)\1{2,}/g, '$1$1') // "puuuute" -> "puute"
    .replace(/[^a-z\s]/g, ' ')     // ponctuation -> espace
    .replace(/\s+/g, ' ')
    .trim();
}

// true si le texte contient un terme banni (match sur mots normalisés).
export function containsProfanity(text: string): boolean {
  const norm = normalize(text);
  if (!norm) return false;
  const words = new Set(norm.split(' '));
  return BANNED.some((bad) => {
    const nb = normalize(bad);
    // mot isolé OU sous-chaîne accolée (ex: "vasympute")
    return words.has(nb) || norm.includes(nb);
  });
}
