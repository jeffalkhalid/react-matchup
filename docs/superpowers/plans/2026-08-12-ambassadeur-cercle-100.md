# Ambassadeur « Cercle des 100 » — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner aux 100 premiers inscrits de PagMatch un statut « Ambassadeur » à vie : numéro de membre N°001–N°100, anneau + laurier or sur l'avatar (profil, listes, accueil), carte membre collector, overlay de révélation animé à la visite du profil, écran de révélation au premier lancement, et story partageable.

**Architecture:** Une colonne matérialisée `players.member_number` (migration SQL manuelle, jamais réattribuée) exposée automatiquement par les `select('*')` existants. Côté client, un petit module `lib/ambassador.ts` (prédicat + formatage) et une famille de composants `components/ambassador/` (SVG laurier/médaillon, anneau, chip, carte membre, overlay) branchés dans les écrans existants sans en changer la structure. Tout dégrade proprement tant que la migration n'est pas appliquée (`member_number` absent → aucun traitement ambassadeur).

**Tech Stack:** React Native / Expo Router, `react-native-svg` (déjà utilisé partout), `Animated` du core RN (pattern du repo — PAS reanimated), Supabase (`players`), AsyncStorage, `react-native-view-shot` + `expo-sharing` (système de stories existant).

## Global Constraints

