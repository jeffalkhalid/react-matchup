package com.pagmatch.wear

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

// ---------------------------------------------------------------------------
// Ce que ce fichier resout, et ce qu'il ne resout PAS
// ---------------------------------------------------------------------------
// Wear OS, contrairement a Connect IQ sur la Garmin, ne laisse pas une
// application ouverte indefiniment. La documentation "Always-on and system
// ambient mode" decrit DEUX delais d'inactivite successifs :
//   - delai n°1 : l'ecran passe de l'etat interactif a l'etat AMBIANT (il
//     s'estompe). C'est le comportement voulu ici : entre deux points l'ecran
//     se met en veille douce, au lever de poignet il se rallume.
//   - delai n°2 : le systeme MASQUE l'application et affiche le cadran. C'est
//     celui-la qui tue la fonctionnalite -- le joueur leve le poignet et lit
//     l'heure au lieu du score.
//
// Le seul remede documente au delai n°2 est l'Ongoing Activity, et la
// documentation le borne explicitement : "On Wear OS 5 and higher, you can
// prevent this by implementing an Ongoing Activity." Wear OS 5 = API 34, alors
// que notre minSdk est 30 (Wear OS 3, Galaxy Watch 4).
//
// MESURE, sur emulateur Wear OS 3 (API 30), avec temoin : le retour au cadran
// EST empeche des cette version. Meme scenario joue deux fois -- 2 min puis
// 10 min de veille, reveil -- avec le service, on retombe sur MainActivity ;
// SANS le service, on retombe sur le cadran. La borne documentee est donc plus
// prudente que le comportement observe. Ne pas se fier a cela comme a une
// garantie pour autant : sur les appareils ou elle ne tiendrait pas, il reste
// ce que la documentation promet vraiment en dessous de Wear OS 5, une icone
// tapotable qui ramene a l'app en un seul geste ("the ongoing activity
// indicator provides a one-tap way for them to return to your app"). C'est le
// plancher ; il est tres au-dessus de rien.
//
// Ce qu'on ne fait PAS, volontairement : le modificateur `keepScreenOn`, seul
// moyen d'eviter le delai n°1. La documentation le dit elle-meme -- "This
// functions as a wake lock [...] Use this with extreme caution as it severely
// impacts battery life" -- et la decision de conception du projet l'interdit :
// un match dure quatre-vingt-dix minutes, un ecran allume en permanence vide
// la montre bien avant la fin. On laisse donc le systeme estomper l'ecran, et
// c'est le lever de poignet qui le rallume. La permission WAKE_LOCK a d'ailleurs
// ete RETIREE du manifeste avec ce meme changement : elle n'etait utilisee
// nulle part, et c'est precisement celle qui permettrait de defaire cette
// regle sans que rien ne le signale.
//
// ---------------------------------------------------------------------------
// PIEGE : ne pas appeler rememberAmbientModeManager() ici. Il plante.
// ---------------------------------------------------------------------------
// La page always-on recommande aujourd'hui, pour Compose,
// `rememberAmbientModeManager` / `LocalAmbientModeManager` (androidx.wear.compose.
// foundation), et ne mentionne AUCUNE contrainte de version. La bibliotheque ne
// porte aucun @RequiresApi non plus. Rien, ni dans la doc ni dans l'IDE, ne
// previent de ce qui suit -- d'ou ce commentaire.
//
// Desassemblage de compose-foundation-1.6.2.aar, DEJA la dependance du projet.
// Le CONSTRUCTEUR, avant meme startListening(), a l'offset 10 :
//
//   AmbientModeManagerImpl.<init>(Activity):
//     10: invokestatic  // com/google/wear/services/ambient/AmbientComponentState
//                       //   .makeActivityStateRegistry()
//
// et rememberAmbientModeManager construit cet objet sans la moindre garde de
// version. `com.google.wear.*` vient de la bibliotheque partagee `wear-sdk`,
// que le manifeste de l'aar declare `required="false"` -- donc absente sans
// erreur d'installation. Sur l'emulateur Wear OS 3 du projet :
//
//   $ adb shell pm list libraries | grep -i wear
//   library:com.google.android.wearable          <-- pas de "wear-sdk"
//
// `wear-sdk` n'arrive qu'a partir de Wear OS 5. Or le minSdk de ce projet est
// 30 (Wear OS 3, Galaxy Watch 4), exigence figee. Ajouter ces trois lignes
// ferait donc planter l'application EN PLEINE COMPOSITION, au premier
// affichage du match, sur le plancher que ce projet s'engage a supporter.
//
// Et ce n'est de toute facon pas necessaire : le systeme estompe et rallume
// l'ecran tout seul. Il n'y a rien a coder ici. Si un jour le minSdk passe a
// 34+, cette API redevient utilisable -- pas avant.
// ---------------------------------------------------------------------------

