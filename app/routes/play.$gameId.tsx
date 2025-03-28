import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useLoaderData, useFetcher } from '@remix-run/react';
import type { LoaderFunctionArgs, ActionFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { supabase } from '~/lib/supabase';
import { requirePlayer } from '~/lib/session.server';

// Define Player type for frontend state
interface PlayerInfo {
  id: string;
  nickname: string;
  score: number;
}

// Define type for successful join action data
interface JoinSuccessData {
    success: true;
    player: {
        id: string; // Player UUID from DB
        nickname: string;
        game_id: string; // Game UUID from DB
        // user_id: string | null; // If you add this later
        created_at: string;
        score: number;
    };
}

// Define type for join action error data
interface JoinErrorData {
    error: string;
}

type JoinActionData = JoinSuccessData | JoinErrorData | undefined;


export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const gamePin = data?.game?.game_pin ?? 'Play';
  return [{ title: `Play Game: ${gamePin}` }];
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  console.log(`\n--- [play.$gameId.tsx loader] --- Handling request for path: ${url.pathname}`);
  console.log(`[play.$gameId.tsx loader] Params received:`, params);

  const playerUser = await requirePlayer(request);
  const gamePin = params.gameId?.toUpperCase(); // Get PIN from route segment

  console.log(`[play.$gameId.tsx loader] Extracted gamePin from route params: ${gamePin}`);

  if (!gamePin) {
    console.error("[play.$gameId.tsx loader] CRITICAL: No gameId found in route parameters!");
    // This should ideally not happen if Remix routing is correct
    throw new Response('Game PIN missing in route parameters.', { status: 400 });
  }

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('id, game_pin, status, host_id, current_question_index')
    .eq('game_pin', gamePin)
    .single();

  if (gameError || !game) {
    console.error(`[play.$gameId.tsx loader] Error fetching game ${gamePin} or game not found:`, gameError);
    throw new Response('Game not found.', { status: 404 });
  }

  // Fetch current players (RLS handles permissions)
  const { data: initialPlayers, error: playersError } = await supabase
    .from('players')
    .select('id, nickname, score')
    .eq('game_id', game.id); // Use game UUID

   if (playersError) {
     console.error('[play.$gameId.tsx loader] Error fetching initial players:', playersError);
   }

   // TODO: Fetch current question if game is active

  console.log(`[play.$gameId.tsx loader] Successfully loaded data for game ${gamePin}`);
  return json({
      game: { id: game.id, game_pin: game.game_pin, status: game.status, current_question_index: game.current_question_index },
      initialPlayers: initialPlayers ?? [],
      playerUserId: playerUser.id
  });
}

export async function action({ request, params }: ActionFunctionArgs) {
    console.log(`\n--- [play.$gameId.tsx action] --- Handling POST request`);
    const playerUser = await requirePlayer(request);
    const gamePin = params.gameId?.toUpperCase(); // Get PIN from route segment
    const formData = await request.formData();
    const nickname = formData.get('nickname') as string;

    console.log(`[play.$gameId.tsx action] gamePin from params: ${gamePin}, nickname from form: ${nickname}`);

    if (!gamePin) {
        console.error("[play.$gameId.tsx action] No gameId found in route parameters!");
        return json({ error: 'Game PIN missing in route parameters.' }, { status: 400 });
    }
    if (!nickname || nickname.trim().length === 0 || nickname.length > 20) {
        console.error("[play.$gameId.tsx action] Invalid nickname:", nickname);
        return json({ error: 'Nickname must be between 1 and 20 characters.' }, { status: 400 });
    }

    const { data: game, error: gameError } = await supabase
      .from('games').select('id, status').eq('game_pin', gamePin).single();

    if (gameError || !game) {
        console.error("[play.$gameId.tsx action] Game not found:", gamePin, gameError);
        return json({ error: 'Game not found.' }, { status: 404 });
    }
    if (game.status !== 'lobby') {
        console.warn(`[play.$gameId.tsx action] Attempt to join non-lobby game ${gamePin} (status: ${game.status})`);
        return json({ error: 'Game is no longer accepting players.' }, { status: 403 });
    }

    // TODO: Add check here to prevent user joining multiple games if user_id is added to players table

    const { data: newPlayer, error: insertError } = await supabase
        .from('players')
        .insert({ game_id: game.id, nickname: nickname.trim() /*, user_id: playerUser.id */ })
        .select() // Select the newly created player record
        .single();

    if (insertError) {
        console.error('[play.$gameId.tsx action] Error inserting player:', insertError);
        if (insertError.code === '23505') { // Unique violation
             return json({ error: 'This nickname is already taken in this game.' }, { status: 409 });
        }
        return json({ error: 'Failed to join the game. ' + insertError.message }, { status: 500 });
    }

    console.log(`[play.$gameId.tsx action] Player ${nickname} joined game ${gamePin} (DB record created)`);
    return json({ success: true, player: newPlayer });
}


