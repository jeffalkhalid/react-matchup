// components/admin/MessagesTab.tsx — écrire le message que les joueurs voient
// à l'ouverture de l'app.
//
// Il vit dans son propre fichier, comme le journal et la recherche : l'écran
// admin fait déjà quatre mille lignes, et un éditeur de plus dedans le rendrait
// impossible à relire.
//
// Trois niveaux, un seul formulaire. Le troisième — « mise à jour requise » —
// ne se ferme pas côté joueur : il sert à arrêter une app devenue incompatible
// avec le serveur. C'est le seul écran d'où l'on peut le déclencher, d'où
// l'avertissement en rouge avant d'enregistrer.
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { supabase } from '../../lib/supabase';
import { imageRatio, type AppMessage, type AppMessageLayout, type AppMessageLevel } from '../../lib/appMessages';
import { Colors, Fonts } from '../../lib/theme';
import { Icon } from '../community/icons';

const NIVEAUX: { key: AppMessageLevel; label: string; aide: string }[] = [
  { key: 'info',    label: 'Information', aide: 'Se ferme. Ne revient plus une fois vue.' },
  { key: 'feature', label: 'Nouveauté',   aide: 'Se ferme. Ne revient plus une fois vue.' },
  { key: 'update',  label: 'Mise à jour', aide: 'NE SE FERME PAS. Bloque l’app tant qu’elle n’est pas mise à jour.' },
];

type Brouillon = {
  id: string | null;
  level: AppMessageLevel;
  title: string;
  body: string;
  cta_label: string;
  cta_url: string;
  min_app_version: string;
  max_app_version: string;
  starts_on: string;
  ends_on: string;
  priority: string;
  active: boolean;
  image_url: string;
  image_ratio: number | null;
  layout: AppMessageLayout;
};

const VIDE: Brouillon = {
  id: null, level: 'info', title: '', body: '', cta_label: '', cta_url: '',
  min_app_version: '', max_app_version: '', starts_on: '', ends_on: '', priority: '0', active: true,
  image_url: '', image_ratio: null, layout: 'card',
};

const BUCKET = 'app-media';
/** Même plafond que le bucket : au-delà, la fenêtre resterait vide plusieurs
 *  secondes sur un réseau moyen — et le serveur refuserait le fichier. */
const POIDS_MAX = 2 * 1024 * 1024;

