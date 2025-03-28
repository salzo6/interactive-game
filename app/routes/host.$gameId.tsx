import { useEffect } from 'react';
import { useParams, useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { supabase } from '~/lib/supabase';
import { requireAdmin } from '~/lib/session.server'; // Require admin user

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const gamePin = data?.game?.game_pin ?? 'Host';
  return [{ title: `Host Game: ${gamePin}` }];
};

// Loader: Fetch game data and ensure user is the admin host
export async function loader({ request, params }: LoaderFunctionArgs) {
  const adminUser = await requireAdmin(request); // Ensures user is logged in and is an admin
  const gamePin = params.gameId; // From the route segment $gameId

  if (!gamePin) {
    throw new Response('Game PIN not provided', { status: 400 });
  }

  // Fetch the game details, ensuring the current admin user is the host
  const { data: game, error } = await supabase
    .from('games')
    .select('*')
    .eq('game_pin', gamePin)
    .eq('host_id', adminUser.id) // Crucial check: is this user the host?
    .single();

  if (error || !game) {
    console.error('Error fetching game or access denied:', error);
    // Throw 404 if game not found or user is not the host
    throw new Response('Game not found or you are not the host.', { status: 404 });
  }

  // Fetch players for this game (using RLS implicitly)
  const { data: players, error: playersError } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('game_id', game.id);

  if (playersError) {
    console.error('Error fetching players:', playersError);
    // Handle error, maybe return game without players or throw 500
    throw new Response('Error fetching player data', { status: 500 });
  }


  return json({ game, players: players ?? [] });
}


export default function HostGame() {
  const { game, players } = useLoaderData<typeof loader>();
  const params = useParams();
  const gamePin = params.gameId;

  // TODO: Setup WebSocket connection for host controls and real-time updates

  useEffect(() => {
    console.log(`Host connected for game: ${gamePin}`);
    // Initialize WebSocket connection here
    // const ws = new WebSocket(`ws://${window.location.host}/ws`);
    // ws.onopen = () => {
    //   console.log('Host WebSocket connected');
    //   // Send host identification message
    //   ws.send(JSON.stringify({ type: 'identify_host', gamePin, hostId: game.host_id }));
    // };
    // ws.onmessage = (event) => {
    //   const message = JSON.parse(event.data);
    //   console.log('Host received message:', message);
    //   // Handle player joins, answers, etc.
    // };
    // ws.onerror = (error) => console.error('Host WebSocket error:', error);
    // ws.onclose = () => console.log('Host WebSocket disconnected');
    // return () => ws.close(); // Cleanup on component unmount
  }, [gamePin, game.host_id]);


  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Hosting Game: {game.game_pin}</h1>
      <p className="mb-2">Status: <span className="font-semibold">{game.status}</span></p>
      <p className="mb-6">Share this PIN with players: <strong className="text-2xl tracking-widest">{game.game_pin}</strong></p>

      {/* TODO: Add controls for starting game, advancing questions etc. */}
      {game.status === 'lobby' && (
         <button className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded mr-2">
           Start Game
         </button>
      )}
       {game.status === 'active' && (
         <button className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded mr-2">
           Next Question
         </button>
       )}
       {/* Add more controls as needed */}


      <h2 className="text-2xl font-semibold mt-8 mb-4">Players ({players.length})</h2>
      {players.length > 0 ? (
        <ul className="list-disc pl-5 space-y-2">
          {players.map((player) => (
            <li key={player.id}>
              {player.nickname} (Score: {player.score})
            </li>
          ))}
        </ul>
      ) : (
        <p>No players have joined yet.</p>
      )}

      {/* TODO: Display current question, results, etc. */}
    </div>
  );
}
