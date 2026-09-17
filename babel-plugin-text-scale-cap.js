// babel-plugin-text-scale-cap.js — plafonne l'agrandissement de police système
// sur TOUS les textes de l'app, au moment de la compilation.
//
// LE PROBLÈME. L'app ne limitait nulle part la taille de police réglée dans le
// téléphone. Beaucoup d'Android (Samsung en tête) l'agrandissent par défaut :
// chez nous, elle gonflait les 2 000+ textes sans limite — boutons tronqués
// (« TROUVER UN MATCH » → « TROUVER UN »), cartes qui débordent, écrans qui
// changent d'un téléphone à l'autre. Les autres apps posent un plafond.
//
// POURQUOI UN PLUGIN BABEL. La solution habituelle — `Text.defaultProps =
// { maxFontSizeMultiplier }` au démarrage — est un NO-OP ici : dans React
// Native 0.86, `Text` est un composant fonction, et React 19 ignore
// `defaultProps` sur les fonctions, sans erreur ni avertissement. Plafonner
// côté natif Android ne couvrirait que l'APK (ni Expo Go, ni iPhone). Remplacer
// `Text` dans 138 fichiers serait une refonte à haut risque. Ce plugin ajoute
// l'attribut à la compilation : un seul fichier, toutes les plateformes.
//
// CE QU'IL FAIT. Dans chaque fichier, il repère `Text` et `TextInput` IMPORTÉS
// DE 'react-native' (sous leur nom local, alias compris) et ajoute
// `maxFontSizeMultiplier={CAP}` à chaque élément JSX qui ne le fixe pas déjà.
//
// L'attribut est inséré EN PREMIER : un `maxFontSizeMultiplier` explicite ou un
// `{...props}` placé après le remplace. Un écran qui a besoin d'une autre
// valeur la pose lui-même, et c'est elle qui gagne.
//
// ACCESSIBILITÉ, ASSUMÉ. Un utilisateur qui agrandit sa police garde un texte
// plus grand — jusqu'à ×1,1 — mais pas au point de casser la mise en page.
// Le réglage vit ici, à un seul endroit. Abaissé de 1,25 à 1,1 le 2026-09-15 :
// à 1,25, des titres débordaient sur des écrans Android étroits.

const CAP = 1.1;
const CIBLES = new Set(['Text', 'TextInput']);

module.exports = function textScaleCap({ types: t }) {
  return {
    name: 'pagmatch-text-scale-cap',
    pre() {
      this.nomsLocaux = new Set();
    },
    visitor: {
      ImportDeclaration(path) {
        if (path.node.source.value !== 'react-native') return;
        for (const s of path.node.specifiers) {
          if (t.isImportSpecifier(s) && t.isIdentifier(s.imported) && CIBLES.has(s.imported.name)) {
            this.nomsLocaux.add(s.local.name);
          }
        }
      },
      JSXOpeningElement(path) {
        const nom = path.node.name;
        if (!t.isJSXIdentifier(nom) || !this.nomsLocaux.has(nom.name)) return;
        const dejaFixe = path.node.attributes.some(
          a => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name)
            && a.name.name === 'maxFontSizeMultiplier',
        );
        if (dejaFixe) return;
        path.node.attributes.unshift(
          t.jsxAttribute(
            t.jsxIdentifier('maxFontSizeMultiplier'),
            t.jsxExpressionContainer(t.numericLiteral(CAP)),
          ),
        );
      },
    },
  };
};

module.exports.CAP = CAP;
