import { Form, Link, useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { getSession, getUser } from '~/lib/session.server'; // Import session utilities
import { supabase } from '~/lib/supabase'; // Import supabase client if needed for other data

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request);
  const isAdmin = user?.user_metadata?.is_admin ?? false;
  // You could potentially fetch active games here if needed, but keep it simple for now
  return json({ user, isAdmin });
}

export default function Index() {
  const { user, isAdmin } = useLoaderData<typeof loader>();

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-100 to-pink-100 dark:from-gray-900 dark:via-indigo-900 dark:to-purple-900 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-12">
        <img src="/logo-light.png" alt="Live Quiz Logo" className="h-16 mx-auto mb-4 dark:hidden" />
        <img src="/logo-dark.png" alt="Live Quiz Logo" className="h-16 mx-auto mb-4 hidden dark:block" />
        <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100">Welcome to Live Quiz!</h1>
        <p className="text-lg text-gray-600 dark:text-gray-300 mt-2">Join the fun or host your own game.</p>
      </div>

      <div className="w-full max-w-md bg-white dark:bg-gray-800 shadow-xl rounded-lg p-8 space-y-6">
        {user ? (
          // User is logged in
          <div className="text-center">
            <p className="text-lg mb-4 dark:text-gray-200">Welcome back, <span className="font-semibold">{user.email}</span>!</p>

            {/* Join Game Form */}
            <Form method="get" action="/play" className="space-y-4 mb-6">
              <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200">Join a Game</h2>
              <div>
                <label htmlFor="gameId" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Game PIN
                </label>
                <input
                  type="text"
                  id="gameId"
                  name="gameId" // CRITICAL: Name must be "gameId"
                  placeholder="Enter 6-digit PIN"
                  required
                  maxLength={6}
                  className="w-full uppercase tracking-widest text-center font-mono text-lg rounded border border-gray-300 dark:border-gray-600 px-3 py-2 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:bg-gray-700 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                  style={{ textTransform: 'uppercase' }} // Ensure visual uppercase
                  // Basic client-side pattern (optional, server validates anyway)
                  // pattern="[A-Z0-9]{6}"
                  // title="6 uppercase letters/digits"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded bg-indigo-600 px-4 py-2 text-white font-semibold hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              >
                Join Game
              </button>
            </Form>

            {/* Host Section (only for admins) */}
            {isAdmin && (
              <div className="border-t pt-6 dark:border-gray-700">
                <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-200 mb-4">Admin Actions</h2>
                <Link
                  to="/host" // Link to the page where hosting starts
                  className="w-full block text-center rounded bg-green-600 px-4 py-2 text-white font-semibold hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 mb-4"
                >
                  Host New Game
                </Link>
                {/* Add other admin links here if needed */}
              </div>
            )}

            {/* Logout Button */}
             <Form method="post" action="/logout">
                <button
                  type="submit"
                  className="w-full rounded bg-gray-500 px-4 py-2 text-white font-semibold hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 mt-4"
                >
                  Logout
                </button>
              </Form>

          </div>
        ) : (
          // User is logged out
          <div className="text-center space-y-4">
             <p className="text-lg dark:text-gray-200">Please log in or sign up to play.</p>
            <Link
              to="/login"
              className="block w-full rounded bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Login
            </Link>
            <Link
              to="/signup"
              className="block w-full rounded bg-gray-600 px-4 py-2 text-white font-semibold hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
            >
              Sign Up
            </Link>
          </div>
        )}
      </div>

      <footer className="mt-12 text-center text-sm text-gray-500 dark:text-gray-400">
        &copy; {new Date().getFullYear()} Live Quiz App. All rights reserved.
      </footer>
    </div>
  );
}
