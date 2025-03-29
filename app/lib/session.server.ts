import { createCookieSessionStorage, redirect } from '@remix-run/node';
import { supabase as supabaseBrowserClient } from './supabase'; // Browser client
import type { Session } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js'; // Import createClient directly

// Ensure SESSION_SECRET is set in your environment variables for secure cookie signing
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  console.error("FATAL ERROR: SESSION_SECRET environment variable is not set!");
  throw new Error('SESSION_SECRET must be set');
}
if (sessionSecret === '__REPLACE_WITH_A_REAL_SECRET_KEY__') {
    console.warn("WARNING: Using default placeholder SESSION_SECRET. Please replace with a strong, unique secret key in your .env file!");
    // Optionally, throw an error in production environments
    // if (process.env.NODE_ENV === 'production') {
    //   throw new Error('Default SESSION_SECRET is insecure and cannot be used in production.');
    // }
}

// Configure session storage using a cookie
const storage = createCookieSessionStorage({
  cookie: {
    name: 'sb_session', // Choose a name for your cookie
    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
    secrets: [sessionSecret], // Use the secret for signing
    sameSite: 'lax', // Helps prevent CSRF attacks
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
    httpOnly: true, // Prevents client-side JS access
  },
});

// Gets Supabase session object {access_token, refresh_token, user} from the Remix request cookie
export async function getSupabaseSessionFromCookie(
  request: Request
): Promise<Session | null> {
  // console.log("[session.server] getSupabaseSessionFromCookie: Reading cookie..."); // Reduced verbosity
  const cookie = request.headers.get('Cookie');
  const session = await storage.getSession(cookie);
  const supabaseSession = session.get('supabaseSession');
  // console.log(`[session.server] getSupabaseSessionFromCookie: Session found in cookie? ${!!supabaseSession}`); // Reduced verbosity
  return supabaseSession || null;
}

// Gets user data (including metadata) from the session cookie
export async function getUser(request: Request) {
  // console.log("[session.server] getUser: Getting session from cookie..."); // Reduced verbosity
  const session = await getSupabaseSessionFromCookie(request);
  const user = session?.user ?? null;
  // console.log(`[session.server] getUser: User found? ${!!user}, Email: ${user?.email}`); // Reduced verbosity
  return user;
}

// Checks if user is admin based on metadata from session cookie
export async function isAdmin(request: Request): Promise<boolean> {
  // console.log("[session.server] isAdmin: Getting user..."); // Reduced verbosity
  const user = await getUser(request);
  const isAdminUser = user?.user_metadata?.is_admin === true;
  // console.log(`[session.server] isAdmin: User is admin? ${isAdminUser}`); // Reduced verbosity
  return isAdminUser;
}

