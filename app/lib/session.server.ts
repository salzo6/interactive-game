import { createCookieSessionStorage, redirect } from '@remix-run/node';
import { supabase } from './supabase'; // Your Supabase client instance
import type { Session } from '@supabase/supabase-js';

// Ensure SESSION_SECRET is set in your environment variables for secure cookie signing
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  throw new Error('SESSION_SECRET must be set');
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

// Gets Supabase session from the Remix request
export async function getSupabaseSession(
  request: Request
): Promise<Session | null> {
  const cookie = request.headers.get('Cookie');
  const session = await storage.getSession(cookie);
  const supabaseSession = session.get('supabaseSession');
  return supabaseSession || null;
}

// Gets user data (including metadata) from the session
export async function getUser(request: Request) {
  const session = await getSupabaseSession(request);
  if (!session?.user) return null;

  // Optionally fetch fresh user data if needed, otherwise use session data
  // const { data: { user }, error } = await supabase.auth.getUser(session.access_token);
  // if (error) {
  //   console.error("Error fetching user:", error);
  //   return null;
  // }
  // return user;

  return session.user; // Contains id, email, app_metadata, user_metadata etc.
}

// Checks if user is admin based on metadata
export async function isAdmin(request: Request): Promise<boolean> {
  const user = await getUser(request);
  return user?.user_metadata?.is_admin === true;
}

// Creates a Remix session containing the Supabase session
export async function createSession(
  supabaseSession: Session,
  redirectTo: string
) {
  const session = await storage.getSession();
  session.set('supabaseSession', supabaseSession);
  return redirect(redirectTo, {
    headers: {
      'Set-Cookie': await storage.commitSession(session),
    },
  });
}

// Destroys the Remix session (logout)
export async function destroySession(request: Request) {
  const session = await storage.getSession(request.headers.get('Cookie'));
  return redirect('/login', { // Redirect to login after logout
    headers: {
      'Set-Cookie': await storage.destroySession(session),
    },
  });
}

// Helper to require authentication in loaders/actions
export async function requireUser(request: Request, redirectTo: string = new URL(request.url).pathname) {
  const user = await getUser(request);
  if (!user) {
    const searchParams = new URLSearchParams([["redirectTo", redirectTo]]);
    throw redirect(`/login?${searchParams}`);
  }
  return user;
}

// Helper to require admin role
export async function requireAdmin(request: Request) {
  const user = await requireUser(request); // Ensures user is logged in first
  if (user.user_metadata?.is_admin !== true) {
    // Optionally redirect to a specific page or throw an error
    throw new Response("Forbidden: Admins only", { status: 403 });
    // Or redirect: throw redirect("/");
  }
  return user;
}

// Helper to require player (non-admin) role
export async function requirePlayer(request: Request) {
    const user = await requireUser(request); // Ensures user is logged in first
    if (user.user_metadata?.is_admin === true) {
      // Optionally redirect to a specific page or throw an error
      throw new Response("Forbidden: Players only", { status: 403 });
      // Or redirect: throw redirect("/");
    }
    return user;
  }
