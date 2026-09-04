// Carte « Prochain match » de l'accueil : bloc jour/heure noir à accent violet,
// club, joueurs des deux camps (nom + niveau), CTA « Voir » → fiche détail.
// UI pure — données réelles de upcomingGames (participants inclus).
// NB : l'occupation des places dérive des participants via occupiesSpot
// (jamais de check de status brut — cf. project_status_checks_isinviteactive) ;
// spots_available (compteur fragile) n'est pas utilisé ici.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Fonts, eloToLevel } from '../../lib/theme';
import { occupiesSpot, gameEloRange } from '../../lib/games';
import { matchNature } from '../../lib/matchView';
import { NaturePill } from '../profile/components';
import { Icon } from '../community/icons';
import { getLiveScoringEnabled, fetchLiveSession } from '../../lib/liveSession';
import { LiveDot } from '../live/LiveDot';
import type { OpenGame } from '../../types';

const VIOLET = '#8B5CF6';

function dayLabel(date: Date): string {
  const now = new Date();
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((dateDay.getTime() - nowDay.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return 'Demain';
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

type SlotPlayer = { id: string; name: string; elo: number };

// TeamSide encode camp + position ('A_GAU', 'B_DRO'…) — seul le camp nous intéresse ici.
function sideOf(teamSide?: string | null): 'A' | 'B' | undefined {
  if (!teamSide) return undefined;
  return teamSide.startsWith('B') ? 'B' : 'A';
}

// Répartit créateur + occupants vivants en deux camps (team_side, sinon équilibrage).
function buildTeams(game: OpenGame): { A: SlotPlayer[]; B: SlotPlayer[]; teamSize: number } {
  const teamSize = game.game_format === 'singles' ? 1 : 2;
  const teams: { A: SlotPlayer[]; B: SlotPlayer[] } = { A: [], B: [] };
  const push = (side: 'A' | 'B' | undefined, p?: { id: string; name: string; elo_score: number } | null) => {
    if (!p) return;
    const s: 'A' | 'B' = side ?? (teams.A.length <= teams.B.length ? 'A' : 'B');
    if (teams[s].length < teamSize) teams[s].push({ id: p.id, name: p.name, elo: p.elo_score });
    else teams[s === 'A' ? 'B' : 'A'].push({ id: p.id, name: p.name, elo: p.elo_score });
  };
  push(sideOf(game.creator_side), game.creator as any);
  (game.participants ?? [])
    .filter(p => occupiesSpot(p as any) && p.player_id !== game.creator_id && (p as any).player)
    .forEach(p => push(sideOf((p as any).team_side), (p as any).player));
  return { ...teams, teamSize };
}

// Charte match : équipe A = noir/texte blanc, équipe B = jaune/texte noir.
function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function PlayerSlot({ p, team }: { p: SlotPlayer | null; team: 'A' | 'B' }) {
  const dark = team === 'A';
  return (
    <View style={{ alignItems: 'center', width: 60 }}>
      {p ? (
        <>
          <View style={{
            width: 40, height: 40, borderRadius: 999,
            backgroundColor: dark ? Colors.primary : Colors.brand,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontFamily: Fonts.display, fontSize: 15, color: dark ? '#FFFFFF' : Colors.primary, includeFontPadding: false }}>
              {initials(p.name)}
            </Text>
          </View>
          <View style={{ backgroundColor: dark ? Colors.brand : Colors.primary, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1.5, marginTop: -8 }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 9, color: dark ? Colors.primary : Colors.brand }}>
              {eloToLevel(p.elo).toFixed(1)}
            </Text>
          </View>
          <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBold, fontWeight: '700', fontSize: 10, color: Colors.textSecondary, marginTop: 3, maxWidth: 60 }}>
            {p.name.split(/\s+/)[0]}
          </Text>
        </>
      ) : (
        <>
          <View style={{
            width: 40, height: 40, borderRadius: 999, borderWidth: 1.5, borderStyle: 'dashed',
            borderColor: Colors.textMuted, alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="plus" size={16} color={Colors.textMuted} stroke={2} />
          </View>
          <Text style={{ fontFamily: Fonts.uiBold, fontWeight: '700', fontSize: 10, color: Colors.textMuted, marginTop: 13 }}>
            Libre
          </Text>
        </>
      )}
    </View>
  );
}

export function UpcomingMatchCard({ game, count, onOpenDetails, onSeeAll, onFindGame, compact }: {
  game: OpenGame | null;
  count: number;
  onOpenDetails: () => void;   // tap carte / VOIR → fiche détail du match
  onSeeAll: () => void;        // tap pill « N à venir » → onglet À venir
  onFindGame: () => void;      // état vide → Explorer
  compact?: boolean;           // petits écrans : typo/paddings réduits pour tenir sans scroll
}) {
  const router = useRouter();
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);

  // Badge « 🔴 LIVE » : uniquement si le flag est actif ET qu'une session live
  // existe pour cette partie. Flag éteint ⇒ aucune requête live_match_sessions.
  useEffect(() => {
    let cancelled = false;
    setLiveSessionId(null);
    const gameId = game?.id;
    if (!gameId) return;
    (async () => {
      const enabled = await getLiveScoringEnabled();
      if (!enabled || cancelled) return;
      const session = await fetchLiveSession(gameId);
      if (cancelled) return;
      setLiveSessionId(session?.status === 'live' ? session.id : null);
    })();
    return () => { cancelled = true; };
  }, [game?.id]);

  const date = game?.match_date ? new Date(game.match_date) : null;
  const teams = game ? buildTeams(game) : null;
  // Fourchette de niveau — même source unique que les cartes lobby / fiche
  // (gameEloRange) : contrainte explicite si présente, sinon dérivée des
  // joueurs confirmés (défi ciblé). Bornes égales → valeur seule.
  const range = game ? gameEloRange(game) : null;
  const rangeLabel = range
    ? (eloToLevel(range.min).toFixed(1) === eloToLevel(range.max).toFixed(1)
        ? `Niv. ${eloToLevel(range.min).toFixed(1)}`
        : `Niv. ${eloToLevel(range.min).toFixed(1)} – ${eloToLevel(range.max).toFixed(1)}`)
    : null;
  const slots = (team: SlotPlayer[], size: number): (SlotPlayer | null)[] =>
    [...team, ...Array(Math.max(0, size - team.length)).fill(null)];

  return (
    <TouchableOpacity
      onPress={game ? (liveSessionId ? () => router.push(`/live/${liveSessionId}` as any) : onOpenDetails) : onFindGame}
      activeOpacity={0.9}
      style={{
        backgroundColor: Colors.bgCard, borderRadius: 22,
        paddingVertical: compact ? 10 : 12, paddingHorizontal: 14,
        borderWidth: 1, borderColor: Colors.border,
        // Remplit le wrapper proportionnel de l'écran (voir index) ; l'air se
        // répartit entre en-tête / infos / joueurs.
        flex: 1, justifyContent: 'space-between',
        shadowColor: '#0F172A', shadowOpacity: 0.06, shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 }, elevation: 3,
      }}
    >
      {/* En-tête de section */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Icon name="calendar" size={15} color={VIOLET} stroke={2.2} />
        <Text style={{ fontFamily: Fonts.welcome, fontSize: 14.5, color: Colors.textPrimary, letterSpacing: 0.5 }}>
          PROCHAIN MATCH
        </Text>
        <View style={{ flex: 1 }} />
        {game ? (
          <TouchableOpacity
            onPress={onSeeAll}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={{ backgroundColor: '#EDE9FE', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 }}
          >
            <Text style={{ fontFamily: Fonts.uiBold, fontWeight: '700', fontSize: 10, color: '#6D28D9' }}>
              {count > 1 ? `${count} à venir` : 'Programmé'}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {game ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: compact ? 8 : 10 }}>
            {/* Bloc jour / heure */}
            <View style={{
              backgroundColor: Colors.heroBg, borderRadius: 15,
              paddingVertical: compact ? 6 : 8, paddingHorizontal: 10,
              alignItems: 'center', minWidth: compact ? 66 : 72,
            }}>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: compact ? 8.5 : 9, color: '#A78BFA', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {date ? dayLabel(date) : 'À planifier'}
              </Text>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: Fonts.welcome, fontSize: compact ? 17 : 19, lineHeight: compact ? 20 : 23, color: Colors.textOnDark, marginTop: 1, paddingRight: 5 }}>
                {date ? date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
              </Text>
            </View>

            {/* Club + nature du match (défi / compétitif / amical — même pastille que MatchCard) */}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>
                {game.location || 'Lieu à définir'}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, alignSelf: 'flex-start' }}>
                {liveSessionId && <LiveDot />}
                <NaturePill {...matchNature(game)} />
                {rangeLabel && (
                  <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBold, fontWeight: '700', fontSize: 10, color: Colors.textMuted }}>
                    {rangeLabel}
                  </Text>
                )}
              </View>
            </View>

            {/* CTA Voir → fiche détail */}
            <View style={{ backgroundColor: Colors.heroBg, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 9 }}>
              <Text style={{ fontFamily: Fonts.welcome, fontSize: 12.5, color: Colors.brand, letterSpacing: 0.5 }}>VOIR</Text>
            </View>
          </View>

          {/* Joueurs — camp A vs camp B, niveaux réels */}
          {teams && (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: compact ? 8 : 10, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: compact ? 7 : 9 }}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {slots(teams.A, teams.teamSize).map((p, i) => <PlayerSlot key={p?.id ?? `a${i}`} p={p} team="A" />)}
              </View>
              <View style={{ width: 30, height: 30, borderRadius: 999, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 10, color: Colors.textSecondary }}>VS</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {slots(teams.B, teams.teamSize).map((p, i) => <PlayerSlot key={p?.id ?? `b${i}`} p={p} team="B" />)}
              </View>
            </View>
          )}
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14, color: Colors.textPrimary }}>
              Aucun match programmé
            </Text>
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11, lineHeight: 15, color: Colors.textMuted, marginTop: 3 }}>
              Explore les parties ouvertes et lance ta prochaine partie.
            </Text>
          </View>
          <View style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: Colors.brand, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronRight" size={17} color={Colors.primary} stroke={2.6} />
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}