// Le texte tient sous 20 caracteres, comme sur la Garmin : en plein soleil,
// une balle dans la main, ce qui est court se lit et ce qui est long ne se lit
// pas. La borne est APPLIQUEE, pas seulement esperee.
const val ONGOING_MAX_CHARS = 19

// Passe cet age sans confirmation du serveur, on cesse d'annoncer le jeu en
// cours. Trois battements lents manques (voir OngoingMatch.SLOW_TICK_MS) : une
// seule requete perdue ne doit pas degrader l'affichage, trois de suite disent
// autre chose qu'un hoquet.
//
// Pourquoi degrader au lieu de garder la derniere valeur connue : le jeu en
// cours bouge toutes les 30 secondes, les sets toutes les vingt minutes.
// Apres trois minutes de silence, "40-30" est tres probablement faux tandis
// que "Sets 1-0" est tres probablement encore vrai. On laisse donc tomber la
// clause qui ment vite et on garde celle qui vieillit bien.
//
// Un seul palier, et pas un second qui effacerait aussi les sets : au-dela de
// quelques minutes sans reseau, le probleme n'est plus l'affichage mais
// l'application entiere, et l'utilisateur le voit des qu'il l'ouvre.
const val ONGOING_STALE_MS = 180_000L

// Le texte doit aussi rester en ASCII PUR. Deux raisons, pas une :
//   - le rendu de la notification sur le cadran et dans le tiroir est fait par
//     le systeme avec la police du cadran, dont rien ne garantit qu'elle porte
//     les accents ;
//   - le reste de l'application (MatchScreen, ConfirmScreen, MatchStore) ecrit
//     deja tous ses libelles sans accent, pour la meme raison. Une seule regle
//     partout plutot que deux qui divergeraient.
private fun ascii(text: String): String = text.filter { it.code in 0x20..0x7E }

// Y a-t-il un match a annoncer ? Fonction PURE, donc testable hors Android :
// c'est elle, et pas le cycle de vie du service, qui decide quand l'activite
// en cours commence et quand elle s'arrete.
//
// `session == null` couvre a lui seul les deux fins possibles, et ce n'est pas
// un hasard :
//   - le serveur affirme qu'il n'y a plus de match (has_session:false, seul
//     chemin qui autorise MatchStore.applySession(null) -- une coupure reseau
//     ou un corps illisible ne l'empruntent JAMAIS, cf. serverSaysNoSession
//     dans Session.kt). Une panne de Bluetooth ne doit pas retirer le score du
//     poignet, exactement comme elle ne l'efface pas de l'ecran ;
//   - la montre est deliee : MatchStore.unpair() met _session a null (fige par
//     MatchStoreTest, "token_revoked delie la montre et vide la file").
//     L'etat en cours ne survit donc pas au deliage, sans qu'il faille
//     observer `unpaired` en plus ici -- un seul chemin, pas deux qui
//     pourraient diverger.
// `finished` ferme le dernier cas : le serveur renvoie encore la session mais
// le match est clos (score valide). L'etat en cours ne doit pas lui survivre.
fun shouldShowOngoing(s: Session?): Boolean = s != null && !s.finished

