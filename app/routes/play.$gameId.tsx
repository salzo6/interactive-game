import type { LoaderFunctionArgs } from '@remix-run/node';
import { json, redirect } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { useEffect, useState, useRef } from 'react';

// Define types (consider moving to a shared types file)
interface Question {
  index: number;
  text: string;
  options: string[];
  // timeLimit?: number;
}
interface PlayerResults {
  isCorrect: boolean;
  scoreEarned: number;
  currentScore: number;
  rank?: number; // Optional rank
}
interface FinalScores {
   players: { nickname: string; score: number }[];
}
type GamePhase = 'connecting' | 'lobby' | 'question' | 'results' | 'ended' | 'error' | 'disconnected';

interface GameState {
  phase: GamePhase;
  question?: Question;
  results?: PlayerResults;
  finalScores?: FinalScores;
  error?: string;
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const gameId = params.gameId?.toUpperCase(); // Ensure uppercase
  const url = new URL(request.url);
  const nickname = url.searchParams.get('nickname');

  if (!gameId || gameId.length !== 6) {
    // Redirect back to join page if gameId is invalid
    console.log("Invalid gameId format in loader:", gameId);
    return redirect(`/play`);
  }
  if (!nickname) {
    // Redirect back to join page if nickname is missing
    console.log("Nickname missing in loader for game:", gameId);
    return redirect(`/play?gameId=${gameId}`);
  }

  // Optional TODO: Server-side validation if gameId exists.
  // This is difficult without querying the WS server state or DB.
  // Relying on WS connection for now.

  return json({ gameId, nickname });
}

