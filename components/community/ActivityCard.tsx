// Carte d'activité : entête acteur + bloc (résultat / badge / promotion) + réactions.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors, Fonts, getLeague } from '../../lib/theme';
import { Avatar } from './Avatar';
import { Card, Chips } from './ui';
import { Icon } from './icons';
import { MatchCard as MatchScoreCard } from '../profile/components';
import { BadgePill } from '../profile/BadgePill';
import { matchToView } from '../../lib/matchView';
import type { ActivityEvent, League } from '../../types';

function verbFor(e: ActivityEvent): { verb: string; accent?: string } {
  switch (e.type) {
    case 'match_win':  return { verb: 'a gagné' };
    case 'match_loss': return { verb: 'a perdu' };
    case 'badge':      return { verb: 'a débloqué un badge' };
    case 'promotion':  return { verb: 'monte en', accent: e.payload.promo_label ?? '' };
    case 'bilan':      return { verb: 'a partagé son bilan', accent: e.payload.label ?? '' };
    default:           return { verb: '' };
  }
}

export function ActivityCard({ e, myId, onReact, onPressActor, onReport, onPressComments, onPressPlayer, onOpen }: {
  e: ActivityEvent;
  myId: string;
  onReact?: () => void;        // absent = 🔥 désactivé (ex: ses propres posts)
  onPressActor?: () => void;   // ouvre le profil de l'acteur
  onReport?: () => void;       // signaler l'activité (absent si c'est la mienne)
  onPressComments?: () => void; // ouvre la feuille de commentaires
  onPressPlayer?: (id: string) => void; // ouvre le profil d'un joueur de la carte de match
  onOpen?: () => void;          // tap sur le contenu → vue plein écran
}) {
  const win = e.type === 'match_win';
  const isMatch = e.type === 'match_win' || e.type === 'match_loss';
  const { verb, accent } = verbFor(e);
  const fireIds = e.reactions?.['🔥'] ?? [];
  const liked = fireIds.includes(myId);
  const likes = fireIds.length;
  const league = (e.league ?? (e.actor ? getLeague(e.actor.elo_score) : 'discovery')) as League;

  return (
    <Card pad={16}>
      {/* Entête — avatar + nom cliquables → profil de l'acteur */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <TouchableOpacity onPress={onPressActor} disabled={!onPressActor} activeOpacity={0.7} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Avatar name={e.actor?.name} size={42} radius={13} league={league} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: Fonts.ui, fontSize: 14, color: Colors.textPrimary }}>
              <Text style={{ fontFamily: Fonts.uiExtraBold }}>{e.actor?.name ?? 'Joueur'}</Text>
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
        ) : (
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: Chips, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="arrowRight" size={16} color={Colors.textSecondary} stroke={2.4} rotate={-45} />
          </View>
        )}
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
            <Text style={{ fontFamily: Fonts.display, fontSize: 22, letterSpacing: -0.5, color: win ? Colors.success : Colors.danger, marginTop: 1 }}>
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
          <Text style={{ fontSize: 22 }}>⬆️</Text>
          <Text style={{ fontFamily: Fonts.welcome, fontSize: 18, color: Colors.brandDeep, textTransform: 'uppercase' }}>
            {e.payload.promo_label}
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

      {/* Réactions */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
        <TouchableOpacity onPress={onReact} disabled={!onReact} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ fontSize: 17, opacity: liked ? 1 : 0.5 }}>🔥</Text>
          <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 13, color: liked ? Colors.brandDeep : Colors.textMuted }}>
            {likes}
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
      <Text style={{ fontFamily: Fonts.display, fontSize: 24, color, lineHeight: 24 }}>{n}</Text>
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
