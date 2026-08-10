import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { usePlayer } from '../../hooks/usePlayer';
import { Colors, Fonts } from '../../lib/theme';
import { getSuggestions, searchPlayers, setFollow, getFriendsWithForm, type FriendWithForm } from '../../lib/community';
import { Card, NavBar, BrandBtn, Divider, Cream, CreamBorder } from '../../components/community/ui';
import { Icon } from '../../components/community/icons';
import { PlayerRow } from '../../components/community/PlayerRow';
import { Avatar } from '../../components/community/Avatar';
import type { SocialPlayer } from '../../types';

export default function FriendsScreen() {
  const router = useRouter();
  const { player } = usePlayer();

  // L'onglet « Activité » a été retiré : le fil des amis vit désormais dans
  // l'onglet Activité principal. Cet écran ne sert plus qu'à la recherche.
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <NavBar title="Mes amis" onBack={() => router.back()} />

      {!player ? null : (
        <SearchBody myId={player.id} onInvite={() => router.push('/community/invite')} player={player} />
      )}
    </View>
  );
}

// ─── Champ de recherche ISOLÉ ────────────────────────────────
// Non-contrôlé (ref + defaultValue) + sans état de focus + memo :
//  • toucher le champ ne déclenche AUCUN re-render → le clavier ne se ferme pas ;
//  • les re-renders du parent (suggestions/résultats) ne le touchent jamais (memo) ;
//  • le « × » reste monté (opacité) pour ne pas blur en ajoutant/retirant un frère.
const SearchField = memo(function SearchField({ onChange }: { onChange: (t: string) => void }) {
  const ref = useRef<TextInput>(null);
  const [hasText, setHasText] = useState(false);
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 4 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderRadius: 14, paddingHorizontal: 14,
        backgroundColor: Colors.bgCard, borderWidth: 1.6, borderColor: Colors.border,
      }}>
        <Icon name="search" size={18} color={Colors.textMuted} />
        <TextInput
          ref={ref}
          defaultValue=""
          onChangeText={(t) => { setHasText(t.length > 0); onChange(t); }}
          placeholder="Tape au moins 3 lettres…"
          placeholderTextColor={Colors.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          returnKeyType="search"
          underlineColorAndroid="transparent"
          style={{ flex: 1, fontFamily: Fonts.ui, fontSize: 15, color: Colors.textPrimary, paddingVertical: 0 }}
        />
        <TouchableOpacity onPress={() => { ref.current?.clear(); setHasText(false); onChange(''); }} disabled={!hasText} hitSlop={8} style={{ opacity: hasText ? 1 : 0, width: 18 }}>
          <Text style={{ color: Colors.textMuted, fontSize: 18 }}>×</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// ─── Onglet Recherche ────────────────────────────────────────
function SearchBody({ myId, onInvite, player }: {
  myId: string; onInvite: () => void; player: any;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SocialPlayer[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<SocialPlayer[]>([]);
  const [friends, setFriends] = useState<FriendWithForm[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Référence stable → SearchField (memo) ne se re-rend jamais à cause du parent.
  const handleChange = useCallback((t: string) => setQ(t), []);

  useEffect(() => { getSuggestions(player).then(setSuggestions); }, [player]);
  // Rechargé au focus : un suivi/désabonnement fait depuis un profil est
  // reflété au retour sur cet écran.
  useFocusEffect(useCallback(() => { getFriendsWithForm(myId).then(setFriends); }, [myId]));

  // Recherche déclenchée à ≥ 3 lettres, anti-rebond 250 ms (la dernière frappe gagne).
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) { setResults(null); setSearching(false); return; }
    let active = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchPlayers(myId, term).then(r => { if (active) { setResults(r); setSearching(false); } });
    }, 250);
    return () => { active = false; clearTimeout(t); };
  }, [q, myId]);

  const onFollow = async (list: SocialPlayer[], setList: (l: SocialPlayer[]) => void, p: SocialPlayer) => {
    setBusyId(p.id);
    await setFollow(myId, p.id, !p.following);
    setList(list.map(x => x.id === p.id ? { ...x, following: !x.following } : x));
    setBusyId(null);
  };

  return (
    <View style={{ flex: 1 }}>
      <SearchField onChange={handleChange} />

      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="none" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 110 }}>
        {/* Recherche en cours */}
        {searching && results === null && (
          <ActivityIndicator color={Colors.brand} style={{ marginTop: 24 }} />
        )}

        {/* < 3 lettres → mes amis puis suggestions */}
        {results === null && !searching && friends.length > 0 && (
          <View style={{ marginTop: 18 }}>
            <SectionTitle count={friends.length}>Mes amis</SectionTitle>
            <View style={{ gap: 8 }}>
              {friends.map(f => (
                <FriendRow key={f.id} f={f} onPress={() => router.push(`/player/${f.id}` as any)} />
              ))}
            </View>
          </View>
        )}

        {results === null && !searching && (
          <View style={{ marginTop: 18 }}>
            <SectionTitle>Suggestions pour toi</SectionTitle>
            {suggestions.length > 0 ? (
              <Card pad={16}>
                {suggestions.map((p, i) => (
                  <View key={p.id}>
                    <PlayerRow p={p} sub={p.reason} busy={busyId === p.id} onFollow={() => onFollow(suggestions, setSuggestions, p)} onPress={() => router.push(`/player/${p.id}` as any)} />
                    {i < suggestions.length - 1 ? <View style={{ height: 1, backgroundColor: Divider }} /> : null}
                  </View>
                ))}
              </Card>
            ) : null}
            <InviteBlock title="Tu ne trouves pas le joueur ?" sub="Invite-le sur PagMatch — il rejoint, tu gagnes un badge parrainage." onInvite={onInvite} />
          </View>
        )}

        {/* ≥ 3 lettres → résultats, amis EN PREMIER (ligne riche : forme + delta),
            puis les autres joueurs avec le bouton Suivre. */}
        {results !== null && results.length > 0 && (() => {
          const friendById = new Map(friends.map(f => [f.id, f]));
          const matchedFriends = results.filter(r => r.following);
          const others = results.filter(r => !r.following);
          return (
            <>
              {matchedFriends.length > 0 && (
                <View style={{ marginTop: 14 }}>
                  <SectionTitle count={matchedFriends.length}>Mes amis</SectionTitle>
                  <View style={{ gap: 8 }}>
                    {matchedFriends.map(p => {
                      const f = friendById.get(p.id);
                      return f ? (
                        <FriendRow key={p.id} f={f} onPress={() => router.push(`/player/${p.id}` as any)} />
                      ) : (
                        <PlayerRow key={p.id} p={p} busy={busyId === p.id} onFollow={() => onFollow(results, setResults as any, p)} onPress={() => router.push(`/player/${p.id}` as any)} />
                      );
                    })}
                  </View>
                </View>
              )}
              {others.length > 0 && (
                <View style={{ marginTop: 14 }}>
                  <SectionTitle count={others.length}>Joueurs</SectionTitle>
                  <Card pad={16}>
                    {others.map((p, i) => (
                      <View key={p.id}>
                        <PlayerRow p={p} busy={busyId === p.id} onFollow={() => onFollow(results, setResults as any, p)} onPress={() => router.push(`/player/${p.id}` as any)} />
                        {i < others.length - 1 ? <View style={{ height: 1, backgroundColor: Divider }} /> : null}
                      </View>
                    ))}
                  </Card>
                </View>
              )}
            </>
          );
        })()}

        {results !== null && results.length === 0 && !searching && (
          <View style={{ marginTop: 14 }}>
            <InviteBlock title={`Aucun joueur « ${q.trim()} »`} sub="Invite-le sur PagMatch pour jouer ensemble." onInvite={onInvite} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Carte « ami » : niveau, forme (5 derniers matchs, carrés V/D) et delta
// du dernier match. Même langage visuel que la Home (carte blanche arrondie,
// pill jaune, chip verte/rouge).
function FriendRow({ f, onPress }: { f: FriendWithForm; onPress: () => void }) {
  const delta = f.lastLevelDelta;
  const deltaUp = (delta ?? 0) >= 0;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{
      backgroundColor: Colors.bgCard, borderRadius: 18,
      borderWidth: 1, borderColor: Colors.border,
      padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12,
      shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 }, elevation: 2,
    }}>
      <Avatar name={f.name} size={44} radius={14} league={f.league} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: Fonts.uiExtraBold, fontSize: 14.5, color: Colors.textPrimary }}>
          {f.name}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 }}>
          <View style={{ backgroundColor: 'rgba(255,193,26,0.18)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2.5 }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 10.5, color: Colors.brandDeep }}>
              Niv. {f.level.toFixed(2)}
            </Text>
          </View>
          {f.mutual != null && f.mutual > 0 ? (
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: Fonts.uiSemi, fontSize: 10.5, color: Colors.textMuted }}>
              {f.mutual} ami{f.mutual > 1 ? 's' : ''} en commun
            </Text>
          ) : null}
        </View>
      </View>

      {/* Forme (V/D, plus récent à gauche) + delta du dernier match */}
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        {f.form.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: 3 }}>
            {f.form.map((win, i) => (
              <View key={i} style={{
                width: 16, height: 16, borderRadius: 5,
                backgroundColor: win ? '#DCFCE7' : '#FEE2E2',
                alignItems: 'center', justifyContent: 'center',
                opacity: 1 - i * 0.12,   // les plus anciens s'estompent
              }}>
                <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 8.5, color: win ? '#15803D' : '#B91C1C' }}>
                  {win ? 'V' : 'D'}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ fontFamily: Fonts.uiSemi, fontSize: 10, color: Colors.textMuted }}>Aucun match</Text>
        )}
        {delta != null && (
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 3,
            backgroundColor: deltaUp ? '#ECFDF5' : '#FEF2F2',
            borderWidth: 1, borderColor: deltaUp ? '#A7F3D0' : '#FECACA',
            borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2.5,
          }}>
            <Text style={{ fontSize: 7, color: deltaUp ? Colors.success : Colors.danger }}>
              {deltaUp ? '▲' : '▼'}
            </Text>
            <Text style={{ fontFamily: Fonts.uiBlack, fontWeight: '900', fontSize: 10.5, color: deltaUp ? Colors.success : Colors.danger }}>
              {`${deltaUp ? '+' : '−'}${Math.abs(delta).toFixed(2)}`}
            </Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}

