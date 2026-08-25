// watch/source/Api.mc
// Toutes les requêtes vers Supabase. Le jeton d'appairage est stocké en
// permanence dans Application.Storage : il survit aux redémarrages.
using Toybox.Communications;
using Toybox.Application;
using Toybox.Lang;

module Api {

    const KEY_TOKEN = "watch_token";

    function token() {
        return Application.Storage.getValue(KEY_TOKEN);
    }

    function hasToken() {
        var t = token();
        return t != null && t.length() > 0;
    }

    function setToken(t) {
        Application.Storage.setValue(KEY_TOKEN, t);
    }

    function clearToken() {
        Application.Storage.deleteValue(KEY_TOKEN);
    }

    function headers() {
        return {
            "Content-Type"  => Communications.REQUEST_CONTENT_TYPE_JSON,
            "apikey"        => Config.ANON_KEY,
            "Authorization" => "Bearer " + Config.ANON_KEY
        };
    }

    function post(path, body, cb) {
        Communications.makeWebRequest(
            Config.SUPABASE_URL + "/rest/v1/rpc/" + path,
            body,
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => headers(),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            cb
        );
    }

    // cb.invoke(responseCode, data)
    function redeem(code, cb) {
        post("redeem_watch_pairing_code",
             { "p_code" => code, "p_device_label" => Config.DEVICE_LABEL }, cb);
    }

    function currentSession(cb) {
        post("watch_current_session", { "p_token" => token() }, cb);
    }

    function applyEvent(sessionId, eventType, team, clientSeq, cb) {
        post("watch_apply_event", {
            "p_token"      => token(),
            "p_session_id" => sessionId,
            "p_event_type" => eventType,
            "p_payload"    => { "team" => team },
            "p_client_seq" => clientSeq
        }, cb);
    }
}