- Repo : `c:\Users\jeffa\Bureau\Native\react-matchup`, travail **direct sur `main`**, changements **additifs et réversibles**. **AUCUN commit automatique** — l'utilisateur committe lui-même ou le demande explicitement. Ne jamais `git push`.
- La migration SQL est **écrite mais PAS appliquée** (l'utilisateur l'applique à la main dans le SQL Editor Supabase). Tout le code client doit fonctionner sans elle (`member_number` `undefined` → UI inchangée).
- La table de profil s'appelle **`players`** (il n'existe pas de table `profiles`).
- Couleurs : réutiliser `Colors.brand` `#FFC11A`, `Colors.brandDeep` `#E8A906`, `Colors.brandBright` `#FFD23F`, `PM.ink` `#0A0A0A`. Les teintes propres au concept (copiées du prototype) sont centralisées dans `AMB` de `lib/ambassador.ts` : `#16110A`, `#C98F08`, `#B8860B`, `#141010`, `#060607`, `#1C1C1E`, `#1C1710`.
- Polices (déjà chargées, `lib/theme.ts:54-63`) : `Fonts.display` = Anton (chiffres/logos), `Fonts.welcome` = BarlowCondensed_900Black_Italic (titres/noms), `Fonts.uiBlack/uiExtraBold/uiBold/uiSemi` = Inter 900/800/700/600.
- **Titres en `Fonts.welcome` sur Android** : toujours `numberOfLines={1}` (ou `{2}` si multi-ligne prévu) + `adjustsFontSizeToFit` + un `paddingRight` de quelques px, sinon l'italique est rognée (règle projet).
- Animations : `Animated` du core RN avec `useNativeDriver: true` (modèle : `components/AnimatedSplash.tsx`). Pas de reanimated.
- Formats du numéro : padded `N°042` (carte, pill, chip, overlay — via `formatMemberNumber`) ; brut `N°42` (plaque sous avatar, sceau accueil — via `formatMemberNumberShort`).
- Vérification de chaque tâche : `npx tsc --noEmit` depuis la racine du repo (pas de framework de test JS dans ce repo ; la vérification visuelle sur device est listée mais différée au rebuild).
- Le glyphe couronne est le path existant de `components/CreatorCrownBadge.tsx` : `M3 8.5 6.5 12l3-5 2.5 4 2.5-4 3 5L21 8.5 19 19H5L3 8.5z` (viewBox 24×24). Le prototype l'utilise pour la pill, le badge de liste et le médaillon — le réutiliser à l'identique.
- Hors périmètre (décisions notées) : la carte « Accès anticipé : classements par club » du prototype accueil (la feature n'existe pas) ; le traitement du podium de `/ranking` (le handoff ne couvre que les lignes de liste) ; l'overlay se rejoue **à chaque visite** (chaque montage de l'écran profil) — le produit tranchera plus tard s'il faut le limiter.

---

### Task 1: Data — migration SQL, type Player, module lib/ambassador

**Files:**
- Create: `supabase/migrations/ambassador_member_number.sql`
- Create: `lib/ambassador.ts`
- Modify: `types/index.ts` (interface `Player`, ~l.15-46)

**Interfaces:**
- Consumes: rien (première tâche).
- Produces: colonne `players.member_number` (int, 1-100, unique, nullable) ; `Player.member_number?: number | null` ; `lib/ambassador.ts` exporte `AMBASSADOR_LIMIT: number`, `AMB` (tokens couleur), `isAmbassador(p?: { member_number?: number | null } | null): boolean`, `formatMemberNumber(n: number): string` (→ `N°042`), `formatMemberNumberShort(n: number): string` (→ `N°42`), `memberSinceLabel(createdAt?: string | null): string` (→ `mars 2026`), `issuedLabel(createdAt?: string | null): string` (→ `ÉMISE 03.2026`), `fetchAmbassadorsCount(): Promise<number | null>`.

- [ ] **Step 1: Écrire la migration**

Créer `supabase/migrations/ambassador_member_number.sql` (convention du repo : nom descriptif sans timestamp, cartouche, `BEGIN/COMMIT`, bloc ROLLBACK final) :

```sql
-- =====================================================================
-- AMBASSADEUR « CERCLE DES 100 » — numéro de membre à vie
--
-- Contexte : les 100 premiers inscrits reçoivent un statut Ambassadeur
--   permanent (N°001 à N°100) affiché dans l'app (profil, listes,
--   accueil, carte membre, story).
-- Principe : colonne matérialisée players.member_number, attribuée une
--   seule fois et JAMAIS réattribuée (même si le compte est supprimé).
--   Backfill des comptes actifs existants par ordre d'inscription
--   (created_at), puis trigger BEFORE INSERT pour les prochains
--   inscrits, jusqu'à épuisement des 100 places.
-- Lecture : couverte par la policy players_select (USING true) —
--   aucun changement RLS nécessaire. Écriture uniquement via trigger.
-- Déploiement : appliquer ce fichier tel quel dans le SQL Editor.
--   Le client dégrade proprement tant que la migration n'est pas
--   appliquée (member_number absent → aucun traitement ambassadeur).
-- Idempotence : rejouable (IF NOT EXISTS / OR REPLACE / garde sur
--   member_number IS NULL au backfill).
-- =====================================================================
BEGIN;

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS member_number integer
    UNIQUE
    CHECK (member_number BETWEEN 1 AND 100);

-- Backfill : comptes actifs existants, par ordre d'inscription.
WITH base AS (
  SELECT COALESCE(MAX(member_number), 0) AS max_no FROM public.players
),
ranked AS (
  SELECT p.id, ROW_NUMBER() OVER (ORDER BY p.created_at, p.id) AS rn
  FROM public.players p
  WHERE p.deleted_at IS NULL AND p.member_number IS NULL
)
UPDATE public.players p
SET member_number = ranked.rn + base.max_no
FROM ranked, base
WHERE p.id = ranked.id
  AND ranked.rn + base.max_no <= 100;

-- Attribution automatique pour les prochains inscrits (fiche players
-- créée par handle_new_user à la confirmation d'email).
CREATE OR REPLACE FUNCTION public.assign_member_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_no integer;
BEGIN
  -- Sérialise les inserts concurrents le temps de la transaction,
  -- sinon deux inscriptions simultanées liraient le même MAX().
  PERFORM pg_advisory_xact_lock(hashtext('players.member_number'));
  SELECT COALESCE(MAX(member_number), 0) + 1 INTO next_no FROM public.players;
  IF next_no <= 100 THEN
    NEW.member_number := next_no;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_member_number ON public.players;
CREATE TRIGGER trg_assign_member_number
  BEFORE INSERT ON public.players
  FOR EACH ROW
  WHEN (NEW.member_number IS NULL)
  EXECUTE FUNCTION public.assign_member_number();

COMMIT;

-- ROLLBACK :
-- DROP TRIGGER IF EXISTS trg_assign_member_number ON public.players;
-- DROP FUNCTION IF EXISTS public.assign_member_number();
-- ALTER TABLE public.players DROP COLUMN IF EXISTS member_number;
```

- [ ] **Step 2: Ajouter le champ au type Player**

Dans `types/index.ts`, interface `Player`, ajouter après `created_at: string;` :

```ts
  member_number?: number | null; // Ambassadeur « Cercle des 100 » : rang d'inscription 1-100, à vie
```

- [ ] **Step 3: Créer lib/ambassador.ts**

```ts
// Statut Ambassadeur « Cercle des 100 » : les 100 premiers inscrits.
// Source de vérité unique du prédicat et des formats — ne jamais tester
// member_number à la main dans les écrans.
import { supabase } from './supabase';

export const AMBASSADOR_LIMIT = 100;

// Teintes propres au concept Ambassadeur (prototype design_handoff_ambassadeur).
// L'or de base reste Colors.brand / brandDeep / brandBright.
export const AMB = {
  gold: '#FFC11A',
  goldDeep: '#E8A906',
  goldBright: '#FFD23F',
  goldDark: '#C98F08',   // bas du dégradé du numéro de carte
  chipText: '#B8860B',   // texte du chip N°xxx sur fond clair
  inkWarm: '#16110A',    // noir chaud des fonds ambassadeur
  inkCard: '#1C1C1E',    // haut du dégradé de la carte membre
  inkCardWarm: '#1C1710',// haut du dégradé de la carte Stats
  inkDeep: '#060607',    // bas des dégradés sombres
  medallionBg: '#141010',// fond du cercle central du médaillon
  line35: 'rgba(255,193,26,0.35)',
  line45: 'rgba(255,193,26,0.45)',
} as const;

export function isAmbassador(p?: { member_number?: number | null } | null): boolean {
  return p?.member_number != null && p.member_number >= 1 && p.member_number <= AMBASSADOR_LIMIT;
}

/** « N°042 » — carte, pill, chip, overlay. */
export function formatMemberNumber(n: number): string {
  return 'N°' + String(n).padStart(3, '0');
}

/** « N°42 » — plaque sous l'avatar, sceau accueil. */
export function formatMemberNumberShort(n: number): string {
  return 'N°' + n;
}

/** « mars 2026 » */
export function memberSinceLabel(createdAt?: string | null): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

/** « ÉMISE 03.2026 » */
export function issuedLabel(createdAt?: string | null): string {
  if (!createdAt) return '';
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `ÉMISE ${mm}.${d.getFullYear()}`;
}

/** Nombre de places attribuées (null si indisponible — migration pas appliquée, offline…). */
export async function fetchAmbassadorsCount(): Promise<number | null> {
  try {
    const { count, error } = await supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .not('member_number', 'is', null);
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.
NE PAS appliquer la migration (action manuelle utilisateur, à rappeler dans le récap final).

---

### Task 2: Primitives SVG + anneau + chip + pill (components/ambassador/primitives.tsx)

**Files:**
- Create: `components/ambassador/primitives.tsx`

**Interfaces:**
- Consumes: `AMB`, `formatMemberNumber`, `formatMemberNumberShort` (Task 1) ; `Fonts` de `lib/theme`.
- Produces:
  - `CROWN_PATH: string` (path couronne 24×24, identique à CreatorCrownBadge)
  - `LaurelWreath({ width?: number; color?: string })` — laurier plat, viewBox `0 0 96 30`, défaut width 72
  - `LaurelMedallion({ width?: number; doubleRing?: boolean; innerFill?: string })` — médaillon, viewBox `0 0 140 70`, défaut width 60
  - `AmbassadorRing({ size: number; radius: number; surface?: string; showStar?: boolean; children })` — anneau fin de liste + badge couronne 13px bas-droite
  - `AmbassadorChip({ number: number })` — chip « N°042 » pour fonds clairs
  - `AmbassadorPill({ number: number })` — pill pleine « AMBASSADEUR N°042 » du header profil
  - `NumberPlate({ number: number })` — plaque « N°42 » sous le laurier

- [ ] **Step 1: Écrire le fichier**

```tsx
// Primitives visuelles du statut Ambassadeur « Cercle des 100 ».
// Les paths laurier/médaillon viennent du prototype (design_handoff_ambassadeur)
// et doivent rester identiques partout — c'est la signature de la marque.
import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { AMB, formatMemberNumber, formatMemberNumberShort } from '../../lib/ambassador';

export const CROWN_PATH = 'M3 8.5 6.5 12l3-5 2.5 4 2.5-4 3 5L21 8.5 19 19H5L3 8.5z';

const FLAT_LEAVES = [
  'M38 27 Q28 28 21 22 Q30 18 38 27z',
  'M32 20 Q22 19 17 11 Q27 10 32 20z',
  'M29 12 Q21 8 20 1 Q29 3 29 12z',
];
const MEDALLION_BRANCH =
  'M55 60 Q35 62 25 50 Q38 48 44 56 Q32 52 26 40 Q40 40 46 50 Q34 42 32 28 Q44 32 48 44z';

/** Couronne de laurier plate, drapée sous l'avatar. viewBox 0 0 96 30. */
export function LaurelWreath({ width = 72, color = AMB.gold }: { width?: number; color?: string }) {
  const height = Math.round(width * (30 / 96));
  const leaves = FLAT_LEAVES.map((d, i) => (
    <Path key={i} d={d} opacity={i === 2 ? 0.85 : 1} />
  ));
  return (
    <Svg width={width} height={height} viewBox="0 0 96 30" pointerEvents="none">
      <G fill={color}>
        {leaves}
        <G transform="translate(96,0) scale(-1,1)">{leaves}</G>
      </G>
    </Svg>
  );
}

/** Médaillon laurier (deux branches + cercle + couronne). viewBox 0 0 140 70. */
export function LaurelMedallion({
  width = 60,
  doubleRing = false,
  innerFill = AMB.medallionBg,
}: { width?: number; doubleRing?: boolean; innerFill?: string }) {
  const height = Math.round(width / 2);
  return (
    <Svg width={width} height={height} viewBox="0 0 140 70" pointerEvents="none">
      <G fill={AMB.gold}><Path d={MEDALLION_BRANCH} /></G>
      <G fill={AMB.gold} transform="translate(140,0) scale(-1,1)"><Path d={MEDALLION_BRANCH} /></G>
      {doubleRing ? (
        <>
          <Circle cx={70} cy={35} r={23} fill={innerFill} stroke="rgba(255,193,26,0.4)" strokeWidth={7} />
          <Circle cx={70} cy={35} r={22} fill={innerFill} stroke={AMB.gold} strokeWidth={3} />
        </>
      ) : (
        <Circle cx={70} cy={35} r={21} fill={innerFill} stroke={AMB.gold} strokeWidth={3} />
      )}
      <G transform="translate(58,23)" fill={AMB.gold}><Path d={CROWN_PATH} /></G>
    </Svg>
  );
}

/**
 * Anneau or fin autour d'un avatar de liste + badge couronne en bas-droite.
 * Ne remplace pas le traitement de ligue : l'avatar enfant reste intact
 * À L'INTÉRIEUR de l'anneau. `surface` = couleur du fond de la ligne,
 * pour détourer le badge (même principe que CreatorCrownBadge.ringColor).
 */
export function AmbassadorRing({
  size, radius, surface = '#FFFFFF', showStar = true, children,
}: {
  size: number; radius: number; surface?: string; showStar?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={{ position: 'relative', alignSelf: 'flex-start' }}>
      <View style={{
        borderWidth: 1.5, borderColor: 'rgba(232,169,6,0.9)',
        borderRadius: Math.min(radius + 3.5, (size + 7) / 2), padding: 2,
      }}>
        {children}
      </View>
      {showStar && (
        <View style={{
          position: 'absolute', bottom: -3, right: -3,
          width: 13, height: 13, borderRadius: 999,
          backgroundColor: AMB.gold, borderWidth: 1.5, borderColor: surface,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Svg width={7} height={7} viewBox="0 0 24 24">
            <Path d={CROWN_PATH} fill="#0A0A0A" />
          </Svg>
        </View>
      )}
    </View>
  );
}

/** Chip « N°042 » à côté du nom, pour fonds clairs (listes). */
export function AmbassadorChip({ number }: { number: number }) {
  return (
    <View style={{
      backgroundColor: 'rgba(255,193,26,0.14)', borderWidth: 1,
      borderColor: 'rgba(232,169,6,0.5)', borderRadius: 999,
      paddingHorizontal: 7, paddingVertical: 2.5,
    }}>
      <Text style={{
        fontFamily: Fonts.uiBlack, fontSize: 8.5, letterSpacing: 0.8, color: AMB.chipText,
      }}>
        {formatMemberNumber(number)}
      </Text>
    </View>
  );
}

/** Pill pleine « AMBASSADEUR N°042 » (header profil). */
export function AmbassadorPill({ number }: { number: number }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: AMB.gold, borderRadius: 999,
      paddingHorizontal: 9, paddingVertical: 3.5,
    }}>
      <Svg width={11} height={11} viewBox="0 0 24 24">
        <Path d={CROWN_PATH} fill="#0A0A0A" />
      </Svg>
      <Text style={{
        fontFamily: Fonts.uiBlack, fontSize: 9.5, letterSpacing: 0.6, color: '#0A0A0A',
      }}>
        AMBASSADEUR {formatMemberNumber(number)}
      </Text>
    </View>
  );
}

/** Plaque « N°42 » (pilule noire bord or, sous le laurier de l'avatar profil). */
export function NumberPlate({ number }: { number: number }) {
  return (
    <View style={{
      backgroundColor: '#0A0A0A', borderWidth: 1.5, borderColor: AMB.gold,
      borderRadius: 999, paddingHorizontal: 9, paddingVertical: 1.5,
      alignSelf: 'center',
    }}>
      <Text style={{ fontFamily: Fonts.display, fontSize: 11, color: AMB.gold }}>
        {formatMemberNumberShort(number)}
      </Text>
    </View>
  );
}
```

- [ ] **Step 2: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.

---

### Task 3: Fonds & carte membre (backdrops.tsx + MemberCard.tsx)

**Files:**
- Create: `components/ambassador/backdrops.tsx`
- Create: `components/ambassador/MemberCard.tsx`

**Interfaces:**
- Consumes: `AMB`, `formatMemberNumber`, `LaurelMedallion` ; `Fonts` de `lib/theme` ; asset `assets/auth/splash-racket.png`.
- Produces:
  - `Guilloche({ opacity?: number; gap?: number })` — texture guillochée absolute-fill (lignes diagonales or ~115°)
  - `DarkGoldBackdrop({ radius: number; from?: string; to?: string; glowAt?: 'topRight' | 'topLeft' | 'top' })` — absolute-fill : dégradé linéaire sombre + halo radial or
  - `GoldGradientNumber({ number: number; fontSize: number })` — numéro « N°042 » en dégradé or (Svg Text)
  - `MemberCard({ width: number; name: string; number: number; issued: string; compact?: boolean })` — la carte membre collector (le rotate est appliqué PAR L'APPELANT)

- [ ] **Step 1: Écrire backdrops.tsx**

```tsx
// Fonds « ambassadeur » : équivalents RN des gradients CSS du prototype.
// Tout est en react-native-svg (pas d'expo-linear-gradient dans le repo).
import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, {
  Defs, LinearGradient, Line, RadialGradient, Rect, Stop, Text as SvgText,
} from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { AMB, formatMemberNumber } from '../../lib/ambassador';

let uid = 0;

/** Texture guillochée : fines lignes or diagonales (~115°), très faibles. */
export function Guilloche({ opacity = 0.045, gap = 7 }: { opacity?: number; gap?: number }) {
  const SIZE = 400;
  const lines: React.ReactNode[] = [];
  for (let x = -SIZE; x < SIZE; x += gap) {
    lines.push(
      <Line key={x} x1={x} y1={0} x2={x + SIZE * 0.47} y2={SIZE}
        stroke={AMB.gold} strokeWidth={1} strokeOpacity={opacity} />
    );
  }
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${SIZE} ${SIZE}`} preserveAspectRatio="xMidYMid slice">
      {lines}
    </Svg>
  );
}

/** Dégradé sombre + halo or radial, en absolute fill (poser sous le contenu). */
export function DarkGoldBackdrop({
  radius, from = AMB.inkCard, to = AMB.inkDeep, glowAt = 'topRight',
}: { radius: number; from?: string; to?: string; glowAt?: 'topRight' | 'topLeft' | 'top' }) {
  const id = `agb${uid++}`;
  const glow = glowAt === 'topRight' ? { cx: '85%', cy: '0%' }
    : glowAt === 'topLeft' ? { cx: '12%', cy: '0%' }
    : { cx: '50%', cy: '0%' };
  return (
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id={`${id}-lin`} x1="0" y1="0" x2="0.35" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
        <RadialGradient id={`${id}-rad`} cx={glow.cx} cy={glow.cy} rx="90%" ry="70%">
          <Stop offset="0" stopColor={AMB.gold} stopOpacity={0.18} />
          <Stop offset="0.6" stopColor={AMB.gold} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" rx={radius} fill={`url(#${id}-lin)`} />
      <Rect x={0} y={0} width="100%" height="100%" rx={radius} fill={`url(#${id}-rad)`} />
    </Svg>
  );
}

/** Numéro « N°042 » en dégradé or vertical (Anton). */
export function GoldGradientNumber({ number, fontSize }: { number: number; fontSize: number }) {
  const id = `agn${uid++}`;
  const label = formatMemberNumber(number);
  // Largeur générique Anton ≈ 0.62em/caractère — marge incluse.
  const width = Math.ceil(label.length * fontSize * 0.62) + 8;
  const height = Math.ceil(fontSize * 1.05);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0.05" stopColor="#FFE9A8" />
          <Stop offset="0.45" stopColor={AMB.gold} />
          <Stop offset="0.95" stopColor={AMB.goldDark} />
        </LinearGradient>
      </Defs>
      <SvgText x={0} y={fontSize * 0.88} fill={`url(#${id})`}
        fontFamily={Fonts.display} fontSize={fontSize}>
        {label}
      </SvgText>
    </Svg>
  );
}
```

- [ ] **Step 2: Écrire MemberCard.tsx**

Base design 352 pt de large (prototype) ; tout est multiplié par `s = width / 352`. `compact` = variante story (paddings resserrés, pas de pied de carte).

```tsx
// Carte membre collector « Cercle des 100 » — noir & or, guillochée,
// filigrane raquette. Utilisée par la révélation (Task 8) et la story
// (Task 7). L'inclinaison (rotate) est appliquée par l'appelant.
import React from 'react';
import { Image, Text, View } from 'react-native';
import { Fonts } from '../../lib/theme';
import { AMB } from '../../lib/ambassador';
import { DarkGoldBackdrop, GoldGradientNumber, Guilloche } from './backdrops';
import { LaurelMedallion } from './primitives';

