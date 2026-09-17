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
    plugins: ['./babel-plugin-text-scale-cap.js'],
  };
};
