import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { supabase } from '~/lib/supabase';
import { requireAdmin } from '~/lib/session.server';

// Define Player type for frontend state
interface PlayerInfo {
  id: string;
  nickname: string;
  score: number;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const gamePin = data?.game?.game_pin ?? 'Host';
  return [{ title: `Host Game: ${gamePin}` }];
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const adminUser = await requireAdmin(request);
  const gamePin = params.gameId; // This is the game_pin from the URL

  if (!gamePin) {
    throw new Response('Game PIN not provided', { status: 400 });
  }

  const { data: game, error } = await supabase
    .from('games')
    .select('id, game_pin, status, host_id') // Select the actual game ID (UUID)
    .eq('game_pin', gamePin)
    .eq('host_id', adminUser.id)
    .single();

  if (error || !game) {
    console.error('Error fetching game or access denied:', error);
    throw new Response('Game not found or you are not the host.', { status: 404 });
  }

  // Fetch initial players (though WS will update)
  const { data: initialPlayers, error: playersError } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('game_id', game.id); // Use the actual game ID (UUID)

  if (playersError) {
    console.error('Error fetching initial players:', playersError);
    // Non-critical, WS will handle updates
  }

  // Pass the actual game ID (UUID) and game PIN to the component
  return json({
      game: { id: game.id, game_pin: game.game_pin, status: game.status },
      initialPlayers: initialPlayers ?? []
  });
}


export default function HostGame() {
  const { game, initialPlayers } = useLoaderData<typeof loader>();
  const [players, setPlayers] = useState<PlayerInfo[]>(initialPlayers);
  const [sharedState, setSharedState] = useState<number>(0); // Initial shared state
  const [isConnected, setIsConnected] = useState(false);
  const ws = useRef<WebSocket | null>(null);

  const gameId = game.id; // The actual UUID game ID
  const gamePin = game.game_pin; // The user-facing PIN

  // WebSocket connection and message handling
  useEffect(() => {
    const wsUrl = `ws://${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);
    console.log(`Attempting to connect WebSocket to ${wsUrl}`);

    ws.current.onopen = () => {
      console.log('Host WebSocket connected');
      setIsConnected(true);
      // Send host identification message with gameId (UUID) and gamePin
      ws.current?.send(JSON.stringify({
          type: 'HOST_JOIN',
          payload: { gameId: gameId, gamePin: gamePin }
      }));
    };

    ws.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Host received message:', message);

        switch (message.type) {
          case 'PLAYER_LIST_UPDATE':
            setPlayers(message.payload.players);
            break;
          case 'SHARED_STATE_UPDATE':
            setSharedState(message.payload.newState);
            break;
          // Handle other messages like GAME_STARTED, SHOW_QUESTION etc.
          default:
            console.log('Host received unhandled message type:', message.type);
        }
      } catch (error) {
        console.error('Error parsing message or handling update:', error);
      }
    };

    ws.current.onerror = (error) => {
      console.error('Host WebSocket error:', error);
      setIsConnected(false);
    };

    ws.current.onclose = (event) => {
      console.log('Host WebSocket disconnected:', event.reason);
      setIsConnected(false);
      // Maybe show a disconnected message or attempt reconnect
    };

    // Cleanup on component unmount
    return () => {
      console.log('Closing host WebSocket connection');
      ws.current?.close();
    };
  }, [gameId, gamePin]); // Reconnect if gameId/gamePin changes (shouldn't happen often)

  // Function to send message to WebSocket server
  const sendMessage = useCallback((message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not connected or not open.');
    }
  }, []);

  // Handler to update shared state
  const updateSharedState = (increment: number) => {
      const newState = sharedState + increment;
      setSharedState(newState); // Optimistic update (optional)
      sendMessage({
          type: 'ADMIN_UPDATE_SHARED_STATE',
          payload: { newState: newState }
      });
  };

  // Handler to start the game
  const startGame = () => {
      sendMessage({ type: 'START_GAME', payload: {} });
  };


  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Hosting Game: {gamePin}</h1>
      <p className="mb-2">Status: <span className="font-semibold">{game.status}</span> {isConnected ? '(Connected)' : '(Disconnected)'}</p>
      <p className="mb-6">Share this PIN with players: <strong className="text-2xl tracking-widest">{gamePin}</strong></p>

      {/* Shared State Control */}
      <div className="my-6 p-4 border rounded dark:border-gray-700">
          <h2 className="text-xl font-semibold mb-3">Shared State Control</h2>
          <p className="text-4xl font-bold text-center mb-4">{sharedState}</p>
          <div className="flex justify-center space-x-4">
              <button
                  onClick={() => updateSharedState(-1)}
                  disabled={!isConnected}
                  className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
              >
                  Decrement (-)
              </button>
              <button
                  onClick={() => updateSharedState(1)}
                  disabled={!isConnected}
                  className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded disabled:opacity-50"
              >
                  Increment (+)
              </button>
          </div>
      </div>


      {/* Game Controls */}
      {game.status === 'lobby' && (
         <button
            onClick={startGame}
            disabled={!isConnected || players.length === 0}
            className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded mr-2 disabled:opacity-50"
         >
           Start Game
         </button>
      )}
       {game.status === 'active' && (
         <button
            // onClick={nextQuestion} // TODO: Implement next question logic
            disabled={!isConnected}
            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded mr-2 disabled:opacity-50"
         >
           Next Question
         </button>
       )}


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