export function MemberCard({
  width, name, number, issued, compact = false,
}: { width: number; name: string; number: number; issued: string; compact?: boolean }) {
  const s = width / 352;
  const radius = (compact ? 20 : 24) * s;
  const pad = (compact ? 18 : 22) * s;
  return (
    <View style={{
      width, borderRadius: radius, overflow: 'hidden',
      borderWidth: 1, borderColor: AMB.line45,
      // Ombre iOS ; sur Android l'elevation projette une ombre noire correcte.
      shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 27 * s,
      shadowOffset: { width: 0, height: 13 * s }, elevation: 12,
      backgroundColor: AMB.inkDeep,
    }}>
      <DarkGoldBackdrop radius={radius} glowAt="topRight" />
      <Guilloche />
      <Image
        source={require('../../assets/auth/splash-racket.png')}
        style={{
          position: 'absolute', right: -28 * s, bottom: -32 * s,
          width: 150 * s, height: 150 * s, opacity: 0.08,
          transform: [{ rotate: '-15deg' }],
        }}
        resizeMode="contain"
      />
      <View style={{ padding: pad, paddingBottom: (compact ? 14 : 18) * s }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: (compact ? 12 : 18) * s,
        }}>
          <Text style={{
            fontFamily: Fonts.display, fontSize: (compact ? 11 : 13) * s,
            letterSpacing: 2 * s, color: '#FFFFFF',
          }}>
            PAGMATCH
          </Text>
          <LaurelMedallion width={(compact ? 42 : 54) * s} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 * s }}>
          <GoldGradientNumber number={number} fontSize={(compact ? 42 : 58) * s} />
          <Text style={{
            fontFamily: Fonts.display, fontSize: (compact ? 15 : 20) * s,
            color: 'rgba(255,193,26,0.45)', marginBottom: 4 * s,
          }}>
            /100
          </Text>
        </View>
        <Text
          numberOfLines={1} adjustsFontSizeToFit
          style={{
            fontFamily: Fonts.welcome, fontSize: (compact ? 18 : 23) * s,
            color: '#FFFFFF', marginTop: (compact ? 6 : 8) * s,
            marginBottom: compact ? 0 : 16 * s, paddingRight: 6,
          }}>
          {name}
        </Text>
        {!compact && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            borderTopWidth: 1, borderTopColor: 'rgba(255,193,26,0.22)', paddingTop: 12 * s,
          }}>
            <Text style={{
              fontFamily: Fonts.uiBlack, fontSize: 9 * s, letterSpacing: 1.5 * s,
              color: 'rgba(255,255,255,0.55)',
            }}>
              MEMBRE FONDATEUR
            </Text>
            <Text style={{
              fontFamily: Fonts.uiBlack, fontSize: 9 * s, letterSpacing: 1.5 * s,
              color: AMB.goldDeep,
            }}>
              {issued}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.
