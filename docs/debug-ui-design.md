# Connectome Debug UI Technical Design

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Connectome Runtime                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │    Space    │  │ VEILState    │  │ TransitionMgr    │  │
│  │             │  │   Manager    │  │                  │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                │                    │             │
│         └────────────────┴────────────────────┘             │
│                          │                                   │
│                    ┌─────▼─────┐                           │
│                    │  Debug    │                           │
│                    │  Server   │◄─── HTTP/WS ──┐          │
│                    └───────────┘                │          │
└─────────────────────────────────────────────────┼──────────┘
                                                  │
                                          ┌───────▼────────┐
                                          │   Debug UI     │
                                          │   (Browser)    │
                                          └────────────────┘
```

## 2. Frame UUID Generation

### 2.1 UUID Strategy
```typescript
// Use deterministic UUIDs based on frame content
import { v5 as uuidv5 } from 'uuid';

const CONNECTOME_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function generateFrameUUID(frame: VEILFrame): string {
  // Create deterministic UUID from frame properties
  const frameData = {
    sequence: frame.sequence,
    timestamp: frame.timestamp,
    source: frame.source,
    operationTypes: frame.operations.map(op => op.type).sort()
  };
  
  const input = JSON.stringify(frameData);
  return uuidv5(input, CONNECTOME_NAMESPACE);
}
```

### 2.2 Frame Tracking Integration
```typescript
// Extend VEILFrame
interface VEILFrame {
  // Existing fields...
  uuid?: string; // Added by debug system
}

// Hook into frame processing
class DebugFrameTracker {
  constructor(private space: Space) {
    this.space.on('frame:create', (frame) => {
      frame.uuid = generateFrameUUID(frame);
      this.startTracking(frame);
    });
  }
}
```

## 3. Debug Server Implementation

### 3.1 Core Server Class
```typescript
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

export class DebugServer {
  private app: express.Application;
  private server: Server;
  private wss: WebSocketServer;
  private frameBuffer: CircularBuffer<FrameDebugData>;
  private clients: Set<WebSocket> = new Set();
  
  constructor(
    private space: Space,
    private veilState: VEILStateManager,
    private config: DebugServerConfig = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.frameBuffer = new CircularBuffer(this.config.maxFrames);
    this.setupServer();
    this.attachListeners();
  }
  
  private setupServer() {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    
    // Serve static UI files
    this.app.use(express.static(path.join(__dirname, '../debug-ui/build')));
    
    // Setup API routes
    this.setupAPIRoutes();
    
    // Setup WebSocket handling
    this.setupWebSocket();
  }
}
```

### 3.2 Frame Data Collection
```typescript
interface FrameDebugData {
  uuid: string;
  sequence: number;
  timestamp: number;
  
  // Processing stages
  incoming: IncomingFrameData;
  agentProcessing?: AgentProcessingData;
  outgoing?: OutgoingFrameData;
  
  // Relationships
  triggeredBy?: string; // UUID of triggering frame
  triggered: string[];  // UUIDs of frames triggered by this
  
  // Performance
  timing: {
    start: number;
    veilProcessing: number;
    agentProcessing?: number;
    total: number;
  };
}

class FrameCollector {
  private currentFrame: Partial<FrameDebugData> = {};
  
  startFrame(frame: VEILFrame) {
    this.currentFrame = {
      uuid: frame.uuid,
      sequence: frame.sequence,
      timestamp: frame.timestamp,
      incoming: {
        trigger: this.extractTrigger(frame),
        operations: [],
        spaceChanges: { elements: [], components: [] }
      },
      timing: { start: performance.now() }
    };
  }
  
  addOperation(op: VEILOperation) {
    this.currentFrame.incoming!.operations.push(op);
  }
  
  captureRenderedContext(context: RenderedContext) {
    this.currentFrame.incoming!.renderedContext = {
      content: context.content,
      tokens: context.tokens,
      preview: context.content.substring(0, 200) + '...'
    };
  }
  