export default function PlayGame() {
  const { gameId, nickname } = useLoaderData<typeof loader>();
  const [gameState, setGameState] = useState<GameState>({ phase: 'connecting' });
  const [hasAnswered, setHasAnswered] = useState(false); // Track if player answered current question
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    console.log(`Attempting to connect WebSocket to ${wsUrl}`);
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('Player WebSocket connected');
      // Send join message
      ws.current?.send(
        JSON.stringify({
          type: 'JOIN_GAME',
          payload: { gameId, nickname },
        })
      );
      // Initial state is connecting, wait for server confirmation or error
    };

    ws.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Player received message:', message);

        switch (message.type) {
          case 'JOIN_SUCCESS': // Server confirms successful join
             setGameState({ phase: 'lobby' });
             break;
          case 'GAME_STATE_UPDATE': // General state update (e.g., phase change)
             // Be careful not to overwrite question/results data if phase matches
             if (message.payload.phase && message.payload.phase !== gameState.phase) {
                setGameState(prev => ({ ...prev, phase: message.payload.phase }));
             }
             // Handle other state updates if needed
             break;
          case 'SHOW_QUESTION':
            setGameState({ phase: 'question', question: message.payload });
            setHasAnswered(false); // Reset answered flag for new question
            break;
          case 'SHOW_RESULTS': // Results after a question
             setGameState({ phase: 'results', results: message.payload });
            break;
          case 'GAME_ENDED':
             setGameState({ phase: 'ended', finalScores: message.payload });
             ws.current?.close();
             break;
          case 'ERROR':
             console.error("Server error:", message.payload);
             setGameState({ phase: 'error', error: message.payload || 'An unknown error occurred.' });
             ws.current?.close(); // Close connection on error
             break;
          default:
             console.log("Received unhandled message type:", message.type);
        }
      } catch (error) {
        console.error('Error parsing message:', error);
         setGameState({ phase: 'error', error: 'Received invalid message from server.' });
      }
    };

    ws.current.onerror = (error) => {
      console.error('Player WebSocket error:', error);
      setGameState({ phase: 'error', error: 'WebSocket connection error.' });
    };

    ws.current.onclose = (event) => {
      console.log('Player WebSocket disconnected', event.code, event.reason);
       // Only show disconnected message if it wasn't a normal game end or an error state already
       if (gameState.phase !== 'ended' && gameState.phase !== 'error') {
         setGameState({ phase: 'disconnected' });
       }
    };

    // Cleanup on component unmount
    return () => {
      console.log('Closing player WebSocket connection.');
      ws.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, nickname]); // Effect dependencies


  const submitAnswer = (answerIndex: number) => {
     if (ws.current?.readyState === WebSocket.OPEN && !hasAnswered) {
        ws.current?.send(JSON.stringify({ type: 'SUBMIT_ANSWER', payload: { gameId, answerIndex } }));
        setHasAnswered(true); // Mark as answered
        // Optionally update UI immediately to show "Answered" state
     }
  }

  // --- Render logic based on gameState.phase ---
  const renderContent = () => {
     switch (gameState.phase) {
        case 'connecting':
           return <p className="text-xl animate-pulse">Connecting...</p>;
        case 'lobby':
           return <p className="text-xl">Waiting for the host to start the game...</p>;
        case 'question':
           if (!gameState.question) return <p>Waiting for question...</p>;
           return (
             <div className="w-full max-w-2xl text-center">
               <h2 className="mb-6 text-2xl font-semibold">{gameState.question.text}</h2>
               <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                 {gameState.question.options.map((option: string, index: number) => (
                   <button
                     key={index}
                     onClick={() => submitAnswer(index)}
                     disabled={hasAnswered}
                     className={`rounded p-4 text-lg font-semibold text-white shadow transition-opacity duration-150 ${
                       hasAnswered
                         ? 'cursor-not-allowed bg-gray-400 opacity-70'
                         : 'bg-blue-500 hover:bg-blue-600'
                     }`}
                   >
                     {option}
                   </button>
                 ))}
               </div>
                {hasAnswered && <p className="mt-6 text-lg font-semibold text-green-600">Answer submitted! Waiting for results...</p>}
             </div>
           );
        case 'results':
           if (!gameState.results) return <p>Waiting for results...</p>;
           return (
             <div className="text-center">
               <h2 className={`text-3xl font-bold ${gameState.results.isCorrect ? 'text-green-500' : 'text-red-500'}`}>
                  {gameState.results.isCorrect ? 'Correct!' : 'Incorrect'}
               </h2>
               <p className="mt-2 text-xl">Score Earned: +{gameState.results.scoreEarned}</p>
               <p className="text-xl">Total Score: {gameState.results.currentScore}</p>
               {gameState.results.rank && <p className="text-xl">Rank: {gameState.results.rank}</p>}
               <p className="mt-6 text-lg italic">Waiting for next question...</p>
             </div>
           );
        case 'ended':
           if (!gameState.finalScores) return <p>Game Over!</p>;
           return (
             <div className="w-full max-w-md text-center">
               <h2 className="mb-6 text-3xl font-bold">Game Over! Final Scores:</h2>
               <ul className="space-y-2">
                  {gameState.finalScores.players
                     .sort((a, b) => b.score - a.score) // Sort by score descending
                     .map((player, index) => (
                        <li key={player.nickname} className="flex justify-between rounded bg-gray-100 p-3 text-lg dark:bg-gray-700">
                           <span>{index + 1}. {player.nickname}</span>
                           <span className="font-semibold">{player.score}</span>
                        </li>
                  ))}
               </ul>
             </div>
           );
        case 'error':
           return <p className="text-xl text-red-500">Error: {gameState.error || 'An unknown error occurred.'}</p>;
        case 'disconnected':
           return <p className="text-xl text-orange-500">Disconnected from server.</p>;
        default:
           return <p>Loading...</p>;
     }
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center p-8 font-sans dark:bg-gray-900 dark:text-gray-100">
      <p className="absolute top-4 right-4 text-sm text-gray-600 dark:text-gray-400">
        Player: <strong>{nickname}</strong> | Game: <strong>{gameId}</strong>
      </p>
      {renderContent()}
    </div>
  );
}