Note pour la vérif device ultérieure : si `GoldGradientNumber` ne rend pas la police Anton sur Android (limite connue des polices custom dans les `<Text>` SVG), fallback prévu : remplacer par un `<Text>` RN `fontFamily: Fonts.display, color: AMB.gold` — dégradé abandonné, hifi approché.

---

### Task 4: Profil — avatar laurier, pill, carte Stats, header doré

**Files:**
- Modify: `components/profile/components.tsx` (`ProfileHeader`, signature l.470-481, avatar l.519-521, rangée pills l.524-540, conteneur l.485)
- Modify: `components/profile/tabs.tsx` (`StatsTab`, signature l.17-25, corps l.40+)
- Modify: `app/player/[id].tsx` (passage des props, rendu `ProfileHeader` l.1280-1303 et `StatsTab` l.1305-1313)

**Interfaces:**
- Consumes: `isAmbassador`, `formatMemberNumber`, `memberSinceLabel`, `AMB` (Task 1) ; `LaurelWreath`, `NumberPlate`, `AmbassadorPill`, `LaurelMedallion` (Task 2) ; `Guilloche`, `DarkGoldBackdrop` (Task 3).
- Produces: `ProfileHeader` accepte `ambassador?: number | null` (numéro de membre) ; `StatsTab` accepte `ambassador?: { number: number; since: string } | null` et `onShareCard?: () => void`.

- [ ] **Step 1: ProfileHeader — prop + fond doré**

Dans `components/profile/components.tsx` :
- Ajouter à la signature de `ProfileHeader` : `ambassador?: number | null;`.
- Imports : `import { LaurelWreath, NumberPlate, AmbassadorPill } from '../ambassador/primitives';` et `import { Guilloche } from '../ambassador/backdrops';` et `import { AMB } from '../../lib/ambassador';` et `Svg, { Defs, LinearGradient as SvgLinearGradient, RadialGradient, Rect, Stop }` si pas déjà importés.
- Sur le conteneur racine du header (l.485, `backgroundColor: PM.ink`), quand `ambassador` est truthy ajouter `borderBottomWidth: 1, borderBottomColor: AMB.line35` au style, et insérer en premier enfant un fond absolu (avant la barre logo) :

```tsx
{ambassador != null && (
  <>
    <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Defs>
        <SvgLinearGradient id="ambHdr" x1="0" y1="0" x2="0" y2="0.7">
          <Stop offset="0" stopColor={AMB.inkWarm} />
          <Stop offset="1" stopColor={PM.ink} />
        </SvgLinearGradient>
        <RadialGradient id="ambHdrGlow" cx="80%" cy="0%" rx="95%" ry="80%">
          <Stop offset="0" stopColor={AMB.gold} stopOpacity={0.13} />
          <Stop offset="0.6" stopColor={AMB.gold} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#ambHdr)" />
      <Rect width="100%" height="100%" fill="url(#ambHdrGlow)" />
    </Svg>
    <Guilloche opacity={0.03} gap={8} />
  </>
)}
```

- [ ] **Step 2: ProfileHeader — avatar anneau + laurier + plaque**

Remplacer le bloc avatar inline (l.519-521 : `View 72×72 borderRadius:36 bg ACCENT borderWidth:3 borderColor PM.inkSoft` + initiales Anton 30). Version conditionnelle :

```tsx
{ambassador != null ? (
  <View style={{ position: 'relative', paddingBottom: 15, alignSelf: 'flex-start' }}>
    <View style={{
      borderWidth: 2, borderColor: AMB.gold, borderRadius: 999, padding: 3,
      shadowColor: AMB.gold, shadowOpacity: 0.3, shadowRadius: 24,
      shadowOffset: { width: 0, height: 0 },
    }}>
      <View style={{
        width: 72, height: 72, borderRadius: 36, backgroundColor: ACCENT,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Text style={{ fontFamily: PFonts.anton, fontSize: 30, lineHeight: 39, color: PM.ink }}>
          {initials(name)}
        </Text>
      </View>
    </View>
    <View style={{ position: 'absolute', bottom: 6, left: 0, right: 0, alignItems: 'center' }}>
      <LaurelWreath width={78} />
    </View>
    <View style={{ position: 'absolute', bottom: -7, left: 0, right: 0, alignItems: 'center' }}>
      <NumberPlate number={ambassador} />
    </View>
  </View>
) : (
  /* bloc avatar existant inchangé */
)}
```

- [ ] **Step 3: ProfileHeader — pill AMBASSADEUR**

Dans la rangée de pills (l.524-540), après la pill FRMT conditionnelle (l.533-539), ajouter :

```tsx
{ambassador != null && <AmbassadorPill number={ambassador} />}
```

- [ ] **Step 4: StatsTab — carte « Cercle des 100 »**

Dans `components/profile/tabs.tsx` :
- Signature : ajouter `ambassador?: { number: number; since: string } | null;` et `onShareCard?: () => void;`.
- Imports : `LaurelMedallion` (primitives), `Guilloche`, `DarkGoldBackdrop` (backdrops), `AMB, formatMemberNumber` (lib/ambassador), `TouchableOpacity` de react-native si absent.
- En tout premier enfant du `<View style={{ gap: 14 }}>` (l.40), AVANT la Section « Évolution du niveau » :

