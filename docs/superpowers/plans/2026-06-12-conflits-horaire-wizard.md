# Conflits d'horaire visibles dans le wizard — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher proactivement, à l'étape « Quand & Où » du wizard de création, un point sur les jours ayant ≥1 match, un signal ambre sur les créneaux horaires en conflit (±2h), et un bloc détaillant les parties en conflit sous la grille.

**Architecture:** Un fetch one-shot des parties à venir du joueur (organisateur + rejointes) à l'ouverture du wizard, stocké dans un state `busyGames`. Trois valeurs dérivées (`useMemo`) en découlent : `daysWithGames` (points jour), `occupiedTimes` (ambre heure), `selectedConflicts` (bloc info). Aucune modification de l'alerte de publication ni de la base.

**Tech Stack:** React Native / Expo, TypeScript, Supabase JS client. Pas de framework de test dans le projet → vérification par `npx tsc --noEmit` + contrôle visuel manuel sur Expo.

**Spec :** `docs/superpowers/specs/2026-06-12-conflits-horaire-wizard-design.md`

---

## Structure des fichiers

Tout se passe dans un seul fichier : `app/(tabs)/CreateWizard.tsx`.

- **Bloc Types** (haut du fichier) — ajout du type `BusyGame`.
- **Constantes module** (près de `TIMES`) — ajout de `OVERLAP_MS`.
- **`MiniCalendar`** (fonction ~ligne 128) — nouveau prop `daysWithGames` + point dans les cases.
- **Composant `CreateWizard`** — import `useMemo`, state `busyGames`, `useEffect` de fetch, 3 dérivés `useMemo`, et 3 retouches de rendu (pastilles Jour, `MiniCalendar` appelé, pastilles Heure, bloc info).

> ⚠️ Le `cwd` doit être `react-matchup/`. Toutes les commandes ci-dessous s'exécutent depuis ce dossier.

---

## Task 1 : Couche données — `busyGames` + dérivés

**Files:**
- Modify: `app/(tabs)/CreateWizard.tsx` (imports ligne 1 ; bloc Types ~ligne 15 ; constantes ~ligne 47 ; state ~ligne 217 ; useEffect ~après ligne 312 ; dérivés ~après ligne 334)

- [ ] **Step 1 : Ajouter `useMemo` à l'import React**

Remplacer la ligne 1 :

```ts
import { useCallback, useEffect, useMemo, useState } from 'react';
```

- [ ] **Step 2 : Déclarer le type `BusyGame` dans le bloc Types**

Juste après la ligne `type Genre = 'mixed' | 'men' | 'women';` (~ligne 15) :

```ts
type BusyGame = { ts: number; location: string | null; role: string };
```

- [ ] **Step 3 : Déclarer `OVERLAP_MS` près de `TIMES`**

Juste après le tableau `TIMES` (après la ligne 47, avant `FR_DAYS`) :

```ts
// Fenêtre d'anti-chevauchement (identique au pre-check du publish dans lobby.tsx)
const OVERLAP_MS = 2 * 60 * 60 * 1000;
```

- [ ] **Step 4 : Ajouter le state `busyGames`**

Dans la section `// Data` du composant, après la ligne `const [searching, setSearching] = useState(false);` (ligne 217) :

```ts
const [busyGames, setBusyGames] = useState<BusyGame[]>([]);
```

- [ ] **Step 5 : Ajouter le `useEffect` de fetch**

Juste après le `useEffect` « Load frequent players » (après la ligne 312, avant `// Player search`) :

