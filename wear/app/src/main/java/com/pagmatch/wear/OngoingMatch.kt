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
import androidx.core.content.ContextCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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
// c'est le lever de poignet qui le rallume.
// ---------------------------------------------------------------------------

// Le texte tient sous 20 caracteres, comme sur la Garmin : en plein soleil,
// une balle dans la main, ce qui est court se lit et ce qui est long ne se lit
// pas. La borne est appliquee par clampAscii(), pas seulement esperee.
const val ONGOING_MAX_CHARS = 19

// Le texte doit aussi rester en ASCII PUR. Deux raisons, pas une :
//   - le rendu de la notification sur le cadran et dans le tiroir est fait par
//     le systeme avec la police du cadran, dont rien ne garantit qu'elle porte
//     les accents ;
//   - le reste de l'application (MatchScreen, ConfirmScreen, MatchStore) ecrit
//     deja tous ses libelles sans accent, pour la meme raison. Une seule regle
//     partout plutot que deux qui divergeraient.
private fun clampAscii(text: String): String =
    text.filter { it.code in 0x20..0x7E }.take(ONGOING_MAX_CHARS).trimEnd()

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
//   - la montre est deliee : MatchStore.unpair() met _session a null. L'etat
//     en cours ne survit donc pas au deliage, sans qu'il faille observer
//     `unpaired` en plus ici -- un seul chemin, pas deux qui pourraient
//     diverger.
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
fun ongoingText(s: Session?): String {
    // Ne devrait pas arriver (le service ne tourne pas sans session), mais un
    // service de premier plan DOIT porter une notification : renvoyer une
    // chaine vide ferait une notification muette et illisible plutot qu'une
    // erreur visible.
    if (s == null) return "Match en cours"
    val sets = "${s.setsWon.t1}-${s.setsWon.t2}"
    // game_label d'abord (il porte 15/30/40/AV), current_game en repli (des
    // entiers, notamment en mode points et en tie-break).
    val game = s.gameLabel?.let { "${it.t1}-${it.t2}" }?.takeIf { it != "-" }
        ?: s.currentGame?.let { "${it.t1}-${it.t2}" }
    if (game.isNullOrBlank()) return clampAscii("Sets $sets")
    return clampAscii("Sets $sets ${if (s.tieBreak) "TB" else "Jeu"} $game")
}

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

        // Publie AVANT toute suspension. Le systeme accorde cinq secondes
        // entre startForegroundService() et startForeground() ; passe ce
        // delai il tue le processus. Rien d'asynchrone ne doit s'intercaler.
        post(ongoingText(store.session.value))

        val sc = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = sc
        sc.launch {
            store.session.collect { s ->
                if (stopping) return@collect
                if (!shouldShowOngoing(s)) {
                    // Filet de securite : normalement c'est MainActivity qui
                    // arrete le service (elle seule peut le REDEMARRER, cf.
                    // son commentaire). Mais l'etat en cours ne doit jamais
                    // survivre au match, meme si ce chemin-la manquait.
                    stopping = true
                    stopSelf()
                    return@collect
                }
                post(ongoingText(s))
            }
        }
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
        shown = text
        val notification = build(text)
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
        private const val TITLE = "PAG MATCH"

        // Demarre le service. A n'appeler QUE depuis une activite visible :
        // depuis Android 12 (API 31), demarrer un service de premier plan
        // alors que l'application est en arriere-plan leve
        // ForegroundServiceStartNotAllowedException. MainActivity respecte
        // cette regle (elle n'observe qu'entre onStart et onStop) ; le
        // try/catch est la pour la course residuelle -- une session qui
        // arrive juste au moment ou l'ecran s'eteint. Perdre la notification
        // est desagreable ; faire tomber l'application qui compte les points
        // pendant un match serait grave. Jamais l'un au prix de l'autre.
        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(
                    context, Intent(context, OngoingMatch::class.java)
                )
            } catch (e: Exception) {
                // Volontairement muet : voir ci-dessus.
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