// Titre de section sportif (Barlow italique), même langage que la Home.
function SectionTitle({ children, count }: { children: string; count?: number }) {
  return (
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}
      style={{ fontFamily: Fonts.welcome, fontSize: 16, color: Colors.textPrimary, letterSpacing: 0.4, marginBottom: 10, paddingRight: 4 }}>
      {children.toUpperCase()}
      {count != null ? <Text style={{ color: Colors.brandDeep }}>{`  ·  ${count}`}</Text> : null}
    </Text>
  );
}

function InviteBlock({ title, sub, onInvite }: { title: string; sub: string; onInvite: () => void }) {
  return (
    <View style={{ marginTop: 18, backgroundColor: Cream, borderWidth: 1, borderColor: CreamBorder, borderRadius: 18, padding: 20, alignItems: 'center' }}>
      <Text style={{ fontFamily: Fonts.uiExtraBold, fontSize: 16, color: Colors.textPrimary, marginBottom: 4, textAlign: 'center' }}>{title}</Text>
      <Text style={{ fontFamily: Fonts.ui, fontSize: 13, color: Colors.textSecondary, marginBottom: 16, textAlign: 'center' }}>{sub}</Text>
      <BrandBtn
        label="Invite-le sur PagMatch"
        icon={<Icon name="arrowRight" size={17} color={Colors.primary} stroke={2.4} rotate={-45} />}
        onPress={onInvite}
        style={{ alignSelf: 'stretch' }}
      />
    </View>
  );
}