// Le score courant en une ligne. Meme matiere que MatchScreen, comprimee :
// les sets gagnes (sets_won, l'OBJET serveur {t1,t2}) puis le jeu en cours
// (game_label, l'OBJET {t1,t2} de jetons texte "0".."40"/"AV" que le client
// assemble lui-meme, cf. fn_game_label et le consommateur Garmin).
//
// "Sets 1-0 Jeu 40-30" = 18 caracteres, le pire cas realiste. Le tie-break
// prend l'etiquette "TB" plutot que "Jeu" parce que les nombres n'y veulent
// pas dire la meme chose (des points de tie-break, pas 15/30/40), et parce que
// c'est deux caracteres de moins.
//
// `ageMs` est l'age de la derniere confirmation serveur (MatchStore.sessionAgeMs).
fun ongoingText(s: Session?, ageMs: Long = 0L): String {
    // Ne devrait pas arriver (le service ne tourne pas sans session), mais un
    // service de premier plan DOIT porter une notification : renvoyer une
    // chaine vide ferait une notification muette et illisible plutot qu'une
    // erreur visible.
    if (s == null) return "Match en cours"
    val sets = ascii("Sets ${s.setsWon.t1}-${s.setsWon.t2}").take(ONGOING_MAX_CHARS)
    if (ageMs >= ONGOING_STALE_MS) return sets
    // game_label d'abord (il porte 15/30/40/AV), current_game en repli (des
    // entiers, notamment en mode points et en tie-break).
    //
    // Les DEUX cotes doivent etre renseignes. Tester la chaine assemblee
    // (`!= "-"`) ne rattrapait que le cas ou les deux etaient vides : un seul
    // cote vide passait, et donnait "Jeu -5" au poignet -- un texte qui a
    // l'air d'un score sans en etre un, exactement ce qu'un affichage lu d'un
    // coup d'oeil ne doit jamais produire.
    val game = s.gameLabel?.takeIf { it.t1.isNotBlank() && it.t2.isNotBlank() }
        ?.let { "${it.t1}-${it.t2}" }
        ?: s.currentGame?.let { "${it.t1}-${it.t2}" }
    if (game.isNullOrBlank()) return sets
    val full = ascii("$sets ${if (s.tieBreak) "TB" else "Jeu"} $game")
    // DEBORDEMENT : on laisse tomber la clause du jeu, on ne coupe pas la
    // ligne. Tronquer l'assemblage rognait par la DROITE, donc dans le score
    // lui-meme ("Sets 10-10 Jeu 40-3") : la seule chose que cette pastille
    // existe pour dire devenait fausse, silencieusement. Perdre le jeu en
    // cours est une perte d'information ; afficher un score faux est une
    // desinformation. On choisit la premiere.
    return if (full.length <= ONGOING_MAX_CHARS) full else sets
}

// Quand publier la notification echoue, faut-il renoncer au service ?
//
// Fonction PURE parce que la decision est le vrai sujet, et qu'elle ne peut
// pas etre eprouvee ici : les exceptions concernees
// (MissingForegroundServiceTypeException, SecurityException) n'arrivent qu'a
// partir de l'API 34.
//
//   - JAMAIS devenu premier plan : il FAUT se retirer. Un service qui ne
//     rappelle pas startForeground() dans les cinq secondes est tue par le
//     systeme, et il l'est avec une exception qui emporte le PROCESSUS -- donc
//     l'application qui compte les points. stopSelf() desamorce ce compte a
//     rebours proprement : on perd la pastille, on garde le match.
//   - DEJA au premier plan : surtout pas. L'echec ne concerne qu'une mise a
//     jour ; la notification precedente est toujours affichee et toujours
//     a peu pres vraie. La retirer serait remplacer une petite perte de
//     fraicheur par la panne complete que tout ceci evite.
fun shouldGiveUpOnPostFailure(alreadyForeground: Boolean): Boolean = !alreadyForeground

// ---------------------------------------------------------------------------

class OngoingMatch : Service() {

    // Scope PROPRE au service, pas celui de MatchStore : quand le service
    // meurt, son observation meurt avec lui, sans toucher a la boucle d'envoi
    // du store (qui doit survivre -- un point tape juste avant la fin part
    // quand meme, cf. MatchStore).
    private var scope: CoroutineScope? = null

