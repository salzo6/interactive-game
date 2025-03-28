import { createClient } from '@supabase/supabase-js';

// Access environment variables for client/server
// Client-side: Vite uses import.meta.env (available after build or in dev)
// Server-side: Node.js uses process.env (loaded via Vite/Remix)
// Client-side access relies on vars being exposed via window.ENV in root.tsx
const supabaseUrl = typeof document === 'undefined'
  ? process.env.VITE_SUPABASE_URL // Server
  : window.ENV.VITE_SUPABASE_URL; // Client

const supabaseAnonKey = typeof document === 'undefined'
  ? process.env.VITE_SUPABASE_ANON_KEY // Server
  : window.ENV.VITE_SUPABASE_ANON_KEY; // Client


// Basic check to ensure variables are loaded
if (!supabaseUrl) {
  console.error('Error: VITE_SUPABASE_URL environment variable is not set.');
  throw new Error('VITE_SUPABASE_URL is not defined. Check server env and client exposure.');
}
if (!supabaseAnonKey) {
  console.error('Error: VITE_SUPABASE_ANON_KEY environment variable is not set.');
  throw new Error('VITE_SUPABASE_ANON_KEY is not defined. Check server env and client exposure.');
}

// Validate the URL format (basic check) - only if URL is present
if (supabaseUrl) {
    try {
      new URL(supabaseUrl);
    } catch (e) {
      console.error('Error: Invalid VITE_SUPABASE_URL format.', e);
      throw new Error(`Invalid VITE_SUPABASE_URL format: ${supabaseUrl}`);
    }
}


// Create and export the Supabase client
// We pass the storage option only on the client-side to enable session persistence
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        // Only use localStorage on the client-side
        persistSession: typeof document !== 'undefined',
        // autoRefreshToken: typeof document !== 'undefined', // default is true
        // detectSessionInUrl: typeof document !== 'undefined', // default is true
    }
});

// Optionally, define types based on your DB schema here or in a separate file
// export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
// export interface Database { ... }
