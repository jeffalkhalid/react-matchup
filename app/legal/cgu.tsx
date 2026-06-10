// Écran légal — Conditions Générales d'Utilisation (PAG MATCH).
// Accessible SANS connexion (lié depuis l'inscription) et depuis le profil.
// ⚠️ Valeurs à compléter dans lib/legal.ts ([EDITEUR]…).
import { Linking, Text } from 'react-native';
import { LEGAL } from '../../lib/legal';
import { LegalLayout, Section, P, B, Bullet, Callout } from '../../components/legal/LegalKit';
import { Colors, Fonts } from '../../lib/theme';

const link = (label: string, url: string) => (
  <Text onPress={() => Linking.openURL(url)} style={{ color: Colors.brandDeep, fontFamily: Fonts.uiBold }}>{label}</Text>
);

export default function CguScreen() {
  const mail = `mailto:${LEGAL.contactEmail}`;
  return (
    <LegalLayout
      kicker="Règles du jeu"
      title="Conditions d'utilisation"
      sub="Les règles qui rendent l'expérience juste et agréable pour toute la communauté padel."
      updated={LEGAL.lastUpdate}
    >
      <Section n={1} icon="🎾" title="Le Service">
        <P>
          <B>{LEGAL.brand}</B> met en relation les joueurs de padel : organisation de parties,
          matchmaking, classement ELO, défis, messagerie et communauté. Nous facilitons l'organisation
          entre joueurs, mais ne garantissons ni la disponibilité d'un terrain, ni la présence
          effective des participants.
        </P>
      </Section>

      <Section n={2} icon="🪪" title="Compte & éligibilité">
        <Bullet>Vous devez avoir au moins {LEGAL.minAge} ans (accord d'un parent ou tuteur si mineur).</Bullet>
        <Bullet>Vos informations doivent être exactes et tenues à jour.</Bullet>
        <Bullet>Vous êtes responsable de vos identifiants et de l'activité sur votre compte.</Bullet>
        <Bullet>Un seul compte par personne ; l'usurpation d'identité est interdite.</Bullet>
      </Section>

      <Section n={3} icon="🤝" title="Règles de conduite">
        <P>En utilisant le Service, vous vous engagez à ne pas :</P>
        <Bullet>publier de contenus illégaux, haineux, violents, harcelants, diffamatoires ou sexuels ;</Bullet>
        <Bullet>usurper l'identité d'un tiers ou tromper les autres joueurs ;</Bullet>
        <Bullet>fausser les scores, le classement ELO ou manipuler le système ;</Bullet>
        <Bullet>collecter les données d'autres utilisateurs sans leur consentement ;</Bullet>
        <Bullet>perturber le service, contourner la sécurité ou en faire un usage automatisé non autorisé.</Bullet>
      </Section>

      <Section n={4} icon="📸" title="Vos contenus">
        <P>
          Vous restez responsable de ce que vous publiez (messages, commentaires, activités) et
          garantissez en détenir les droits. Vous nous accordez une licence limitée et non exclusive,
          aux seules fins de faire fonctionner le Service. Les Stories sont générées sur votre appareil
          et partagées par vos soins : nous ne les hébergeons pas.
        </P>
      </Section>

      <Section n={5} icon="🚫" title="Tolérance zéro">
        <P>
          Aucun contenu répréhensible ni comportement abusif n'est toléré. Nous pouvons retirer tout
          contenu signalé et suspendre ou supprimer le compte d'un contrevenant.
        </P>
        <Callout icon="⏱️" tone="warn">
          Les contenus signalés sont examinés et, le cas échéant, retirés dans un délai raisonnable
          (objectif : sous 24 h).
        </Callout>
      </Section>

      <Section n={6} icon="🛑" title="Signalement & blocage">
        <Bullet>Signalez un contenu ou un utilisateur abusif directement depuis l'application.</Bullet>
        <Bullet>Bloquez un utilisateur pour ne plus interagir avec lui ni voir ses contenus.</Bullet>
      </Section>

      <Section n={7} icon="🏆" title="Parties, scores & classement">
        <P>
          Les résultats et l'évolution du classement ELO sont calculés automatiquement à partir des
          scores saisis et validés par les participants. Un mécanisme de contestation est prévu en cas
          de litige. Toute fraude répétée peut entraîner des sanctions.
        </P>
      </Section>

      <Section n={8} icon="©️" title="Propriété intellectuelle">
        <P>
          Le Service, sa marque, son interface et ses contenus (hors contenus utilisateurs)
          appartiennent à l'éditeur et sont protégés. Toute reproduction sans accord préalable est
          interdite.
        </P>
      </Section>

      <Section n={9} icon="⚠️" title="Responsabilité">
        <P>
          Le Service est fourni « en l'état », sans garantie de disponibilité continue. Dans les limites
          permises par la loi, l'éditeur n'est pas responsable des interactions entre utilisateurs, des
          contenus de tiers, ni des dommages indirects liés à l'utilisation du Service.
        </P>
      </Section>

      <Section n={10} icon="🚪" title="Suspension & résiliation">
        <P>
          Vous pouvez supprimer votre compte à tout moment depuis les réglages. Nous pouvons suspendre
          ou résilier votre accès en cas de violation des présentes CGU.
        </P>
      </Section>

      <Section n={11} icon="🔐" title="Données personnelles">
        <P>
          Le traitement de vos données est détaillé dans notre Politique de confidentialité, accessible
          depuis l'application.
        </P>
      </Section>

      <Section n={12} icon="🔄" title="Modifications">
        <P>
          Nous pouvons modifier ces CGU. En cas de changement important, nous vous en informerons. La
          date en haut indique la dernière révision.
        </P>
      </Section>

      <Section n={13} icon="⚖️" title="Droit applicable">
        <P>
          Les présentes CGU sont régies par le droit marocain. Tout litige relève des juridictions
          compétentes, sous réserve des dispositions légales protectrices applicables.
        </P>
      </Section>

      <Section n={14} icon="✉️" title="Éditeur & contact">
        <P>L'application {LEGAL.appName} est éditée par <B>{LEGAL.editor}</B>.</P>
        <P>Une question sur ces CGU ? {link(LEGAL.contactEmail, mail)}.</P>
      </Section>
    </LegalLayout>
  );
}
