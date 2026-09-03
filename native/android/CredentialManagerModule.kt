package com.pagmatch.app

import android.os.CancellationSignal
import androidx.core.content.ContextCompat
import androidx.credentials.CreatePasswordRequest
import androidx.credentials.CreateCredentialResponse
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.GetPasswordOption
import androidx.credentials.PasswordCredential
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialException
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Pont natif vers l'API Jetpack Credential Manager (androidx.credentials).
 *
 * Contrairement au framework autofill (détection automatique, qui retombe en
 * « augmented-only » sans sauvegarde sur certains Samsung), ici l'app DEMANDE
 * explicitement à Google Password Manager :
 *  - savePassword() → boîte « Enregistrer le mot de passe ? » (createCredential)
 *  - getPassword()  → sélecteur d'identifiants enregistrés (getCredential)
 *
 * Les deux affichent une UI système → nécessitent l'Activity courante.
 */
class CredentialManagerModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "CredentialManagerBridge"

  @ReactMethod
  fun savePassword(username: String, password: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve("no-activity")
      return
    }
    val cm = CredentialManager.create(activity)
    val request = CreatePasswordRequest(id = username, password = password)
    cm.createCredentialAsync(
      activity,
      request,
      CancellationSignal(),
      ContextCompat.getMainExecutor(activity),
      object : CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException> {
        override fun onResult(result: CreateCredentialResponse) {
          promise.resolve("saved")
        }
        override fun onError(e: CreateCredentialException) {
          // ex. utilisateur a annulé / déjà enregistré → on ne casse pas le flow.
          promise.resolve("error:${e.type}")
        }
      },
    )
  }

  @ReactMethod
  fun getPassword(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve(null)
      return
    }
    val cm = CredentialManager.create(activity)
    val request = GetCredentialRequest(listOf(GetPasswordOption()))
    cm.getCredentialAsync(
      activity,
      request,
      CancellationSignal(),
      ContextCompat.getMainExecutor(activity),
      object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
        override fun onResult(result: GetCredentialResponse) {
          val cred = result.credential
          if (cred is PasswordCredential) {
            val map = Arguments.createMap()
            map.putString("username", cred.id)
            map.putString("password", cred.password)
            promise.resolve(map)
          } else {
            promise.resolve(null)
          }
        }
        override fun onError(e: GetCredentialException) {
          // pas d'identifiant enregistré / annulé → null (pas une erreur fatale).
          promise.resolve(null)
        }
      },
    )
  }
}