```ts
// Load the player's upcoming games to surface schedule conflicts (±2h).
// Sources et libellés de rôle alignés sur le pre-check du publish (lobby.tsx).
useEffect(() => {
  if (!visible || !player) return;
  const myId = player.id;
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const fromIso = todayStart.toISOString();
  let cancelled = false;

  (async () => {
    const [{ data: created }, { data: joined }] = await Promise.all([
      supabase.from('open_games')
        .select('location, match_date')
        .eq('creator_id', myId)
        .neq('status', 'cancelled')
        .gte('match_date', fromIso),
      supabase.from('game_participants')
        .select('status, game:game_id(location, match_date, status)')
        .eq('player_id', myId)
        .in('status', ['accepted', 'pending', 'invited', 'waitlist']),
    ]);
    if (cancelled) return;

    const games: BusyGame[] = [];
    (created ?? []).forEach((g: any) => {
      if (!g.match_date) return;
      games.push({ ts: new Date(g.match_date).getTime(), location: g.location ?? null, role: 'organisateur' });
    });
    const ROLE: Record<string, string> = {
      accepted: 'inscrit', invited: 'invité', waitlist: "liste d'attente", pending: 'candidature',
    };
    (joined ?? []).forEach((p: any) => {
      const g = p.game;
      if (!g || g.status === 'cancelled' || !g.match_date) return;
      const ts = new Date(g.match_date).getTime();
      if (ts < todayStart.getTime()) return;
      games.push({ ts, location: g.location ?? null, role: ROLE[p.status] ?? 'engagement' });
    });
    setBusyGames(games);
  })();

  return () => { cancelled = true; };
}, [visible, player]);
```

- [ ] **Step 6 : Ajouter les trois dérivés `useMemo`**

Juste après le bloc `const canNext = [...]` (après la ligne 334, avant `// Step 2 helpers`) :

```ts
// ── Dérivés conflit d'horaire (depuis busyGames) ──
const daysWithGames = useMemo(
  () => new Set(busyGames.map(g => localDateStr(new Date(g.ts)))),
  [busyGames],
);
const occupiedTimes = useMemo(() => {
  const s = new Set<string>();
  if (!form.day) return s;
  for (const tm of TIMES) {
    const slotTs = new Date(`${form.day}T${tm}`).getTime();
    if (isNaN(slotTs)) continue;
    if (busyGames.some(g => Math.abs(g.ts - slotTs) <= OVERLAP_MS)) s.add(tm);
  }
  return s;
}, [busyGames, form.day]);
const selectedConflicts = useMemo<BusyGame[]>(() => {
  if (!form.day || !form.time) return [];
  const slotTs = new Date(`${form.day}T${form.time}`).getTime();
  if (isNaN(slotTs)) return [];
  return busyGames.filter(g => Math.abs(g.ts - slotTs) <= OVERLAP_MS);
}, [busyGames, form.day, form.time]);
```

- [ ] **Step 7 : Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (aucune erreur). `busyGames`, `daysWithGames`, `occupiedTimes`, `selectedConflicts` ne sont pas encore consommés mais doivent typer correctement.

- [ ] **Step 8 : Commit**

```bash
git add "app/(tabs)/CreateWizard.tsx"
git commit -m "feat(create): fetch upcoming games + derive schedule-conflict sets"
```

---

## Task 2 : Point sur les pastilles Jour rapides

**Files:**
- Modify: `app/(tabs)/CreateWizard.tsx:497-510` (le `QUICK_DAYS.map`)

- [ ] **Step 1 : Marquer les jours ayant un match**

Remplacer le bloc `QUICK_DAYS.map` (lignes 497-510) par :

```tsx
          {QUICK_DAYS.map(d => {
            const active = form.day === d.val;
            const hasGame = daysWithGames.has(d.val);
            return (
              <TouchableOpacity key={d.val} onPress={() => { pickDay(d.val); setShowCal(false); }}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, position: 'relative',
                  borderWidth: 2, borderColor: active ? t.accent : Colors.border,
                  backgroundColor: active ? t.selectBg : Colors.bgCard,
                }}>
                <Text style={{ fontSize: 12, fontWeight: active ? '900' : '600', color: active ? t.selectColor : Colors.textPrimary }}>
                  {d.label}
                </Text>
                {hasGame && (
                  <View style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.textMuted }} />
                )}
              </TouchableOpacity>
            );
          })}
```

