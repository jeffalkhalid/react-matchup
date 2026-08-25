// watch/source/Queue.mc
// File d'envoi persistante : un appui est enregistré ICI d'abord, envoyé
// ensuite. Tant qu'un envoi n'a pas été acquitté, l'événement reste en tête
// et sera rejoué — c'est l'idempotence côté serveur (client_seq) qui rend ce
// rejeu sûr. Cf. spec §7.
using Toybox.Application;
using Toybox.Lang;

module Queue {

    const KEY_ITEMS = "queue_items";
    const KEY_SEQ   = "queue_seq";

    function items() {
        var v = Application.Storage.getValue(KEY_ITEMS);
        if (v == null) { return []; }
        return v;
    }

    function save(a) {
        Application.Storage.setValue(KEY_ITEMS, a);
    }

    // client_seq monotone, JAMAIS réutilisé : c'est la clé d'idempotence.
    function nextSeq() {
        var s = Application.Storage.getValue(KEY_SEQ);
        if (s == null) { s = 0; }
        s = s + 1;
        Application.Storage.setValue(KEY_SEQ, s);
        return s;
    }

    function push(sessionId, eventType, team, seq) {
        var a = items();
        a.add({ "sid" => sessionId, "type" => eventType, "team" => team, "seq" => seq });
        save(a);
    }

    function head() {
        var a = items();
        if (a.size() == 0) { return null; }
        return a[0];
    }

    function popHead() {
        var a = items();
        if (a.size() == 0) { return; }
        var b = [];
        for (var i = 1; i < a.size(); i = i + 1) { b.add(a[i]); }
        save(b);
    }

    function size() { return items().size(); }

    function clear() { save([]); }
}
