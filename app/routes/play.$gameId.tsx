import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { Form, Link, useActionData, useLoaderData, useNavigation } from '@remix-run/react';
import { useEffect, useRef, useState } from 'react';
import { requirePlayer, createServerClient } from '~/lib/session.server'; // Import server client creator

// Define Player type for frontend state
interface PlayerInfo {
  id: string;
  nickname: string;
  score: number;
}

export const meta: MetaFunction<typeof loader> = ({ data }) => {
  const gamePin = data?.game?.game_pin;
  return [{ title: gamePin ? `Join Game ${gamePin} - Live Quiz` : 'Join Game - Live Quiz' }];
};

// Loader: Fetch game details for display and initial validation
export async function loader({ request, params }: LoaderFunctionArgs) {
  const playerUser = await requirePlayer(request); // Ensure user is logged in and is a player
  const gamePin = params.gameId?.toUpperCase();

  console.log(`\n--- [play.$gameId.tsx loader] --- Handling request for game PIN: ${gamePin}`);

  if (!gamePin) {
    console.error("[play.$gameId.tsx loader] No gamePin found in route params.");
    throw redirect('/play'); // Redirect to the page asking for a PIN
  }

  let supabase;
  try {
    console.log("[play.$gameId.tsx loader] Attempting to create server client...");
    supabase = createServerClient(request); // Use authenticated server client
    console.log("[play.$gameId.tsx loader] Server client created. Type:", typeof supabase);
    if (!supabase || typeof supabase.from !== 'function') {
        console.error("[play.$gameId.tsx loader] Failed to create a valid Supabase client or client is malformed.");
        throw new Error("Failed to initialize database connection.");
    }
    console.log("[play.$gameId.tsx loader] Supabase client seems valid. Proceeding with query...");
  } catch (error) {
      console.error("[play.$gameId.tsx loader] Error creating Supabase client:", error);
      throw json({ error: "Internal server error initializing database connection." }, { status: 500 });
  }

  console.log(`[play.$gameId.tsx loader] Querying for game details with PIN: ${gamePin}`);
  const { data: game, error: dbError } = await supabase
    .from('games')
    .select('id, game_pin, status, host_id') // Select necessary fields
    .eq('game_pin', gamePin)
    .single();

  if (dbError || !game) {
    console.warn(`[play.$gameId.tsx loader] Game PIN ${gamePin} not found or error:`, dbError);
     // Log the specific error before throwing
     const errorMessage = dbError ? `Database error: ${dbError.message}` : 'Invalid Game PIN.';
     console.error(`[play.$gameId.tsx loader] Throwing 404/500: ${errorMessage}`);
     throw json({ error: errorMessage }, { status: dbError ? 500 : 404 });
  }

   if (game.status !== 'lobby') {
     console.warn(`[play.$gameId.tsx loader] Attempt to load join page for game ${gamePin} which is not in lobby (status: ${game.status})`);
     throw json({ error: `Game is already ${game.status}. Cannot join now.` }, { status: 403 });
   }

  console.log(`[play.$gameId.tsx loader] Player ${playerUser.email} can join game ${gamePin}. Rendering join form.`);
  // Return game data and player info for the form page
  return json({ game, playerUser, alreadyJoined: false }); // Assuming alreadyJoined logic is handled elsewhere or removed for simplicity
}