  completeFrame(): FrameDebugData {
    this.currentFrame.timing!.total = 
      performance.now() - this.currentFrame.timing!.start;
    return this.currentFrame as FrameDebugData;
  }
}
```

### 3.3 API Implementation
```typescript
private setupAPIRoutes() {
  // Current state endpoint
  this.app.get('/api/state', (req, res) => {
    const state = {
      elements: this.serializeElementTree(),
      facets: this.serializeCurrentFacets(),
      streams: Array.from(this.veilState.getActiveStreams()),
      metrics: this.getSystemMetrics()
    };
    res.json(state);
  });
  
  // Frame endpoints
  this.app.get('/api/frames', (req, res) => {
    const { limit = 100, offset = 0 } = req.query;
    const frames = this.frameBuffer.getRange(
      Number(offset), 
      Number(limit)
    );
    res.json({
      frames,
      total: this.frameBuffer.size,
      hasMore: offset + limit < this.frameBuffer.size
    });
  });
  
  // Specific frame
  this.app.get('/api/frames/:uuid', (req, res) => {
    const frame = this.frameBuffer.find(f => f.uuid === req.params.uuid);
    if (frame) {
      res.json(frame);
    } else {
      res.status(404).json({ error: 'Frame not found' });
    }
  });
  
  // Element inspection
  this.app.get('/api/elements/:id', (req, res) => {
    const element = this.space.findChild(req.params.id);
    if (element) {
      res.json(this.serializeElement(element));
    } else {
      res.status(404).json({ error: 'Element not found' });
    }
  });
}
```

### 3.4 WebSocket Communication
```typescript
private setupWebSocket() {
  this.wss.on('connection', (ws) => {
    this.clients.add(ws);
    
    // Send initial state
    ws.send(JSON.stringify({
      type: 'connected',
      state: this.getCurrentState(),
      recentFrames: this.frameBuffer.getLast(10)
    }));
    
    // Handle client messages
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      this.handleClientMessage(ws, msg);
    });
    
    ws.on('close', () => {
      this.clients.delete(ws);
    });
  });
}

private broadcast(message: any) {
  const data = JSON.stringify(message);
  this.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}
