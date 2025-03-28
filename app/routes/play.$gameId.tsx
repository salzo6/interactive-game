import { useState, useEffect } from 'react';
import { useParams, useLoaderData, Form, useFetcher } from '@remix-run/react';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { supabase } from '~/lib/supabase';
import { requirePlayer } from '~/lib/session.server'; // Require player role

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const gamePin = data?.game?.game_pin ?? 'Play';
  return [{ title: `Play Game: ${gamePin}` }];
};

// Loader: Fetch game data, ensure user is player, check game status
export async function loader({ request, params }: LoaderFunctionArgs) {
  const playerUser = await requirePlayer(request); // Ensures user is logged in and is NOT an admin
  const gamePin = params.gameId?.toUpperCase();

  if (!gamePin) {
    throw new Response('Game PIN not provided', { status: 400 });
  }

  // Fetch the game details
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('id, game_pin, status, host_id, current_question_index') // Select necessary fields
    .eq('game_pin', gamePin)
    .single();

  if (gameError || !game) {
    console.error(`Error fetching game ${gamePin} or game not found:`, gameError);
    throw new Response('Game not found.', { status: 404 });
  }

  // Check if player has already joined this game (using nickname for now, ideally user_id)
  // This requires an action to handle joining first. Let's assume for now they might need to join.
  // We'll add a check later once the join action exists.

  // If game is not in lobby or active, maybe redirect or show message
  if (!['lobby', 'active'].includes(game.status)) {
     // Maybe redirect to a results page or back home?
     // For now, let's allow viewing but disable interaction.
     console.log(`Game ${gamePin} is in status ${game.status}.`);
  }

  // Fetch current players (RLS handles permissions)
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('game_id', game.id);

   if (playersError) {
     console.error('Error fetching players:', playersError);
     // Non-critical? Return game data anyway?
   }

   // TODO: Fetch current question if game is active


  return json({ game, players: players ?? [], playerUserId: playerUser.id });
}

// Action: Handle player joining the game (setting nickname)
export async function action({ request, params }: ActionFunctionArgs) {
    const playerUser = await requirePlayer(request);
    const gamePin = params.gameId?.toUpperCase();
    const formData = await request.formData();
    const nickname = formData.get('nickname') as string;

    if (!gamePin) {
        return json({ error: 'Game PIN missing.' }, { status: 400 });
    }
    if (!nickname || nickname.trim().length === 0 || nickname.length > 20) {
        return json({ error: 'Nickname must be between 1 and 20 characters.' }, { status: 400 });
    }

    // 1. Find the game ID from the PIN
    const { data: game, error: gameError } = await supabase
      .from('games')
      .select('id, status')
      .eq('game_pin', gamePin)
      .single();

    if (gameError || !game) {
      return json({ error: 'Game not found.' }, { status: 404 });
    }

    // 2. Check if game is in lobby state (RLS also checks this on insert)
    if (game.status !== 'lobby') {
        return json({ error: 'Game is no longer accepting players.' }, { status: 403 });
    }

    // 3. Insert the player (RLS policy 'Allow authenticated non-admins to join games' will apply)
    const { data: newPlayer, error: insertError } = await supabase
        .from('players')
        .insert({
            game_id: game.id,
            nickname: nickname.trim(),
            // user_id: playerUser.id // TODO: Add user_id column to players table later
        })
        .select()
        .single();

    if (insertError) {
        console.error('Error inserting player:', insertError);
        // Check for unique constraint violation if nicknames must be unique per game
        if (insertError.code === '23505') { // Unique violation
             return json({ error: 'This nickname is already taken in this game.' }, { status: 409 });
        }
        return json({ error: 'Failed to join the game. ' + insertError.message }, { status: 500 });
    }

    console.log(`Player ${nickname} joined game ${gamePin}`);
    // No redirect needed, the page will re-render via fetcher state change
    return json({ success: true, player: newPlayer });
}


