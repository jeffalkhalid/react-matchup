package com.pagmatch.wear.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.*
import com.pagmatch.wear.*
import kotlinx.coroutines.launch

// Saisie du code a 6 chiffres, un chiffre a la fois. Chaque chiffre se regle
// avec les fleches et se valide avec le bouton central.
@Composable
fun PairingScreen(prefs: Prefs, onPaired: () -> Unit) {
    var digits by remember { mutableStateOf(IntArray(6)) }
    var index by remember { mutableStateOf(0) }
    var status by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Column(
        Modifier.fillMaxSize().padding(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("Code affiche dans l app", textAlign = TextAlign.Center,
             style = MaterialTheme.typography.caption2)
        Spacer(Modifier.height(4.dp))
        Text(digits.joinToString(""), style = MaterialTheme.typography.display2)
        Text("Chiffre ${index + 1}/6", style = MaterialTheme.typography.caption2)
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { digits = digits.clone().also { it[index] = (it[index] + 9) % 10 } },
                   enabled = !busy) { Text("-") }
            Button(onClick = { digits = digits.clone().also { it[index] = (it[index] + 1) % 10 } },
                   enabled = !busy) { Text("+") }
            Button(enabled = !busy, onClick = {
                if (index < 5) { index++ } else {
                    busy = true; status = "..."
                    scope.launch {
                        val body = Api.redeem(digits.joinToString(""), Config.deviceLabel())
                        val reason = Api.errorReason(body)
                        if (reason != null) {
                            status = Api.reasonPair(reason)?.first ?: reason
                            busy = false
                        } else {
                            val t = Api.parseToken(body)
                            if (t == null) { status = "Reponse illisible"; busy = false }
                            else { prefs.token = t; onPaired() }
                        }
                    }
                }
            }) { Text(if (index < 5) ">" else "OK") }
        }
        if (status != null) {
            Spacer(Modifier.height(4.dp))
            Text(status!!, color = MaterialTheme.colors.error,
                 style = MaterialTheme.typography.caption2, textAlign = TextAlign.Center)
        }
    }
}