/** « AAAA-MM-JJ » → début ou fin de cette journée, ou null si le champ est vide. */
function jourVersIso(jour: string, bout: 'debut' | 'fin'): string | null {
  const t = jour.trim();
  if (!t) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], bout === 'debut' ? 0 : 23, bout === 'debut' ? 0 : 59, bout === 'debut' ? 0 : 59);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function isoVersJour(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const champ = {
  backgroundColor: Colors.bg, borderWidth: 1, borderColor: Colors.border, borderRadius: 12,
  paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: Colors.textPrimary,
} as const;

const etiquette = {
  fontSize: 11, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textMuted,
  textTransform: 'uppercase', letterSpacing: 0.8,
} as const;

export default function MessagesTab() {
  const [messages, setMessages] = useState<AppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [envoiImage, setEnvoiImage] = useState(false);
  const [form, setForm] = useState<Brouillon>(VIDE);

  const set = <K extends keyof Brouillon>(k: K, v: Brouillon[K]) => setForm(f => ({ ...f, [k]: v }));

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('app_messages')
      .select('id, level, title, body, cta_label, cta_url, starts_at, ends_at, min_app_version, max_app_version, image_url, image_ratio, layout, active, priority, created_at')
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setMessages((data ?? []) as AppMessage[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const editer = (m: AppMessage) => {
    setForm({
      id: m.id, level: m.level, title: m.title, body: m.body,
      cta_label: m.cta_label ?? '', cta_url: m.cta_url ?? '',
      min_app_version: m.min_app_version ?? '', max_app_version: m.max_app_version ?? '',
      starts_on: isoVersJour(m.starts_at), ends_on: isoVersJour(m.ends_at),
      priority: String(m.priority ?? 0), active: m.active,
      image_url: m.image_url ?? '', image_ratio: m.image_ratio ?? null, layout: m.layout ?? 'card',
    });
  };

  /**
   * Choisir une affiche et l'envoyer.
   *
   * La proportion est mesurée ICI, à l'envoi, et enregistrée : c'est elle qui
   * permettra à la fenêtre de réserver la bonne place avant que l'image arrive.
   *
   * On ne redimensionne pas : ça demanderait un module natif, donc un nouveau
   * passage par les stores — tout ce qu'on cherche à éviter. On compresse à la
   * prise, et on refuse poliment ce qui reste trop lourd.
   */
  const choisirImage = async () => {
    let res: ImagePicker.ImagePickerResult;
    try {
      res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    } catch {
      Alert.alert('Accès aux photos', "L'app n'a pas pu ouvrir tes photos. Vérifie l'autorisation dans les réglages du téléphone.");
      return;
    }
    const a = res.canceled ? null : res.assets?.[0];
    if (!a) return;

    setEnvoiImage(true);
    try {
      const bytes = await new File(a.uri).arrayBuffer();
      if (bytes.byteLength > POIDS_MAX) {
        const mo = Math.round((bytes.byteLength / 1024 / 1024) * 10) / 10;
        Alert.alert('Affiche trop lourde', `Elle pèse ${mo} Mo, le maximum est 2 Mo. Réduis-la avant de l'envoyer — sinon la fenêtre resterait vide plusieurs secondes.`);
        return;
      }
      const mime = a.mimeType ?? 'image/jpeg';
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      const path = `messages/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: false });
      if (error) { Alert.alert('Envoi impossible', error.message); return; }
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      setForm(f => ({
        ...f,
        image_url: url,
        image_ratio: a.width && a.height ? a.width / a.height : null,
      }));
    } catch (e: any) {
      Alert.alert('Envoi impossible', String(e?.message ?? e));
    } finally {
      setEnvoiImage(false);
    }
  };

  const enregistrer = async () => {
    if (!form.title.trim() || !form.body.trim()) {
      Alert.alert('Incomplet', 'Il faut au moins un titre et un texte.');
      return;
    }
    for (const [jour, nom] of [[form.starts_on, 'début'], [form.ends_on, 'fin']] as const) {
      if (jour.trim() && !jourVersIso(jour, 'debut')) {
        Alert.alert('Date invalide', `La date de ${nom} doit s'écrire AAAA-MM-JJ (ex. 2026-10-15).`);
        return;
      }
    }

    const ligne = {
      level: form.level,
      title: form.title.trim(),
      body: form.body.trim(),
      cta_label: form.cta_label.trim() || null,
      cta_url: form.cta_url.trim() || null,
      min_app_version: form.min_app_version.trim() || null,
      max_app_version: form.max_app_version.trim() || null,
      starts_at: jourVersIso(form.starts_on, 'debut'),
      ends_at: jourVersIso(form.ends_on, 'fin'),
      priority: parseInt(form.priority, 10) || 0,
      active: form.active,
      image_url: form.image_url.trim() || null,
      image_ratio: form.image_ratio,
      // Une mise en page « affiche » sans image retomberait sur la carte côté
      // joueur : on la range tout de suite pour que la liste ne mente pas.
      layout: form.layout === 'poster' && form.image_url.trim() ? 'poster' : 'card',
    };

    setSaving(true);
    const { error } = form.id
      ? await supabase.from('app_messages').update(ligne).eq('id', form.id)
      : await supabase.from('app_messages').insert(ligne);
    setSaving(false);
    if (error) { Alert.alert('Erreur', error.message); return; }
    setForm(VIDE);
    load();
  };

  const basculer = async (m: AppMessage) => {
    const { error } = await supabase.from('app_messages').update({ active: !m.active }).eq('id', m.id);
    if (error) { Alert.alert('Erreur', error.message); return; }
    load();
  };

  const supprimer = (m: AppMessage) => {
    Alert.alert('Supprimer ce message ?', `« ${m.title} » disparaîtra définitivement.`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('app_messages').delete().eq('id', m.id);
          if (error) { Alert.alert('Erreur', error.message); return; }
          if (form.id === m.id) setForm(VIDE);
          load();
        },
      },
    ]);
  };

  const bloquant = form.level === 'update';

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      {/* ── Formulaire ── */}
      <View style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
          {form.id ? 'Modifier le message' : 'Nouveau message'}
        </Text>
        <Text style={{ fontSize: 12, color: Colors.textMuted, lineHeight: 17 }}>
          S'affiche à l'ouverture de l'app, une seule fois par ouverture. Un joueur qui l'a fermé ne le revoit plus.
        </Text>

        <Text style={etiquette}>Niveau</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {NIVEAUX.map(n => {
            const actif = form.level === n.key;
            return (
              <TouchableOpacity key={n.key} onPress={() => set('level', n.key)}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                  backgroundColor: actif ? Colors.primary : Colors.bg,
                  borderWidth: 1.5, borderColor: actif ? Colors.primary : Colors.border,
                }}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
                  style={{ fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', color: actif ? Colors.textOnDark : Colors.textPrimary }}>
                  {n.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={{ fontSize: 11.5, color: bloquant ? Colors.danger : Colors.textMuted, lineHeight: 16 }}>
          {NIVEAUX.find(n => n.key === form.level)?.aide}
        </Text>

        <Text style={etiquette}>Titre</Text>
        <TextInput value={form.title} onChangeText={t => set('title', t)} style={champ}
          placeholder="Les tournois arrivent" placeholderTextColor={Colors.textMuted} />

        <Text style={etiquette}>Texte</Text>
        <TextInput value={form.body} onChangeText={t => set('body', t)} multiline
          style={{ ...champ, minHeight: 90, textAlignVertical: 'top' }}
          placeholder="Deux ou trois phrases, pas plus." placeholderTextColor={Colors.textMuted} />

        <Text style={etiquette}>Bouton (facultatif)</Text>
        <TextInput value={form.cta_label} onChangeText={t => set('cta_label', t)} style={champ}
          placeholder="Libellé — ex. « Voir les tournois »" placeholderTextColor={Colors.textMuted} />
        <TextInput value={form.cta_url} onChangeText={t => set('cta_url', t)} autoCapitalize="none" style={champ}
          placeholder="Lien — /tournaments/index, https://…, tel:0661382155" placeholderTextColor={Colors.textMuted} />
        <Text style={{ fontSize: 11.5, color: Colors.textMuted, lineHeight: 16 }}>
          Un chemin qui commence par « / » ouvre un écran de l'app. Tout le reste sort de l'app : site web, téléphone (tel:), WhatsApp. En mode affiche, taper l'image suit ce même lien.
        </Text>

        <Text style={etiquette}>Affiche (facultatif)</Text>
        {form.image_url ? (
          <View style={{ gap: 8 }}>
            <Image
              source={{ uri: form.image_url }}
              resizeMode="cover"
              style={{ width: '100%', aspectRatio: imageRatio(form), borderRadius: 12, backgroundColor: Colors.bg }}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity onPress={choisirImage} disabled={envoiImage}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, opacity: envoiImage ? 0.6 : 1 }}>
                <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textSecondary }}>Remplacer</Text>
              </TouchableOpacity>
              {/* Le fichier reste dans le stockage : une affiche retirée d'un
                  message peut resservir, et un fichier orphelin ne casse rien. */}
              <TouchableOpacity onPress={() => setForm(f => ({ ...f, image_url: '', image_ratio: null, layout: 'card' }))}
                style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: 'rgba(239,68,68,0.45)' }}>
                <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>Retirer</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={choisirImage} disabled={envoiImage}
            style={{ alignItems: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.border, backgroundColor: Colors.bg }}>
            {envoiImage
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="image" size={15} color={Colors.textSecondary} stroke={2.2} />
                  <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textSecondary }}>Choisir une image</Text>
                </View>
              )}
          </TouchableOpacity>
        )}
        <Text style={{ fontSize: 11.5, color: Colors.textMuted, lineHeight: 16 }}>
          2 Mo maximum. Le titre et le texte restent obligatoires : si l'affiche ne charge pas, c'est eux que le joueur verra.
        </Text>

        {form.image_url ? (
          <>
            <Text style={etiquette}>Mise en page</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {([
                { key: 'card' as const, label: 'Carte', aide: 'Image en haut, puis le texte' },
                { key: 'poster' as const, label: 'Affiche', aide: 'L’image occupe tout, et se tape' },
              ]).map(o => {
                const actif = form.layout === o.key;
                return (
                  <TouchableOpacity key={o.key} onPress={() => set('layout', o.key)}
                    style={{
                      flex: 1, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, alignItems: 'center', gap: 2,
                      backgroundColor: actif ? Colors.primary : Colors.bg,
                      borderWidth: 1.5, borderColor: actif ? Colors.primary : Colors.border,
                    }}>
                    <Text style={{ fontSize: 12.5, fontFamily: Fonts.uiBlack, fontWeight: '900', color: actif ? Colors.textOnDark : Colors.textPrimary }}>{o.label}</Text>
                    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}
                      style={{ fontSize: 10, color: actif ? 'rgba(255,255,255,0.75)' : Colors.textMuted }}>{o.aide}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        <Text style={etiquette}>Versions de l'app visées (facultatif)</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={form.min_app_version} onChangeText={t => set('min_app_version', t)} autoCapitalize="none"
            style={{ ...champ, flex: 1 }} placeholder="À partir de 1.0.0" placeholderTextColor={Colors.textMuted} />
          <TextInput value={form.max_app_version} onChangeText={t => set('max_app_version', t)} autoCapitalize="none"
            style={{ ...champ, flex: 1 }} placeholder="Jusqu'à 1.0.0" placeholderTextColor={Colors.textMuted} />
        </View>
        <Text style={{ fontSize: 11.5, color: Colors.textMuted, lineHeight: 16 }}>
          Bornes comprises. Pour « mets ton app à jour », remplis seulement « jusqu'à » avec la dernière version périmée.
        </Text>

        <Text style={etiquette}>Période d'affichage (facultatif)</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={form.starts_on} onChangeText={t => set('starts_on', t)} autoCapitalize="none"
            style={{ ...champ, flex: 1 }} placeholder="Du 2026-10-01" placeholderTextColor={Colors.textMuted} />
          <TextInput value={form.ends_on} onChangeText={t => set('ends_on', t)} autoCapitalize="none"
            style={{ ...champ, flex: 1 }} placeholder="Au 2026-10-15" placeholderTextColor={Colors.textMuted} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={etiquette}>Priorité</Text>
            <TextInput value={form.priority} onChangeText={t => set('priority', t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad" style={{ ...champ, marginTop: 6 }} placeholder="0" placeholderTextColor={Colors.textMuted} />
          </View>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Text style={etiquette}>Actif</Text>
            <Switch value={form.active} onValueChange={v => set('active', v)}
              trackColor={{ false: Colors.border, true: Colors.brand }} thumbColor={Colors.bgCard} />
          </View>
        </View>

        {bloquant && (
          <View style={{ backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.45)', borderRadius: 12, padding: 12 }}>
            <Text style={{ fontSize: 12, fontFamily: Fonts.uiBold, fontWeight: '700', color: Colors.danger, lineHeight: 17 }}>
              Ce message bloquera l'app des joueurs visés. Vérifie deux fois les versions, et mets un lien vers le store dans le bouton.
            </Text>
          </View>
        )}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          {form.id && (
            <TouchableOpacity onPress={() => setForm(VIDE)}
              style={{ paddingHorizontal: 16, paddingVertical: 13, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border }}>
              <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textSecondary }}>Annuler</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={enregistrer} disabled={saving}
            style={{ flex: 1, backgroundColor: Colors.brand, borderRadius: 12, paddingVertical: 13, alignItems: 'center', opacity: saving ? 0.6 : 1 }}>
            {saving
              ? <ActivityIndicator size="small" color={Colors.textOnBrand} />
              : <Text style={{ fontSize: 13, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textOnBrand }}>
                  {form.id ? 'Enregistrer' : 'Créer le message'}
                </Text>}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Liste ── */}
      {loading ? <ActivityIndicator color={Colors.primary} style={{ marginTop: 24 }} /> : (
        messages.length === 0 ? (
          <Text style={{ fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 12 }}>
            Aucun message pour l'instant.
          </Text>
        ) : messages.map(m => (
          <View key={m.id} style={{ backgroundColor: Colors.bgCard, borderWidth: 1, borderColor: Colors.border, borderRadius: 16, padding: 14, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{
                paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999,
                backgroundColor: m.level === 'update' ? 'rgba(239,68,68,0.12)' : m.level === 'feature' ? 'rgba(255,193,26,0.18)' : 'rgba(59,130,246,0.12)',
              }}>
                <Text style={{ fontSize: 10, fontFamily: Fonts.uiBlack, fontWeight: '900', color: m.level === 'update' ? Colors.danger : m.level === 'feature' ? Colors.brandDeep : Colors.info }}>
                  {NIVEAUX.find(n => n.key === m.level)?.label ?? m.level}
                </Text>
              </View>
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 14, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textPrimary }}>
                {m.title}
              </Text>
              <Switch value={m.active} onValueChange={() => basculer(m)}
                trackColor={{ false: Colors.border, true: Colors.brand }} thumbColor={Colors.bgCard} />
            </View>
            <Text numberOfLines={2} style={{ fontSize: 12.5, color: Colors.textSecondary, lineHeight: 18 }}>{m.body}</Text>
            <Text style={{ fontSize: 11, color: Colors.textMuted }}>
              {[
                m.min_app_version || m.max_app_version
                  ? `versions ${m.min_app_version || '…'} → ${m.max_app_version || '…'}`
                  : 'toutes versions',
                m.starts_at || m.ends_at ? `du ${isoVersJour(m.starts_at) || '…'} au ${isoVersJour(m.ends_at) || '…'}` : null,
                m.image_url ? (m.layout === 'poster' ? 'affiche' : 'avec image') : null,
                `priorité ${m.priority}`,
              ].filter(Boolean).join(' · ')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
              <TouchableOpacity onPress={() => editer(m)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: Colors.border }}>
                <Icon name="pencil" size={12} color={Colors.textSecondary} stroke={2.4} />
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.textSecondary }}>Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => supprimer(m)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(239,68,68,0.45)' }}>
                <Icon name="trash" size={12} color={Colors.danger} stroke={2.4} />
                <Text style={{ fontSize: 12, fontFamily: Fonts.uiBlack, fontWeight: '900', color: Colors.danger }}>Supprimer</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}
