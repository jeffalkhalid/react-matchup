package com.pagmatch.wear

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

object Api {
    private val client = OkHttpClient()
    private val JSON = "application/json".toMediaType()
    private val lenient = Json { ignoreUnknownKeys = true; isLenient = true }

    // ---- Refus serveur : les rendre LISIBLES au poignet --------------------
    // PostgREST renvoie le texte du RAISE dans "message"
    // ({"code":"P0001","message":"not_the_scorer"}). redeem_watch_pairing_code
    // repond 200 avec {"ok":false,"reason":"..."} : meme extraction, deux cles.
    fun errorReason(body: String?): String? {
        if (body == null) return null
        return try {
            val o = lenient.parseToJsonElement(body).jsonObject
            val m = o["message"] ?: o["reason"] ?: return null
            m.jsonPrimitive.content
        } catch (e: Exception) { null }
    }

    // LA PAIRE EST L'UNITE D'EDITION. Chaque raison porte DEUX formulations :
    // la riche, et le repli court employe quand la riche ne tient pas. Les
    // separer en deux tables etait un piege sur la Garmin : ajouter une raison
    // a l'une sans penser a l'autre rendait l'ecran muet pour cette seule
    // raison, sans que rien ne le signale.
    //
    // Table reconciliee avec watch/source/Api.mc (app Garmin, en prod) : en cas
    // de desaccord avec un brouillon anterieur, c'est TOUJOURS la formulation
    // Garmin qui l'emporte, elle seule a ete relue sur un cadran reel.
    //
    // Chaines SANS ACCENTS (contrainte du projet, cf. Garmin dont les polices
    // systeme ne les garantissent pas — regle gardee pour les deux montres).
    // Forme riche <= 20 caracteres, forme courte <= 10 : au-dela, l'ecran rond
    // le plus petit du parc Garmin n'affichait rien plutot que de rogner.
    fun reasonPair(reason: String?): Pair<String, String>? = when (reason) {
        null -> null
        "token_revoked"     -> "Montre deliee"      to "Deliee"
        "not_the_scorer"    -> "Plus le scoreur"    to "Pas toi"
        "watch_has_control" -> "Montre a la main"   to "Montre"
        "session_not_live"  -> "Match termine"      to "Termine"
        "not_a_participant" -> "Plus dans ce match" to "Hors match"
        "rate_limited"      -> "Trop d essais"      to "Attendre"
        "invalid_code"      -> "Code invalide"      to "Invalide"
        "code_expired"      -> "Code expire"        to "Expire"
        "code_already_used" -> "Code deja utilise"  to "Deja pris"
        "feature_disabled"  -> "Fonction desactivee" to "Desactivee"
        // Ces deux-la ne vivent pas dans la table Garmin elle-meme mais dans un
        // cas particulier de ConfirmView.mc (watch_finalize_session seulement) :
        // memes formulations, ramenees ici dans la table unique.
        "no_winner"         -> "Pas de vainqueur"   to "Non fini"
        "not_enough_sets"   -> "Moins de 2 sets"    to "2 sets min"
        else -> null
    }

    private suspend fun post(path: String, body: String): String = withContext(Dispatchers.IO) {
        val req = Request.Builder()
            .url("${Config.SUPABASE_URL}/rest/v1/rpc/$path")
            .addHeader("Content-Type", "application/json")
            .addHeader("apikey", Config.ANON_KEY)
            .addHeader("Authorization", "Bearer ${Config.ANON_KEY}")
            .post(body.toRequestBody(JSON))
            .build()
        // OkHttp 5.x : Response.body n'est plus nullable (contrairement a la 4.x
        // que la plupart des exemples ciblent) ; plus besoin de l'appel securise.
        client.newCall(req).execute().use { it.body.string() }
    }

    private fun q(s: String) = Json.encodeToString(JsonPrimitive(s))

    suspend fun redeem(code: String, label: String): String =
        post("redeem_watch_pairing_code", """{"p_code":${q(code)},"p_device_label":${q(label)}}""")

    suspend fun currentSession(token: String): String =
        post("watch_current_session", """{"p_token":${q(token)}}""")

    suspend fun applyEvent(
        token: String, sessionId: String, eventType: String, team: Int, clientSeq: Long
    ): String = post("watch_apply_event",
        """{"p_token":${q(token)},"p_session_id":${q(sessionId)},"p_event_type":${q(eventType)},"p_payload":{"team":$team},"p_client_seq":$clientSeq}""")

    suspend fun finalize(token: String, sessionId: String): String =
        post("watch_finalize_session", """{"p_token":${q(token)},"p_session_id":${q(sessionId)}}""")
}
