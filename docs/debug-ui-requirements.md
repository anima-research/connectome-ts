# Connectome Debug UI Requirements

## 1. Overview

The Connectome Debug UI is a web-based observability and debugging tool that provides real-time visibility into the internal state and processing flow of a Connectome system. It consists of two main components:

1. **Debug Server**: Embedded HTTP/WebSocket server within the Connectome runtime
2. **Debug UI**: Web application for visualizing and interacting with the system

## 2. Goals

1. **Observability**: Provide clear visibility into system state and behavior
2. **Debuggability**: Enable developers to understand why specific behaviors occurred
3. **Interactivity**: Allow direct manipulation of system state for testing
4. **Performance**: Minimal overhead when enabled, zero overhead when disabled
5. **Accessibility**: Work in any modern web browser without additional tools

## 3. Functional Requirements

### 3.1 Frame Tracking

#### 3.1.1 Frame Identification
- Each frame MUST have a unique UUID for stable reference
- Frame UUIDs MUST be deterministic and reproducible
- Frames MUST be linkable (previous/next/caused-by relationships)

#### 3.1.2 Frame Content
The system MUST capture for each frame:
- Trigger information (what caused the frame)
- Timestamp and sequence number
- All VEIL operations performed
- Element tree modifications
- Component property changes
- Rendered context (what the agent saw)
- Agent activation status and reason

#### 3.1.3 Agent Processing Tracking
For frames with agent activation, capture:
- LLM request (messages and token counts)
- Raw LLM response
- Parsed operations from response
- Any errors during parsing
- Timing information

### 3.2 State Inspection

#### 3.2.1 Element Tree
- Display complete element hierarchy
- Show all components attached to each element
- Display component properties (including @persistent ones)
- Indicate component state (mounted/unmounted)
- Show element subscriptions

#### 3.2.2 VEIL State
- Display all current facets grouped by type (state/event/ambient)
- Show facet attributes and content
- Display active streams
- Show facet scope information
- Support facet search/filtering

#### 3.2.3 Persistence State
- Show current snapshot sequence
- Display pending transitions
- Show persistent property values
- Indicate last save timestamp

### 3.3 Timeline Navigation

#### 3.3.1 Frame Timeline
- Visual timeline of all frames
- Differentiate frame types (incoming/outgoing/bidirectional)
- Show agent activation indicators
- Support zoom and pan
- Click to select and inspect frame

#### 3.3.2 Frame Relationships
- Show causal relationships between frames
- Highlight trigger chains
- Support forward/backward navigation
- Show parallel frame processing

### 3.4 Real-time Updates

#### 3.4.1 Live Mode
- WebSocket connection for real-time updates
- Show frames as they're processed
- Update state displays immediately
- Smooth animations for changes
- Pause/resume live updates

#### 3.4.2 Historical Mode
- Browse past frames while system runs
- Maintain selected frame during updates
- Option to "catch up" to live
- Export frame data for analysis

### 3.5 Interactive Features

#### 3.5.1 State Manipulation
- Trigger custom events
- Modify component properties
- Add/remove elements
- Update facet values
- Clear specific state

#### 3.5.2 Frame Replay
- Re-execute a specific frame
- Modify frame parameters
- Test alternative outcomes
- Save modified frames

### 3.6 Search and Filter

#### 3.6.1 Frame Search
- Search by frame UUID
- Filter by trigger type
- Filter by time range
- Search frame content
- Save search queries

#### 3.6.2 State Search
- Search elements by ID/name
- Search components by type
- Search facets by content
- Filter by property values

## 4. Non-Functional Requirements

### 4.1 Performance
- Debug server overhead < 5% CPU when active
- Frame capture < 1ms per frame
- UI responsive with 10,000+ frames
- WebSocket latency < 50ms
- Memory usage < 100MB for 1000 frames

### 4.2 Compatibility
- Support Chrome, Firefox, Safari, Edge (latest 2 versions)
- Work on screens ≥ 1280x720
- Support touch interactions
- Keyboard navigation support

### 4.3 Developer Experience
- Zero configuration to enable
- Automatic UI serving
- No external dependencies
- Clear error messages
- Helpful tooltips

### 4.4 Data Management
- Automatic frame cleanup (keep last N frames)
- Configurable retention policies
- Export capabilities (JSON, CSV)
- Import previous sessions

