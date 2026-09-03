// TypeScript 6 refuse un import à effet de bord dont il ne connaît pas le type
// (`import '../global.css'` dans app/_layout.tsx, la feuille NativeWind).
//
// La déclaration ne vit pas dans `nativewind-env.d.ts` : ce fichier est généré
// par NativeWind et porte lui-même la consigne de ne pas l'éditer.
declare module '*.css';
