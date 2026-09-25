import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { libererMonJeton } from '../lib/pushToken';
import type { Player } from '../types';

interface PlayerContextValue {
  player: Player | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue>({
  player: null,
  loading: true,
  refresh: async () => {},
  signOut: async () => {},
});

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [player, setPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPlayer = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPlayer(null); setLoading(false); return; }
    const { data } = await supabase
      .from('players')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (!data) { setPlayer(null); setLoading(false); return; }

    const { data: seasonData } = await supabase
      .from('leaderboard_season')
      .select('season_points')
      .eq('player_id', data.id)
      .maybeSingle();

    const season_points = seasonData?.season_points ?? 0;
    setPlayer({ ...data, season_points });
    setLoading(false);
  };

  useEffect(() => {
    fetchPlayer();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { setPlayer(null); setLoading(false); }
      else if (event === 'SIGNED_IN') { fetchPlayer(); }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // Libère le jeton push de CET appareil (le jeton est par-appareil ; sans ça
    // il reste collé à un compte délogué et provoque des notifs croisées).
    // On ne touche pas aux autres téléphones du joueur : voir libererMonJeton.
    if (player) {
      await libererMonJeton(player.id);
    }
    await supabase.auth.signOut();
    setPlayer(null);
  };

  return (
    <PlayerContext.Provider value={{ player, loading, refresh: fetchPlayer, signOut }}>
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer() {
  return useContext(PlayerContext);
}
