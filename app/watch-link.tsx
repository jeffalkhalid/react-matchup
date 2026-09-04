// app/watch-link.tsx — « Ma montre ». Implémente `design_handoff_panel_arbitre`,
// écran montre.
//
// L'écran ne montrait qu'un code à six chiffres et une ligne par montre liée.
// Deux choses manquaient, et ce sont les deux seules qui comptent :
//
//  1. QUOI FAIRE. Un code sans mode d'emploi ne dit pas qu'il faut d'abord
//     installer l'app sur la montre, ni où le saisir. On voyait six chiffres
//     et on refermait l'écran. Les trois étapes sont donc écrites, numérotées,
//     et la troisième s'accomplit sous les yeux : l'écran surveille la liaison
//     et bascule tout seul quand la montre répond.
//
//  2. QUELLE MONTRE. « Vue le 03/09/2026 » ne dit pas si la liaison marche, et
//     avec deux montres la liste affichait deux fois « Montre » — délier
//     revenait à tirer au sort. La fiche dit maintenant le nom (renommable),
//     la dernière synchro en clair, depuis quand elle est liée, et combien de
//     matchs ont été marqués avec.
//
// La maquette affichait aussi la batterie et la version du logiciel. Ni l'une
// ni l'autre n'existe : ni en base, ni dans les apps montre, rien ne les
// remonte. Les afficher aurait voulu dire inventer un chiffre — elles sont
// volontairement absentes, plutôt que fausses.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Alert, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Fonts, FontSize, Radius, Spacing } from '../lib/theme';
import { Icon } from '../components/community/icons';
import {
  createPairingCode, listWatchLinks, revokeWatchLink, renameWatchLink,
  formatCode, deviceName, matchesLabel, lastSeenLabel, linkedSinceLabel,
  type WatchLink,
} from '../lib/watchLink';

const VALIDITY_MS = 5 * 60 * 1000;
/** Une montre vue il y a moins de deux jours est considérée « en service ». */
const ACTIVE_MS = 48 * 60 * 60 * 1000;

/**
 * Une étape du mode d'emploi. Numérotée : l'ordre compte, on ne peut pas
 * saisir un code avant d'avoir installé l'app.
 */
function Step({ n, title, detail, done }: {
  n: number; title: string; detail: string; done?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' }}>
      <View style={{
        width: 26, height: 26, borderRadius: 13, marginTop: 1,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: done ? Colors.success : Colors.brand,
      }}>
        {done
          ? <Icon name="check" size={14} color={Colors.textOnDark} stroke={3} />
          : <Text style={{ fontFamily: Fonts.uiBlack, fontSize: 13, color: Colors.textOnBrand }}>{n}</Text>}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontFamily: Fonts.uiBlack, fontSize: FontSize.sm, color: Colors.textPrimary }}>
          {title}
        </Text>
        <Text style={{ fontSize: FontSize.xs, color: Colors.textSecondary, lineHeight: 17 }}>
          {detail}
        </Text>
      </View>
    </View>
  );
}