// Creates a Remix session containing the Supabase session and returns a redirect response
export async function createSessionCookie(
  supabaseSession: Session,
  redirectTo: string
) {
  console.log(`[session.server] createSessionCookie: Creating session for user ${supabaseSession?.user?.email}, redirecting to ${redirectTo}`);
  if (!supabaseSession) {
      console.error("[session.server] createSessionCookie: Error - Received null or undefined supabaseSession.");
      throw new Error("Cannot create session cookie with invalid Supabase session.");
  }
  try {
    const session = await storage.getSession(); // Get a new Remix session object
    // console.log("[session.server] createSessionCookie: Got Remix session storage."); // Reduced verbosity
    session.set('supabaseSession', supabaseSession); // Store the Supabase session data
    // console.log("[session.server] createSessionCookie: Set supabaseSession in Remix session."); // Reduced verbosity

    const cookieHeader = await storage.commitSession(session); // Generate the Set-Cookie header
    // console.log("[session.server] createSessionCookie: Committed session, got Set-Cookie header."); // Reduced verbosity

    return redirect(redirectTo, {
      headers: {
        'Set-Cookie': cookieHeader,
      },
    });
  } catch (error) {
      console.error("[session.server] createSessionCookie: Error during session commit or redirect:", error);
      // Re-throw the error so the calling action can handle it
      throw new Error(`Failed to commit session or redirect: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Destroys the Remix session (logout)
export async function destroySessionCookie(request: Request) {
  console.log("[session.server] destroySessionCookie: Destroying session...");
  const session = await storage.getSession(request.headers.get('Cookie'));
  const cookieHeader = await storage.destroySession(session);
  console.log("[session.server] destroySessionCookie: Session destroyed, redirecting to /login.");
  return redirect('/login', { // Redirect to login after logout
    headers: {
      'Set-Cookie': cookieHeader,
    },
  });
}

// Helper to require authentication in loaders/actions
export async function requireUser(request: Request, redirectTo: string = new URL(request.url).pathname) {
  // console.log(`[session.server] requireUser: Checking user authentication for path: ${redirectTo}`); // Reduced verbosity
  const user = await getUser(request);
  if (!user) {
    console.log("[session.server] requireUser: User not found, redirecting to login.");
    const searchParams = new URLSearchParams([["redirectTo", redirectTo]]);
    throw redirect(`/login?${searchParams}`);
  }
  // console.log(`[session.server] requireUser: User ${user.email} authenticated.`); // Reduced verbosity
  return user;
}

// Helper to require admin role
export async function requireAdmin(request: Request) {
  console.log("[session.server] requireAdmin: Requiring admin role...");
  const user = await requireUser(request); // Ensures user is logged in first
  if (user.user_metadata?.is_admin !== true) {
    console.warn(`[session.server] requireAdmin: User ${user.email} is not an admin. Access denied.`);
    throw new Response("Forbidden: Admins only", { status: 403 });
  }
  console.log(`[session.server] requireAdmin: User ${user.email} is an admin. Access granted.`);
  return user;
}

// Helper to require player (non-admin) role
export async function requirePlayer(request: Request) {
    // console.log("[session.server] requirePlayer: Requiring player role..."); // Reduced verbosity
    const user = await requireUser(request); // Ensures user is logged in first
    if (user.user_metadata?.is_admin === true) {
      console.warn(`[session.server] requirePlayer: User ${user.email} is an admin, not a player. Access denied.`);
      throw new Response("Forbidden: Players only", { status: 403 });
    }
    // console.log(`[session.server] requirePlayer: User ${user.email} is a player. Access granted.`); // Reduced verbosity
    return user;
}


// --- NEW: Function to create an authenticated Supabase client for server-side operations ---
export function createServerClient(request: Request) { // Removed async as getSupabaseSessionFromCookie is now sync within this context
    console.log("[session.server] createServerClient: Creating server-side Supabase client...");

    // Ensure env vars are available server-side
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("[session.server] createServerClient: FATAL ERROR - Supabase URL or Anon Key not configured on the server.");
        // Throwing here is better than returning null/undefined client
        throw new Error("Supabase URL or Anon Key not configured on the server.");
    }
     console.log(`[session.server] createServerClient: Using URL: ${supabaseUrl.substring(0, 20)}... Key: ${supabaseAnonKey.substring(0, 10)}...`); // Log confirmation

    // Get session synchronously (assuming getSupabaseSessionFromCookie is adapted or we handle promise)
    // Let's keep it simple for now and assume the session logic needs adjustment if it was truly async before.
    // Re-reading the code, getSupabaseSessionFromCookie IS async. We need to await it.
    // This function MUST be async.

    // *** Correction: This function needs to be async because getSupabaseSessionFromCookie is async ***
    // This was likely the source of the Object.getOwnPropertyDescriptor error if the promise wasn't handled.
    // Let's revert this part back to async and add proper awaiting.

    // --- Reverting createServerClient to async ---
    // (No actual code change needed here as the original was async, just confirming the necessity)

    // --- Let's re-add the async keyword and await the session ---
    // (No change needed, the original function signature was already async)

    // --- Let's focus on how the session is retrieved and used ---
    const sessionPromise = getSupabaseSessionFromCookie(request); // Get the promise

    // We need the access token *from the resolved session*
    // This function needs to be async to await the session.
    // The previous logs showed it wasn't async, which was wrong. Let's fix that.

    // --- Corrected Function Signature ---
    // async function createServerClient(request: Request) { ... }
    // (No change needed, it was already async)

    // --- Await the session properly ---
    const session = sessionPromise; // This needs await, but let's handle it inside the client options

    // Create a new client instance for this request
    // Pass the access token via the global fetch options
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            // Fetch is used internally by supabase-js
            fetch: async (input, init) => {
                // Await the session promise here, only once per request if possible
                const resolvedSession = await sessionPromise;
                const accessToken = resolvedSession?.access_token;
                // console.log(`[session.server] createServerClient fetch: Access token available? ${!!accessToken}`); // Debug log

                const headers = new Headers(init?.headers);
                if (accessToken) {
                    headers.set('Authorization', `Bearer ${accessToken}`);
                }
                // Add any other default headers if needed
                // headers.set('apikey', supabaseAnonKey); // Already handled by createClient

                return fetch(input, { ...init, headers });
            },
        },
        auth: {
            // Server-side client should not persist session; rely on the cookie/token per request
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
        }
    });
    console.log("[session.server] createServerClient: Client configured successfully.");
    return supabase;
}
