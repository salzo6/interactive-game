import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLoaderData } from '@remix-run/react';
import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
// import { supabase } from '~/lib/supabase'; // Don't use browser client in loader
import { requireAdmin, createServerClient } from '~/lib/session.server'; // Import server client creator

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
  console.log("\n--- [host.$gameId.tsx loader] --- Start"); // Added newline for clarity
  const adminUser = await requireAdmin(request);
  const gamePin = params.gameId; // This is the game_pin from the URL
  const supabase = await createServerClient(request); // Use authenticated server client

  if (!gamePin) {
    console.error("[host.$gameId.tsx loader] Error: Game PIN not provided in URL params.");
    throw new Response('Game PIN not provided', { status: 400 });
  }

  console.log(`[host.$gameId.tsx loader] Admin ${adminUser.email} loading game PIN: ${gamePin}`);
  console.log("[host.$gameId.tsx loader] Supabase client created. Type:", typeof supabase, "Keys:", supabase ? Object.keys(supabase) : 'null');

  let gameData, gameError;
  try {
    console.log(`[host.$gameId.tsx loader] Attempting to query 'games' table for PIN: ${gamePin}, Host ID: ${adminUser.id}`);
    const query = supabase
      .from('games')
      .select('id, game_pin, status, host_id') // Select the actual game ID (UUID)
      .eq('game_pin', gamePin)
      .eq('host_id', adminUser.id) // Ensure the logged-in admin is the host
      .single();

    console.log("[host.$gameId.tsx loader] Query constructed. Awaiting execution...");
    const { data, error } = await query;
    gameData = data;
    gameError = error;
    console.log("[host.$gameId.tsx loader] Query execution finished."); // Log success

  } catch (e) {
      console.error("[host.$gameId.tsx loader] CRITICAL: Error *during* Supabase query execution:", e);
      // Re-throw the caught error if it's not the Vite internal one,
      // otherwise let the original Vite error propagate if this catch doesn't run.
      throw new Response(`Server error during database query: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }

  console.log("[host.$gameId.tsx loader] Query result:", { data: gameData, error: gameError });


  if (gameError || !gameData) {
    console.error(`[host.$gameId.tsx loader] Error fetching game ${gamePin} or access denied for user ${adminUser.email}:`, gameError);
    // Provide more specific feedback if possible
    if (gameError?.code === 'PGRST116') { // PostgREST code for "Resource not found or permission denied"
         throw new Response(`Game with PIN ${gamePin} not found or you are not the host.`, { status: 404 });
    }
    // If it's not PGRST116, it might be the Vite error manifesting as a null result or different error code
    throw new Response(`Error loading game data. Details: ${gameError?.message || 'Unknown error'}`, { status: 500 });
  }

   console.log(`[host.$gameId.tsx loader] Game ${gamePin} (ID: ${gameData.id}) loaded successfully for host ${adminUser.email}. Status: ${gameData.status}`);

  // Fetch initial players (though WS will update)
   let initialPlayersData, playersErrorData;
   try {
       console.log(`[host.$gameId.tsx loader] Attempting to fetch players for game ID: ${gameData.id}`);
       const { data: playersData, error: playersErr } = await supabase
         .from('players')
         .select('id, nickname, score')
         .eq('game_id', gameData.id); // Use the actual game ID (UUID)
       initialPlayersData = playersData;
       playersErrorData = playersErr;
       console.log("[host.$gameId.tsx loader] Players query finished.");
   } catch (e) {
       console.error("[host.$gameId.tsx loader] CRITICAL: Error *during* players query execution:", e);
       // Non-critical for page load, but log it
       initialPlayersData = []; // Default to empty array on error
       playersErrorData = e; // Store the error
   }


  if (playersErrorData) {
    console.error(`[host.$gameId.tsx loader] Error fetching initial players for game ${gameData.id}:`, playersErrorData);
    // Non-critical, WS will handle updates, but log it.
  } else {
     console.log(`[host.$gameId.tsx loader] Fetched ${initialPlayersData?.length ?? 0} initial players for game ${gameData.id}.`);
  }

  console.log("[host.$gameId.tsx loader] Preparing JSON response...");
  // Pass the actual game ID (UUID) and game PIN to the component
  const responsePayload = {
      game: { id: gameData.id, game_pin: gameData.game_pin, status: gameData.status },
      initialPlayers: initialPlayersData ?? []
  };

  try {
      const response = json(responsePayload);
      console.log("--- [host.$gameId.tsx loader] --- End Success");
      return response;
  } catch (e) {
      console.error("[host.$gameId.tsx loader] CRITICAL: Error during JSON serialization:", e);
      console.error("[host.$gameId.tsx loader] Payload causing serialization error:", JSON.stringify(responsePayload, null, 2));
      throw new Response(`Server error during response creation: ${e instanceof Error ? e.message : String(e)}`, { status: 500 });
  }
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
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);
    console.log(`Host attempting to connect WebSocket to ${wsUrl} for game ${gameId}`);

    ws.current.onopen = () => {
      console.log(`Host WebSocket connected for game ${gameId}`);
      setIsConnected(true); // Set connected state HERE
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
      setIsConnected(false); // Set disconnected on error
    };

    ws.current.onclose = (event) => {
      console.log(`Host WebSocket disconnected for game ${gameId}. Code: ${event.code}, Reason: ${event.reason}`);
      setIsConnected(false); // Set disconnected on close
      // Maybe show a disconnected message or attempt reconnect
    };

    // Cleanup on component unmount
    return () => {
      if (ws.current) {
         console.log(`Closing host WebSocket connection for game ${gameId}`);
         ws.current.close();
         ws.current = null;
      }
    };
  }, [gameId, gamePin]); // Reconnect if gameId/gamePin changes (shouldn't happen often)

  // Function to send message to WebSocket server
  const sendMessage = useCallback((message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not connected or not open.');
      // Optionally provide user feedback here
    }
  }, []);

  // Handler to update shared state
  const updateSharedState = (increment: number) => {
      const newState = sharedState + increment;
      // setSharedState(newState); // Let server be source of truth via broadcast
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
      {/* Display connection status more clearly */}
      <p className={`mb-2 font-semibold ${isConnected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
         Status: {game.status} {isConnected ? '(Connected)' : '(Disconnected)'}
      </p>
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
