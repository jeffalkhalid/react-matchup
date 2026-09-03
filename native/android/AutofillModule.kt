package com.pagmatch.app

import android.os.Build
import android.view.autofill.AutofillManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Pont natif minimal pour forcer Android à committer le contexte d'autofill.
 *
 * Dans une app React Native mono-Activity, naviguer en JS (router.replace) ne
 * ferme pas l'Activity, donc le framework de saisie automatique ne reçoit jamais
 * le signal « formulaire validé » et ne propose jamais d'enregistrer le mot de
 * passe. Appeler AutofillManager.commit() juste après une connexion réussie
 * déclenche la fenêtre « Enregistrer dans Google ? ».
 */
class AutofillModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "AutofillBridge"

  @ReactMethod
  fun commit(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      promise.resolve("sdk<26")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.resolve("no-activity")
      return
    }
    activity.runOnUiThread {
      try {
        val mgr = activity.getSystemService(AutofillManager::class.java)
        if (mgr == null) {
          promise.resolve("no-manager")
          return@runOnUiThread
        }
        // isEnabled = un service autofill est sélectionné pour l'utilisateur.
        val enabled = mgr.isEnabled
        mgr.commit()
        promise.resolve("committed enabled=$enabled")
      } catch (e: Exception) {
        promise.resolve("error:${e.message}")
      }
    }
  }
}