// Action: Handle the form submission to join the game
export async function action({ request, params }: ActionFunctionArgs) {
  const playerUser = await requirePlayer(request); // Ensure user is logged in and is a player
  const gamePin = params.gameId?.toUpperCase();
  const formData = await request.formData();
  const nickname = formData.get('nickname')?.toString().trim();

  console.log(`\n--- [play.$gameId.tsx action] --- Handling join attempt for game PIN: ${gamePin} by user: ${playerUser.email}`);

  if (!gamePin) {
    console.error("[play.$gameId.tsx action] No gamePin found in route params.");
    return json({ error: 'Game PIN missing in URL.' }, { status: 400 });
  }

  if (!nickname || nickname.length === 0 || nickname.length > 20) {
    console.warn(`[play.$gameId.tsx action] Invalid nickname provided: "${nickname}"`);
    return json({ error: 'Nickname must be between 1 and 20 characters.' }, { status: 400 });
  }

  let supabase;
  try {
    console.log("[play.$gameId.tsx action] Attempting to create server client...");
    supabase = createServerClient(request); // Use authenticated server client
     console.log("[play.$gameId.tsx action] Server client created. Type:", typeof supabase);
     if (!supabase || typeof supabase.from !== 'function') {
         console.error("[play.$gameId.tsx action] Failed to create a valid Supabase client or client is malformed.");
         throw new Error("Failed to initialize database connection for action.");
     }
     console.log("[play.$gameId.tsx action] Supabase client seems valid. Proceeding...");
  } catch (error) {
      console.error("[play.$gameId.tsx action] Error creating Supabase client:", error);
      // Return JSON error response instead of throwing
      return json({ error: "Internal server error initializing database connection." }, { status: 500 });
  }


  // *** Re-fetch game state within the action to prevent race conditions ***
  console.log(`[play.$gameId.tsx action] Checking game status for PIN: ${gamePin}`);
  const { data: game, error: gameCheckError } = await supabase
    .from('games')
    .select('id, status, host_id') // Select needed fields
    .eq('game_pin', gamePin)
    .single();

  if (gameCheckError || !game) {
    console.warn(`[play.$gameId.tsx action] Game PIN ${gamePin} not found or error during action check:`, gameCheckError);
    return json({ error: 'Game not found or could not be verified.' }, { status: 404 });
  }

  // *** Check game status AGAIN before insert ***
  if (game.status !== 'lobby') {
    console.warn(`[play.$gameId.tsx action] Attempt to join game ${gamePin} which is no longer in lobby (status: ${game.status})`);
    return json({ error: `Game is no longer accepting players (status: ${game.status}).` }, { status: 403 });
  }

  if (game.host_id === playerUser.id) {
      console.warn(`[play.$gameId.tsx action] Host (${playerUser.email}) attempted to join their own game ${gamePin} as a player.`);
      return json({ error: 'Hosts cannot join their own game as a player.' }, { status: 403 });
  }

   console.log(`[play.$gameId.tsx action] Checking nickname uniqueness: "${nickname}" in game ID: ${game.id}`);
   const { data: existingNickname, error: nicknameCheckError } = await supabase
     .from('players')
     .select('nickname')
     .eq('game_id', game.id)
     .eq('nickname', nickname)
     .maybeSingle();

   if (nicknameCheckError) {
     // *** ENHANCED LOGGING ***
     console.error(`[play.$gameId.tsx action] Error checking nickname uniqueness for game ${gamePin}. Nickname: "${nickname}", GameID: ${game.id}`);
     console.error('[play.$gameId.tsx action] Full Nickname Check Error:', JSON.stringify(nicknameCheckError, null, 2)); // Log the full error object
     // *** END ENHANCED LOGGING ***
     return json({ error: 'Database error checking nickname.' }, { status: 500 });
   }

   if (existingNickname) {
     console.warn(`[play.$gameId.tsx action] Nickname "${nickname}" already taken in game ${gamePin}.`);
     return json({ error: `Nickname "${nickname}" is already taken in this game.` }, { status: 409 }); // 409 Conflict
   }

  // *** Attempt to insert the player AND return the ID ***
  console.log(`[play.$gameId.tsx action] Inserting player "${nickname}" (User ID: ${playerUser.id}) into game ID: ${game.id}`);
  const { data: newPlayer, error: insertError } = await supabase
    .from('players')
    .insert({
      game_id: game.id, // Use the validated game ID
      nickname: nickname,
      user_id: playerUser.id // Link player to the authenticated user
    })
    .select('id') // Select the ID of the newly inserted row
    .single(); // Expect only one row back

  if (insertError) {
    console.error(`[play.$gameId.tsx action] Error inserting player ${nickname} into game ${gamePin} (ID: ${game.id}):`, insertError);
    // Check if the error is specifically RLS violation (code 42501)
    if (insertError.code === '42501') {
       console.error("[play.$gameId.tsx action] RLS policy violation confirmed during insert.");
       return json({ error: 'Failed to join the game. Please ensure the game is still in the lobby and accepting players. (RLS)' }, { status: 403 });
    }
    // Handle other potential DB errors
    console.error('[play.$gameId.tsx action] Full Insert Error:', JSON.stringify(insertError, null, 2)); // Log full insert error too
    return json({ error: `Failed to join the game. Database error: ${insertError.message}` }, { status: 500 });
  }

  if (!newPlayer || !newPlayer.id) {
      console.error(`[play.$gameId.tsx action] Player insert succeeded but no ID returned for ${nickname} in game ${gamePin}.`);
      return json({ error: 'Failed to join the game. Could not retrieve player ID after creation.' }, { status: 500 });
  }

  console.log(`[play.$gameId.tsx action] Player ${nickname} (ID: ${newPlayer.id}, UserID: ${playerUser.id}) successfully joined game ${gamePin} (ID: ${game.id}).`);

  // Return success, the nickname, and the NEWLY CREATED PLAYER ID
  return json({ success: true, joinedNickname: nickname, playerId: newPlayer.id });
}


