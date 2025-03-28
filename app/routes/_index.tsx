import { useState } from 'react';
import { Form, Link, useFetcher, useLoaderData } from '@remix-run/react';
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { nanoid } from 'nanoid';
import { supabase } from '~/lib/supabase';
import { getUser, requireAdmin, requirePlayer } from '~/lib/session.server'; // Import auth helpers

export const meta: MetaFunction = () => {
  return [{ title: 'Live Quiz Game' }];
};

// Loader to get user data
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await getUser(request); // Get user session, null if not logged in
  return json({ user });
}


// Action to create a new game (only for admins)
export async function action({ request }: ActionFunctionArgs) {
  const adminUser = await requireAdmin(request); // Ensures user is logged in and is an admin

  const gamePin = nanoid(6).toUpperCase();
  console.log(`Admin ${adminUser.email} creating game with PIN: ${gamePin}`);

  const { data, error } = await supabase
    .from('games')
    .insert([{
        game_pin: gamePin,
        host_id: adminUser.id // Set the host_id to the admin's user ID
    }])
    .select()
    .single();

  if (error) {
    console.error('Error creating game in Supabase:', error);
    // Return error response to be handled by the fetcher
    return json({ error: error.message }, { status: 500 });
  }

  console.log('Game created successfully in Supabase:', data);
  return redirect(`/host/${gamePin}`);
}

export default function Index() {
  const { user } = useLoaderData<typeof loader>();
  const [joinGameId, setJoinGameId] = useState('');
  const createGameFetcher = useFetcher<typeof action>();

  const isCreatingGame = createGameFetcher.state !== 'idle';
  const isAdmin = user?.user_metadata?.is_admin === true;
  const isPlayer = user && !isAdmin;

  return (
    <div className="flex flex-col items-center justify-center gap-12 p-8">
      <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100">
        Live Quiz Game
      </h1>

      {!user && (
        <div className="text-center p-6 border border-gray-200 dark:border-gray-700 rounded-lg">
          <p className="mb-4 text-lg text-gray-700 dark:text-gray-200">Welcome! Please log in or sign up to play.</p>
          <div className="flex justify-center gap-4">
            <Link to="/login" className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700">
              Login
            </Link>
            <Link to="/signup" className="rounded-lg bg-green-600 px-6 py-2 text-white hover:bg-green-700">
              Sign Up
            </Link>
          </div>
        </div>
      )}

      {user && (
        <div className="flex w-full max-w-md flex-col gap-6">
          {/* Create Game (Admin Only) */}
          {isAdmin && (
            <createGameFetcher.Form method="post">
              <button
                type="submit"
                disabled={isCreatingGame}
                className="w-full rounded-lg bg-blue-600 px-6 py-3 text-lg font-semibold text-white shadow transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingGame ? 'Creating...' : 'Create New Game (Admin)'}
              </button>
              {createGameFetcher.data?.error && (
                <p className="mt-2 text-center text-sm text-red-600 dark:text-red-400">
                  Error: {createGameFetcher.data.error}
                </p>
              )}
            </createGameFetcher.Form>
          )}

          {/* Join Game (Player Only) */}
          {isPlayer && (
            <Form
              method="get" // Navigate to /play?gameId=XYZ
              action="/play"
              className="flex flex-col gap-4 rounded-lg border border-gray-200 p-6 dark:border-gray-700"
            >
              <label
                htmlFor="gameId"
                className="text-lg font-semibold text-gray-700 dark:text-gray-200"
              >
                Join Existing Game (Player)
              </label>
              <input
                type="text"
                id="gameId"
                name="gameId" // This becomes the query parameter
                value={joinGameId}
                onChange={(e) => setJoinGameId(e.target.value.toUpperCase())}
                placeholder="Enter Game PIN"
                maxLength={6}
                className="rounded border border-gray-300 px-4 py-2 text-center text-lg uppercase tracking-widest focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                required
                autoCapitalize="characters"
                autoComplete="off"
              />
              <button
                type="submit"
                className="rounded-lg bg-green-600 px-6 py-3 text-lg font-semibold text-white shadow transition-colors duration-150 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
              >
                Join Game
              </button>
              {/* TODO: Add error display if joining fails (e.g., invalid PIN) - handled on /play page */}
            </Form>
          )}
        </div>
      )}
    </div>
  );
}
