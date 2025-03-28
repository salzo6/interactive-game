import type { WebSocket } from 'ws';
import type * as http from 'http';
import { nanoid } from 'nanoid';
import { supabase } from '../app/lib/supabase';

// --- Types ---
interface Player {
  id: string; // Corresponds to Supabase 'players' table id (UUID)
  nickname: string;
  score: number;
  ws: WebSocket | null; // Reference to the WebSocket connection (can be null initially)
}

interface GameState {
  gameId: string; // Corresponds to the Supabase 'games' table ID
  gamePin: string;
  hostWs: WebSocket | null;
  players: Map<string, Player>; // Map playerId (UUID) to Player object
  currentQuestionIndex: number;
  gamePhase: 'lobby' | 'question' | 'leaderboard' | 'ended';
  sharedAdminState: number; // New shared state controlled by admin
  // TODO: Add quiz questions array
}

// --- In-Memory State ---
const games = new Map<string, GameState>();
const wsClientMap = new Map<WebSocket, { gameId: string; clientId: string; isHost: boolean }>(); // clientId is host_id or player_id

// --- WebSocket Message Handler ---
export function handleWebSocket(ws: WebSocket, req: http.IncomingMessage) {

  ws.on('message', (messageBuffer) => {
    let message;
    try {
      message = JSON.parse(messageBuffer.toString());
      console.log('Received message:', message);

      const { type, payload } = message;
      const clientInfo = wsClientMap.get(ws);

      switch (type) {
        case 'HOST_JOIN': {
          const { gameId, gamePin } = payload;
          if (!gameId || !gamePin) {
             send(ws, { type: 'ERROR', payload: 'Missing gameId or gamePin for host join.' });
             ws.close(); return;
          }
          const game = findOrCreateGame(gameId, gamePin);
          if (game.hostWs && game.hostWs !== ws) {
             send(ws, { type: 'ERROR', payload: 'Game already has a host.' });
             ws.close(); return;
          }
          game.hostWs = ws;
          // Use game.gameId as the unique identifier for the host in this context
          const hostClientId = `host_${gameId}`;
          wsClientMap.set(ws, { gameId, clientId: hostClientId, isHost: true });
          console.log(`Host joined game ${gameId} (PIN: ${gamePin})`);

          // Send initial state to host
          sendPlayerListUpdate(gameId);
          sendSharedStateUpdate(gameId, game.sharedAdminState, ws); // Send current shared state ONLY to host initially
          break;
        }

        // Player identifies their WebSocket connection *after* joining via Remix action
        case 'PLAYER_IDENTIFY': {
          const { gameId, playerId, nickname } = payload; // Expect gameId (UUID) and playerId (UUID)
          if (!gameId || !playerId || !nickname) {
             send(ws, { type: 'ERROR', payload: 'Missing gameId, playerId, or nickname for player identify.' });
             ws.close(); return;
          }

          const game = games.get(gameId);
          if (!game) {
            console.log(`Game ${gameId} not found for player identify.`);
            send(ws, { type: 'ERROR', payload: 'Game not found.' });
            ws.close(); return;
          }

          // Check if player already exists in memory (might happen on reconnect)
          let player = game.players.get(playerId);

          if (!player) {
            // If player not in memory (e.g., server restart or first connection after join action), create entry
            console.log(`Player ${nickname} (${playerId}) identifying, adding to game ${gameId} memory.`);
            player = { id: playerId, nickname: nickname, score: 0, ws: ws };
            game.players.set(playerId, player);
          } else {
             // Player exists, just update WebSocket reference
             console.log(`Player ${nickname} (${playerId}) re-identifying in game ${gameId}.`);
             player.ws = ws;
          }

          wsClientMap.set(ws, { gameId, clientId: playerId, isHost: false });

          console.log(`Player ${nickname} (${playerId}) identified WebSocket for game ${gameId}`);

          // Send initial state to player
          send(ws, { type: 'IDENTIFY_SUCCESS', payload: { message: 'WebSocket identified successfully.' } });
          sendPlayerListUpdate(gameId); // Update everyone
          sendSharedStateUpdate(gameId, game.sharedAdminState, ws); // Send current shared state ONLY to this player initially
          break;
        }

        case 'START_GAME': {
           if (!clientInfo || !clientInfo.isHost) {
              send(ws, { type: 'ERROR', payload: 'Only the host can start the game.' }); return;
           }
           const game = games.get(clientInfo.gameId);
           if (!game) return; // Should not happen if clientInfo exists
           if (game.gamePhase !== 'lobby') return;

           console.log(`Starting game ${clientInfo.gameId}`);
           game.gamePhase = 'question';
           game.currentQuestionIndex = 0;
           // TODO: Update game status in DB to 'active'
           broadcast(clientInfo.gameId, { type: 'GAME_STARTED' }); // Notify clients game has started
           sendQuestion(clientInfo.gameId);
           break;
        }

        case 'ADMIN_UPDATE_SHARED_STATE': {
            if (!clientInfo || !clientInfo.isHost) {
                send(ws, { type: 'ERROR', payload: 'Only the host can update the state.' }); return;
            }
            const game = games.get(clientInfo.gameId);
            if (!game) return;

            const { newState } = payload;
            if (typeof newState !== 'number') {
                send(ws, { type: 'ERROR', payload: 'Invalid state value.' }); return;
            }

            console.log(`Host updating shared state for game ${clientInfo.gameId} to ${newState}`);
            game.sharedAdminState = newState;
            // Broadcast the update to everyone
            sendSharedStateUpdate(clientInfo.gameId, newState);
            break;
        }


        case 'SUBMIT_ANSWER': {
           if (!clientInfo || clientInfo.isHost) return; // Only players submit
           const game = games.get(clientInfo.gameId);
           const player = game?.players.get(clientInfo.clientId); // clientId is playerId for players
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

  ws.on('close', async () => {
    const clientInfo = wsClientMap.get(ws);
    if (clientInfo) {
      const { gameId, clientId, isHost } = clientInfo;
      const game = games.get(gameId);
      wsClientMap.delete(ws);

      if (game) {
        if (isHost) {
          // HOST DISCONNECTED
          console.log(`Host disconnected from game ${gameId}. Deleting game.`);
          game.hostWs = null;

          broadcast(gameId, { type: 'GAME_ENDED', payload: 'Host disconnected and game has ended.' }, ws);

          try {
            const { error } = await supabase.from('games').delete().eq('id', gameId);
            if (error) console.error(`Error deleting game ${gameId} from database (RLS might be blocking):`, error);
            else console.log(`Game ${gameId} successfully deleted from database.`);
          } catch (dbError) {
            console.error(`Exception during database deletion for game ${gameId}:`, dbError);
          }

          games.delete(gameId);

          console.log(`Closing connections for remaining players in game ${gameId}...`);
          game.players.forEach(p => {
             if (p.ws && (p.ws.readyState === WebSocket.OPEN || p.ws.readyState === WebSocket.CONNECTING)) {
                 p.ws.close(1000, 'Host disconnected');
             }
             // Also remove players associated with this game from wsClientMap
             if(p.ws) wsClientMap.delete(p.ws);
          });
          console.log(`Cleanup complete for game ${gameId}.`);

        } else {
          // PLAYER DISCONNECTED
          const player = game.players.get(clientId); // clientId is playerId
          if (player) {
             console.log(`Player ${player.nickname} disconnected from game ${gameId}`);
             // Don't delete player record from map immediately, just set ws to null
             // They might reconnect and re-identify
             player.ws = null;
             // Notify host and remaining players about the disconnect (optional, or just update list)
             sendPlayerListUpdate(gameId); // Update list for everyone
          }
        }
      } else {
         console.log(`Game ${gameId} not found in memory during disconnect cleanup for client ${clientId}.`);
      }
    } else {
        console.log("Disconnected client was not found in the wsClientMap.");
    }
  });
}

// --- Helper Functions ---

function findOrCreateGame(gameId: string, gamePin: string): GameState {
  if (!games.has(gameId)) {
    console.log(`Creating new game state for ${gameId} (PIN: ${gamePin})`);
    games.set(gameId, {
      gameId: gameId,
      gamePin: gamePin,
      hostWs: null,
      players: new Map<string, Player>(),
      currentQuestionIndex: -1,
      gamePhase: 'lobby',
      sharedAdminState: 0, // Initialize shared state
    });
  }
  return games.get(gameId)!;
}

function send(ws: WebSocket, message: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  } else {
     console.log("Attempted to send message to a closed or closing socket.");
  }
}

function broadcast(gameId: string, message: any, excludeWs?: WebSocket) {
  const game = games.get(gameId);
  if (!game) {
      console.warn(`Attempted to broadcast to non-existent game ${gameId}`);
      return;
  }
  const messageString = JSON.stringify(message);

  // Send to host
  if (game.hostWs && game.hostWs !== excludeWs && game.hostWs.readyState === WebSocket.OPEN) {
    try { game.hostWs.send(messageString); } catch (e) { console.error(`Error sending to host:`, e); }
  }

  // Send to all players with active connections
  game.players.forEach((player) => {
    if (player.ws && player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
       try { player.ws.send(messageString); } catch (e) { console.error(`Error sending to player ${player.nickname}:`, e); }
    }
  });
}

// Send the current player list to ALL connected clients in the game
function sendPlayerListUpdate(gameId: string) {
   const game = games.get(gameId);
   if (!game) return;

   // Include only players with active WS connections? Or all joined players? Let's send all joined.
   // Filter out the 'ws' property before sending
   const playerList = Array.from(game.players.values()).map(({ id, nickname, score }) => ({ id, nickname, score }));
   console.log(`Broadcasting player list update for game ${gameId}:`, playerList);
   broadcast(gameId, { type: 'PLAYER_LIST_UPDATE', payload: { players: playerList } });
}

// Send the shared admin state update to clients
// If targetWs is provided, sends only to that client, otherwise broadcasts
function sendSharedStateUpdate(gameId: string, state: number, targetWs?: WebSocket) {
    const message = { type: 'SHARED_STATE_UPDATE', payload: { newState: state } };
    if (targetWs) {
        console.log(`Sending shared state ${state} to specific client in game ${gameId}`);
        send(targetWs, message);
    } else {
        console.log(`Broadcasting shared state ${state} for game ${gameId}`);
        broadcast(gameId, message);
    }
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
