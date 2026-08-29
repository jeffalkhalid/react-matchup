package com.pagmatch.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.wear.compose.material.MaterialTheme
import com.pagmatch.wear.ui.MatchScreen
import com.pagmatch.wear.ui.PairingScreen

class MainActivity : ComponentActivity() {
    // MatchStore.get : UNE instance par PROCESSUS, jamais une par activite.
    // Wear OS termine l'activite au balayage vers la droite (et le manifeste ne
    // declare aucun configChanges), donc rouvrir l'app construisait auparavant
    // une seconde MatchStore -- donc une seconde Queue sur le meme
    // SharedPreferences, pendant qu'un envoi de la premiere etait encore en
    // vol. Voir le commentaire de classe de MatchStore et celui d'enqueue()
    // dans Queue.kt : le verrou de Queue n'offre AUCUNE exclusion entre deux
    // instances, et la mesure dit 265 a 280 evenements perdus sur 320.
    private lateinit var store: MatchStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(applicationContext)
        store = MatchStore.get(prefs)
        setContent { App(prefs, store) }
    }

    // Le battement suit le CYCLE DE VIE, pas la composition : ecran eteint ou
    // app en arriere-plan, on cesse d'interroger le serveur (batterie de
    // montre). Un envoi deja en vol n'est PAS annule pour autant : il vit sur
    // le scope du store, qui survit a cette activite -- un point tape juste
    // avant l'extinction part quand meme.
    override fun onStart() {
        super.onStart()
        store.startPolling()
    }

    override fun onStop() {
        super.onStop()
        store.stopPolling()
    }
}

@Composable
fun App(prefs: Prefs, store: MatchStore) {
    // paired ne relit prefs.token qu'a la creation : une fois l'appairage
    // reussi, onPaired() bascule cet etat sans redemarrer l'activite.
    var paired by remember { mutableStateOf(prefs.token != null) }
    // Le telephone a delie la montre (token_revoked) : retour a l'appairage.
    // Sans ce chemin, fn_watch_link refuse tout pour toujours et l'app n'est
    // plus bonne qu'a reinstaller.
    val unpaired by store.unpaired.collectAsState()
    LaunchedEffect(unpaired) { if (unpaired) paired = false }

    MaterialTheme {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (!paired) {
                PairingScreen(prefs = prefs, onPaired = {
                    store.onPaired()
                    paired = true
                })
            } else {
                MatchScreen(store = store, onValidate = { /* Task suivante : ecran de validation. */ })
            }
        }
    }
}