// Component: Form for joining a game OR Lobby view
export default function JoinGamePage() {
  const { game, playerUser } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === 'submitting';

  // State for WebSocket connection, player list, and shared state
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [sharedState, setSharedState] = useState<number>(0); // Initial shared state for player view
  const [isConnected, setIsConnected] = useState(false);
  const [hasJoined, setHasJoined] = useState(actionData?.success ?? false);
  const [joinedNickname, setJoinedNickname] = useState(actionData?.joinedNickname ?? '');
  const [playerId, setPlayerId] = useState(actionData?.playerId ?? ''); // Store player ID
  const ws = useRef<WebSocket | null>(null);

  const gameId = game.id; // The actual UUID game ID
  const gamePin = game.game_pin; // The user-facing PIN

  // Update state if actionData changes (e.g., after form submission)
  useEffect(() => {
    if (actionData?.success) {
      setHasJoined(true);
      setJoinedNickname(actionData.joinedNickname);
      setPlayerId(actionData.playerId); // Store the player ID
    }
  }, [actionData]);

  // Effect to establish WebSocket connection after joining
  useEffect(() => {
    // Only connect if the player has successfully joined (either via action or if they were already joined)
    if (hasJoined && playerId && gameId) {
      console.log(`Player ${joinedNickname} (ID: ${playerId}) attempting WebSocket connection for game ${gameId}...`);

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws`; // Connect to the base WS endpoint
      console.log(`Connecting to WebSocket: ${wsUrl}`);

      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        console.log(`WebSocket connected for player ${joinedNickname} in game ${gameId}`);
        setIsConnected(true);
        // Send PLAYER_IDENTIFY message with gameId (UUID), playerId (UUID), and nickname
        ws.current?.send(JSON.stringify({
            type: 'PLAYER_IDENTIFY',
            payload: {
                gameId: gameId,
                playerId: playerId,
                nickname: joinedNickname
            }
        }));
      };

      ws.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log(`Player ${joinedNickname} received message:`, message);

          switch (message.type) {
            case 'PLAYER_LIST_UPDATE':
              setPlayers(message.payload.players);
              break;
            case 'SHARED_STATE_UPDATE':
              setSharedState(message.payload.newState);
              break;
            case 'IDENTIFY_SUCCESS':
              console.log('Server confirmed WebSocket identification.');
              break;
            case 'GAME_ENDED':
              console.log('Game ended by host.');
              alert(`Game Over: ${message.payload || 'The host ended the game.'}`);
              // TODO: Redirect or update UI to reflect game end
              setHasJoined(false); // Go back to join form state maybe?
              ws.current?.close();
              break;
            // Handle other game messages (e.g., SHOW_QUESTION)
            default:
              console.log(`Player received unhandled message type: ${message.type}`);
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.current.onerror = (error) => {
        console.error(`WebSocket error for player ${joinedNickname}:`, error);
        setIsConnected(false);
      };

      ws.current.onclose = (event) => {
        console.log(`WebSocket disconnected for player ${joinedNickname}. Code: ${event.code}, Reason: ${event.reason}`);
        setIsConnected(false);
        // Optionally attempt reconnect or show disconnected state
      };

      // Cleanup function
      return () => {
        if (ws.current) {
          console.log(`Closing WebSocket connection for player ${joinedNickname}`);
          ws.current.close();
          ws.current = null;
        }
      };
    }
  }, [hasJoined, gameId, playerId, joinedNickname]); // Dependencies for establishing connection


  // --- Render Logic ---

  if (hasJoined) {
    // Display Lobby/Waiting screen
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">
          Game Lobby: {gamePin}
        </h1>
        <p className="text-lg text-gray-600 dark:text-gray-300">
          Welcome, {joinedNickname}! Waiting for the host to start...
        </p>
        <p className={`text-sm font-semibold ${isConnected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
          {isConnected ? 'Connected' : 'Disconnected'}
        </p>

        {/* Display Shared State */}
        <div className="my-4 p-3 border rounded dark:border-gray-600 bg-gray-100 dark:bg-gray-800">
            <h2 className="text-lg font-semibold mb-2 text-center">Shared Counter</h2>
            <p className="text-3xl font-bold text-center">{sharedState}</p>
        </div>


        <div className="mt-4 w-full max-w-sm p-4 border rounded bg-gray-50 dark:bg-gray-700">
          <h2 className="text-xl font-semibold mb-2 text-center">Players Joined ({players.length}):</h2>
          {players.length > 0 ? (
            <ul className="list-disc list-inside space-y-1">
              {players.map((player) => (
                <li key={player.id} className="text-gray-700 dark:text-gray-200">
                    {player.nickname} {player.id === playerId ? '(You)' : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center text-gray-500 dark:text-gray-400">Waiting for players...</p>
          )}
        </div>
         <Link to="/" className="mt-6 text-blue-600 hover:underline dark:text-blue-400">
            Leave Game
         </Link>
      </div>
    );
  }

  // Display Join Form
  return (
    <div className="flex flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">
        Join Game: <span className="font-mono tracking-widest">{gamePin}</span>
      </h1>
      <p className="text-gray-600 dark:text-gray-400">Enter a nickname to join the game.</p>

      <Form method="post" className="w-full max-w-xs space-y-4">
        <div>
          <label htmlFor="nickname" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Nickname
          </label>
          <input
            type="text"
            id="nickname"
            name="nickname"
            required
            minLength={1}
            maxLength={20}
            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:ring-offset-gray-800"
            aria-describedby="nickname-error"
          />
        </div>

        {actionData?.error && !actionData?.success && ( // Only show error if not successful
          <p id="nickname-error" className="text-sm text-red-600 dark:text-red-400">
            {actionData.error}
          </p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 dark:focus:ring-offset-gray-800"
        >
          {isSubmitting ? 'Joining...' : 'Join Game'}
        </button>
      </Form>
       <Link to="/" className="mt-4 text-blue-600 hover:underline dark:text-blue-400">
         Cancel
       </Link>
    </div>
  );
}
