import { Form, Link, useLoaderData, useSearchParams } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { supabase } from '~/lib/supabase';
import { requirePlayer } from '~/lib/session.server'; // Require player (non-admin)

export const meta: MetaFunction = () => {
  return [{ title: 'Join Game - Live Quiz' }];
};

// Loader: Validate game PIN and user role
export async function loader({ request }: LoaderFunctionArgs) {
  const playerUser = await requirePlayer(request); // Ensures user is logged in and is NOT an admin
  const url = new URL(request.url);
  const gamePin = url.searchParams.get('gameId')?.toUpperCase();

  if (!gamePin) {
    // If no gameId in query params, maybe redirect back to index or show error?
    // For now, just return null, the component will handle it.
    return json({ gameExists: false, error: 'No Game PIN provided.', gamePin: null });
  }

  // Check if a game with this PIN exists and is in 'lobby' state
  const { data: game, error } = await supabase
    .from('games')
    .select('id, status')
    .eq('game_pin', gamePin)
    .single();

  if (error || !game) {
    console.warn(`Game PIN ${gamePin} not found or error:`, error);
    return json({ gameExists: false, error: 'Invalid Game PIN.', gamePin });
  }

  if (game.status !== 'lobby') {
     console.warn(`Attempt to join game ${gamePin} which is not in lobby (status: ${game.status})`);
     return json({ gameExists: true, error: `Game is already ${game.status}. Cannot join now.`, gamePin });
  }

  // Game exists and is joinable, redirect to the specific game play page
  // Pass user ID or nickname selection logic might happen here or on the next page
  console.log(`Player ${playerUser.email} validated for game PIN ${gamePin}. Redirecting to play/${gamePin}`);
  return redirect(`/play/${gamePin}`);

  // If we wanted to stay on this page and show a nickname form:
  // return json({ gameExists: true, error: null, gamePin });
}

// This component might not be reached if the loader always redirects on success.
// It acts as a validation/routing step.
// If we modified the loader to NOT redirect, this component would render.
export default function JoinGameLander() {
  const { gameExists, error, gamePin } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const initialPin = searchParams.get('gameId') ?? ''; // Get initial PIN from URL if any

  // This UI will only show if the loader finds an error or doesn't redirect
  return (
    <div className="flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">Join Game</h1>
      {error && (
        <div className="w-full max-w-md p-4 text-center text-red-700 bg-red-100 border border-red-400 rounded dark:bg-red-900 dark:text-red-200 dark:border-red-700">
          <p>{error}</p>
          <Link to="/" className="mt-2 inline-block text-blue-600 hover:underline dark:text-blue-400">
            Go back home
          </Link>
        </div>
      )}

      {/* Optionally show a form again if needed, though index handles initial entry */}
       {!error && !gameExists && (
         <p>Enter a game PIN on the home page to join.</p>
         // Or show the form again here
       )}

       {/* If loader didn't redirect, maybe show nickname form here */}
       {/* {gameExists && !error && ( ... Nickname Form ... )} */}

    </div>
  );
}
