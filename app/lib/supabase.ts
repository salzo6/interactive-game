import { createClient } from '@supabase/supabase-js';

// Vite exposes env variables through import.meta.env for client-side code
// Remix server-side code uses process.env
// Use VITE_ prefix as required by Vite to expose to the client,
// and ensure they are loaded server-side as well.
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;


// Basic check to ensure variables are loaded
if (!supabaseUrl) {
  console.error('Error: VITE_SUPABASE_URL environment variable is not set.');
  // Throw an error to prevent SupabaseClient initialization with undefined
  throw new Error('VITE_SUPABASE_URL is not defined. Please check your .env file.');
}
if (!supabaseAnonKey) {
  console.error('Error: VITE_SUPABASE_ANON_KEY environment variable is not set.');
  // Throw an error
  throw new Error('VITE_SUPABASE_ANON_KEY is not defined. Please check your .env file.');
}

// Validate the URL format (basic check)
try {
  new URL(supabaseUrl);
} catch (e) {
  console.error('Error: Invalid VITE_SUPABASE_URL format.', e);
  throw new Error(`Invalid VITE_SUPABASE_URL format: ${supabaseUrl}`);
}


// Create and export the Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Optionally, define types based on your DB schema here or in a separate file
// export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
// export interface Database { ... }
