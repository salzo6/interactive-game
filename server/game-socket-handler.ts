import type { WebSocket } from 'ws';
import type * as http from 'http';
import { nanoid } from 'nanoid';
import { supabase } from '../app/lib/supabase'; // Import the Supabase client

// --- Types ---
interface Player {
  id: string;
  nickname: string;
  score: number;
  ws: WebSocket; // Reference to the WebSocket connection
}

interface GameState {
  gameId: string; // Corresponds to the Supabase 'games' table ID
  gamePin: string; // The user-facing PIN (needed for potential re-query if necessary)
  hostWs: WebSocket | null; // Reference to the host's WebSocket
  players: Map<string, Player>; // Map playerId to Player object
  currentQuestionIndex: number;
  gamePhase: 'lobby' | 'question' | 'leaderboard' | 'ended';
  // TODO: Add quiz questions array
}

// --- In-Memory State ---
// WARNING: This state is lost on server restart. Use a database for persistence.
const games = new Map<string, GameState>(); // Key is gameId (UUID)
// Map WebSocket instances to player/game info for easy cleanup on disconnect
const wsClientMap = new Map<WebSocket, { gameId: string; playerId: string }>(); // playerId can be 'host_{gameId}'

// --- WebSocket Message Handler ---
export function handleWebSocket(ws: WebSocket, req: http.IncomingMessage) {

  ws.on('message', (messageBuffer) => {
    let message;
    try {
      message = JSON.parse(messageBuffer.toString());
      console.log('Received message:', message);

      const { type, payload } = message;
      const clientInfo = wsClientMap.get(ws); // Get existing info if client is known

      switch (type) {
        case 'HOST_JOIN': {
          const { gameId, gamePin } = payload; // Expect gameId (UUID) and gamePin now
          if (!gameId || !gamePin) {
             send(ws, { type: 'ERROR', payload: 'Missing gameId or gamePin for host join.' });
             ws.close();
             return;
          }
          const game = findOrCreateGame(gameId, gamePin); // Pass gamePin too
          if (game.hostWs && game.hostWs !== ws) {
             send(ws, { type: 'ERROR', payload: 'Game already has a host.' });
             ws.close();
             return;
          }
          game.hostWs = ws;
          const hostId = `host_${gameId}`;
          wsClientMap.set(ws, { gameId, playerId: hostId });
          console.log(`Host joined game ${gameId} (PIN: ${gamePin})`);
          sendPlayerListUpdate(gameId);
          break;
        }

        case 'JOIN_GAME': {
          // Player joins using the GAME PIN. We need to find the gameId (UUID) from the PIN.
          const { gamePin, nickname } = payload;
          if (!gamePin || !nickname) {
             send(ws, { type: 'ERROR', payload: 'Missing gamePin or nickname.' });
             ws.close();
             return;
          }

          // Find gameId by gamePin (inefficient, consider a map if many games)
          let game: GameState | undefined;
          let gameId: string | undefined;
          for (const [id, g] of games.entries()) {
              if (g.gamePin === gamePin) {
                  game = g;
                  gameId = id;
                  break;
              }
          }

          if (!game || !gameId) {
            // Attempt to fetch from DB if not in memory (e.g., server restart) - Optional advanced feature
            console.log(`Game with PIN ${gamePin} not found in memory.`);
            send(ws, { type: 'ERROR', payload: 'Game not found.' });
            ws.close();
            return;
          }

          if (game.gamePhase !== 'lobby') {
             send(ws, { type: 'ERROR', payload: 'Game has already started.' });
             ws.close();
             return;
          }

          let uniqueNickname = nickname;
          let counter = 1;
          while (Array.from(game.players.values()).some(p => p.nickname === uniqueNickname)) {
             uniqueNickname = `${nickname}_${counter++}`;
          }

          const playerId = nanoid(8);
          const newPlayer: Player = { id: playerId, nickname: uniqueNickname, score: 0, ws };
          game.players.set(playerId, newPlayer);
          wsClientMap.set(ws, { gameId, playerId }); // Use the found gameId (UUID)

          console.log(`Player ${uniqueNickname} (${playerId}) joined game ${gameId} (PIN: ${gamePin})`);

          send(ws, { type: 'JOIN_SUCCESS', payload: { playerId, nickname: uniqueNickname, gameId } }); // Send gameId back
          sendPlayerListUpdate(gameId);
          break;
        }

        case 'START_GAME': {
           if (!clientInfo) return;
           const game = games.get(clientInfo.gameId);
           if (!game || game.hostWs !== ws) {
              send(ws, { type: 'ERROR', payload: 'Only the host can start the game.' });
              return;
           }
           if (game.gamePhase !== 'lobby') return;

           console.log(`Starting game ${clientInfo.gameId}`);
           game.gamePhase = 'question';
           game.currentQuestionIndex = 0;
           // TODO: Update game status in DB to 'active'
           sendQuestion(clientInfo.gameId);
           break;
        }

        case 'SUBMIT_ANSWER': {
           if (!clientInfo) return;
           const game = games.get(clientInfo.gameId);
           const player = game?.players.get(clientInfo.playerId);
           if (!game || !player || game.gamePhase !== 'question') return;

           const { answerIndex } = payload;
           console.log(`Player ${player.nickname} answered ${answerIndex} for question ${game.currentQuestionIndex}`);
           // TODO: Validate answer, calculate score, store answer
           send(ws, { type: 'ANSWER_RECEIVED' });
           break;
        }

        default:
          console.log('Unknown message type:', type);
          send(ws, { type: 'ERROR', payload: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Failed to process message or invalid JSON:', error);
      if (ws.readyState === WebSocket.OPEN) {
         send(ws, { type: 'ERROR', payload: 'Invalid message format' });
      }
    }
  });

  ws.on('close', async () => { // Make the handler async
    const clientInfo = wsClientMap.get(ws);
    if (clientInfo) {
      const { gameId, playerId } = clientInfo;
      const game = games.get(gameId);
      wsClientMap.delete(ws); // Remove from map regardless

      if (game) {
        // Check if the host disconnected
        if (game.hostWs === ws) {
          console.log(`Host disconnected from game ${gameId}. Deleting game.`);
          game.hostWs = null; // Clear host reference in memory

          // 1. Notify all remaining players the game is ending
          broadcast(gameId, { type: 'GAME_ENDED', payload: 'Host disconnected and game has ended.' }, ws); // Exclude the disconnecting host

          // 2. Attempt to delete the game from Supabase
          try {
            // IMPORTANT: Supabase client needs the user's JWT for RLS check on DELETE.
            // This basic setup uses the anon key, which might fail depending on RLS.
            // A more robust solution involves passing the host's JWT or using a service role key.
            // Assuming RLS "Allow host to delete their own game" might work if the client implicitly uses the host's session.
            const { error } = await supabase
              .from('games')
              .delete()
              .eq('id', gameId); // Use the UUID gameId

            if (error) {
              console.error(`Error deleting game ${gameId} from database (RLS might be blocking):`, error);
              // Log the error but continue cleanup
            } else {
              console.log(`Game ${gameId} successfully deleted from database.`);
            }
          } catch (dbError) {
            console.error(`Exception during database deletion for game ${gameId}:`, dbError);
          }

          // 3. Clean up in-memory game state
          games.delete(gameId);

          // 4. Close remaining player connections for this game and clean up their map entries
          console.log(`Closing connections for remaining players in game ${gameId}...`);
          game.players.forEach(p => {
             if (p.ws.readyState === WebSocket.OPEN || p.ws.readyState === WebSocket.CONNECTING) {
                 p.ws.close(1000, 'Host disconnected'); // Close with a reason
             }
             wsClientMap.delete(p.ws); // Ensure cleanup from the map
          });
          console.log(`Cleanup complete for game ${gameId}.`);

        } else {
          // A player disconnected
          const player = game.players.get(playerId);
          if (player) {
             console.log(`Player ${player.nickname} disconnected from game ${gameId}`);
             game.players.delete(playerId);
             // Notify host and remaining players
             sendPlayerListUpdate(gameId);
          }
        }
      } else {
         console.log(`Game ${gameId} not found in memory during disconnect cleanup for player ${playerId}.`);
      }
    } else {
        console.log("Disconnected client was not found in the wsClientMap.");
    }
  });
}

// --- Helper Functions ---

// Now requires gamePin when creating
function findOrCreateGame(gameId: string, gamePin: string): GameState {
  if (!games.has(gameId)) {
    console.log(`Creating new game state for ${gameId} (PIN: ${gamePin})`);
    games.set(gameId, {
      gameId: gameId,
      gamePin: gamePin, // Store the pin
      hostWs: null,
      players: new Map<string, Player>(),
      currentQuestionIndex: -1,
      gamePhase: 'lobby',
    });
  }
  // Type assertion is safe here because we ensure it exists
  return games.get(gameId)!;
}

// Send message to a single client
function send(ws: WebSocket, message: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
     console.log("Attempted to send message to a closed or closing socket.");
  }
}

// Broadcast message to all clients (host and players) in a specific game
function broadcast(gameId: string, message: any, excludeWs?: WebSocket) {
  const game = games.get(gameId);
  if (!game) {
      console.warn(`Attempted to broadcast to non-existent game ${gameId}`);
      return;
  }

  const messageString = JSON.stringify(message);

  // Send to host if connected and not excluded
  if (game.hostWs && game.hostWs !== excludeWs && game.hostWs.readyState === WebSocket.OPEN) {
    try {
        game.hostWs.send(messageString);
    } catch (e) {
        console.error(`Error sending message to host of game ${gameId}:`, e);
    }
  }

  // Send to all players if connected and not excluded
  game.players.forEach((player) => {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
       try {
           player.ws.send(messageString);
       } catch (e) {
           console.error(`Error sending message to player ${player.nickname} in game ${gameId}:`, e);
       }
    }
  });
}


// Send the current player list to the host
function sendPlayerListUpdate(gameId: string) {
   const game = games.get(gameId);
   // Check if hostWs exists and is OPEN before sending
   if (!game || !game.hostWs || game.hostWs.readyState !== WebSocket.OPEN) {
       if (game && !game.hostWs) console.log(`Cannot send player list update for game ${gameId}: Host not connected.`);
       else if (game && game.hostWs.readyState !== WebSocket.OPEN) console.log(`Cannot send player list update for game ${gameId}: Host socket not open (state: ${game.hostWs.readyState}).`);
       return;
   }

   const playerList = Array.from(game.players.values()).map(({ id, nickname, score }) => ({ id, nickname, score }));
   send(game.hostWs, { type: 'PLAYER_LIST_UPDATE', payload: { players: playerList } });
}

// Send the current question to all players
function sendQuestion(gameId: string) {
   const game = games.get(gameId);
   if (!game || game.gamePhase !== 'question') return;

   // TODO: Get the actual question based on game.currentQuestionIndex
   const currentQuestion = {
      index: game.currentQuestionIndex,
      text: `This is question ${game.currentQuestionIndex + 1}?`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      // timeLimit: 30, // Optional
   };

   broadcast(gameId, { type: 'SHOW_QUESTION', payload: currentQuestion });
}