export default function PlayGame() {
  const { game, players, playerUserId } = useLoaderData<typeof loader>();
  const params = useParams();
  const gamePin = params.gameId;
  const joinFetcher = useFetcher<typeof action>();

  // Check if the current user is already in the players list
  // TODO: This check needs improvement. Ideally, check based on playerUserId against a user_id on the players table.
  // For now, we'll rely on the form submission state.
  const hasJoined = players.some(p => p.nickname /* === user's chosen nickname? */); // Placeholder logic

  const isJoining = joinFetcher.state !== 'idle';
  const joinError = joinFetcher.data?.error;
  const joinSuccess = joinFetcher.data?.success;


  // TODO: Setup WebSocket connection for real-time game updates (status, questions, scores)
  useEffect(() => {
    console.log(`Player connected for game: ${gamePin}`);
    // Initialize WebSocket connection here if player has joined
    // if (joinSuccess || hasJoined) {
    //   const ws = new WebSocket(`ws://${window.location.host}/ws`);
    //   ws.onopen = () => {
    //     console.log('Player WebSocket connected');
    //     // Send player identification message
    //     ws.send(JSON.stringify({ type: 'identify_player', gamePin, /* nickname, playerId */ }));
    //   };
    //   // ... handle messages (game state changes, new questions)
    //   return () => ws.close();
    // }
  }, [gamePin, joinSuccess, hasJoined]);


  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Playing Game: {game.game_pin}</h1>
      <p className="mb-6">Status: <span className="font-semibold">{game.status}</span></p>

      {/* Nickname Form (if game is lobby and user hasn't joined) */}
      {game.status === 'lobby' && !joinSuccess && !hasJoined && ( // Adjust hasJoined logic later
        <joinFetcher.Form method="post" className="max-w-sm mb-6 p-4 border rounded dark:border-gray-700">
          <h2 className="text-xl font-semibold mb-3">Choose your nickname</h2>
          <label htmlFor="nickname" className="block text-sm font-medium mb-1 dark:text-gray-300">
            Nickname (1-20 characters)
          </label>
          <input
            type="text"
            id="nickname"
            name="nickname"
            required
            maxLength={20}
            className="w-full rounded border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
          {joinError && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">{joinError}</p>
          )}
          <button
            type="submit"
            disabled={isJoining}
            className="mt-3 w-full rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isJoining ? 'Joining...' : 'Join Game'}
          </button>
        </joinFetcher.Form>
      )}

      {/* Waiting Room / Game Active UI */}
      {(joinSuccess || hasJoined) && ( // Adjust hasJoined logic later
        <div>
          {game.status === 'lobby' && (
            <p className="text-lg text-blue-700 dark:text-blue-300">Waiting for the host to start the game...</p>
          )}
          {game.status === 'active' && (
            <div>
              <h2 className="text-2xl font-semibold mb-4">Question {game.current_question_index + 1}</h2>
              {/* TODO: Display current question and answer options */}
              <p>Question text will appear here.</p>
              <div className="grid grid-cols-2 gap-4 mt-4">
                 {/* Example Answer Buttons */}
                 <button className="bg-red-500 hover:bg-red-600 text-white font-bold py-4 px-4 rounded">Option A</button>
                 <button className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-4 rounded">Option B</button>
                 <button className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-4 px-4 rounded">Option C</button>
                 <button className="bg-green-500 hover:bg-green-600 text-white font-bold py-4 px-4 rounded">Option D</button>
              </div>
            </div>
          )}
           {game.status === 'finished' && (
             <p className="text-lg font-semibold text-purple-700 dark:text-purple-300">The game has finished!</p>
             // TODO: Show final scores/leaderboard
           )}
        </div>
      )}

      {/* Player List */}
      <h3 className="text-xl font-semibold mt-8 mb-3">Players in Game ({players.length})</h3>
      {players.length > 0 ? (
        <ul className="list-inside list-disc space-y-1">
          {players.map((player) => (
            <li key={player.id}>
              {player.nickname}
              {/* Maybe show score if game is active/finished */}
              {/* (Score: {player.score}) */}
            </li>
          ))}
        </ul>
      ) : (
         game.status === 'lobby' && !joinSuccess && !hasJoined ? null : <p>No players yet.</p> // Hide if showing nickname form
      )}
    </div>
  );
}