```

## 4. UI Implementation

### 4.1 React Application Structure
```typescript
// src/App.tsx
export function DebugApp() {
  const { connected, frames, currentState } = useDebugStore();
  const [selectedFrame, setSelectedFrame] = useState<string | null>(null);
  
  return (
    <div className="debug-app">
      <Header>
        <ConnectionIndicator connected={connected} />
        <GlobalControls />
      </Header>
      
      <div className="main-layout">
        <Sidebar>
          <FrameList 
            frames={frames}
            onSelect={setSelectedFrame}
          />
          <StateTree state={currentState} />
        </Sidebar>
        
        <div className="content">
          <FrameTimeline 
            frames={frames}
            selected={selectedFrame}
            onSelect={setSelectedFrame}
          />
          
          {selectedFrame && (
            <FrameInspector 
              frame={frames.find(f => f.uuid === selectedFrame)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
```

### 4.2 State Management
```typescript
// src/stores/debug-store.ts
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface DebugStore {
  // Connection
  connected: boolean;
  ws: WebSocket | null;
  
  // Data
  frames: FrameDebugData[];
  currentState: SystemState | null;
  
  // Actions
  connect: (url: string) => void;
  disconnect: () => void;
  addFrame: (frame: FrameDebugData) => void;
  updateState: (state: SystemState) => void;
}

export const useDebugStore = create<DebugStore>()(
  subscribeWithSelector((set, get) => ({
    connected: false,
    ws: null,
    frames: [],
    currentState: null,
    
    connect: (url) => {
      const ws = new WebSocket(url);
      
      ws.onopen = () => set({ connected: true, ws });
      
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg, get, set);
      };
      
      ws.onclose = () => set({ connected: false, ws: null });
    },
    
    addFrame: (frame) => {
      set(state => ({
        frames: [...state.frames.slice(-999), frame]
      }));
    }
  }))
);
```

### 4.3 Key UI Components

#### Frame Timeline
```tsx
export function FrameTimeline({ frames, selected, onSelect }) {
  const timelineRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0);
  
  useEffect(() => {
    if (!timelineRef.current) return;
    
    const svg = d3.select(timelineRef.current);
    
    // Create scales
    const xScale = d3.scaleLinear()
      .domain([frames[0]?.sequence || 0, frames[frames.length - 1]?.sequence || 100])
      .range([0, 1000 * zoom]);
    
    // Draw frame nodes
    const nodes = svg.selectAll('.frame-node')
      .data(frames, d => d.uuid);
    
    nodes.enter()
      .append('g')
      .attr('class', 'frame-node')
      .attr('transform', d => `translate(${xScale(d.sequence)}, 50)`)
      .call(createFrameNode);
    
    // Draw connections
    const links = svg.selectAll('.frame-link')
      .data(getFrameLinks(frames));
    
    links.enter()
      .append('path')
      .attr('class', 'frame-link')
      .attr('d', createLinkPath);
      
  }, [frames, zoom]);
  
  return (
    <div className="frame-timeline">
      <TimelineControls onZoom={setZoom} />
      <svg ref={timelineRef} />
    </div>
  );
}
```

#### Frame Inspector
```tsx
export function FrameInspector({ frame }: { frame: FrameDebugData }) {
  const [activeTab, setActiveTab] = useState('incoming');
  
  return (
    <div className="frame-inspector">
      <FrameHeader frame={frame} />
      
      <Tabs value={activeTab} onChange={setActiveTab}>
        <Tab label="Incoming" value="incoming" />
        {frame.agentProcessing && (
          <Tab label="Agent" value="agent" />
        )}
        {frame.outgoing && (
          <Tab label="Outgoing" value="outgoing" />
        )}
        <Tab label="Timing" value="timing" />
      </Tabs>
      
      <TabPanel value={activeTab} index="incoming">
        <IncomingFrameView data={frame.incoming} />
      </TabPanel>
      
      {frame.agentProcessing && (
        <TabPanel value={activeTab} index="agent">
          <AgentProcessingView data={frame.agentProcessing} />
        </TabPanel>
      )}
      
      {frame.outgoing && (
        <TabPanel value={activeTab} index="outgoing">
          <OutgoingFrameView data={frame.outgoing} />
        </TabPanel>
      )}
      
      <TabPanel value={activeTab} index="timing">
        <TimingView timing={frame.timing} />
      </TabPanel>
    </div>
  );
}
```

## 5. Integration with Trace System

### 5.1 Trace URL Generation
```typescript
function getTraceUrl(frameUuid: string, traceType?: string): string {
  const baseUrl = process.env.TRACE_UI_URL || 'http://localhost:9090';
  if (traceType) {
    return `${baseUrl}/traces/frame/${frameUuid}/${traceType}`;
  }
  return `${baseUrl}/traces/frame/${frameUuid}`;
}

// In UI component
<a href={getTraceUrl(frame.uuid, 'rendering')} target="_blank">
  View rendering traces →
</a>
```

### 5.2 Trace Context Headers
```typescript
// Add trace context to all operations
class TraceContext {
  static setFrameContext(frameUuid: string) {
    AsyncLocalStorage.run({ frameUuid }, () => {
      // All traces within this context will include frameUuid
    });
  }
}
```

## 6. Performance Optimizations

### 6.1 Circular Buffer for Frames
```typescript
class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private tail = 0;
  private count = 0;
  
  constructor(private capacity: number) {
    this.buffer = new Array(capacity);
  }
  
  push(item: T) {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    
    if (this.count < this.capacity) {
      this.count++;
    } else {
      this.head = (this.head + 1) % this.capacity;
    }
  }
  
  getLast(n: number): T[] {
    const result: T[] = [];
    let idx = (this.tail - 1 + this.capacity) % this.capacity;
    
    for (let i = 0; i < Math.min(n, this.count); i++) {
      const item = this.buffer[idx];
      if (item !== undefined) result.unshift(item);
      idx = (idx - 1 + this.capacity) % this.capacity;
    }
    
    return result;
  }
}
```

### 6.2 Debounced Updates
```typescript
class DebugServer {
  private updateQueue: any[] = [];
  private updateTimer: NodeJS.Timeout | null = null;
  
  private queueUpdate(update: any) {
    this.updateQueue.push(update);
    
    if (!this.updateTimer) {
      this.updateTimer = setTimeout(() => {
        this.flushUpdates();
      }, 16); // ~60fps
    }
  }
  
  private flushUpdates() {
    if (this.updateQueue.length > 0) {
      this.broadcast({
        type: 'batch-update',
        updates: this.updateQueue
      });
      this.updateQueue = [];
    }
    this.updateTimer = null;
  }
}
```

## 7. Development Workflow

### 7.1 Debug Server Start
```typescript
// In Space constructor or initialization
class Space {
  private debugServer?: DebugServer;
  
  enableDebugServer(config?: DebugServerConfig) {
    if (!this.debugServer) {
      this.debugServer = new DebugServer(this, this.veilState, config);
      this.debugServer.start();
      console.log(`🔍 Debug UI: http://localhost:${config?.port || 8888}`);
    }
  }
}
```

### 7.2 Usage Example
```typescript
// In application startup
const space = new Space(veilState);
space.enableDebugServer({ port: 8888 });

// Debug server is now running
// Navigate to http://localhost:8888 to view
```
