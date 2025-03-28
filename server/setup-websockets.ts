import type { ViteDevServer } from 'vite';
import { WebSocketServer } from 'ws';
import { handleWebSocket } from './game-socket-handler'; // We'll create this next

// Store the WebSocket server instance globally to prevent multiple instances during HMR
declare global {
  // eslint-disable-next-line no-var
  var wss: WebSocketServer | undefined;
}

export const webSocketPlugin = {
  name: 'webSocketPlugin',
  configureServer(server: ViteDevServer) {
    if (!server.httpServer) {
      console.warn('HTTP server not available for WebSocket setup.');
      return;
    }

    // Prevent creating multiple WebSocket servers during HMR
    if (!globalThis.wss) {
      console.log('🔌 Setting up WebSocket server...');
      const wss = new WebSocketServer({ server: server.httpServer });
      globalThis.wss = wss;

      wss.on('connection', (ws, req) => {
        // Extract client IP, handle potential proxies if necessary
        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        console.log(`🔌 WebSocket client connected: ${clientIp}`);

        handleWebSocket(ws, req); // Delegate handling to the game logic module

        ws.on('close', (code, reason) => {
          console.log(`🔌 WebSocket client disconnected: ${clientIp} (Code: ${code}, Reason: ${reason.toString()})`);
          // handleWebSocket cleanup logic is triggered internally on 'close'
        });

        ws.on('error', (error) => {
          console.error(`🔌 WebSocket error for ${clientIp}:`, error);
        });
      });

      // Optional: Clean shutdown handling
      const shutdown = () => {
        console.log('🔌 Shutting down WebSocket server...');
        wss.close((err) => {
          if (err) {
            console.error('Error closing WebSocket server:', err);
          } else {
            console.log('WebSocket server closed.');
          }
        });
        globalThis.wss = undefined; // Clear the global reference
      };

      server.httpServer.on('close', shutdown);
      // Consider process signals like SIGTERM, SIGINT if running standalone node server
      // process.on('SIGTERM', shutdown);
      // process.on('SIGINT', shutdown);


      console.log('✅ WebSocket server configured and listening.');
    } else {
       console.log('🔌 WebSocket server already running.');
       // Optionally re-attach listeners if needed, though handleWebSocket should manage state
    }
  },
};