    // Dernier texte REELLEMENT publie. Sans cette memoire, chaque battement de
    // 5 s republierait la meme notification : du travail et de la batterie
    // pour rien, sur l'appareil ou la batterie est justement le sujet.
    private var shown: String? = null

    // La notification a-t-elle deja ete acceptee au moins une fois ? Decide de
    // ce qu'on fait d'un echec de publication (voir shouldGiveUpOnPostFailure).
    private var foreground = false

    // stopSelf() ne coupe pas le collecteur sur-le-champ (onDestroy arrive
    // plus tard) : sans ce drapeau, une emission qui suit rappellerait
    // startForeground sur un service en train de mourir.
    private var stopping = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()

        // MatchStore.get : LE singleton de processus, jamais une seconde
        // instance. Une seconde MatchStore, c'est une seconde Queue sur le
        // meme SharedPreferences, et la mesure citee dans Queue.kt dit ce que
        // cela coute (265 a 280 evenements perdus sur 320). Ce service
        // OBSERVE l'etat existant, il n'en cree aucun.
        val store = MatchStore.get(Prefs(applicationContext))

        // Publie AVANT toute suspension : rien d'asynchrone ne doit s'intercaler
        // entre la creation du service et sa notification.
        post(ongoingText(store.session.value, store.sessionAgeMs))

        val sc = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = sc

        // (a) Suivre l'etat : republier a chaque changement de score.
        sc.launch {
            store.session.collect { s ->
                if (stopping) return@collect
                if (!endIfOver(s)) post(ongoingText(s, store.sessionAgeMs))
            }
        }

