import type { WebSocket } from 'ws';
import type * as http from 'http';
import { nanoid } from 'nanoid';

// --- Types ---
interface Player {
  id: string;
  nickname: string;
  score: number;
  ws: WebSocket; // Reference to the WebSocket connection
}

interface GameState {
  gameId: string;
  hostWs: WebSocket | null; // Reference to the host's WebSocket
  players: Map<string, Player>; // Map playerId to Player object
  currentQuestionIndex: number;
  gamePhase: 'lobby' | 'question' | 'leaderboard' | 'ended';
  // TODO: Add quiz questions array
}

// --- In-Memory State ---
// WARNING: This state is lost on server restart. Use a database for persistence.
const games = new Map<string, GameState>();
// Map WebSocket instances to player/game info for easy cleanup on disconnect
const wsClientMap = new Map<WebSocket, { gameId: string; playerId: string }>();

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
          const { gameId } = payload;
          const game = findOrCreateGame(gameId);
          if (game.hostWs && game.hostWs !== ws) {
             // Handle scenario where a host tries to join a game that already has one
             send(ws, { type: 'ERROR', payload: 'Game already has a host.' });
             ws.close();
             return;
          }
          game.hostWs = ws;
          // Add host to client map (using a special ID or similar)
          const hostId = `host_${gameId}`;
          wsClientMap.set(ws, { gameId, playerId: hostId });
          console.log(`Host joined game ${gameId}`);
          // Send current player list to the new host
          sendPlayerListUpdate(gameId);
          break;
        }

        case 'JOIN_GAME': {
          const { gameId, nickname } = payload;
          const game = games.get(gameId);

          if (!game) {
            send(ws, { type: 'ERROR', payload: 'Game not found.' });
            ws.close();
            return;
          }
          if (game.gamePhase !== 'lobby') {
             send(ws, { type: 'ERROR', payload: 'Game has already started.' });
             ws.close();
             return;
          }

          // Check for nickname collision (simple check)
          let uniqueNickname = nickname;
          let counter = 1;
          while (Array.from(game.players.values()).some(p => p.nickname === uniqueNickname)) {
             uniqueNickname = `${nickname}_${counter++}`;
          }


          const playerId = nanoid(8);
          const newPlayer: Player = { id: playerId, nickname: uniqueNickname, score: 0, ws };
          game.players.set(playerId, newPlayer);
          wsClientMap.set(ws, { gameId, playerId });

          console.log(`Player ${uniqueNickname} (${playerId}) joined game ${gameId}`);

          // Send confirmation to player
          send(ws, { type: 'JOIN_SUCCESS', payload: { playerId, nickname: uniqueNickname } });
          // Send updated player list to host and other players
          sendPlayerListUpdate(gameId);
          break;
        }

        case 'START_GAME': {
           if (!clientInfo) return; // Should not happen if client is mapped
           const game = games.get(clientInfo.gameId);
           if (!game || game.hostWs !== ws) {
              send(ws, { type: 'ERROR', payload: 'Only the host can start the game.' });
              return;
           }
           if (game.gamePhase !== 'lobby') return; // Can only start from lobby

           console.log(`Starting game ${clientInfo.gameId}`);
           game.gamePhase = 'question';
           game.currentQuestionIndex = 0;
           // TODO: Load questions if not already loaded
           // broadcast(clientInfo.gameId, { type: 'GAME_STARTED' });
           sendQuestion(clientInfo.gameId); // Send the first question
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
           // For now, just acknowledge
           send(ws, { type: 'ANSWER_RECEIVED' });
           break;
        }

        // TODO: Add 'NEXT_QUESTION' handler triggered by host

        default:
          console.log('Unknown message type:', type);
          send(ws, { type: 'ERROR', payload: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Failed to process message or invalid JSON:', error);
      // Avoid sending error back if ws is already closed or closing
      if (ws.readyState === WebSocket.OPEN) {
         send(ws, { type: 'ERROR', payload: 'Invalid message format' });
      }
    }
  });

  ws.on('close', () => {
    const clientInfo = wsClientMap.get(ws);
    if (clientInfo) {
      const { gameId, playerId } = clientInfo;
      const game = games.get(gameId);
      wsClientMap.delete(ws); // Remove from map regardless

      if (game) {
        // Check if the host disconnected
        if (game.hostWs === ws) {
          console.log(`Host disconnected from game ${gameId}. Ending game.`);
          game.hostWs = null; // Clear host reference
          // Notify all players the host left and end the game
          broadcast(gameId, { type: 'GAME_ENDED', payload: 'Host disconnected' });
          // Clean up game state
          games.delete(gameId);
          // Close remaining player connections for this game
          game.players.forEach(p => {
             if (p.ws.readyState === WebSocket.OPEN) p.ws.close();
             wsClientMap.delete(p.ws);
          });

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
      }
    }
  });
}

// --- Helper Functions ---

function findOrCreateGame(gameId: string): GameState {
  if (!games.has(gameId)) {
    console.log(`Creating new game state for ${gameId}`);
    games.set(gameId, {
      gameId: gameId,
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
     console.log("Attempted to send message to a closed socket.");
  }
}

// Broadcast message to all clients (host and players) in a specific game
function broadcast(gameId: string, message: any, excludeWs?: WebSocket) {
  const game = games.get(gameId);
  if (!game) return;

  const messageString = JSON.stringify(message);

  // Send to host if connected and not excluded
  if (game.hostWs && game.hostWs !== excludeWs && game.hostWs.readyState === WebSocket.OPEN) {
    game.hostWs.send(messageString);
  }

  // Send to all players if connected and not excluded
  game.players.forEach((player) => {
    if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
      player.ws.send(messageString);
    }
  });
}


// Send the current player list to the host
function sendPlayerListUpdate(gameId: string) {
   const game = games.get(gameId);
   if (!game || !game.hostWs) return;

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
