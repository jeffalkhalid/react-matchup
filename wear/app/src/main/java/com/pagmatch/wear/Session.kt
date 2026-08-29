package com.pagmatch.wear

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

// Forme du payload verifiee contre trois sources : fn_watch_payload
// (supabase/migrations/watch_team_initials.sql, qui redefinit la fonction de
// watch_rpcs.sql en n'ajoutant que team1_short/team2_short), les types
// SetScore/LiveState de lib/liveScore.ts, et le consommateur Garmin de
// production watch/source/SessionView.mc.

@Serializable
data class SetScore(val t1: Int = 0, val t2: Int = 0)

// fn_game_label (watch_rpcs.sql) renvoie un OBJET jsonb {t1,t2} de TEXTE
// ("0".."40", "AV"), jamais une chaine "30 - 15" deja composee : c'est
// SessionView.mc (Garmin) qui assemble le tiret cote client
// (`g["t1"] + " - " + g["t2"]`).
@Serializable
data class GameLabel(val t1: String = "", val t2: String = "")

@Serializable
data class Session(
    @SerialName("has_session")    val hasSession: Boolean = false,
    @SerialName("session_id")     val sessionId: String = "",
    @SerialName("scoring_mode")   val scoringMode: String = "games",
    @SerialName("is_scorer")      val isScorer: Boolean = false,
    // coalesce(s.input_device, 'phone') cote SQL : toujours present dans un
    // vrai payload, jamais null.
    @SerialName("input_device")   val inputDevice: String = "phone",
    val team1: String = "",
    val team2: String = "",
    // coalesce(t1s, 'E1') / coalesce(t2s, 'E2') cote SQL : toujours presents,
    // jamais null, dans un vrai payload.
    @SerialName("team1_short")    val team1Short: String = "E1",
    @SerialName("team2_short")    val team2Short: String = "E2",
    val sets: List<SetScore> = emptyList(),
    // OBJET {t1,t2} (jsonb_build_object cote SQL), PAS un tableau [1,1] :
    // SessionView.mc lit sw["t1"]/sw["t2"], jamais sw[0]/sw[1].
    @SerialName("sets_won")       val setsWon: SetScore = SetScore(),
    @SerialName("current_game")   val currentGame: SetScore? = null,
    @SerialName("game_label")     val gameLabel: GameLabel? = null,
    // coalesce(s.golden_point, true) cote SQL : le defaut serveur est true,
    // pas false.
    @SerialName("golden_point")   val goldenPoint: Boolean = true,
    @SerialName("tie_break")      val tieBreak: Boolean = false,
    @SerialName("match_decided")  val matchDecided: Boolean = false,
    val finished: Boolean = false,
    @SerialName("contest_count")  val contestCount: Int = 0,
)

private val json = Json { ignoreUnknownKeys = true; isLenient = true }

// VRAI uniquement quand le serveur a DIT qu'il n'y a pas de match
// (has_session:false). Un corps illisible -- une page HTML 502 du edge, une
// reponse tronquee par une coupure Bluetooth -- renvoie FAUX, pas VRAI.
// parseSession() confond les deux (null dans les deux cas) et l'appelant qui
// s'y fiait annoncait "Aucun match en cours" en plein match, sur un simple
// hoquet du reseau. Le doute ne doit jamais effacer le score affiche : seule
// une affirmation du serveur le peut.
fun serverSaysNoSession(body: String?): Boolean {
    if (body == null) return false
    return try {
        val v = json.parseToJsonElement(body).jsonObject["has_session"] ?: return false
        v.jsonPrimitive.booleanOrNull == false
    } catch (e: Exception) { false }
}

// Renvoie null quand il n'y a pas de match en cours. Le serveur signale ce cas
// par has_session:false plutot que par un corps vide.
fun parseSession(body: String?): Session? {
    if (body == null) return null
    return try {
        val s = json.decodeFromString<Session>(body)
        if (s.hasSession) s else null
    } catch (e: Exception) { null }
}
