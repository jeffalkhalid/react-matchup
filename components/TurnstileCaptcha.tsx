// ============================================================
// TurnstileCaptcha — remplaçant drop-in de @hcaptcha/react-native-hcaptcha
// pour Cloudflare Turnstile, basé sur react-native-webview.
//
// ⚠️ DRAFT non testé sur device : nécessite une Site Key Turnstile
//    (dash.cloudflare.com, widget type "Invisible") + Supabase Auth
//    configuré sur Turnstile. Reste inerte tant que les écrans gardent
//    CAPTCHA_ENABLED = false.
//
// API compatible avec l'ancien composant hCaptcha, pour minimiser les
// changements dans login.tsx / signup.tsx :
//   - ref.show()   → déclenche le challenge (turnstile.execute)
//   - ref.reset()  → réarme le widget (token usage unique)
//   - onMessage(event) → event.nativeEvent.data contient :
//        * le token (string longue >35) en cas de succès
//        * 'error' | 'expired' | 'cancel' sinon
//   (handleCaptchaMessage lit déjà exactement ce contrat.)
// ============================================================
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export type TurnstileCaptchaHandle = {
  show: () => void;
  reset: () => void;
};

type Props = {
  siteKey: string;
  /** Origine déclarée à Turnstile (doit matcher un domaine autorisé). */
  url?: string;
  languageCode?: string;
  onMessage: (event: WebViewMessageEvent) => void;
};

// Le widget Turnstile s'exécute en mode "execute" (déféré) : rien ne tourne
// tant que turnstile.execute() n'est pas appelé via show().
const buildHtml = (siteKey: string, lang: string) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
  <style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}</style>
</head>
<body>
  <div id="cf"></div>
  <script>
    var widgetId = null;
    function post(msg){ if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(String(msg)); }
    function render(){
      if (!window.turnstile) { setTimeout(render, 150); return; }
      widgetId = window.turnstile.render('#cf', {
        sitekey: '${siteKey}',
        language: '${lang}',
        execution: 'execute',
        appearance: 'interaction-only',
        callback: function(token){ post(token); },
        'error-callback': function(){ post('error'); },
        'expired-callback': function(){ post('expired'); },
        'timeout-callback': function(){ post('expired'); }
      });
    }
    function doExecute(){ if (window.turnstile && widgetId !== null) window.turnstile.execute(widgetId); }
    function doReset(){ if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId); }
    render();
  </script>
</body>
</html>`;

const TurnstileCaptcha = forwardRef<TurnstileCaptchaHandle, Props>(
  ({ siteKey, url, languageCode = 'fr', onMessage }, ref) => {
    const webRef = useRef<WebView>(null);

    useImperativeHandle(ref, () => ({
      // reset avant execute → garantit un token frais même après un échec
      // (les tokens Turnstile sont à usage unique et expirent).
      show: () => webRef.current?.injectJavaScript('doReset(); doExecute(); true;'),
      reset: () => webRef.current?.injectJavaScript('doReset(); true;'),
    }));

    return (
      <WebView
        ref={webRef}
        source={{ html: buildHtml(siteKey, languageCode), baseUrl: url ?? 'https://localhost' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        // Invisible : le widget ne doit occuper aucune place dans le layout.
        style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }}
        containerStyle={{ position: 'absolute', width: 0, height: 0 }}
      />
    );
  },
);

TurnstileCaptcha.displayName = 'TurnstileCaptcha';
export default TurnstileCaptcha;
