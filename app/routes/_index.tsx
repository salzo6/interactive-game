import { useState } from 'react';
import { Form, Link, useFetcher } from '@remix-run/react';
import type { ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { nanoid } from 'nanoid'; // For generating unique game IDs
import { supabase } from '~/lib/supabase'; // Import the Supabase client

export const meta: MetaFunction = () => {
  return [{ title: 'Live Quiz Game' }];
};

// Action to create a new game and save it to the database
export async function action({ request }: ActionFunctionArgs) {
  const gamePin = nanoid(6).toUpperCase(); // Generate a 6-character uppercase game PIN
  console.log(`Creating game with PIN: ${gamePin}`);

  // Save the new game to the Supabase 'games' table
  const { data, error } = await supabase
    .from('games')
    .insert([{ game_pin: gamePin }]) // Insert the game_pin, host_id will be null initially
    .select() // Optionally select the inserted data if needed
    .single(); // Expecting a single row back

  if (error) {
    console.error('Error creating game in Supabase:', error);
    // Return error response to be handled by the fetcher
    return json({ error: error.message }, { status: 500 });
  }

  console.log('Game created successfully in Supabase:', data);

  // Redirect the user to the host page for the newly created game
  return redirect(`/host/${gamePin}`);
}

export default function Index() {
  const [joinGameId, setJoinGameId] = useState('');
  const createGameFetcher = useFetcher<typeof action>(); // Add type for fetcher data/errors

  const isCreatingGame = createGameFetcher.state !== 'idle';

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-12 p-8 font-sans dark:bg-gray-900">
      <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100">
        Live Quiz Game
      </h1>

      <div className="flex w-full max-w-md flex-col gap-6">
        {/* Create Game */}
        <createGameFetcher.Form method="post">
          <button
            type="submit"
            disabled={isCreatingGame}
            className="w-full rounded-lg bg-blue-600 px-6 py-3 text-lg font-semibold text-white shadow transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreatingGame ? 'Creating...' : 'Create New Game'}
          </button>
          {/* Display error message if game creation failed */}
          {createGameFetcher.data?.error && ( // THIS LINE IS CORRECTED
            <p className="mt-2 text-center text-sm text-red-600 dark:text-red-400">
              Error: {createGameFetcher.data.error}
            </p>
          )}
        </createGameFetcher.Form>

        {/* Join Game */}
        <Form
          method="get" // Use GET to navigate to the join page with query param
          action="/play"
          className="flex flex-col gap-4 rounded-lg border border-gray-200 p-6 dark:border-gray-700"
        >
          <label
            htmlFor="gameId"
            className="text-lg font-semibold text-gray-700 dark:text-gray-200"
          >
            Join Existing Game
          </label>
          <input
            type="text"
            id="gameId"
            name="gameId" // Name matches the query param expected on /play
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
        </Form>
      </div>
    </div>
  );
}