```tsx
{ambassador && (
  <View style={{ gap: 9 }}>
    <View style={{
      flexDirection: 'row', alignItems: 'baseline',
      justifyContent: 'space-between', paddingHorizontal: 2,
    }}>
      <Text style={{
        fontFamily: PFonts.uiBlack, fontSize: 11, color: PM.text,
        letterSpacing: 1, textTransform: 'uppercase',
      }}>
        Cercle des 100
      </Text>
      <Text style={{ fontFamily: PFonts.uiBold, fontSize: 11, color: PM.muted }}>
        {formatMemberNumber(ambassador.number)} / 100
      </Text>
    </View>
    <View style={{
      borderWidth: 1, borderColor: AMB.line45, borderRadius: 18,
      overflow: 'hidden', backgroundColor: AMB.inkDeep,
    }}>
      <DarkGoldBackdrop radius={18} from={AMB.inkCardWarm} to="#08080A" glowAt="topLeft" />
      <Guilloche opacity={0.035} gap={8} />
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 15, paddingHorizontal: 16,
      }}>
        <LaurelMedallion width={60} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{
            fontFamily: PFonts.uiBlack, fontSize: 8.5, letterSpacing: 1.8, color: AMB.gold,
          }}>
            CERCLE DES 100
          </Text>
          <Text
            numberOfLines={1} adjustsFontSizeToFit
            style={{
              fontFamily: PFonts.barlow, fontSize: 22, color: '#FFFFFF',
              textTransform: 'uppercase', marginTop: 3, marginBottom: 2, paddingRight: 6,
            }}>
            Ambassadeur {formatMemberNumber(ambassador.number)}
          </Text>
          <Text style={{
            fontFamily: PFonts.uiSemi, fontSize: 10.5, color: 'rgba(255,255,255,0.55)',
          }}>
            Membre fondateur · depuis {ambassador.since}
          </Text>
          {onShareCard && (
            <TouchableOpacity onPress={onShareCard} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{
                fontFamily: PFonts.uiXBold, fontSize: 11, color: AMB.goldDeep, marginTop: 7,
              }}>
                Partager ma carte →
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  </View>
)}
```

- [ ] **Step 5: Câbler dans app/player/[id].tsx**

- Import : `import { isAmbassador, memberSinceLabel } from '../../lib/ambassador';`
- Au rendu de `ProfileHeader` (l.1280-1303) ajouter : `ambassador={isAmbassador(profile) ? profile.member_number : null}`.
- Au rendu de `StatsTab` (l.1305-1313) ajouter :

```tsx
ambassador={isAmbassador(profile)
  ? { number: profile.member_number!, since: memberSinceLabel(profile.created_at) }
  : null}
onShareCard={() => { setComposerMode('profil'); setComposerLocked(false); setComposerOpen(true); }}
```

(`onShareCard` sera re-pointé vers le template « Carte Membre » à la Task 7 — ce câblage provisoire ouvre déjà le composer existant.)

- [ ] **Step 6: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.

---

### Task 5: Overlay de révélation à la visite du profil

