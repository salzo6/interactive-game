/**
 * By default, Remix will handle hydrating your application on the client for
 * you. You are free to delete this file if you'd like to, but if you ever
 * want it revealed again, you can run `npx remix reveal` ✨
 * For more information, see https://remix.run/file-conventions/entry.client
 */

import { RemixBrowser } from "@remix-run/react";
import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { createClient } from '@supabase/supabase-js';
import { useNavigate } from 'react-router-dom'; // Import useNavigate

// Client-side Supabase initialization
// Access ENV vars passed from the server via window.ENV
const supabaseUrl = window.ENV.VITE_SUPABASE_URL;
const supabaseAnonKey = window.ENV.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Supabase URL or Anon Key not found on client. Check root loader.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Listen for Supabase auth changes to keep session consistent
// Note: This basic example just reloads the page. More sophisticated handling
// might involve updating state without a full reload using Remix's fetchers/loaders.
supabase.auth.onAuthStateChange((event, session) => {
  console.log('Supabase auth state changed:', event, session);
  // A simple way to reflect auth changes is to trigger a Remix navigation/reload
  // This might not be the most efficient, but ensures loaders re-run with new auth state.
  // Consider using Remix's `useRevalidator` for a smoother update in specific components.

  // Example: Reload on sign-in/sign-out to ensure loaders re-run
  // Avoid reloading on TOKEN_REFRESHED to prevent unnecessary reloads
  if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
     // Use navigate hook or window.location.reload()
     // Using window.location.reload() is simpler here but less elegant
     window.location.reload();
  }
});


startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>
  );
});
