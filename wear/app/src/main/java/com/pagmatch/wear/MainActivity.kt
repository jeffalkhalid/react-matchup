package com.pagmatch.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.wear.compose.material.MaterialTheme
import com.pagmatch.wear.ui.MatchScreen
import com.pagmatch.wear.ui.PairingScreen
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val prefs = Prefs(applicationContext)
        setContent { App(prefs) }
    }
}

@Composable
fun App(prefs: Prefs) {
    // paired ne relit prefs.token qu'a la creation : une fois l'appairage
    // reussi, onPaired() bascule cet etat sans redemarrer l'activite.
    var paired by remember { mutableStateOf(prefs.token != null) }
    // Cree UNE SEULE FOIS pour toute la duree de vie de l'ecran de match :
    // MatchStore ouvre sa propre Queue (voir MatchStore.kt), et une seconde
    // instance ouvrirait une seconde Queue sur le meme store -- exactement
    // le scenario qui a fait perdre 265 a 280 evenements sur 320 en mesure
    // (cf. le commentaire d'enqueue() dans Queue.kt). `remember` garantit
    // que cette instance survit aux recompositions.
    val store = remember { MatchStore(prefs) }

    MaterialTheme {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (!paired) {
                PairingScreen(prefs = prefs, onPaired = { paired = true })
            } else {
                // Rafraichissement au premier affichage puis toutes les 5 s
                // tant que l'ecran de match est visible, meme rythme que la
                // Garmin (SessionView.mc, onTick) : si des evenements
                // attendent encore en file, on tente de les vider en
                // priorite (c'est ce qui vide la file des le retour du
                // reseau, sans attendre un nouveau tapotement) ; sinon on
                // rafraichit simplement l'etat du match.
                LaunchedEffect(store) {
                    while (true) {
                        if (store.pending > 0) store.drain() else store.refresh()
                        delay(5000)
                    }
                }
                MatchScreen(store = store, onValidate = { /* Task suivante : ecran de validation. */ })
            }
        }
    }
}
