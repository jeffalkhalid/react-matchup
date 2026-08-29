package com.pagmatch.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import com.pagmatch.wear.ui.PairingScreen

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

    MaterialTheme {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            if (!paired) {
                PairingScreen(prefs = prefs, onPaired = { paired = true })
            } else {
                // L'ecran de match arrive a la Task 6.
                Text("Appaire")
            }
        }
    }
}