- [ ] **Step 2 : Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add "app/(tabs)/CreateWizard.tsx"
git commit -m "feat(create): dot on quick-day pills that already have a match"
```

---

## Task 3 : Point dans le calendrier (`MiniCalendar`)

**Files:**
- Modify: `app/(tabs)/CreateWizard.tsx:128-133` (signature), `:173-188` (cellules), `:523` (appel)

- [ ] **Step 1 : Ajouter le prop `daysWithGames` à la signature de `MiniCalendar`**

Remplacer les lignes 128-133 :

```tsx
function MiniCalendar({ selectedVal, onSelect, t, allDays, daysWithGames }: {
  selectedVal: string;
  onSelect: (val: string) => void;
  t: ReturnType<typeof getTheme>;
  allDays: Array<{ label: string; val: string }>;
  daysWithGames: Set<string>;
}) {
```

- [ ] **Step 2 : Afficher le point dans les cases**

Remplacer le bloc de rendu des cellules (lignes 175-188, du `const active` jusqu'à `</TouchableOpacity>`) par :

```tsx
          const active  = cell.val === selectedVal;
          const isToday = cell.val === todayStr;
          const hasGame = cell.valid && daysWithGames.has(cell.val);
          return (
            <TouchableOpacity key={i} onPress={() => cell.valid && onSelect(cell.val)}
              activeOpacity={cell.valid ? 0.7 : 1}
              style={{ width: '14.28%', height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', position: 'relative',
                backgroundColor: active ? t.btnBg : isToday ? t.eloBg : 'transparent',
                opacity: !cell.valid ? 0.3 : 1,
              }}>
              <Text style={{ fontSize: 12, fontWeight: (active || isToday) ? '900' : '500',
                color: active ? Colors.textOnDark : isToday ? t.eloColor : Colors.textPrimary,
              }}>{cell.d}</Text>
              {hasGame && (
                <View style={{ position: 'absolute', bottom: 3, width: 5, height: 5, borderRadius: 2.5,
                  backgroundColor: active ? Colors.textOnDark : Colors.textMuted }} />
              )}
            </TouchableOpacity>
          );
```

- [ ] **Step 3 : Passer le prop au point d'appel**

Remplacer la ligne 523 :

```tsx
          <MiniCalendar selectedVal={form.day} onSelect={v => { pickDay(v); setShowCal(false); }} t={t} allDays={ALL_DAYS} daysWithGames={daysWithGames} />
```

- [ ] **Step 4 : Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add "app/(tabs)/CreateWizard.tsx"
git commit -m "feat(create): dot on calendar days that already have a match"
```

---

## Task 4 : Pastille Heure « occupée » (ambre, cliquable)

**Files:**
- Modify: `app/(tabs)/CreateWizard.tsx:543-558` (le `TIMES.map`)

- [ ] **Step 1 : Ajouter l'état occupé sur les pastilles d'heure**

Remplacer le bloc `TIMES.map` (lignes 543-558) par :

```tsx
          {TIMES.map(tm => {
            const active   = form.time === tm;
            const past     = isPastSlot(form.day, tm);
            const occupied = !past && occupiedTimes.has(tm);
            return (
              <TouchableOpacity key={tm} disabled={past} onPress={() => set('time', tm)}
                style={{ width: '23%', paddingVertical: 9, borderRadius: 10, position: 'relative',
                  borderWidth: 1.5,
                  borderColor: active ? t.eloBorder : occupied ? Colors.warning : Colors.border,
                  backgroundColor: active ? t.selectBg : Colors.bgCard, alignItems: 'center',
                  opacity: past ? 0.35 : 1,
                }}>
                <Text style={{ fontSize: 12, fontWeight: active ? '900' : '600',
                  color: active ? t.selectColor : Colors.textPrimary,
                  textDecorationLine: past ? 'line-through' : 'none' }}>{tm}</Text>
                {occupied && (
                  <View style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.warning }} />
                )}
              </TouchableOpacity>
            );
          })}
```

- [ ] **Step 2 : Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3 : Commit**

```bash
git add "app/(tabs)/CreateWizard.tsx"
git commit -m "feat(create): amber marker on time slots within 2h of an existing game"
```

---

## Task 5 : Bloc info contextuel sous la grille

**Files:**
- Modify: `app/(tabs)/CreateWizard.tsx` (insertion après la `</View>` de la grille des heures, ligne 559, avant `</ScrollView>` ligne 560)

- [ ] **Step 1 : Insérer le bloc info**

Entre la fermeture de la grille des heures (`</View>` ligne 559) et `</ScrollView>` (ligne 560), insérer :

```tsx
        {/* Conflits sur le créneau choisi (±2h) */}
        {form.time && selectedConflicts.length > 0 && (
          <View style={{ flexDirection: 'row', backgroundColor: 'rgba(245,158,11,0.08)',
            borderWidth: 1.5, borderColor: 'rgba(245,158,11,0.45)', borderRadius: 12,
            overflow: 'hidden', marginBottom: 16 }}>
            <View style={{ width: 4, backgroundColor: Colors.warning }} />
            <View style={{ flex: 1, padding: 11, gap: 7 }}>
              <Text style={{ fontSize: 12, fontWeight: '900', color: '#92400e' }}>
                ⚠️ Tu es déjà pris à ce créneau (±2h)
              </Text>
              {selectedConflicts.map((g, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text style={{ fontSize: 11, color: Colors.textSecondary, flex: 1 }} numberOfLines={1}>
                    🗓️ {new Date(g.ts).toLocaleString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {g.location ?? '?'}
                  </Text>
                  <Pill variant="brand">{g.role}</Pill>
                </View>
              ))}
            </View>
          </View>
        )}
```

- [ ] **Step 2 : Vérifier le typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (`Pill` est déjà importé ligne 11 ; vérifier que `variant="brand"` est une valeur acceptée — c'est le cas, déjà utilisé ligne 827.)

- [ ] **Step 3 : Commit**

```bash
git add "app/(tabs)/CreateWizard.tsx"
git commit -m "feat(create): contextual conflict info block under the time grid"
```

---

## Task 6 : Vérification visuelle sur Expo (manuelle)

**Files:** aucun (vérification).

> Pas de runner de tests dans le projet : cette tâche valide le rendu réel. À faire avec un compte de test qui possède déjà au moins une partie à venir (en tant qu'organisateur ET/OU inscrit).

- [ ] **Step 1 : Lancer l'app**

Run: `npm start` (puis ouvrir sur un device/simulateur).

- [ ] **Step 2 : Vérifier les points Jour (pastilles rapides)**

Ouvrir « Créer une partie ». Sur la rangée de jours rapides, un **point gris** apparaît en haut-à-droite des jours qui contiennent déjà un match. Aucun point sur les jours libres.

- [ ] **Step 3 : Vérifier les points Jour (calendrier)**

Toucher « 📅 Autres dates ». Dans le calendrier, un **point gris** apparaît sous le numéro des jours ayant un match (clair sur un jour sélectionné/fond noir, gris sinon). Aucun point sur les jours hors plage (grisés).

- [ ] **Step 4 : Vérifier les pastilles Heure occupées**

Sélectionner un jour avec un match. Les créneaux à **±2h** du match existant affichent une **bordure ambre + point ambre** et restent **cliquables**. Les créneaux passés restent barrés/désactivés (pas marqués ambre).

- [ ] **Step 5 : Vérifier le bloc info**

Choisir un créneau ambre. Sous la grille apparaît la carte « ⚠️ Tu es déjà pris à ce créneau (±2h) » listant la/les partie(s) (jour court · heure · lieu + pastille de rôle). Choisir un créneau libre → le bloc disparaît.

- [ ] **Step 6 : Vérifier la cohérence avec l'alerte de publication**

Publier sur un créneau marqué ambre → l'alerte « ⚠️ Conflit de créneau » existante doit lister exactement les mêmes parties (mêmes rôles). Aucune surprise (rien dans l'alerte qui n'était pas signalé en amont).

---

## Self-Review (effectuée à l'écriture)

- **Couverture spec** : couche données one-shot (Task 1) ✓ ; point jour pastilles + calendrier (Tasks 2-3) ✓ ; pastille heure ambre cliquable (Task 4) ✓ ; bloc info contextuel (Task 5) ✓ ; alerte publish/trigger inchangés (aucune tâche n'y touche) ✓ ; sémantique deux couleurs (gris jour / ambre conflit) respectée ✓.
- **Placeholders** : aucun — chaque step contient le code exact.
- **Cohérence des types** : `BusyGame` défini en Task 1 et réutilisé tel quel dans `selectedConflicts` (Task 1) et le bloc info (Task 5) ; `daysWithGames: Set<string>` cohérent entre dérivé, prop `MiniCalendar` et usages ; `occupiedTimes: Set<string>` (`.has(tm)`) cohérent ; libellés de rôle identiques à `lobby.tsx`.
