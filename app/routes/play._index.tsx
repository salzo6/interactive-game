import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { supabase } from '~/lib/supabase';
import { requirePlayer } from '~/lib/session.server';

export const meta: MetaFunction = () => {
  return [{ title: 'Join Game - Live Quiz' }];
};

// Loader: Validate game PIN from query param and redirect
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // Log entry point for this specific loader
  console.log(`\n--- [play._index.tsx loader] --- Handling request for path: ${url.pathname}, search: ${url.search}`);

  // This loader should ONLY handle requests like /play?gameId=...
  // It should NOT handle /play/SOME_PIN

  const playerUser = await requirePlayer(request);
  const gamePin = url.searchParams.get('gameId')?.toUpperCase();

  console.log(`[play._index.tsx loader] Extracted gamePin from searchParams: ${gamePin}`);

  if (!gamePin) {
    console.error("[play._index.tsx loader] No gamePin found in URL search params.");
    // If no gamePin, maybe render a page asking for one, or redirect home?
    // For now, return an error.
    return json({ error: 'No Game PIN provided in the URL (?gameId=...).' }, { status: 400 });
  }

  const { data: game, error: dbError } = await supabase
    .from('games')
    .select('id, status')
    .eq('game_pin', gamePin)
    .single();

  if (dbError || !game) {
    console.warn(`[play._index.tsx loader] Game PIN ${gamePin} not found or error:`, dbError);
    return json({ error: 'Invalid Game PIN.' }, { status: 404 });
  }

  if (game.status !== 'lobby') {
     console.warn(`[play._index.tsx loader] Attempt to join game ${gamePin} which is not in lobby (status: ${game.status})`);
     return json({ error: `Game is already ${game.status}. Cannot join now.` }, { status: 403 });
  }

  console.log(`[play._index.tsx loader] Player ${playerUser.email} validated for game PIN ${gamePin}. Redirecting to /play/${gamePin}`);
  // Redirect to the dynamic route handled by play.$gameId.tsx
  return redirect(`/play/${gamePin}`);
}

// Component to display errors if validation/redirect fails at this stage
export default function JoinGameRedirectPage() {
  const data = useLoaderData<typeof loader>();
  const error = data?.error;

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
       {/* This component primarily handles redirects or errors before the redirect */}
       {!error && (
         <div className="w-full max-w-md p-4 text-center text-yellow-700 bg-yellow-100 border border-yellow-400 rounded dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-700">
            <p>Redirecting...</p>
             <Link to="/" className="mt-2 inline-block text-blue-600 hover:underline dark:text-blue-400">
                Go back home
            </Link>
         </div>
       )}
    </div>
  );
}
