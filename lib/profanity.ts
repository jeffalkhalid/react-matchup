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
    // Ponctuation de FIN de mot d'abord : sans ça « connard! » devient
    // « connardi » (le ! est lu comme un i leetspeak) et n'est plus reconnu.
    // Lookahead seulement, pas de lookbehind : sûr sur Hermes.
    .replace(/[!|]+(?=\s|$)/g, ' ')
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

// Lettres répétées écrasées à UNE seule : « salopeee » → « salope ».
// (normalize() n'en compacte que trois ou plus, et laisse donc « salopee ».)
const squeeze = (mot: string) => mot.replace(/(.)\1+/g, '$1');

/**
 * true si le texte contient une insulte.
 *
 * ⚠ On ne cherche PLUS un terme banni n'importe où dans le texte : « pute »
 * est contenu dans « disputé », « réputé », « amputé », et « Bravo ! Match très
 * disputé » était refusé. Un faux refus coûte plus cher qu'une insulte ratée :
 * ce filtre est CÔTÉ CLIENT (contournable de toute façon) et le signalement
 * prend le relais.
 *
 * La recherche accolée est donc réservée aux termes d'au moins 6 lettres, trop
 * longs pour apparaître par hasard dans un mot français.
 */
export function containsProfanity(text: string): boolean {
  const norm = normalize(text);
  if (!norm) return false;
  const mots = norm.split(' ').filter(Boolean);
  return BANNED.some((bad) => {
    const nb = normalize(bad);
    if (!nb) return false;
    // Mot isolé, pluriel simple, ou lettres étirées (« puuuute »).
    if (mots.some(m =>
      m === nb || m === nb + 's' || m === nb + 'es' || m === nb + 'x'
      || squeeze(m) === squeeze(nb)
    )) return true;
    // Accolé à un autre mot (« vasyconnard ») — termes longs uniquement.
    return nb.length >= 6 && norm.includes(nb);
  });
}
