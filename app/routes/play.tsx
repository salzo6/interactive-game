import { useState, useEffect } from 'react';
import { Form, useSearchParams, useFetcher } from '@remix-run/react';
import type { MetaFunction, ActionFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';

export const meta: MetaFunction = () => {
  return [{ title: 'Join Quiz Game' }];
};

// This action validates and redirects the player to the specific game lobby URL
export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const gameId = (formData.get('gameId') as string)?.toUpperCase(); // Ensure uppercase
  const nickname = formData.get('nickname') as string;

  if (!gameId || !nickname) {
    return json({ error: 'Game PIN and Nickname are required.' }, { status: 400 });
  }
   if (gameId.length !== 6) {
     return json({ error: 'Invalid Game PIN format.' }, { status: 400 });
   }

  // Optional TODO: Server-side validation if gameId exists and is in 'lobby' state.
  // This might require querying the DB or having a way to check the WebSocket server's state.
  // For now, we rely on the WebSocket connection in play.$gameId to handle invalid/started games.

  // Redirect to the game lobby, passing nickname via search params
  const url = new URL(`/play/${gameId}`, request.url);
  url.searchParams.set('nickname', nickname.trim()); // Trim nickname
  return redirect(url.toString());
}


export default function JoinGame() {
  const [searchParams] = useSearchParams();
  const [gameId, setGameId] = useState('');
  const joinFetcher = useFetcher<typeof action>();

  // Pre-fill gameId if it's in the URL from the index page link
  useEffect(() => {
    const initialGameId = searchParams.get('gameId');
    if (initialGameId) {
      setGameId(initialGameId.toUpperCase());
    }
  }, [searchParams]);

  const isJoining = joinFetcher.state !== 'idle';

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-8 p-8 font-sans dark:bg-gray-900">
      <h1 className="text-3xl font-bold dark:text-gray-100">Join Game</h1>
      <joinFetcher.Form
        method="post"
        className="flex w-full max-w-xs flex-col gap-4"
      >
        <label htmlFor="gameId" className="sr-only">Game PIN</label>
        <input
          type="text"
          id="gameId"
          name="gameId"
          value={gameId}
          onChange={(e) => setGameId(e.target.value.toUpperCase())}
          placeholder="Enter Game PIN"
          maxLength={6}
          className="rounded border border-gray-300 px-4 py-2 text-center text-lg uppercase tracking-widest focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          required
          autoCapitalize="characters"
          autoComplete="off"
        />
         <label htmlFor="nickname" className="sr-only">Nickname</label>
        <input
          type="text"
          id="nickname"
          name="nickname"
          placeholder="Enter Nickname"
          maxLength={20}
          className="rounded border border-gray-300 px-4 py-2 text-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          required
          autoComplete="off"
        />
        {/* Display validation errors from the action */}
        {joinFetcher.data?.error && (
          <p className="text-center text-red-500">{joinFetcher.data.error}</p>
        )}
        <button
          type="submit"
          disabled={isJoining}
          className="mt-2 rounded-lg bg-green-600 px-6 py-3 text-lg font-semibold text-white shadow transition-colors duration-150 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isJoining ? 'Joining...' : 'Enter'}
        </button>
      </joinFetcher.Form>
    </div>
  );
}
