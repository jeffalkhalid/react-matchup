// Carte d'activité : entête acteur + bloc (résultat / badge / promotion) + réactions.
import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts, getLeague } from '../../lib/theme';
import { Avatar } from './Avatar';
import { Card, Chips } from './ui';
import { Icon } from './icons';
import { MatchCard as MatchScoreCard } from '../profile/components';
import { BadgePill } from '../profile/BadgePill';
import { matchToView } from '../../lib/matchView';
import { reactionFor } from '../../lib/activityReactions';
import { headlineFor } from '../../lib/activityHeadline';
import { AMB } from '../../lib/ambassador';
import type { ActivityEvent, League } from '../../types';

export function ActivityCard({ e, myId, onReact, onPressActor, onReport, onPressComments, onPressPlayer, onOpen, onDefi }: {
  e: ActivityEvent;
  myId: string;
  onReact?: () => void;        // absent = réaction désactivée (ex: ses propres posts)
  onPressActor?: () => void;   // ouvre le profil de l'acteur
  onReport?: () => void;       // signaler l'activité (absent si c'est la mienne)
  onPressComments?: () => void; // ouvre la feuille de commentaires
  onPressPlayer?: (id: string) => void; // ouvre le profil d'un joueur de la carte de match
  onOpen?: () => void;          // tap sur le contenu → vue plein écran
  onDefi?: () => void;          // « Revanche ? » (défaite) → ouvre l'onglet Défi
}) {
  const win = e.type === 'match_win';
  const isMatch = e.type === 'match_win' || e.type === 'match_loss';
  // « Khalid a gagné » sur sa propre carte : le sujet et le verbe s'accordent
  // (lib/activityHeadline).
  const accentBrut = e.type === 'promotion' ? e.payload.promo_label : e.type === 'bilan' ? e.payload.label : null;
  const { subject, verb, accent } = headlineFor(e.type, e.player_id === myId, e.actor?.name, accentBrut);
  const fireIds = e.reactions?.['🔥'] ?? [];
  const liked = fireIds.includes(myId);
  const likes = fireIds.length;
  const league = (e.league ?? (e.actor ? getLeague(e.actor.elo_score) : 'discovery')) as League;

  // Réaction contextuelle : le bouton (libellé/icône/bascule) dépend du type
  // d'événement — « Revanche ? » (action) reste séparé des réactions 🔥
  // (« Machine ! », « Féliciter ») qui, elles, passent toujours par onReact.
  const reaction = reactionFor(e.type);
  const [defiSent, setDefiSent] = useState(false);
  const reactionActive = reaction.kind === 'reaction' ? liked : defiSent;
  const reactionBg = reactionActive
    ? (reaction.kind === 'action' ? '#0A0A0A' : 'rgba(255,193,26,0.14)')
    : '#FFFFFF';
  const reactionBorder = reactionActive
    ? (reaction.kind === 'action' ? '#0A0A0A' : Colors.brand)
    : Colors.border;
  const reactionText = reactionActive
    ? (reaction.kind === 'action' ? Colors.brand : AMB.chipText)
    : Colors.textSecondary;
  const onPressReaction = () => {
    if (reaction.kind === 'action') { setDefiSent(true); onDefi?.(); }
    else onReact?.();
  };

  return (
    <Card pad={16}>
      {/* Entête — avatar + nom cliquables → profil de l'acteur */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <TouchableOpacity onPress={onPressActor} disabled={!onPressActor} activeOpacity={0.7} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Avatar name={e.actor?.name} path={(e.actor as any)?.avatar_path} size={52} league={league} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold }}>{subject}</Text>
              <Text style={{ color: Colors.textSecondary }}> {verb}</Text>
              {accent ? <Text style={{ fontFamily: Fonts.uiExtraBold, color: Colors.brandDeep }}> {accent}</Text> : null}
            </Text>
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, color: Colors.textMuted, marginTop: 2 }}>
              {timeAgo(e.created_at)}
            </Text>
          </View>
        </TouchableOpacity>
        {onReport ? (
          <TouchableOpacity onPress={onReport} hitSlop={8} activeOpacity={0.7}
            style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: Chips, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 18, lineHeight: 18, color: Colors.textSecondary, marginTop: -4 }}>⋯</Text>
          </TouchableOpacity>
        ) : onOpen ? (
          /* Sur mes propres cartes il n'y a rien à signaler : la flèche prend
             la place du « ⋯ ». Elle ouvre la vue plein écran — avant, c'était
             une simple image qui ne réagissait pas au doigt. */
          <TouchableOpacity onPress={onOpen} hitSlop={8} activeOpacity={0.7}
            accessibilityLabel="Ouvrir en plein écran"
            style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: Chips, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="arrowRight" size={16} color={Colors.textSecondary} stroke={2.4} rotate={-45} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Contenu tappable → vue plein écran */}
      <TouchableOpacity onPress={onOpen} disabled={!onOpen} activeOpacity={onOpen ? 0.9 : 1}>
      {/* Bloc résultat de match — MÊME représentation que partout (<MatchCard>) */}
      {isMatch && e.match ? (
        <View style={{ marginBottom: 12 }}>
          <MatchScoreCard
            m={matchToView(e.match, e.player_id, false)}
            showActions={false}
            showDelta={false}
            onPlayerPress={onPressPlayer}
          />
        </View>
      ) : isMatch && e.payload.score ? (
        // Repli si le match n'a pas pu être hydraté (supprimé / fetch échoué).
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12,
          backgroundColor: win ? 'rgba(16,185,129,0.07)' : 'rgba(239,68,68,0.06)',
          borderWidth: 1, borderColor: win ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.22)',
          borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
        }}>
          <View style={{
            width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center',
            backgroundColor: win ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
          }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: win ? Colors.success : Colors.danger }}>
              {win ? 'V' : 'D'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontFamily: Fonts.uiBold, fontSize: 12, color: Colors.textSecondary }}>
              {[e.payload.partner, e.payload.vs].filter(Boolean).join(' · ')}
            </Text>
            <Text style={{ fontFamily: Fonts.display, fontSize: 22, lineHeight: 29, letterSpacing: -0.5, color: win ? Colors.success : Colors.danger, marginTop: 1 }}>
              {e.payload.score}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Bloc badge */}
      {e.type === 'badge' ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12,
          backgroundColor: 'rgba(255,193,26,0.10)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.35)',
          borderRadius: 14, padding: 14,
        }}>
          <BadgePill badge={e.payload.badge_label ?? ''} size={40} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 15, color: Colors.textPrimary }}>
            {e.payload.badge_label}
          </Text>
        </View>
      ) : null}

      {/* Bloc promotion */}
      {e.type === 'promotion' ? (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12,
          backgroundColor: 'rgba(255,193,26,0.10)', borderWidth: 1, borderColor: 'rgba(255,193,26,0.35)',
          borderRadius: 14, padding: 14,
        }}>
          <Icon name="trendingUp" size={22} color={Colors.brandDeep} stroke={2.2} />
          <Text numberOfLines={2} style={{ fontFamily: Fonts.welcome, fontSize: 18, lineHeight: 23, color: Colors.brandDeep, paddingRight: 6, flexShrink: 1 }}>
            {(e.payload.promo_label ?? '').toUpperCase()}
          </Text>
        </View>
      ) : null}

      {/* Bloc bilan mensuel (post in-app) */}
      {e.type === 'bilan' ? (
        <View style={{ marginBottom: 12, backgroundColor: Colors.bgDark, borderRadius: 14, padding: 16 }}>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 10, color: Colors.brand, letterSpacing: 1.5, textTransform: 'uppercase' }}>Bilan {e.payload.label ?? ''}</Text>
          <View style={{ flexDirection: 'row', gap: 18, marginTop: 10 }}>
            <BilanStat n={e.payload.matches ?? 0} l="matchs" color="#FFFFFF" />
            <BilanStat n={`${e.payload.winRate ?? 0}%`} l="winrate" color={Colors.brand} />
            <BilanStat n={`${(e.payload.levelDelta ?? 0) >= 0 ? '+' : ''}${(e.payload.levelDelta ?? 0).toFixed(2)}`} l="niveau" color={Colors.brand} />
          </View>
          {e.payload.topPartner ? (
            <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 11.5, color: 'rgba(255,255,255,0.6)', marginTop: 10 }}>Meilleur duo : {e.payload.topPartner}</Text>
          ) : null}
        </View>
      ) : null}

      {/* Légende libre (Moment partagé) — visible tant que c'est un Moment
          (is_highlight). Le cron cleanup-stale-moments retire is_highlight après
          7 j → la légende disparaît du fil (donnée conservée, juste masquée). */}
      {e.caption && e.is_highlight ? (
        <Text style={{ fontFamily: Fonts.ui, fontSize: 13.5, color: Colors.textPrimary, marginBottom: 12, lineHeight: 19 }}>{e.caption}</Text>
      ) : null}
      </TouchableOpacity>

      {/* Réactions — le bouton dépend du type d'événement (lib/activityReactions) */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity
          onPress={onPressReaction}
          disabled={reaction.kind === 'reaction' ? !onReact : defiSent}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, borderWidth: 1,
            backgroundColor: reactionBg, borderColor: reactionBorder,
          }}
        >
          <Icon name={reaction.icon} size={14} color={reactionText} stroke={2} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 12, color: reactionText }}>
            {reactionActive ? reaction.activeLabel : reaction.label}
            {reaction.kind === 'reaction' && likes > 0 ? ` · ${likes}` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onPressComments} disabled={!onPressComments} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="message" size={16} color={Colors.textMuted} />
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: Colors.textMuted }}>
            {e.comment_count ?? 0}
          </Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

function BilanStat({ n, l, color }: { n: number | string; l: string; color: string }) {
  return (
    <View>
      <Text style={{ fontFamily: Fonts.display, fontSize: 24, color, lineHeight: 31 }}>{n}</Text>
      <Text style={{ fontFamily: Fonts.uiBold, fontSize: 9.5, color: 'rgba(255,255,255,0.6)', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2 }}>{l}</Text>
    </View>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