/** La fiche d'un appareil lié. */
function DeviceCard({ link, onRename, onRevoke }: {
  link: WatchLink;
  onRename: () => void;
  onRevoke: () => void;
}) {
  const seen = link.last_seen_at ? new Date(link.last_seen_at).getTime() : 0;
  const active = seen > 0 && Date.now() - seen < ACTIVE_MS;
  const since = linkedSinceLabel(link.created_at);

  return (
    <View style={{
      backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
      borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: 10,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
        <Text numberOfLines={1} style={{
          flex: 1, minWidth: 0, fontFamily: Fonts.uiBlack,
          fontSize: FontSize.base, color: Colors.textPrimary,
        }}>
          {deviceName(link)}
        </Text>
        {/* Le point de vie de la liaison : vert = elle a donné signe de vie
            récemment. C'est la seule information qui dise si ça marche. */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 5,
          backgroundColor: (active ? Colors.success : Colors.textMuted) + '1A',
          borderRadius: Radius.full, paddingHorizontal: 9, paddingVertical: 4,
        }}>
          <View style={{
            width: 7, height: 7, borderRadius: 4,
            backgroundColor: active ? Colors.success : Colors.textMuted,
          }} />
          <Text style={{
            fontSize: 9.5, fontFamily: Fonts.uiBlack, letterSpacing: 0.5,
            color: active ? Colors.success : Colors.textMuted,
          }}>
            {active ? 'EN SERVICE' : 'EN VEILLE'}
          </Text>
        </View>
      </View>

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Icon name="signal" size={13} color={Colors.textMuted} stroke={2.2} />
          <Text style={{ fontSize: FontSize.xs, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
            Dernière synchro : {lastSeenLabel(link.last_seen_at)}
          </Text>
        </View>
        {!!since && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="clock" size={13} color={Colors.textMuted} stroke={2.2} />
            <Text style={{ fontSize: FontSize.xs, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
              {since}
            </Text>
          </View>
        )}
        {/* Absent tant que la migration watch_link_details.sql n'est pas
            appliquée : mieux vaut ne rien dire que d'afficher « 0 matchs »
            à quelqu'un qui en a marqué trente. */}
        {typeof link.matches_count === 'number' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Icon name="racket" size={13} color={Colors.textMuted} stroke={2.2} />
            <Text style={{ fontSize: FontSize.xs, fontFamily: Fonts.uiBold, color: Colors.textSecondary }}>
              {matchesLabel(link.matches_count)}
            </Text>
          </View>
        )}
      </View>

      <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: 2 }}>
        <TouchableOpacity
          onPress={onRename}
          activeOpacity={0.8}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            borderRadius: Radius.md, paddingVertical: 11,
            borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg,
          }}
        >
          <Icon name="pencil" size={13} color={Colors.textPrimary} stroke={2.3} />
          <Text style={{ fontSize: FontSize.xs, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
            Renommer
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onRevoke}
          activeOpacity={0.8}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
            borderRadius: Radius.md, paddingVertical: 11,
            borderWidth: 1, borderColor: Colors.danger + '55', backgroundColor: Colors.danger + '0F',
          }}
        >
          <Icon name="trash" size={13} color={Colors.danger} stroke={2.3} />
          <Text style={{ fontSize: FontSize.xs, fontFamily: Fonts.uiExtraBold, color: Colors.danger }}>
            Délier
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function WatchLinkScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState<string | null>(null);
  const [codeAt, setCodeAt] = useState<number>(0);
  const [links, setLinks] = useState<WatchLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<WatchLink | null>(null);
  const [draftName, setDraftName] = useState('');
  const [, setTick] = useState(0);
  // Combien de montres AVANT de générer le code : c'est ce qui permet de
  // détecter qu'une nouvelle vient de se lier, sans rien demander au joueur.
  const countAtCode = useRef(0);

  const reload = useCallback(async () => {
    try { setLinks(await listWatchLinks()); }
    catch { /* liste non bloquante : le code reste générable */ }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  // Tick seconde : fait vivre le compte à rebours de validité du code. Il
  // s'arrête de lui-même à l'expiration — sinon l'écran se redessinait chaque
  // seconde pour afficher un texte figé, tant qu'on le laissait ouvert.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => {
      setTick(n => n + 1);
      if (Date.now() - codeAt >= VALIDITY_MS) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [code, codeAt]);

  // Tant qu'un code est en vie, on guette la liaison. C'est l'étape 3 du mode
  // d'emploi qui se coche toute seule : sans ça, le joueur saisit le code sur
  // sa montre et reste devant un écran qui n'a pas bougé, sans savoir si ça a
  // marché.
  useEffect(() => {
    if (!code) return;
    const t = setInterval(async () => {
      // Un code expiré ne peut plus lier personne : on cesse d'interroger le
      // serveur toutes les quatre secondes pour rien.
      if (Date.now() - codeAt >= VALIDITY_MS) { clearInterval(t); return; }
      try {
        const fresh = await listWatchLinks();
        setLinks(fresh);
        if (fresh.length > countAtCode.current) {
          setCode(null);
          Alert.alert('Montre connectée', 'Elle retrouvera tes matchs toute seule.');
        }
      } catch { /* réseau : on réessaiera au tick suivant */ }
    }, 4000);
    return () => clearInterval(t);
  }, [code, codeAt]);

  const remaining = code ? Math.max(0, VALIDITY_MS - (Date.now() - codeAt)) : 0;
  const expired = !!code && remaining === 0;

  const onGenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      countAtCode.current = links.length;
      const c = await createPairingCode();
      setCode(c);
      setCodeAt(Date.now());
    } catch (e: any) {
      Alert.alert('Erreur', String(e?.message ?? e));
    } finally { setBusy(false); }
  };

  const onRevoke = (l: WatchLink) => {
    Alert.alert(
      'Délier ' + deviceName(l) + ' ?',
      'Elle ne pourra plus marquer de points tant que tu ne la reconnecteras pas.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Délier', style: 'destructive',
          onPress: async () => {
            try { await revokeWatchLink(l.id); await reload(); }
            catch (e: any) { Alert.alert('Erreur', String(e?.message ?? e)); }
          },
        },
      ],
    );
  };

  const onConfirmRename = async () => {
    const l = renaming;
    if (!l) return;
    setRenaming(null);
    try { await renameWatchLink(l.id, draftName); await reload(); }
    catch (e: any) { Alert.alert('Erreur', String(e?.message ?? e)); }
  };

  const aucune = loaded && links.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <View style={{
        paddingTop: insets.top + 8, paddingHorizontal: Spacing.md,
        paddingBottom: Spacing.sm, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
      }}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.75} hitSlop={10}>
          <Icon name="chevronLeft" size={22} color={Colors.textPrimary} stroke={2.6} />
        </TouchableOpacity>
        <Text numberOfLines={1} adjustsFontSizeToFit style={{
          flex: 1, fontFamily: Fonts.uiBlack, fontSize: 17,
          color: Colors.textPrimary, paddingRight: 6,
        }}>
          Ma montre
        </Text>
      </View>

      <ScrollView contentContainerStyle={{
        padding: Spacing.md, paddingBottom: insets.bottom + 40, gap: Spacing.md,
      }}>
        {links.map(l => (
          <DeviceCard
            key={l.id}
            link={l}
            onRename={() => { setDraftName(l.device_label ?? ''); setRenaming(l); }}
            onRevoke={() => onRevoke(l)}
          />
        ))}

        {/* Le mode d'emploi n'a de sens qu'avant la première liaison. Après,
            il devient du bruit au-dessus des montres qu'on vient consulter. */}
        {aucune && (
          <View style={{
            backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
            borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: 14,
          }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: FontSize.base, color: Colors.textPrimary }}>
              Connecter une montre, en 3 étapes
            </Text>
            <Step
              n={1}
              title="Installe PagMatch sur ta montre"
              detail="Depuis le magasin d'applications de la montre — Connect IQ pour une Garmin, Play Store pour une Wear OS."
            />
            <Step
              n={2}
              title="Génère un code ici"
              detail="Six chiffres, valables cinq minutes. Le bouton est juste en dessous."
              done={!!code && !expired}
            />
            <Step
              n={3}
              title="Saisis-le sur la montre"
              detail="Une seule fois : ensuite ta montre retrouvera tes matchs toute seule."
            />
          </View>
        )}

        <View style={{
          backgroundColor: Colors.bgCard, borderRadius: Radius.xl,
          borderWidth: 1, borderColor: code && !expired ? Colors.brand : Colors.border,
          padding: Spacing.lg, alignItems: 'center', gap: Spacing.sm,
        }}>
          {code && !expired ? (
            <>
              <Text style={{
                fontFamily: Fonts.uiBlack, fontSize: 40, letterSpacing: 4,
                color: Colors.textPrimary,
              }}>
                {formatCode(code)}
              </Text>
              <Text style={{ fontSize: FontSize.xs, color: Colors.textMuted }}>
                Valable encore {Math.ceil(remaining / 1000)} s
              </Text>
              <Text style={{
                fontSize: FontSize.xs, color: Colors.textSecondary,
                textAlign: 'center', lineHeight: 17,
              }}>
                Saisis-le sur ta montre — cet écran se mettra à jour tout seul.
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center' }}>
              {expired
                ? 'Code expiré — génères-en un nouveau.'
                : aucune ? 'Aucun code en cours.' : 'Tu peux connecter une autre montre.'}
            </Text>
          )}
          <TouchableOpacity
            onPress={onGenerate}
            disabled={busy}
            activeOpacity={0.85}
            style={{
              backgroundColor: Colors.brand, borderRadius: Radius.md,
              paddingVertical: 12, paddingHorizontal: Spacing.lg, opacity: busy ? 0.6 : 1,
            }}
          >
            {busy
              ? <ActivityIndicator color={Colors.textOnBrand} size="small" />
              : <Text style={{ fontFamily: Fonts.uiBlack, fontSize: FontSize.sm, color: Colors.textOnBrand }}>
                  {code ? 'Générer un nouveau code' : 'Générer un code'}
                </Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={!!renaming} transparent animationType="fade" onRequestClose={() => setRenaming(null)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: '#00000088', justifyContent: 'center', padding: Spacing.lg }}
        >
          <View style={{ backgroundColor: Colors.bgCard, borderRadius: Radius.lg, padding: Spacing.md, gap: 12 }}>
            <Text style={{ fontFamily: Fonts.uiBlack, fontSize: FontSize.base, color: Colors.textPrimary }}>
              Renommer la montre
            </Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Ma Forerunner"
              placeholderTextColor={Colors.textMuted}
              maxLength={40}
              autoFocus
              style={{
                borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
                paddingHorizontal: 12, paddingVertical: 11,
                fontSize: FontSize.sm, color: Colors.textPrimary, backgroundColor: Colors.bg,
              }}
            />
            <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
              <TouchableOpacity
                onPress={() => setRenaming(null)}
                activeOpacity={0.8}
                style={{
                  flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: Radius.md,
                  borderWidth: 1, borderColor: Colors.border,
                }}
              >
                <Text style={{ fontSize: FontSize.xs, fontFamily: Fonts.uiExtraBold, color: Colors.textPrimary }}>
                  Annuler
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onConfirmRename}
                activeOpacity={0.85}
                style={{
                  flex: 1, alignItems: 'center', paddingVertical: 12,
                  borderRadius: Radius.md, backgroundColor: Colors.brand,
                }}
              >
                <Text style={{ fontSize: FontSize.xs, fontFamily: Fonts.uiBlack, color: Colors.textOnBrand }}>
                  Enregistrer
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}
