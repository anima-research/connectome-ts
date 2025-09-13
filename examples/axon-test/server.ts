import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import chokidar from 'chokidar';

const app = express();
const PORT = 8080;
const WS_PORT = 8081;

// Module version tracking
const moduleVersions = new Map<string, string>();

// Compute version for a file
function computeVersion(filePath: string): string {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtimeMs.toString();
  } catch {
    return Date.now().toString();
  }
}

// Initialize versions
const modulePath = path.join(__dirname, 'test-component.ts');
moduleVersions.set('./test-component.js', computeVersion(modulePath));

// Serve manifest at /axon-test
app.get('/axon-test', (req, res) => {
  res.json({
    main: './test-component.js',
    name: 'AXON Test Component',
    description: 'Simple component for testing AXON protocol',
    modules: ['./test-component.js'],
    dev: {
      hotReload: `ws://localhost:${WS_PORT}`
    }
  });
});

// Serve the component (in real usage, this would be compiled JS)
app.get('/test-component.js', async (req, res) => {
  try {
    // For testing, we'll use esbuild to compile TypeScript on the fly
    const { transform } = require('esbuild');
    const result = await transform(
      fs.readFileSync(modulePath, 'utf8'),
      {
        loader: 'ts',
        format: 'cjs',  // CommonJS for Node.js compatibility
        sourcemap: 'inline',
        target: 'es2020'
      }
    );
    
    res.type('application/javascript');
    res.send(result.code);
  } catch (error) {
    console.error('Failed to compile component:', error);
    res.status(500).send('Compilation error');
  }
});

// Set up WebSocket server for hot reload
const wss = new WebSocketServer({ port: WS_PORT });

wss.on('connection', (ws) => {
  console.log('[Server] Hot reload client connected');
  
  // Send initial versions
  ws.send(JSON.stringify({
    type: 'module-versions',
    versions: Object.fromEntries(moduleVersions)
  }));
  
  ws.on('close', () => {
    console.log('[Server] Hot reload client disconnected');
  });
});

// Watch for changes
chokidar.watch(modulePath).on('change', () => {
  console.log('[Server] Component changed, notifying clients...');
  
  const newVersion = computeVersion(modulePath);
  moduleVersions.set('./test-component.js', newVersion);
  
  const msg = JSON.stringify({
    type: 'module-update',
    module: './test-component.js',
    version: newVersion
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(msg);
    }
  });
});

// Start servers
app.listen(PORT, () => {
  console.log(`[Server] AXON test server running at http://localhost:${PORT}`);
  console.log(`[Server] Manifest: http://localhost:${PORT}/axon-test`);
  console.log(`[Server] Hot reload WebSocket: ws://localhost:${WS_PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  wss.clients.forEach(client => client.close());
  wss.close();
  process.exit(0);
});