## 5. Technical Requirements

### 5.1 Debug Server

#### 5.1.1 HTTP API Endpoints
```
GET  /api/state                    # Current system state
GET  /api/frames                   # Recent frames (paginated)
GET  /api/frames/:uuid             # Specific frame details
GET  /api/elements/:id             # Element details
GET  /api/facets                   # Current facets
POST /api/events                   # Trigger custom event
PUT  /api/elements/:id/props       # Update element properties
GET  /api/metrics                  # Performance metrics
```

#### 5.1.2 WebSocket Events
```
// Server → Client
frame:start       # New frame processing started
frame:complete    # Frame processing completed
state:changed     # Element/component state changed
facet:added       # New facet added
facet:changed     # Facet updated
facet:removed     # Facet removed
error             # System error occurred

// Client → Server
subscribe         # Subscribe to updates
unsubscribe       # Unsubscribe from updates
pauseUpdates      # Pause live updates
resumeUpdates     # Resume live updates
```

#### 5.1.3 Integration Points
- Minimal changes to core Space/VEILStateManager
- Use existing event system where possible
- Lazy initialization (only when accessed)
- Pluggable storage backends

### 5.2 Debug UI

#### 5.2.1 Technology Stack
- React 18+ for UI components
- WebSocket for real-time updates
- Zustand or similar for state management
- D3.js or similar for timeline visualization
- CSS Grid/Flexbox for responsive layout

#### 5.2.2 Key Components
```
<DebugApp>
  <Header>
    <ConnectionStatus />
    <GlobalControls />
  </Header>
  
  <MainLayout>
    <Sidebar>
      <FrameList />
      <StateTree />
    </Sidebar>
    
    <ContentArea>
      <FrameTimeline />
      <FrameInspector />
      <StateExplorer />
    </ContentArea>
  </MainLayout>
</DebugApp>
```

## 6. User Interface Requirements

### 6.1 Layout
- Responsive 3-panel layout (sidebar, timeline, inspector)
- Resizable panels
- Collapsible sections
- Dark/light theme support
- Persistent layout preferences

### 6.2 Visualization
- Color coding for frame types
- Icons for different triggers
- Syntax highlighting for code/JSON
- Diff visualization for changes
- Minimap for large timelines

### 6.3 Interactions
- Drag to pan timeline
- Scroll to zoom
- Click to select
- Double-click to expand
- Right-click context menus
- Keyboard shortcuts

## 7. Security Considerations

### 7.1 Access Control (Future)
- Optional authentication
- Read-only vs read-write modes
- IP whitelist support
- CORS configuration

### 7.2 Data Protection
- No sensitive data in URLs
- Configurable data masking
- Audit log for modifications
- Rate limiting on API

## 8. Configuration

### 8.1 Server Configuration
```typescript
interface DebugServerConfig {
  enabled: boolean;          // Default: true
  port: number;             // Default: 8888
  host: string;             // Default: 'localhost'
  maxFrames: number;        // Default: 1000
  retentionMinutes: number; // Default: 60
  corsOrigins: string[];    // Default: ['*']
}
```

### 8.2 UI Configuration
```typescript
interface DebugUIConfig {
  theme: 'light' | 'dark' | 'auto';
  updateInterval: number;    // ms between updates
  maxDisplayFrames: number;  // frames shown at once
  autoScroll: boolean;       // follow latest frame
  showInternalOps: boolean;  // show system operations
}
```

## 9. Success Criteria

1. Developers can understand agent behavior without reading logs
2. Frame processing is visually clear and traceable
3. State changes are immediately visible
4. Performance overhead is negligible
5. UI remains responsive with hours of data
6. No changes needed to existing application code

## 10. Future Enhancements

1. **Trace Integration**: Links to detailed trace analysis
2. **Persistence Debugging**: Snapshot/restore visualization  
3. **Multi-Agent Support**: Track multiple agents simultaneously
4. **Performance Profiling**: Flame graphs and timing analysis
5. **Collaboration**: Share debug sessions with team
6. **AI Assistant**: Natural language queries about system behavior
7. **Mobile App**: Native mobile debugging interface
8. **Plugin System**: Custom visualizations and tools