**Files:**
- Create: `components/ambassador/AmbassadorRevealOverlay.tsx`
- Modify: `app/player/[id].tsx` (montage de l'overlay dans la `View` racine l.1273, en frère du ScrollView, comme les modales existantes)

**Interfaces:**
- Consumes: `AMB`, `formatMemberNumber` (Task 1), `LaurelMedallion` (Task 2) ; assets `splash-racket.png`, `splash-wordmark.png`.
- Produces: `AmbassadorRevealOverlay({ number: number; since: string; onDone: () => void })` — plein écran, `pointerEvents="none"`, fade-in 0.4s → tient ~2.5s → fade-out 0.5s, appelle `onDone` à ~3.4s (l'appelant le démonte).

- [ ] **Step 1: Écrire l'overlay**

```tsx
// Overlay plein écran joué à l'arrivée sur le profil d'un ambassadeur.
// Purement visuel : pointerEvents="none", ne bloque jamais l'interaction.
// Timing : fade-in 400ms → tient 2500ms → fade-out 500ms → onDone.
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Fonts } from '../../lib/theme';
import { AMB, formatMemberNumber } from '../../lib/ambassador';
import { LaurelMedallion } from './primitives';

const HOLD_MS = 2500;

function sectorPath(cx: number, cy: number, r: number, a1: number, a2: number): string {
  const rad = (a: number) => ((a - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
  const x2 = cx + r * Math.cos(rad(a2)), y2 = cy + r * Math.sin(rad(a2));
  return `M${cx} ${cy} L${x1} ${y1} A${r} ${r} 0 0 1 ${x2} ${y2} Z`;
}

function Spark({ top, left, size, color, duration, delay }: {
  top: string; left: string; size: number; color: string; duration: number; delay: number;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: duration / 2, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v, duration, delay]);
  return (
    <Animated.View style={{
      position: 'absolute', top: top as any, left: left as any,
      width: size, height: size, borderRadius: 999, backgroundColor: color,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.15] }) }],
    }} />
  );
}

export function AmbassadorRevealOverlay({ number, since, onDone }: {
  number: number; since: string; onDone: () => void;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const textIn = useRef(new Animated.Value(0)).current;
  const footIn = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(HOLD_MS),
      Animated.timing(opacity, { toValue: 0, duration: 500, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onDone(); });
    Animated.timing(pop, { toValue: 1, duration: 550, delay: 150, easing: Easing.out(Easing.back(1.7)), useNativeDriver: true }).start();
    Animated.timing(textIn, { toValue: 1, duration: 400, delay: 350, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    Animated.timing(footIn, { toValue: 1, duration: 400, delay: 500, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 9000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, []);

  const R = 130;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, {
      zIndex: 50, opacity, alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(6,5,4,0.94)', overflow: 'hidden',
    }]}>
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="ambRevealGlow" cx="50%" cy="42%" rx="70%" ry="55%">
            <Stop offset="0" stopColor={AMB.gold} stopOpacity={0.16} />
            <Stop offset="0.7" stopColor={AMB.gold} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#ambRevealGlow)" />
      </Svg>
      <Animated.View style={{
        position: 'absolute', top: '40%', left: '50%',
        width: R * 2, height: R * 2, marginLeft: -R, marginTop: -R,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
      }}>
        <Svg width={R * 2} height={R * 2}>
          <Path d={sectorPath(R, R, R, 5, 42)} fill={AMB.gold} fillOpacity={0.10} />
          <Path d={sectorPath(R, R, R, 150, 192)} fill={AMB.gold} fillOpacity={0.085} />
          <Path d={sectorPath(R, R, R, 300, 342)} fill={AMB.gold} fillOpacity={0.10} />
        </Svg>
      </Animated.View>
      <Spark top="26%" left="30%" size={5} color={AMB.goldBright} duration={1600} delay={0} />
      <Spark top="22%" left="68%" size={4} color={AMB.gold} duration={1900} delay={300} />
      <Spark top="62%" left="22%" size={4} color={AMB.gold} duration={1700} delay={600} />
      <Spark top="66%" left="74%" size={5} color={AMB.goldBright} duration={2100} delay={150} />
      <Spark top="38%" left="82%" size={3} color={AMB.gold} duration={1500} delay={450} />
      <Animated.View style={{
        opacity: pop,
        transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
      }}>
        <LaurelMedallion width={98} doubleRing />
      </Animated.View>
      <Animated.View style={{ opacity: textIn, alignItems: 'center', marginTop: 14 }}>
        <Text
          numberOfLines={1} adjustsFontSizeToFit
          style={{ fontFamily: Fonts.welcome, fontSize: 40, color: '#FFFFFF', paddingRight: 8 }}>
          Cercle des 100
        </Text>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 8 }}>
          Ambassadeur{' '}
          <Text style={{ fontFamily: Fonts.uiBlack, color: AMB.gold }}>
            {formatMemberNumber(number)}
          </Text>
        </Text>
      </Animated.View>
      <Animated.View style={{ position: 'absolute', bottom: 30, alignItems: 'center', gap: 6, opacity: footIn }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={require('../../assets/auth/splash-racket.png')}
            style={{ width: 18, height: 18 }} resizeMode="contain" />
          <Image source={require('../../assets/auth/splash-wordmark.png')}
            style={{ width: 84, height: 18, marginLeft: -6 }} resizeMode="contain" />
        </View>
        <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.3 }}>
          Membre depuis {since}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
```

- [ ] **Step 2: Monter dans app/player/[id].tsx**

- Imports : `AmbassadorRevealOverlay`, plus `isAmbassador`/`memberSinceLabel` (déjà importés à la Task 4).
- États près des états composer (l.536-538) :

```tsx
const [revealDone, setRevealDone] = useState(false);
```

- Dans la `View` racine (l.1273), APRÈS le ScrollView (comme les modales), ajouter :

```tsx
{!revealDone && profile != null && isAmbassador(profile) && (
  <AmbassadorRevealOverlay
    number={profile.member_number!}
    since={memberSinceLabel(profile.created_at)}
    onDone={() => setRevealDone(true)}
  />
)}
```

Comportement : `PlayerProfile` se remonte à chaque navigation → l'overlay se rejoue à chaque **visite** (décision retenue, cf. Global Constraints). Il n'apparaît qu'une fois `profile` chargé (pas de flash sur les non-ambassadeurs) et ne bloque aucun tap (`pointerEvents="none"`).

- [ ] **Step 3: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.

---

### Task 6: Listes & classements — anneau fin + couronne + chip N°xxx

**Files:**
- Modify: `app/ranking.tsx` (`PlayerRow` local, l.498-604 : avatar l.537-544, rangée nom/chips l.547-572)
- Modify: `components/community/PlayerRow.tsx` (avatar l.21, bloc nom l.23-25)
- Modify: `components/activity/FriendsRanking.tsx` (ligne l.39-55 : avatar l.44-47, nom l.49)

**Interfaces:**
- Consumes: `isAmbassador` (Task 1) ; `AmbassadorRing`, `AmbassadorChip` (Task 2).
- Produces: rien de nouveau — traitement visuel conditionnel dans 3 listes. Le dégradé/couleur de ligue reste INTACT à l'intérieur de l'anneau.

- [ ] **Step 1: app/ranking.tsx — PlayerRow**

- Imports : `import { isAmbassador } from '../lib/ambassador';` et `import { AmbassadorChip, AmbassadorRing } from '../components/ambassador/primitives';`
- Avatar (l.537-544, `View 38×38 borderRadius 11 bg avatarColor(...)`) — envelopper conditionnellement :

```tsx
{isAmbassador(player) ? (
  <AmbassadorRing size={38} radius={11} surface={Colors.bgCard}>
    {/* View avatar 38×38 existante inchangée (garder son borderWidth isMe) */}
  </AmbassadorRing>
) : (
  /* View avatar existante inchangée */
)}
```

- Chip : dans la rangée nom (l.548, `flexDirection:'row', gap:5, flexWrap:'wrap'`), après le chip FRMT (l.560-571) :

```tsx
{isAmbassador(player) && <AmbassadorChip number={player.member_number!} />}
```

- La requête l.67 fait `select('*')` → `member_number` remonte déjà. Vérifier seulement que le type local des lignes est `Player` (sinon élargir).

- [ ] **Step 2: components/community/PlayerRow.tsx**

- Lire le fichier ; la ligne rend `<Avatar name size=46 radius=14 league=... />` (l.21) puis le nom (l.23-25).
- Vérifier que l'objet joueur passé en prop expose `member_number` : ouvrir `lib/community.ts` et contrôler les `select(...)` qui alimentent ces lignes. S'ils listent des colonnes explicitement, ajouter `member_number` ; si `select('*')`, rien à faire.
- Envelopper l'Avatar :

```tsx
{isAmbassador(player) ? (
  <AmbassadorRing size={46} radius={14} surface={Colors.bgCard}>
    <Avatar name={player.name} size={46} radius={14} league={league} />
  </AmbassadorRing>
) : (
  <Avatar name={player.name} size={46} radius={14} league={league} />
)}
```

(adapter les noms de variables réels du fichier). Ajouter le chip à côté du nom : si le nom n'est pas déjà dans une row, l'envelopper : `<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>` autour du `<Text>` nom + `{isAmbassador(player) && <AmbassadorChip number={player.member_number!} />}`.

- [ ] **Step 3: components/activity/FriendsRanking.tsx**

Rangs compacts (avatar 28px) : anneau + chip, PAS de badge couronne (trop petit — `showStar={false}`).
- Avatar (l.44-47) : envelopper avec `<AmbassadorRing size={28} radius={9} showStar={false} surface={...fond de la carte...}>` quand `isAmbassador(f)`.
- Nom (l.49, `<Text>` seul dans `View flex:1`) : envelopper dans une row comme au Step 2 et ajouter `<AmbassadorChip number={f.member_number!} />`.
- Vérifier que les objets `friends` passés par `app/(tabs)/activite.tsx` portent `member_number` (même contrôle des `select` que Step 2).

- [ ] **Step 4: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.

---

### Task 7: Story « Carte Membre » (boucle virale)

**Files:**
- Modify: `components/story/storyTheme.ts` (`StoryPlayer` l.39-44)
- Modify: `components/story/StoryStyles.tsx` (nouveau template + `STORY_REGISTRY` l.437-441 + dispatcher `StoryCardV2` l.443-460 + type `StoryMode` l.430)
- Modify: `components/StoryComposerV2.tsx` (mode `member` accessible uniquement via `lockMode`)
- Modify: `app/player/[id].tsx` (`storyPlayer` l.1149-1166, `fetchData` l.658-718, `onShareCard` de la Task 4)

**Interfaces:**
- Consumes: `MemberCard` (Task 3), `AMB`, `formatMemberNumber`, `issuedLabel`, `fetchAmbassadorsCount`, `AMBASSADOR_LIMIT` (Task 1).
- Produces: `StoryPlayer` += `memberNumber?: number | null; memberIssued?: string; ambassadorsCount?: number | null;` ; `StoryMode` += `'member'` ; template `CardMember` enregistré sous le mode `member` (`{ id: 'member', name: 'Carte Membre' }`).

- [ ] **Step 1: Étendre StoryPlayer**

Dans `components/story/storyTheme.ts`, interface `StoryPlayer` :

```ts
  memberNumber?: number | null;   // Ambassadeur Cercle des 100
  memberIssued?: string;          // « ÉMISE 03.2026 »
  ambassadorsCount?: number | null; // places attribuées (pour « il reste X places »)
```

- [ ] **Step 2: Template CardMember dans StoryStyles.tsx**

- `StoryMode` (l.430) : `'profil' | 'match' | 'photo' | 'member'`.
- `STORY_REGISTRY` : ajouter `member: [{ id: 'member', name: 'Carte Membre' }]`.
- Nouveau composant (même squelette que `CardDark` l.37-91 : `forwardRef<View>`, canvas `width`, `H = width * 16 / 9`, `const s = makeScale(width)`) :

```tsx
// Story « Carte Membre » — Cercle des 100. Fond sombre, carte membre
// compacte inclinée, compteur de places restantes.
const CardMember = forwardRef<View, StoryCardProps>(({ player, width }, ref) => {
  const s = makeScale(width);
  const H = (width * 16) / 9;
  const n = player.memberNumber ?? 0;
  const remaining = player.ambassadorsCount != null
    ? Math.max(0, AMBASSADOR_LIMIT - player.ambassadorsCount)
    : null;
  return (
    <View ref={ref} collapsable={false}
      style={{ width, height: H, backgroundColor: AMB.inkDeep, overflow: 'hidden' }}>
      <DarkGoldBackdrop radius={0} from="#17171A" to={AMB.inkDeep} glowAt="top" />
      {/* étincelles statiques */}
      <View style={{ position: 'absolute', top: H * 0.14, left: width * 0.12, width: s(12), height: s(12), borderRadius: 999, backgroundColor: 'rgba(255,209,63,0.6)' }} />
      <View style={{ position: 'absolute', top: H * 0.22, right: width * 0.10, width: s(9), height: s(9), borderRadius: 999, backgroundColor: 'rgba(255,193,26,0.45)' }} />
      <View style={{ position: 'absolute', bottom: H * 0.20, left: width * 0.09, width: s(9), height: s(9), borderRadius: 999, backgroundColor: 'rgba(255,193,26,0.4)' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: s(66), gap: s(48) }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: s(30), letterSpacing: s(7), color: AMB.gold }}>
          CERCLE DES 100
        </Text>
        <Text
          numberOfLines={1} adjustsFontSizeToFit
          style={{ fontFamily: Fonts.welcome, fontSize: s(108), color: '#FFFFFF', textAlign: 'center', paddingRight: s(12) }}>
          J'y étais en premier.
        </Text>
        <View style={{ transform: [{ rotate: '2deg' }] }}>
          <MemberCard width={width * 0.72} name={player.name} number={n} issued={player.memberIssued ?? ''} compact />
        </View>
        {remaining != null && (
          <Text style={{
            fontFamily: Fonts.ui, fontSize: s(36), lineHeight: s(54),
            color: 'rgba(255,255,255,0.65)', textAlign: 'center', maxWidth: width * 0.62,
          }}>
            Il reste {remaining} places au Cercle des 100 — rejoins-moi sur PagMatch.
          </Text>
        )}
        <Wordmark s={s} />
      </View>
    </View>
  );
});
```

Imports à ajouter dans `StoryStyles.tsx` : `MemberCard`, `DarkGoldBackdrop`, `AMB`, `AMBASSADOR_LIMIT`. Réutiliser le composant `Wordmark` de `StoryPrimitives` comme les autres templates (adapter à sa signature réelle). Ajouter la branche `member` au dispatcher `StoryCardV2` (l.443-460) sur le modèle des branches existantes.

- [ ] **Step 3: StoryComposerV2 — mode member seulement via lockMode**

Lire le composant. Le segmented (masqué quand `lockMode`, l.153) itère la liste des modes : exclure `'member'` de cette liste (le mode n'est atteignable QUE via `initialMode='member'` + `lockMode` — il ne doit pas apparaître pour les non-ambassadeurs ni dans le partage profil standard). Vérifier que rien d'autre ne suppose l'ancienne union à 3 modes (`switch`/records → ajouter la clé `member` où le type l'exige).

- [ ] **Step 4: Câblage app/player/[id].tsx**

- `fetchData` : ajouter au `Promise.all` (l.664-683) un appel `fetchAmbassadorsCount()` stocké dans un état `const [ambCount, setAmbCount] = useState<number | null>(null)`.
- `storyPlayer` (l.1149-1166) : ajouter `memberNumber: profile?.member_number ?? null, memberIssued: issuedLabel(profile?.created_at), ambassadorsCount: ambCount`.
- Remplacer le `onShareCard` provisoire de la Task 4 par :

```tsx
onShareCard={() => { setComposerMode('member' as StoryMode); setComposerLocked(true); setComposerOpen(true); }}
```

(vérifier le type réel de `composerMode` et l'état `composerLocked` l.536-538 — suivre le pattern de `onShareProfile` l.1294).

- [ ] **Step 5: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.

---

### Task 8: Écran de révélation au premier lancement

**Files:**
- Create: `app/ambassador-welcome.tsx`
- Modify: `app/_layout.tsx` (déclaration de route dans `Stack.Protected`, l.43-61)
- Modify: `app/(tabs)/_layout.tsx` (déclencheur, à côté du flag onboarding l.113-123)

**Interfaces:**
- Consumes: `usePlayer` (hooks) ; `isAmbassador`, `formatMemberNumber`, `issuedLabel`, `fetchAmbassadorsCount`, `AMBASSADOR_LIMIT`, `AMB` (Task 1) ; `MemberCard` (Task 3) ; AsyncStorage.
- Produces: route `/ambassador-welcome` (fullScreenModal, fade) ; clé AsyncStorage `amb_reveal_seen:{playerId}`.

**Contexte** : la « révélation à l'inscription » du handoff ne peut PAS vivre sur l'écran de succès du signup — à ce stade il n'y a ni session ni ligne `players` (confirmation email obligatoire, trigger serveur). Elle se joue donc au premier lancement connecté, après l'onboarding, via un flag local — même pattern que `GUIDE_KEY`.

- [ ] **Step 1: Déclarer la route**

Dans `app/_layout.tsx`, bloc `Stack.Protected` (l.43-61), à côté de `bilan/[month]` (l.60) :

```tsx
<Stack.Screen name="ambassador-welcome" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
```

- [ ] **Step 2: Écrire l'écran**

`app/ambassador-welcome.tsx` :

```tsx
// Révélation « Cercle des 100 » : joué une seule fois, au premier
// lancement connecté d'un joueur ambassadeur (après l'onboarding).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { MemberCard } from '../components/ambassador/MemberCard';
import { usePlayer } from '../hooks/usePlayer';
import {
  AMB, AMBASSADOR_LIMIT, fetchAmbassadorsCount, isAmbassador, issuedLabel,
} from '../lib/ambassador';
import { Fonts } from '../lib/theme';

export const AMB_REVEAL_SEEN_KEY = (playerId: string) => `amb_reveal_seen:${playerId}`;

const DOTS = [
  { top: '17%', left: '11%', size: 4, color: 'rgba(255,209,63,0.7)' },
  { top: '12%', right: '18%', size: 3, color: 'rgba(255,193,26,0.5)' },
  { top: '31%', right: '7%', size: 5, color: 'rgba(255,209,63,0.35)' },
  { bottom: '25%', left: '7%', size: 3, color: 'rgba(255,193,26,0.4)' },
] as const;

export default function AmbassadorWelcomeScreen() {
  const { player } = usePlayer();
  const insets = useSafeAreaInsets();
  const [taken, setTaken] = useState<number | null>(null);

  useEffect(() => {
    if (player?.id) AsyncStorage.setItem(AMB_REVEAL_SEEN_KEY(player.id), '1');
    fetchAmbassadorsCount().then(setTaken);
  }, [player?.id]);

  if (!player || !isAmbassador(player)) {
    // Garde-fou : ne devrait jamais s'afficher hors ambassadeur.
    return <View style={{ flex: 1, backgroundColor: '#0A0A0A' }} />;
  }

  const n = player.member_number!;
  const takenCount = taken ?? n;
  const firstName = player.name.trim().split(/\s+/)[0];

  const close = (toProfile: boolean) => {
    if (toProfile) router.replace(`/player/${player.id}`);
    else router.back();
  };

  return (
    <View style={{
      flex: 1, backgroundColor: '#0A0A0A', justifyContent: 'center',
      paddingHorizontal: 24, paddingTop: insets.top + 4, paddingBottom: insets.bottom + 16,
    }}>
      <Svg pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="ambWelcome" cx="50%" cy="42%" rx="80%" ry="55%">
            <Stop offset="0" stopColor={AMB.gold} stopOpacity={0.13} />
            <Stop offset="0.7" stopColor={AMB.gold} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#ambWelcome)" />
      </Svg>
      {DOTS.map((d, i) => (
        <View key={i} style={{
          position: 'absolute', width: d.size, height: d.size, borderRadius: 999,
          backgroundColor: d.color,
          ...('top' in d ? { top: d.top as any } : {}), ...('bottom' in d ? { bottom: (d as any).bottom } : {}),
          ...('left' in d ? { left: (d as any).left } : {}), ...('right' in d ? { right: (d as any).right } : {}),
        }} />
      ))}
      <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11, letterSpacing: 2.4, color: AMB.gold, marginBottom: 10 }}>
        LES 100 PREMIERS
      </Text>
      <Text
        numberOfLines={2} adjustsFontSizeToFit
        style={{ fontFamily: Fonts.welcome, fontSize: 36, lineHeight: 38, color: '#FFFFFF', marginBottom: 12, paddingRight: 8 }}>
        Bienvenue au Cercle des 100, {firstName}.
      </Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13.5, lineHeight: 21, color: 'rgba(255,255,255,0.62)', marginBottom: 26 }}>
        Vous êtes le {n}ᵉ inscrit sur PagMatch. Ce numéro est à vous, à vie — personne d'autre ne le portera.
      </Text>
      <View style={{ transform: [{ rotate: '-2.5deg' }], marginTop: 4, marginHorizontal: 2 }}>
        <MemberCard
          width={Dimensions.get('window').width - 52}
          name={player.name} number={n} issued={issuedLabel(player.created_at)} />
      </View>
      <View style={{ marginTop: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, letterSpacing: 1, color: 'rgba(255,255,255,0.5)' }}>
            PLACES ATTRIBUÉES
          </Text>
          <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 11, color: AMB.gold }}>
            {takenCount} / {AMBASSADOR_LIMIT}
          </Text>
        </View>
        <View style={{ height: 6, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
          <View style={{
            height: '100%', borderRadius: 999,
            width: `${Math.min(100, Math.round((takenCount / AMBASSADOR_LIMIT) * 100))}%`,
            backgroundColor: AMB.goldDeep,
          }} />
        </View>
      </View>
      <View style={{ gap: 10, marginTop: 16 }}>
        <TouchableOpacity onPress={() => close(true)} activeOpacity={0.85}
          style={{ backgroundColor: AMB.gold, borderRadius: 16, padding: 16, alignItems: 'center' }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: '#0A0A0A' }}>
            Voir mes privilèges
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => close(false)} activeOpacity={0.7} style={{ alignItems: 'center', padding: 8 }}>
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
            Plus tard
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
```

Note : la barre de remplissage utilise un aplat `AMB.goldDeep` ; pour le dégradé exact `#E8A906→#FFD23F`, réutiliser un mini `Svg Rect` + `LinearGradient` horizontal si le rendu aplat paraît trop plat à la vérif device (optionnel).

- [ ] **Step 3: Déclencheur dans app/(tabs)/_layout.tsx**

À côté de la logique `hasSeenOnboarding` (l.113-123) :

```tsx
// Révélation Cercle des 100 : une fois, après l'onboarding.
useEffect(() => {
  if (!player?.id || !isAmbassador(player) || hasSeenOnboarding !== true) return;
  (async () => {
    const seen = await AsyncStorage.getItem(`amb_reveal_seen:${player.id}`);
    if (!seen) router.push('/ambassador-welcome');
  })();
}, [player?.id, player?.member_number, hasSeenOnboarding]);
```

(Adapter aux noms réels : vérifier comment `hasSeenOnboarding` est stocké — si c'est un state `boolean | null`, la condition ci-dessus convient ; importer `router` d'expo-router, `isAmbassador`, AsyncStorage si absents.)

- [ ] **Step 4: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.

---

### Task 9: Hero Accueil — noir chaud + sceau laurier

**Files:**
- Modify: `components/home/HomeProfileCard.tsx` (signature l.36-41, carte l.71-135, avatar l.87)
- Modify: `app/(tabs)/index.tsx` (props l.389-400)

**Interfaces:**
- Consumes: `isAmbassador`, `formatMemberNumberShort`, `AMB` (Task 1) ; `LaurelWreath`, `LaurelMedallion` (Task 2) ; `Guilloche`, `DarkGoldBackdrop` (Task 3).
- Produces: `HomeProfileCard` accepte `memberNumber?: number | null`.

- [ ] **Step 1: Props et data**

- `HomeProfileCard` : ajouter `memberNumber?: number | null;` à la signature.
- `app/(tabs)/index.tsx` l.389-400 : passer `memberNumber={player.member_number ?? null}` et porter le `minHeight` du wrapper à `compact ? 198 : 228` quand `player.member_number != null` (le sous-titre + le sceau demandent ~14 pt de plus) :

```tsx
<View style={{ flex: 3, minHeight: (player.member_number != null ? 14 : 0) + (compact ? 184 : 214) }}>
```

- [ ] **Step 2: Restructurer la carte pour le sceau en surplomb**

La carte a `overflow: 'hidden'` (halos internes) : le sceau doit vivre HORS du clip. Envelopper le rendu actuel :

```tsx
const amb = memberNumber != null;
return (
  <View style={{ flex: 1 }}>
    {/* carte existante (overflow hidden) : mêmes enfants qu'avant */}
    <View style={{ /* styles existants */ , ...(amb && { borderWidth: 1, borderColor: AMB.line35 }) }}>
      {amb && (
        <>
          <DarkGoldBackdrop radius={24} from={AMB.inkWarm} to="#0A0A0A" glowAt="topRight" />
          <Guilloche opacity={0.03} gap={8} />
        </>
      )}
      {/* … contenu existant … */}
    </View>
    {amb && (
      <View style={{
        position: 'absolute', top: -14, right: 16, alignItems: 'center',
        transform: [{ rotate: '-9deg' }],
        shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 14,
        shadowOffset: { width: 0, height: 8 }, elevation: 8,
      }}>
        <LaurelMedallion width={66} innerFill={AMB.inkWarm} />
        <Text style={{ fontFamily: Fonts.display, fontSize: 9, color: AMB.gold, marginTop: -4 }}>
          {formatMemberNumberShort(memberNumber!)}
        </Text>
      </View>
    )}
  </View>
);
```

(le fond `Colors.heroBg` existant reste derrière le `DarkGoldBackdrop` — garder tel quel pour le cas non-ambassadeur).

- [ ] **Step 3: Avatar 52 + laurier réduit + sous-titre**

- Avatar (l.87, `GradientAvatar size={compact ? 46 : 54}`) — cas ambassadeur :

```tsx
{amb ? (
  <View style={{ position: 'relative', paddingBottom: 9, alignSelf: 'flex-start' }}>
    <View style={{
      borderWidth: 2, borderColor: AMB.gold, borderRadius: 999, padding: 2.5,
      shadowColor: AMB.gold, shadowOpacity: 0.22, shadowRadius: 20,
      shadowOffset: { width: 0, height: 0 },
    }}>
      <GradientAvatar letter={...} size={compact ? 44 : 52} />
    </View>
    <View style={{ position: 'absolute', bottom: -1, left: 0, right: 0, alignItems: 'center' }}>
      <LaurelWreath width={58} />
    </View>
  </View>
) : (
  /* GradientAvatar existant inchangé */
)}
```

(Note : `GradientAvatar` du hero est un carré arrondi `rx = size*0.28` — le laisser tel quel dans l'anneau rond, cohérent avec la règle « la hiérarchie existante reste visible dans l'anneau ».)
- Sous le nom (l.100-102), ajouter :

```tsx
{amb && (
  <Text style={{ fontFamily: Fonts.uiBold, fontSize: 10, color: AMB.gold, letterSpacing: 0.3, marginTop: 4 }}>
    Membre fondateur · Cercle des 100
  </Text>
)}
```

- [ ] **Step 4: Vérifier**

Run: `npx tsc --noEmit` — Expected: 0 erreur.
Contrôle layout : l'accueil est calibré sans scroll (`compact`) — vérifier à la vérif device que la carte ne pousse pas le contenu (le `minHeight` ajusté au Step 1 doit absorber le sous-titre).

---

## Vérification finale (après la dernière tâche)

- [ ] `npx tsc --noEmit` propre sur l'ensemble.
- [ ] Grep de contrôle : aucun écran ne lit `member_number` directement pour décider du statut (`isAmbassador` partout) : `rg "member_number" app components lib --type-add 'rn:*.{ts,tsx}' -t rn` — les seuls accès directs admis sont les passages de valeur (`profile.member_number!` après garde `isAmbassador`).
- [ ] Récap utilisateur : (1) migration `supabase/migrations/ambassador_member_number.sql` à appliquer manuellement dans le SQL Editor ; (2) décision produit ouverte : overlay rejoué à chaque visite (comportement livré) vs une fois par session ; (3) vérif device requise pour : dégradé du numéro (Svg Text + Anton sur Android), ombres or (iOS seulement), layout accueil compact, titres italiques Android.
