// watch/source/PagMatchApp.mc
// Le nom de cette classe doit rester synchronisé avec l'attribut `entry`
// de manifest.xml, sinon l'app ne démarre pas.
using Toybox.Application;
using Toybox.WatchUi;

class PagMatchApp extends Application.AppBase {

    function initialize() { AppBase.initialize(); }

    function getInitialView() {
        // Déjà appairée → droit au match. Sinon → saisie du code.
        // Les deux delegates prennent leur vue en argument.
        if (Api.hasToken()) {
            var s = new SessionView();
            return [s, new SessionDelegate(s)];
        }
        var v = new PairingView();
        return [v, new PairingDelegate(v)];
    }
}
