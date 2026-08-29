package com.pagmatch.wear

import android.content.Context

// Le jeton d'appairage survit aux redemarrages : on ne demande le code qu'une
// seule fois, comme sur la Garmin.
//
// Toute ecriture ICI utilise commit(), jamais apply() : voir le commentaire
// d'en-tete de KeyValueStore dans Queue.kt. Prefs est le store qui porte la
// file d'envoi (Queue), et tout le raisonnement d'atomicite de cette file
// suppose qu'un putString() qui retourne a deja atteint le disque, et que
// deux ecritures successives s'appliquent dans l'ordre ou elles ont ete
// emises -- ce que apply() (asynchrone) ne garantit pas.
class Prefs(context: Context) : KeyValueStore {
    private val sp = context.getSharedPreferences("pagmatch", Context.MODE_PRIVATE)

    override fun getString(k: String): String? = sp.getString(k, null)
    override fun putString(k: String, v: String) {
        sp.edit().putString(k, v).commit()
    }

    var token: String?
        get() = sp.getString(KEY_TOKEN, null)?.ifEmpty { null }
        set(v) {
            sp.edit().apply { if (v == null) remove(KEY_TOKEN) else putString(KEY_TOKEN, v) }.commit()
        }

    companion object { const val KEY_TOKEN = "watch_token" }
}
