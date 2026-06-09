import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE : flux recommandé pour le mobile. Le lien de récupération renvoie
    // un `?code=…` qu'on échange via exchangeCodeForSession (le code verifier
    // est stocké dans AsyncStorage lors de l'appel resetPasswordForEmail).
    flowType: 'pkce',
  },
});
