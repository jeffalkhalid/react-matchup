module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    // Plafonne l'agrandissement de police système sur tous les <Text> et
    // <TextInput> (voir le fichier). Les plugins du projet passent AVANT ceux
    // des presets : l'attribut est donc posé sur le JSX avant sa transformation.
    plugins: [
      './babel-plugin-text-scale-cap.js',

      // En PRODUCTION uniquement : on retire les `console.log` du bundle.
      //
      // Pourquoi : les journaux du téléphone sont lisibles par n'importe quelle
      // application ayant la permission, et par quiconque branche le téléphone.
      // Or on y écrivait le jeton de notification en entier, la réponse brute
      // du serveur, et les identifiants des joueurs invités. C'est le constat
      // M2 de l'audit du 2026-09-21.
      //
      // `error` et `warn` sont CONSERVÉS : ce sont eux qui servent à
      // comprendre un plantage remonté par un joueur. Un message d'erreur ne
      // contient pas de secret ; un `console.log` de mise au point, si.
      ...(process.env.NODE_ENV === 'production'
        ? [['transform-remove-console', { exclude: ['error', 'warn'] }]]
        : []),
    ],
  };
};
