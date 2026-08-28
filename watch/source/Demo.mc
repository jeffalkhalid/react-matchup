// watch/source/Demo.mc
// TEMPORAIRE — retire en Task 8.
//
// Le simulateur n'a ni jeton d'appairage ni session live : sans ce jeu de
// donnees, impossible de VOIR l'ecran de match sur les 15 familles. On simule
// donc le pire cas realiste : trois sets, noms longs, score de point, message.
module Demo {

    // Mettre a true UNIQUEMENT pour la passe de verification visuelle.
    const ENABLED = false;

    function payload() {
        return {
            "has_session"   => true,
            "session_id"    => "demo",
            "scoring_mode"  => "points",
            "golden_point"  => true,
            "team1"         => "Alexandre & Christophe",
            "team2"         => "Bartholomew & Dominique",
            "team1_short"   => "A&C",
            "team2_short"   => "B&D",
            "sets"          => [ {"t1" => 6, "t2" => 4}, {"t1" => 3, "t2" => 6}, {"t1" => 5, "t2" => 4} ],
            "sets_won"      => {"t1" => 1, "t2" => 1},
            "game_label"    => {"t1" => "40", "t2" => "AV"},
            "contest_count" => 0,
            "input_device"  => "watch",
            "is_scorer"     => true,
            "finished"      => false,
            "match_decided" => false
        };
    }
}
