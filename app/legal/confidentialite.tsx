// Écran légal — Politique de confidentialité (PAG MATCH).
// Accessible SANS connexion (lié depuis l'inscription) et depuis le profil.
// ⚠️ Valeurs à compléter dans lib/legal.ts ([RESPONSABLE], [RÉGION_SUPABASE]…).
import { Linking, Text } from 'react-native';
import { LEGAL } from '../../lib/legal';
import { LegalLayout, Section, P, B, Bullet, Tags, SubRow, Callout } from '../../components/legal/LegalKit';
import { Colors, Fonts } from '../../lib/theme';

const link = (label: string, url: string) => (
  <Text onPress={() => Linking.openURL(url)} style={{ color: Colors.brandDeep, fontFamily: Fonts.uiBold }}>{label}</Text>
);

export default function ConfidentialiteScreen() {
  const mail = `mailto:${LEGAL.contactEmail}`;
  return (
    <LegalLayout
      kicker="Vie privée"
      title="Politique de confidentialité"
      sub="Vos données vous appartiennent. Voici, en clair, ce qu'on collecte, pourquoi, et comment vous gardez le contrôle."
      updated={LEGAL.lastUpdate}
    >
      <Section n={1} icon="👤" title="Qui est responsable ?">
        <P>
          Le responsable du traitement est <B>{LEGAL.responsable}</B>. Une question sur vos données ?
          Écrivez-nous à {link(LEGAL.contactEmail, mail)}.
        </P>
      </Section>

      <Section n={2} icon="🗂️" title="Ce que nous collectons">
        <P>Uniquement ce qui sert à faire fonctionner le jeu et la communauté :</P>
        <Tags items={[
          'E-mail', 'Pseudo / nom', 'Niveau & ELO', 'Historique de matchs',
          'Messages & réactions', 'Activités', 'Jeton de notification', 'Données techniques',
        ]} />
        <P>
          Les <B>Stories</B> sont générées sur votre appareil et partagées par vos soins : nous ne
          collectons ni ne stockons aucune photo ou vidéo sur nos serveurs.
        </P>
      </Section>

      <Section n={3} icon="🎯" title="Pourquoi nous l'utilisons">
        <Bullet>Créer et gérer votre compte et votre profil.</Bullet>
        <Bullet>Organiser les parties, le matchmaking, le classement ELO et les défis.</Bullet>
        <Bullet>Faire vivre la messagerie et la communauté.</Bullet>
        <Bullet>Vous envoyer les notifications liées à vos parties.</Bullet>
        <Bullet>Sécuriser le service et prévenir la fraude et les abus.</Bullet>
        <Bullet>Respecter nos obligations légales.</Bullet>
      </Section>

      <Section n={4} icon="⚖️" title="Sur quelle base">
        <P>
          Nous traitons vos données pour <B>exécuter le service</B> que vous demandez, avec votre{' '}
          <B>consentement</B> (notifications, contenus publiés) et au titre de notre{' '}
          <B>intérêt légitime</B> à sécuriser la plateforme. Vous pouvez retirer votre consentement à
          tout moment.
        </P>
      </Section>

      <Section n={5} icon="🤝" title="Avec qui nous les partageons">
        <P>Nous ne vendons pas vos données. Pour faire tourner le service, nous faisons appel à des prestataires de confiance :</P>
        <SubRow letter="S" color="#10B981" name="Supabase" role="Base de données & comptes" />
        <SubRow letter="E" color="#3B82F6" name="Expo" role="Relais des notifications push" />
        <SubRow letter="G" color="#F59E0B" name="Google FCM" role="Notifications Android" />
        <SubRow letter="A" color="#52525B" name="Apple APNs" role="Notifications iOS" />
        <SubRow letter="C" color="#3B82F6" name="Cloudflare" role="Protection anti-robot (Turnstile)" />
      </Section>

      <Section n={6} icon="🌍" title="Hébergement hors du Maroc">
        <P>
          Ces prestataires hébergent et traitent les données <B>en dehors du Maroc</B>. Nos données
          applicatives sont hébergées par Supabase dans la région <B>{LEGAL.supabaseRegion}</B>.
        </P>
        <Callout icon="🌍">
          Ces transferts sont nécessaires au fonctionnement du service. Nos prestataires appliquent des
          garanties contractuelles et techniques reconnues pour protéger vos données.
        </Callout>
      </Section>

      <Section n={7} icon="⏳" title="Combien de temps">
        <P>
          Vos données sont conservées tant que votre compte est actif. À sa suppression, elles sont
          effacées ou anonymisées dans un délai raisonnable, sous réserve des durées imposées par la loi.
        </P>
      </Section>

      <Section n={8} icon="🛡️" title="Vos droits">
        <P>Conformément à la loi 09-08, vous disposez des droits d'accès, de rectification, d'opposition et de suppression :</P>
        <Bullet>Modifiez vos informations directement dans l'application.</Bullet>
        <Bullet>Supprimez votre compte depuis les réglages — vos données sont effacées ou anonymisées.</Bullet>
        <Bullet>Exercez vos autres droits en écrivant à {LEGAL.contactEmail}.</Bullet>
      </Section>

      <Section n={9} icon="🔒" title="Sécurité">
        <P>
          Les échanges sont chiffrés en transit (HTTPS). L'accès aux données est cloisonné par des
          règles de sécurité au niveau de la base (Row Level Security) : chacun n'accède qu'à ce qui le
          concerne, et les messages d'une partie ne sont visibles que par ses participants.
        </P>
      </Section>

      <Section n={10} icon="🔞" title="Mineurs">
        <P>
          Le service est destiné aux personnes d'au moins <B>{LEGAL.minAge} ans</B>. En dessous,
          l'accord d'un parent ou tuteur légal est requis.
        </P>
      </Section>

      <Section n={11} icon="📢" title="Réclamation (CNDP)">
        <P>
          Vous pouvez saisir la Commission Nationale de contrôle de la protection des Données à
          caractère Personnel (CNDP) au Maroc : {link('www.cndp.ma', 'https://www.cndp.ma')}.
        </P>
      </Section>

      <Section n={12} icon="🔄" title="Mises à jour">
        <P>
          Nous pouvons faire évoluer cette politique. En cas de changement important, nous vous en
          informerons. La date en haut indique la dernière révision.
        </P>
      </Section>
    </LegalLayout>
  );
}
