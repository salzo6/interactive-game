import { useState } from 'react';
import { Form, Link, useActionData, useSearchParams } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { supabase } from '~/lib/supabase';
import { createSessionCookie, getSupabaseSessionFromCookie } from '~/lib/session.server'; // Updated import

export const meta: MetaFunction = () => {
  return [{ title: 'Login - Live Quiz' }];
};

// Loader: Redirect if already logged in
export async function loader({ request }: LoaderFunctionArgs) {
  console.log("--- [login.tsx loader] --- Start");
  const session = await getSupabaseSessionFromCookie(request); // Use correct function
  if (session) {
    console.log("[login.tsx loader] User already logged in, redirecting to /");
    return redirect('/'); // Redirect logged-in users away from login page
  }
  console.log("--- [login.tsx loader] --- End (User not logged in)");
  return json({}); // Must return something
}

// Action: Handle login form submission
export async function action({ request }: ActionFunctionArgs) {
  console.log("\n--- [login.tsx action] --- Start");
  const formData = await request.formData();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;
  const redirectTo = (formData.get('redirectTo') as string) || '/'; // Get redirect path
  console.log(`[login.tsx action] Attempting login for email: ${email}, redirectTo: ${redirectTo}`);

  if (!email || !password) {
    console.error('[login.tsx action] Error: Email or password missing.');
    return json({ error: 'Email and password are required.' }, { status: 400 });
  }

  console.log('[login.tsx action] Calling supabase.auth.signInWithPassword...');
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    console.error('[login.tsx action] Supabase signInWithPassword error:', error?.message || 'No session data returned.');
    return json({ error: error?.message || 'Login failed. Please check your credentials.' }, { status: 401 });
  }

  console.log('[login.tsx action] Supabase login successful. Session data received.');
  console.log('[login.tsx action] Calling createSessionCookie...');
  try {
    const response = await createSessionCookie(data.session, redirectTo);
    console.log("--- [login.tsx action] --- End Success (Redirecting)");
    return response;
  } catch (sessionError: any) {
      console.error('[login.tsx action] Error creating session cookie:', sessionError);
      return json({ error: 'Failed to create user session after login.' }, { status: 500 });
  }
}

export default function Login() {
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirectTo') ?? '/';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-100 dark:bg-gray-900 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow-md dark:bg-gray-800">
        <h1 className="mb-6 text-center text-3xl font-bold text-gray-800 dark:text-gray-100">
          Login
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
              autoComplete="current-password"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 sm:text-sm"
              placeholder="••••••••"
            />
          </div>

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
              Sign in
            </button>
          </div>
        </Form>

        <p className="mt-6 text-center text-sm text-gray-600 dark:text-gray-400">
          Don't have an account?{' '}
          <Link
            to={`/signup?redirectTo=${encodeURIComponent(redirectTo)}`}
            className="font-medium text-blue-600 hover:text-blue-500 dark:text-blue-400 dark:hover:text-blue-300"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
