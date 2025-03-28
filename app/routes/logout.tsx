import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { destroySession } from "~/lib/session.server";
import { supabase } from "~/lib/supabase"; // Import Supabase client

// Loader: Redirect GET requests to home or login
export async function loader({ request }: LoaderFunctionArgs) {
  return redirect("/");
}

// Action: Handle POST requests to log out
export async function action({ request }: ActionFunctionArgs) {
  // Inform Supabase client to clear its stored session
  // Although the cookie handles server-side auth, this helps client-side state
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Supabase sign out error:", error);
    // Decide how to handle this - maybe still destroy the Remix session?
  }

  // Destroy the Remix session cookie
  return destroySession(request);
}