// --- Component code remains the same ---
export default function PlayGame() {
  const { game, initialPlayers, playerUserId } = useLoaderData<typeof loader>();
  const joinFetcher = useFetcher<JoinActionData>(); // Use refined type
  const [players, setPlayers] = useState<PlayerInfo[]>(initialPlayers);
  const [sharedState, setSharedState] = useState<number>(0);
  const [gameStatus, setGameStatus] = useState<'lobby' | 'active' | 'finished' | 'ended'>(game.status as any);
  const [currentQuestion, setCurrentQuestion] = useState<any>(null); // Store current question object
  const [wsConnected, setWsConnected] = useState(false);
  const [hasJoined, setHasJoined] = useState(false); // Track if join action was successful
  const [joinedPlayerInfo, setJoinedPlayerInfo] = useState<{id: string; nickname: string} | null>(null);

  const ws = useRef<WebSocket | null>(null);
  const gameId = game.id; // Game UUID

  const isJoining = joinFetcher.state !== 'idle';
  const joinError = joinFetcher.data && 'error' in joinFetcher.data ? joinFetcher.data.error : null;
  const joinSuccessData = joinFetcher.data && 'success' in joinFetcher.data ? joinFetcher.data : null;

  // Effect to handle successful join and store player info
  useEffect(() => {
      if (joinSuccessData?.success && joinSuccessData.player) {
          setHasJoined(true);
          setJoinedPlayerInfo({ id: joinSuccessData.player.id, nickname: joinSuccessData.player.nickname });
          console.log("[PlayGame Effect] Join successful, player info stored:", joinSuccessData.player);
      }
  }, [joinSuccessData]);


  // Effect for WebSocket connection *after* successful join
  useEffect(() => {
    if (!hasJoined || !joinedPlayerInfo || ws.current) {
        // console.log("[PlayGame WS Effect] Skipping connection (hasJoined:", hasJoined, "joinedPlayerInfo:", !!joinedPlayerInfo, "ws.current:", !!ws.current, ")");
        return;
    }

    const wsUrl = `ws://${window.location.host}/ws`;
    ws.current = new WebSocket(wsUrl);
    console.log(`[PlayGame WS Effect] Attempting Player WebSocket connection to ${wsUrl}`);

    ws.current.onopen = () => {
      console.log('[PlayGame WS Effect] Player WebSocket connected');
      setWsConnected(true);
      ws.current?.send(JSON.stringify({
          type: 'PLAYER_IDENTIFY',
          payload: {
              gameId: gameId,
              playerId: joinedPlayerInfo.id,
              nickname: joinedPlayerInfo.nickname
          }
      }));
      console.log('[PlayGame WS Effect] Sent PLAYER_IDENTIFY');
    };

    ws.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('[PlayGame WS Effect] Player received message:', message.type);

        switch (message.type) {
          case 'PLAYER_LIST_UPDATE':
            setPlayers(message.payload.players);
            break;
          case 'SHARED_STATE_UPDATE':
            setSharedState(message.payload.newState);
            break;
          case 'GAME_STARTED':
            setGameStatus('active');
            setCurrentQuestion(null);
            console.log("[PlayGame WS Effect] Game started!");
            break;
          case 'SHOW_QUESTION':
             setGameStatus('active');
             setCurrentQuestion(message.payload);
             console.log("[PlayGame WS Effect] Received question:", message.payload.index);
             break;
          case 'GAME_ENDED':
            setGameStatus('ended');
            setCurrentQuestion(null);
            console.log("[PlayGame WS Effect] Game ended:", message.payload);
            ws.current?.close(1000, "Game Ended by Host");
            break;
          default:
            console.log('[PlayGame WS Effect] Player received unhandled message type:', message.type);
        }
      } catch (error) {
        console.error('[PlayGame WS Effect] Error parsing message or handling update:', error);
      }
    };

    ws.current.onerror = (error) => {
      console.error('[PlayGame WS Effect] Player WebSocket error:', error);
      setWsConnected(false);
    };

    ws.current.onclose = (event) => {
      console.log('[PlayGame WS Effect] Player WebSocket disconnected:', event.code, event.reason);
      setWsConnected(false);
      // Optionally handle unexpected disconnects
    };

    return () => {
      if (ws.current) {
          console.log('[PlayGame WS Effect] Closing player WebSocket connection');
          ws.current.close();
          ws.current = null;
          setWsConnected(false);
      }
    };
  }, [hasJoined, gameId, joinedPlayerInfo]);


  // Function to send message (e.g., submit answer)
  const sendMessage = useCallback((message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.error('[PlayGame sendMessage] WebSocket not connected or not open.');
    }
  }, []);

  // Handler for submitting an answer
  const submitAnswer = (answerIndex: number) => {
      if (gameStatus !== 'active' || !currentQuestion) return;
      sendMessage({
          type: 'SUBMIT_ANSWER',
          payload: { answerIndex }
      });
      console.log(`[PlayGame submitAnswer] Submitting answer: ${answerIndex}`);
      // TODO: Add visual feedback
  };


  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">Playing Game: {game.game_pin}</h1>
      <p className="mb-1">Status: <span className="font-semibold">{gameStatus}</span> {wsConnected ? '(Connected)' : '(Connecting/Disconnected)'}</p>
      {hasJoined && joinedPlayerInfo && <p className="mb-6">Playing as: <span className="font-semibold">{joinedPlayerInfo.nickname}</span></p>}


      {/* Nickname Form */}
      {gameStatus === 'lobby' && !hasJoined && (
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

      {/* Shared State Display */}
       {hasJoined && (
           <div className="my-4 p-3 border rounded dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
               <h3 className="text-lg font-semibold text-center">Admin's Shared Number:</h3>
               <p className="text-5xl font-bold text-center text-purple-600 dark:text-purple-400">{sharedState}</p>
           </div>
       )}


      {/* Waiting Room / Game Active UI */}
      {hasJoined && (
        <div>
          {gameStatus === 'lobby' && (
            <p className="text-lg text-blue-700 dark:text-blue-300">Waiting for the host to start the game...</p>
          )}
          {gameStatus === 'active' && currentQuestion && (
            <div>
              <h2 className="text-2xl font-semibold mb-4">Question {currentQuestion.index + 1}</h2>
              <p className="text-xl mb-4">{currentQuestion.text}</p>
              <div className="grid grid-cols-2 gap-4 mt-4">
                 {currentQuestion.options.map((option: string, index: number) => (
                     <button
                        key={index}
                        onClick={() => submitAnswer(index)}
                        className={`text-white font-bold py-4 px-4 rounded ${
                            index === 0 ? 'bg-red-500 hover:bg-red-600' :
                            index === 1 ? 'bg-blue-500 hover:bg-blue-600' :
                            index === 2 ? 'bg-yellow-500 hover:bg-yellow-600' :
                            'bg-green-500 hover:bg-green-600' // index === 3
                        }`}
                     >
                         {option}
                     </button>
                 ))}
              </div>
            </div>
          )}
           {gameStatus === 'active' && !currentQuestion && (
               <p className="text-lg text-gray-600 dark:text-gray-400">Waiting for the next question...</p>
           )}
           {gameStatus === 'finished' && (
             <p className="text-lg font-semibold text-purple-700 dark:text-purple-300">The game has finished!</p>
             // TODO: Show final scores/leaderboard
           )}
           {gameStatus === 'ended' && (
               <p className="text-lg font-semibold text-red-700 dark:text-red-400">The game has ended because the host left.</p>
           )}
        </div>
      )}

      {/* Player List */}
      {hasJoined && (
          <>
              <h3 className="text-xl font-semibold mt-8 mb-3">Players in Game ({players.length})</h3>
              {players.length > 0 ? (
                <ul className="list-inside list-disc space-y-1">
                  {players.map((player) => (
                    <li key={player.id}>
                      {player.nickname}
                      {player.id === joinedPlayerInfo?.id ? ' (You)' : ''}
                      {/* (Score: {player.score}) */}
                    </li>
                  ))}
                </ul>
              ) : (
                 <p>Waiting for players...</p>
              )}
          </>
      )}
    </div>
  );
}
