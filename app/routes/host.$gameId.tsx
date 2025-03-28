import type { LoaderFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useState, useRef } from 'react';

// Define Player type (can be moved to a shared types file)
interface PlayerInfo {
  id: string;
  nickname: string;
  score: number;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const gameId = params.gameId?.toUpperCase(); // Ensure gameId is uppercase
  if (!gameId || gameId.length !== 6) { // Basic validation
    throw new Response('Invalid Game ID format', { status: 400 });
  }
  // TODO: Fetch game details/quiz from DB if needed, validate gameId exists
  return json({ gameId });
}

export default function HostGame() {
  const { gameId } = useLoaderData<typeof loader>();
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [gamePhase, setGamePhase] = useState('lobby'); // lobby, question, leaderboard
  const [currentQuestion, setCurrentQuestion] = useState<any>(null); // Store current question object
  const ws = useRef<WebSocket | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('Host WebSocket connected');
      setError(null);
      // Send a message to identify as the host for this game
      ws.current?.send(JSON.stringify({ type: 'HOST_JOIN', payload: { gameId } }));
    };

    ws.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Host received message:', message);

        switch (message.type) {
          case 'PLAYER_LIST_UPDATE':
            setPlayers(message.payload.players);
            break;
          case 'GAME_STARTED': // Server confirms game started
             setGamePhase('question');
             // Question data might come in a separate SHOW_QUESTION message
             break;
          case 'SHOW_QUESTION':
             setCurrentQuestion(message.payload);
             setGamePhase('question');
             break;
          case 'SHOW_LEADERBOARD': // Or results after each question
             setGamePhase('leaderboard');
             // message.payload would contain scores/ranking
             break;
          case 'GAME_ENDED':
             setGamePhase('ended');
             // message.payload could contain final results
             ws.current?.close();
             break;
          case 'ERROR':
             setError(message.payload || 'An unknown error occurred.');
             // Potentially close WS or handle specific errors
             if (message.payload === 'Game already has a host.') {
                ws.current?.close();
             }
             break;
          // Add more cases as needed
        }
      } catch (err) {
        console.error('Error parsing message:', err);
        setError('Received invalid message from server.');
      }
    };

    ws.current.onerror = (err) => {
      console.error('Host WebSocket error:', err);
      setError('WebSocket connection error. Please try refreshing.');
    };

    ws.current.onclose = (event) => {
      console.log('Host WebSocket disconnected', event.code, event.reason);
      // Avoid setting error if game ended normally
      if (gamePhase !== 'ended') {
         setError('WebSocket disconnected. Please refresh.');
      }
      // Handle reconnection logic if needed, or guide user
    };

    // Cleanup on component unmount
    return () => {
      console.log('Closing host WebSocket connection.');
      ws.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]); // Only re-run if gameId changes

  const startGame = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
       ws.current?.send(JSON.stringify({ type: 'START_GAME', payload: { gameId } }));
       // Optimistic UI update can be removed if relying on server confirmation message
       // setGamePhase('question');
    } else {
       setError("Cannot start game: WebSocket not connected.");
    }
  };

   const nextQuestion = () => {
    if (ws.current?.readyState === WebSocket.OPEN) {
       ws.current?.send(JSON.stringify({ type: 'NEXT_QUESTION', payload: { gameId } }));
       // UI will update when server sends SHOW_QUESTION or SHOW_LEADERBOARD
    } else {
       setError("Cannot proceed: WebSocket not connected.");
    }
  };


  return (
    <div className="p-8 font-sans dark:bg-gray-800 dark:text-gray-100 min-h-screen">
      <h1 className="mb-4 text-3xl font-bold">Host Screen</h1>
      {error && <p className="mb-4 rounded bg-red-100 p-3 text-red-700">{error}</p>}
      <p className="mb-6 text-xl">
        Game PIN: <strong className="font-mono tracking-widest text-blue-600 dark:text-blue-400">{gameId}</strong>
      </p>

      {gamePhase === 'lobby' && (
        <div>
          <h2 className="mb-3 text-2xl font-semibold">Players Waiting:</h2>
          <ul className="mb-6 min-h-[50px] list-inside list-disc pl-5">
            {players.length > 0 ? (
              players.map((player) => <li key={player.id} className="text-lg">{player.nickname}</li>)
            ) : (
              <li className="text-lg italic text-gray-500">No players yet...</li>
            )}
          </ul>
          <button
            onClick={startGame}
            disabled={players.length === 0 || !!error}
            className="rounded bg-blue-600 px-6 py-2 text-lg font-semibold text-white shadow transition-colors duration-150 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Start Game
          </button>
        </div>
      )}

      {gamePhase === 'question' && currentQuestion && (
        <div>
          <h2 className="mb-4 text-2xl font-semibold">Question {currentQuestion.index + 1}</h2>
          <p className="mb-6 text-xl">{currentQuestion.text}</p>
          {/* Host usually sees results/stats here, not options */}
          <p className="mb-4">Players are answering...</p>
          {/* TODO: Add timer display */}
          {/* TODO: Add live answer count */}
          <button
             onClick={nextQuestion} // Or maybe "Show Results" then "Next Question"
             disabled={!!error}
             className="mt-4 rounded bg-green-600 px-6 py-2 text-lg font-semibold text-white shadow transition-colors duration-150 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {gamePhase === 'leaderboard' && (
        <div>
          <h2 className="text-2xl font-semibold">Leaderboard</h2>
          {/* TODO: Display scores from server message */}
           <p className="my-4">Showing scores...</p>
           <button
             onClick={nextQuestion}
             disabled={!!error}
             className="mt-4 rounded bg-green-600 px-6 py-2 text-lg font-semibold text-white shadow transition-colors duration-150 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50"
          >
            Next Question
          </button>
        </div>
      )}

       {gamePhase === 'ended' && (
        <div>
          <h2 className="text-3xl font-bold text-center">Game Over!</h2>
          {/* TODO: Display final results */}
        </div>
      )}
    </div>
  );
}