        // (b) BATTEMENT LENT, et c'est le correctif de fond.
        //
        // MainActivity arrete le battement rapide a onStop -- c'est-a-dire
        // exactement quand cette pastille commence a servir. Sans cette boucle,
        // `session` ne pouvait alors plus changer du tout : le collecteur
        // ci-dessus observait un flux gele, son stopSelf() etait inatteignable,
        // et la pastille survivait au match jusqu'a reouverture de l'app ou
        // redemarrage de la montre. Un coequipier qui valide le score depuis
        // son telephone laissait un "Sets 1-0" au poignet pour des heures.
        //
        // Cadence : SLOW_TICK_MS = 60 s, contre 5 s au premier plan. Sur un
        // match de quatre-vingt-dix minutes cela fait environ 90 requetes au
        // lieu de 1080, soit 8 % du cout -- et sur une radio que la file
        // d'envoi reveille de toute facon. Soixante secondes est aussi la
        // cadence que le systeme lui-meme attend d'une application en ambiant
        // sur Wear OS 6 ("Updates may be as infrequent as once per minute").
        //
        // On s'efface quand l'activite est au premier plan : elle interroge
        // deja toutes les 5 s, doubler n'apporterait rien.
        sc.launch {
            while (isActive) {
                delay(SLOW_TICK_MS)
                if (stopping) return@launch
                if (!store.isPolling) store.tick()
                // Republier meme sans changement de session : passe
                // ONGOING_STALE_MS, le texte doit se degrader tout seul, et
                // aucune emission ne viendra le declencher justement parce que
                // le serveur ne repond plus.
                val s = store.session.value
                if (!endIfOver(s)) post(ongoingText(s, store.sessionAgeMs))
            }
        }
    }

    // Le match est-il fini ? Si oui, on se retire. Filet de securite : en
    // temps normal c'est MainActivity qui arrete le service (elle seule peut
    // le REDEMARRER). Mais l'etat en cours ne doit jamais survivre au match,
    // et depuis le battement lent ci-dessus ce chemin est desormais
    // ATTEIGNABLE meme quand plus aucun ecran n'est allume.
    private fun endIfOver(s: Session?): Boolean {
        if (shouldShowOngoing(s)) return false
        stopping = true
        stopSelf()
        return true
    }

    // START_NOT_STICKY : si le systeme tue le service faute de memoire, il ne
    // doit PAS le ressusciter tout seul avec un Intent nul. Un match affiche
    // au poignet alors qu'il est fini serait pire que pas de notification du
    // tout ; c'est MainActivity, qui connait la session, qui redemarrera.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

    override fun onDestroy() {
        scope?.cancel()
        scope = null
        // STOP_FOREGROUND_REMOVE : la notification part AVEC le service. Sans
        // ce retrait explicite, l'icone d'activite en cours pourrait rester
        // sur le cadran apres la fin du match ou apres un deliage -- la chose
        // meme que cette tache interdit.
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    // On republie par startForeground() et NON par NotificationManager.notify().
    // Rappeler startForeground() avec le meme identifiant met a jour la
    // notification du service : un seul chemin de publication, et surtout
    // aucun appel a notify() qui, lui, exige POST_NOTIFICATIONS a partir
    // d'Android 13 et resterait silencieusement sans effet si l'utilisateur
    // avait refuse. Une notification de service de premier plan, elle, n'a pas
    // besoin de cette permission pour EXISTER (elle en a besoin pour etre
    // VISIBLE, ce que MainActivity va demander).
    private fun post(text: String) {
        if (text == shown) return
        val notification = build(text)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                // API 34+ : le type est OBLIGATOIRE. Sans lui le systeme leve
                // MissingForegroundServiceTypeException des startForeground().
                // En dessous, le type n'existe pas encore comme argument
                // obligatoire et le passer n'apporterait rien.
                ServiceCompat.startForeground(
                    this, NOTIF_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIF_ID, notification)
            }
            shown = text
            foreground = true
        } catch (e: Exception) {
            // C'EST ICI que les refus arrivent, pas au demarrage du service.
            // startForeground() est ce qui leve MissingForegroundServiceType-
            // Exception et SecurityException (API 34+), et c'est aussi la que
            // remonte un ForegroundServiceStartNotAllowedException selon les
            // versions. La garde placee autour de startForegroundService()
            // (voir le compagnon) ne pouvait rien en attraper.
            //
            // Et c'est le chemin qui n'a JAMAIS tourne : sur l'emulateur
            // API 30, le type de service n'est meme pas exige. Si quoi que ce
            // soit cloche dans la declaration, cela se manifeste pour la
            // premiere fois sur une vraie montre Wear OS 5+, au premier point
            // du match. Sans cette garde, l'application qui compte les points
            // mourait la, et le joueur perdait le score -- pas seulement la
            // pastille.
            //
            // `shown` n'est PAS mis a jour : un texte refuse n'est pas
            // affiche, et une republication ulterieure doit pouvoir reessayer.
            if (shouldGiveUpOnPostFailure(foreground)) {
                stopping = true
                stopSelf()
            }
        }
    }

    private fun build(text: String): Notification {
        // SINGLE_TOP : on RAMENE l'activite existante, on n'en empile pas une
        // seconde. Une seconde MainActivity ne casserait pas le store (il est
        // singleton de processus) mais laisserait deux ecrans de match
        // superposes, et le balayage retour n'en fermerait qu'un.
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
        }
        // FLAG_IMMUTABLE : obligatoire depuis Android 12 (API 31) pour tout
        // PendingIntent qui ne doit pas etre modifie par son destinataire.
        val touch = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(TITLE)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_match)
            // CATEGORY_WORKOUT : la categorie decide de la priorite d'affichage
            // de l'activite en cours sur le cadran. C'est la seule de la liste
            // documentee (call, navigation, transport, alarm, workout,
            // location_sharing, stopwatch) qui decrive un match de padel.
            .setCategory(NotificationCompat.CATEGORY_WORKOUT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(touch)
            // setOngoing(true) : exige par l'API Ongoing Activity, et de toute
            // facon juste -- on ne balaie pas le match en cours par megarde.
            .setOngoing(true)
            // Le score change a chaque point : sans ces deux-la, chaque point
            // ferait vibrer le poignet au milieu de l'echange.
            .setSilent(true)
            .setOnlyAlertOnce(true)

        // Sans setStatus(), le systeme retombe sur le contentText -- donc sur
        // le meme texte. On le passe explicitement quand meme : c'est ce
        // status que le lanceur affiche dans sa section "Recents", et le
        // rendre explicite evite de dependre d'un repli par defaut.
        val status = Status.Builder()
            .addTemplate("#score#")
            .addPart("score", Status.TextPart(text))
            .build()

        // setTouchIntent est OBLIGATOIRE (a defaut d'un contentIntent sur la
        // notification) : sans lui, OngoingActivity.build() leve
        // IllegalArgumentException. Idem pour l'icone statique. Les deux sont
        // fournies ici plutot que laissees au repli implicite.
        val ongoing = OngoingActivity.Builder(applicationContext, NOTIF_ID, builder)
            .setStaticIcon(R.drawable.ic_match)
            .setTouchIntent(touch)
            .setStatus(status)
            .build()
        // apply() MODIFIE le builder ci-dessus pour y greffer les donnees de
        // l'activite en cours : il doit donc etre appele AVANT builder.build().
        ongoing.apply(applicationContext)

        return builder.build()
    }

    private fun createChannel() {
        // IMPORTANCE_LOW : visible, jamais sonore. Le score s'affiche, il ne
        // s'annonce pas -- le joueur a deja la balle en main.
        val channel = NotificationChannel(
            CHANNEL_ID, "Match en cours", NotificationManager.IMPORTANCE_LOW
        )
        channel.setShowBadge(false)
        getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "match_en_cours"
        const val NOTIF_ID = 1

        // Battement du service quand aucune activite n'est au premier plan.
        // Justification chiffree : voir la boucle (b) dans onCreate().
        const val SLOW_TICK_MS = 60_000L
        private const val TITLE = "PAG MATCH"

        // Demarre le service. A n'appeler QUE depuis une activite visible :
        // depuis Android 12 (API 31), passer un service au premier plan alors
        // que l'application est en arriere-plan leve
        // ForegroundServiceStartNotAllowedException. MainActivity respecte
        // cette regle (elle n'observe qu'entre onStart et onStop).
        fun start(context: Context) {
            try {
                // startService() et NON ContextCompat.startForegroundService(),
                // et c'est deliberement l'inverse de l'idiome habituel.
                //
                // MESURE. Avec startForegroundService(), le systeme arme un
                // chien de garde de cinq secondes : si startForeground() n'est
                // pas appele, il tue LE PROCESSUS avec
                //   android.app.RemoteServiceException:
                //     Context.startForegroundService() did not then call
                //     Service.startForeground()
                // Verifie sur l'emulateur en retirant la permission
                // FOREGROUND_SERVICE du manifeste : la SecurityException etait
                // bien attrapee dans post(), le service se retirait bien...
                // et l'application mourait quand meme, une seconde plus tard,
                // sur ce chien de garde. stopSelf() ne le desamorce PAS.
                //
                // Autrement dit : tant qu'on demarre par
                // startForegroundService(), aucune garde en aval ne peut tenir
                // la promesse "on perd la pastille, jamais le match" -- le
                // couperet ne vient pas de notre code.
                //
                // startService() n'arme aucun chien de garde. Le service peut
                // alors appeler startForeground() et, en cas de refus,
                // renoncer sans emporter l'application. C'est legal ici parce
                // que start() n'est appele QUE depuis une activite visible
                // (MainActivity, entre onStart et onStop) : une application au
                // premier plan a le droit de demarrer un service ordinaire et
                // de le passer au premier plan dans la foulee. Depuis
                // l'arriere-plan, startService() leve IllegalStateException
                // (API 26+), attrapee juste en dessous.
                context.startService(Intent(context, OngoingMatch::class.java))
            } catch (e: Exception) {
                // Perdre la notification est desagreable ; faire tomber
                // l'application qui compte les points pendant un match serait
                // grave. Jamais l'un au prix de l'autre.
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, OngoingMatch::class.java))
            } catch (e: Exception) {
                // Idem.
            }
        }
    }
}
