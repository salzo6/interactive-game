import { useState } from 'react';
import { Form, Link, useActionData, useSearchParams } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { supabase } from '~/lib/supabase';
import { createSessionCookie, getSupabaseSessionFromCookie } from '~/lib/session.server'; // Updated import

export const meta: MetaFunction = () => {
  return [{ title: 'Sign Up - Live Quiz' }];
};

// Loader: Redirect if already logged in
export async function loader({ request }: LoaderFunctionArgs) {
  console.log("--- [signup.tsx loader] --- Start");
  const session = await getSupabaseSessionFromCookie(request); // Use correct function
  if (session) {
    console.log("[signup.tsx loader] User already logged in, redirecting to /");
    return redirect('/'); // Redirect logged-in users away from signup page
  }
  console.log("--- [signup.tsx loader] --- End (User not logged in)");
  return json({}); // Must return something
}

// Action: Handle signup form submission
export async function action({ request }: ActionFunctionArgs) {
  console.log("\n--- [signup.tsx action] --- Start");
  const formData = await request.formData();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const isAdmin = formData.get('isAdmin') === 'on'; // Checkbox value is 'on' when checked
  const redirectTo = (formData.get('redirectTo') as string) || '/'; // Get redirect path
  console.log(`[signup.tsx action] Attempting signup for email: ${email}, isAdmin: ${isAdmin}, redirectTo: ${redirectTo}`);


  if (!email || !password) {
     console.error('[signup.tsx action] Error: Email or password missing.');
    return json({ error: 'Email and password are required.' }, { status: 400 });
  }
  // Add password complexity validation if desired
  if (password.length < 6) {
      console.error('[signup.tsx action] Error: Password too short.');
      return json({ error: 'Password must be at least 6 characters long.' }, { status: 400 });
  }

  console.log('[signup.tsx action] Calling supabase.auth.signUp...');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Store the admin flag in user_metadata
      data: {
        is_admin: isAdmin,
      },
      // IMPORTANT: Disable email confirmation for this example flow
      // In production, you'd likely want email confirmation enabled.
      emailRedirectTo: undefined, // Ensure no email confirmation redirect is attempted client-side by Supabase
    },
  });

  // Check specifically for user already registered error
  if (error?.message.includes('User already registered')) {
      console.warn('[signup.tsx action] Signup attempt for existing email:', email);
      return json({ error: 'An account with this email already exists. Please log in.' }, { status: 409 }); // 409 Conflict
  }

  // Handle other signup errors or missing session data
  if (error || !data.session) {
    // Note: With email confirmation *disabled*, we expect a session immediately.
    // If it were enabled, !data.session would be normal, and data.user would exist.
    console.error('[signup.tsx action] Supabase signUp error:', error?.message || 'No session data returned after signup.');
    return json({ error: error?.message || 'Signup failed. Please try again.' }, { status: 400 });
  }

  console.log('[signup.tsx action] Supabase signup successful. Session data received.');
  console.log('[signup.tsx action] Calling createSessionCookie...');
  try {
    // If signup is successful and a session is created (e.g., email confirmation disabled)
    const response = await createSessionCookie(data.session, redirectTo);
    console.log("--- [signup.tsx action] --- End Success (Redirecting)");
    return response;
  } catch (sessionError: any) {
      console.error('[signup.tsx action] Error creating session cookie:', sessionError);
      return json({ error: 'Failed to create user session after signup.' }, { status: 500 });
  }
}

export default function Signup() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? '/';
  const [isAdminChecked, setIsAdminChecked] = useState(false);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md dark:bg-gray-800">
        <h1 className="mb-6 text-center text-3xl font-bold text-gray-800 dark:text-gray-100">
          Create Account
        </h1>
        <Form method="post" className="space-y-6">
           {/* Hidden input for redirectTo */}
           <input type="hidden" name="redirectTo" value={redirectTo} />

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Email Address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 sm:text-sm"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={6} // Example: Enforce minimum password length
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 sm:text-sm"
              placeholder="•••••••• (min. 6 characters)"
            />
          </div>

          <div className="flex items-center">
            <input
              id="isAdmin"
              name="isAdmin"
              type="checkbox"
              checked={isAdminChecked}
              onChange={(e) => setIsAdminChecked(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:ring-offset-gray-800 dark:focus:ring-blue-600"
            />
            <label
              htmlFor="isAdmin"
              className="ml-2 block text-sm text-gray-900 dark:text-gray-300"
            >
              Create as Admin account? (Allows hosting games)
            </label>
          </div>
           {/* Security Note */}
           <p className="text-xs text-orange-600 dark:text-orange-400">
             Note: In a real application, admin creation should be restricted.
           </p>

          {actionData?.error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              {actionData.error}
            </p>
          )}

          <div>
            <button
              type="submit"
              className="flex w-full justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Sign up
            </button>
          </div>
        </Form>

        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          Already have an account?{' '}
          <Link
            to={`/login?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
