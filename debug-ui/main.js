import {
  createApp,
  reactive,
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch
} from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';

function normalizeFrame(frame) {
  return {
    events: [],
    operations: [],
    renderedContext: null,
    ...frame,
    events: frame.events ? [...frame.events] : [],
    operations: frame.operations ? [...frame.operations] : [],
    kind: frame.kind || 'incoming'
  };
}

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
}

function formatTimestamp(value) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    return date.toLocaleString();
  } catch {
    return value;
  }
}

function formatTime(value) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    return date.toLocaleTimeString();
  } catch {
    if (typeof value === 'number') {
      return `${value} ms`;
    }
    return value;
  }
}

function shorten(value, max = 28) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function truncate(value, max = 160) {
  if (!value && value !== 0) return '';
  const str = String(value);
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function summarizeFacet(facet) {
  if (!facet) return '';
  if (facet.content) return facet.content;
  const keys = Object.keys(facet.attributes || {});
  if (keys.length) {
    return keys.map(key => `${key}: ${stringify(facet.attributes[key])}`).join('\n');
  }
  return facet.displayName || facet.id || '(empty)';
}

function summarizeOperation(op) {
  if (!op) return '';
  switch (op.type) {
    case 'addFacet':
      return `addFacet → ${op.facet?.displayName || op.facet?.id || 'facet'} (${op.facet?.type || '?'})`;
    case 'changeState':
      return `changeState → ${op.facetId}`;
    case 'addStream':
      return `addStream → ${op.stream?.id || op.streamId}`;
    case 'agentActivation':
      return `agentActivation (${op.priority || 'normal'})`;
    case 'speak':
      return `speak: ${(op.content || '').slice(0, 32)}${op.content && op.content.length > 32 ? '…' : ''}`;
    default:
      return op.type;
  }
}

function operationMeta(op) {
  if (!op) return '';
  switch (op.type) {
    case 'addFacet':
      return shorten(op.facet?.displayName || op.facet?.type || '', 32);
    case 'changeState': {
      const keys = Object.keys(op.updates?.attributes || {});
      return keys.length ? `attrs: ${shorten(keys.join(', '), 36)}` : '';
    }
    case 'agentActivation':
      return shorten(op.reason || op.source || '', 36);
    case 'addStream':
      return shorten(op.stream?.name || op.stream?.id || '', 36);
    case 'speak':
      return shorten(op.target || (op.targets && op.targets.join(', ')) || '', 36);
    default:
      return '';
  }
}

function summarizeEvent(event) {
  if (!event) return '';
  const target = event.target?.elementId || event.source?.elementId;
  return target ? `${event.topic} → ${target}` : event.topic || 'event';
}

function eventMeta(event) {
  if (!event) return '';
  const parts = [];
  if (event.phase && event.phase !== 'none') parts.push(event.phase);
  if (event.payload && typeof event.payload === 'object') {
    if (event.payload.reason) parts.push(event.payload.reason);
    if (event.payload.priority) parts.push(`priority ${event.payload.priority}`);
  }
  return shorten(parts.join(' · '), 40);
}

function formatComponentSummary(state) {
  if (!state || typeof state !== 'object') return '';
  const entries = Object.entries(state)
    .slice(0, 2)
    .map(([key, value]) => {
      const formatted = typeof value === 'object' ? JSON.stringify(value) : value;
      return `${key}: ${shorten(formatted, 36)}`;
    });
  return entries.join(' · ');
}

const ElementTree = {
  name: 'ElementTree',
  props: {
    node: { type: Object, required: true },
    depth: { type: Number, default: 0 },
    expanded: { type: Object, required: true }
  },
  emits: ['toggle', 'show-detail'],
  setup(props, { emit }) {
    const hasChildren = computed(() => props.node.children && props.node.children.length > 0);
    const isExpanded = computed(() => {
      if (!hasChildren.value) return false;
      const current = props.expanded[props.node.id];
      return current === undefined ? false : current;
    });

    const toggle = () => {
      if (!hasChildren.value) return;
      emit('toggle', props.node.id);
    };

    const showElementDetail = () => {
      emit('show-detail', {
        title: `Element · ${props.node.name}`,
        subtitle: props.node.type,
        payload: props.node
      });
    };

    const showComponentDetail = comp => {
      emit('show-detail', {
        title: `Component · ${comp.type}`,
        subtitle: props.node.name,
        payload: comp
      });
    };

    const componentSummary = comp => formatComponentSummary(comp.state);

    return {
      hasChildren,
      isExpanded,
      toggle,
      showElementDetail,
      showComponentDetail,
      componentSummary,
      shorten,
      truncate
    };
  },
  template: `
    <li class="tree-item" :style="{ '--depth': depth }">
      <div class="tree-row">
        <button
          v-if="hasChildren"
          class="tree-toggle"
          @click.stop="toggle"
        >
          {{ isExpanded ? '▾' : '▸' }}
        </button>
        <div class="tree-info" @click="showElementDetail">
          <span class="tree-name">{{ node.name }}</span>
          <span class="tree-type">{{ node.type }}</span>
          <span
            v-if="node.subscriptions && node.subscriptions.length"
            class="tree-meta"
          >
            {{ shorten(node.subscriptions.join(', '), 40) }}
          </span>
          <span
            v-if="node.content"
            class="tree-content"
          >
            {{ truncate(node.content, 80) }}
          </span>
        </div>
      </div>
      <div
        v-if="node.components && node.components.length"
        class="tree-components"
      >
        <div
          v-for="(comp, index) in node.components"
          :key="index"
          class="tree-component"
          @click.stop="showComponentDetail(comp)"
        >
          <span class="comp-name">{{ comp.type }}</span>
          <span
            v-if="componentSummary(comp)"
            class="comp-summary"
          >
            {{ componentSummary(comp) }}
          </span>
        </div>
      </div>
      <ul v-if="hasChildren && isExpanded" class="tree-children">
        <element-tree
          v-for="child in node.children"
          :key="child.id"
          :node="child"
          :depth="depth + 1"
          :expanded="expanded"
          @toggle="$emit('toggle', $event)"
          @show-detail="$emit('show-detail', $event)"
        />
      </ul>
    </li>
  `
};

const App = {
  setup() {
    const state = reactive({
      frames: [],
      metrics: {
        incomingFrames: 0,
        outgoingFrames: 0,
        totalEvents: 0,
        averageDurationMs: 0
      },
      facets: [],
      elementTree: null,
      selectedFrameId: null,
      filters: {
        search: ''
      },
      connectionStatus: 'connecting',
      lastUpdated: null,
      loadingFrame: false,
      error: null,
      selectedOperationIndex: null,
      selectedEventIndex: null,
      activeDetail: null
    });

    const socketRef = ref(null);
    const reconnectTimer = ref(null);
    const refreshTimer = ref(null);
    const expandedElements = reactive({});

    function upsertFrame(frameData) {
      if (!frameData || !frameData.uuid) return;
      const incoming = normalizeFrame(frameData);
      const index = state.frames.findIndex(f => f.uuid === incoming.uuid);
      if (index === -1) {
        state.frames.push(incoming);
      } else {
        const existing = state.frames[index];
        state.frames[index] = {
          ...existing,
          ...incoming,
          events: incoming.events.length ? incoming.events : existing.events,
          operations: incoming.operations.length ? incoming.operations : existing.operations,
          renderedContext: incoming.renderedContext || existing.renderedContext
        };
      }
      state.frames.sort((a, b) => b.sequence - a.sequence);
    }

    function applyEventToFrame(frameId, eventRecord) {
      const index = state.frames.findIndex(f => f.uuid === frameId);
      if (index === -1) return;
      const frame = state.frames[index];
      const events = frame.events ? [...frame.events] : [];
      events.push(eventRecord);
      state.frames[index] = {
        ...frame,
        events
      };
      if (state.selectedFrameId === frameId) {
        state.selectedEventIndex = events.length - 1;
      }
    }

    async function loadFrames(limit = 150) {
      try {
        const response = await fetch(`/api/frames?limit=${limit}`);
        if (!response.ok) throw new Error(`frames request failed: ${response.status}`);
        const payload = await response.json();
        (payload.frames || []).forEach(upsertFrame);
        state.metrics = {
          ...state.metrics,
          ...(payload.metrics || {})
        };
        state.lastUpdated = new Date().toISOString();
      } catch (err) {
        state.error = `Failed to load frames: ${err.message}`;
      }
    }

    function initializeElementExpansion(node, depth = 0) {
      if (!node) return;
      if (expandedElements[node.id] === undefined) {
        expandedElements[node.id] = depth < 1;
      }
      if (node.children) {
        node.children.forEach(child => initializeElementExpansion(child, depth + 1));
      }
    }

    async function loadSystemState() {
      try {
        const response = await fetch('/api/state');
        if (!response.ok) throw new Error(`state request failed: ${response.status}`);
        const payload = await response.json();
        state.elementTree = payload.space || null;
        if (state.elementTree) {
          initializeElementExpansion(state.elementTree);
        }
        state.facets = payload.veil?.facets || [];
        if (payload.metrics) {
          state.metrics = {
            ...state.metrics,
            ...payload.metrics
          };
        }
      } catch (err) {
        state.error = `Failed to load system state: ${err.message}`;
      }
    }

    async function loadFrame(uuid) {
      if (!uuid) return;
      state.loadingFrame = true;
      try {
        const response = await fetch(`/api/frames/${uuid}`);
        if (!response.ok) throw new Error(`frame request failed: ${response.status}`);
        const payload = await response.json();
        upsertFrame(payload);
      } catch (err) {
        state.error = `Failed to load frame ${uuid}: ${err.message}`;
      } finally {
        state.loadingFrame = false;
      }
    }

    async function refresh() {
      state.error = null;
      await Promise.all([loadFrames(), loadSystemState()]);
      if (!state.selectedFrameId && state.frames.length) {
        state.selectedFrameId = state.frames[0].uuid;
        await loadFrame(state.selectedFrameId);
      }
    }

    function selectFrame(uuid) {
      state.selectedFrameId = uuid;
      loadFrame(uuid);
    }

    function handleSocketMessage(message) {
      switch (message.type) {
        case 'hello': {
          (message.payload?.frames || []).forEach(upsertFrame);
          if (message.payload?.metrics) {
            state.metrics = {
              ...state.metrics,
              ...message.payload.metrics
            };
          }
          if (message.payload?.state?.facets) {
            state.facets = message.payload.state.facets;
          }
          if (!state.selectedFrameId && state.frames.length) {
            state.selectedFrameId = state.frames[0].uuid;
          }
          break;
        }
        case 'frame:start':
        case 'frame:complete':
        case 'frame:outgoing':
        case 'frame:context': {
          upsertFrame(message.payload);
          if (!state.selectedFrameId && state.frames.length) {
            state.selectedFrameId = state.frames[0].uuid;
          }
          break;
        }
        case 'frame:event': {
          const { frameId, event } = message.payload || {};
          if (frameId && event) {
            applyEventToFrame(frameId, event);
          }
          break;
        }
        case 'state:changed': {
          if (message.payload?.facets) {
            state.facets = message.payload.facets;
          }
          break;
        }
        default:
          break;
      }
    }

    function connectSocket() {
      if (socketRef.value) {
        socketRef.value.close();
      }
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const socket = new WebSocket(`${protocol}://${window.location.host}`);
      socketRef.value = socket;

      socket.addEventListener('open', () => {
        state.connectionStatus = 'live';
        state.error = null;
      });

      socket.addEventListener('close', () => {
        state.connectionStatus = 'offline';
        if (reconnectTimer.value) {
          clearTimeout(reconnectTimer.value);
        }
        reconnectTimer.value = setTimeout(connectSocket, 2000);
      });

      socket.addEventListener('message', event => {
        try {
          const payload = JSON.parse(event.data);
          handleSocketMessage(payload);
        } catch (err) {
          console.warn('Failed to process debug message', err);
        }
      });
    }

    onMounted(async () => {
      await refresh();
      connectSocket();
      refreshTimer.value = setInterval(refresh, 7000);
    });

    onBeforeUnmount(() => {
      if (socketRef.value) {
        socketRef.value.close();
      }
      if (reconnectTimer.value) {
        clearTimeout(reconnectTimer.value);
      }
      if (refreshTimer.value) {
        clearInterval(refreshTimer.value);
      }
    });

    watch(
      () => state.filters.search,
      () => {
        // computed handles filtering reactively
      }
    );

    watch(
      () => state.selectedFrameId,
      () => {
        const frame = state.frames.find(f => f.uuid === state.selectedFrameId);
        state.selectedOperationIndex = frame?.operations?.length ? 0 : null;
        state.selectedEventIndex = frame?.events?.length ? 0 : null;
        state.activeDetail = null;
      }
    );

    function openDetail(title, payload, subtitle) {
      state.activeDetail = { title, payload, subtitle };
    }

    function closeDetail() {
      state.activeDetail = null;
    }

    function selectOperation(op, idx) {
      state.selectedOperationIndex = idx;
      openDetail(`Operation · ${op.type}`, op, operationMeta(op));
    }

    function selectEvent(event, idx) {
      state.selectedEventIndex = idx;
      openDetail(`Event · ${event.topic}`, event, eventMeta(event));
    }

    function toggleElement(id) {
      expandedElements[id] = !expandedElements[id];
    }

    function handleTreeDetail(detail) {
      openDetail(detail.title, detail.payload, detail.subtitle);
    }

    const filteredFrames = computed(() => {
      const query = state.filters.search.trim().toLowerCase();
      const source = state.frames || [];
      if (!query) return source;
      return source.filter(frame => {
        if (frame.uuid && frame.uuid.toLowerCase().includes(query)) return true;
        if (frame.sequence && String(frame.sequence).includes(query)) return true;
        if (frame.activeStream?.streamId && frame.activeStream.streamId.toLowerCase().includes(query)) return true;
        if (frame.agent?.name && frame.agent.name.toLowerCase().includes(query)) return true;
        if (frame.agent?.id && frame.agent.id.toLowerCase().includes(query)) return true;
        if (frame.reason && String(frame.reason).toLowerCase().includes(query)) return true;
        return false;
      });
    });

    const selectedFrame = computed(() => {
      if (!state.selectedFrameId) return null;
      return state.frames.find(frame => frame.uuid === state.selectedFrameId) || null;
    });

    const selectedOperation = computed(() => {
      const frame = selectedFrame.value;
      if (!frame || state.selectedOperationIndex == null) return null;
      return frame.operations?.[state.selectedOperationIndex] || null;
    });

    const selectedEvent = computed(() => {
      const frame = selectedFrame.value;
      if (!frame || state.selectedEventIndex == null) return null;
      return frame.events?.[state.selectedEventIndex] || null;
    });

    const timelineFrames = computed(() => {
      const frames = [...state.frames];
      frames.sort((a, b) => b.sequence - a.sequence);
      return frames.slice(0, 24);
    });

    return {
      state,
      filteredFrames,
      selectedFrame,
      selectedOperation,
      selectedEvent,
      timelineFrames,
      formatTime,
      formatTimestamp,
      shorten,
      summarizeFacet,
      summarizeOperation,
      summarizeEvent,
      operationMeta,
      eventMeta,
      stringify,
      selectFrame,
      selectOperation,
      selectEvent,
      closeDetail,
      expandedElements,
      toggleElement,
      handleTreeDetail,
      refresh
    };
  },
  template: `
    <div class="app-shell">
      <header class="app-header">
        <h1>Connectome Debug UI</h1>
        <div class="header-meta">
          <span
            class="status-pill"
            :class="{ offline: state.connectionStatus !== 'live' }"
          >
            {{ state.connectionStatus === 'live' ? 'Live' : 'Reconnecting' }}
          </span>
          <div class="metrics-row">
            <span class="badge">Incoming: {{ state.metrics.incomingFrames }}</span>
            <span class="badge">Outgoing: {{ state.metrics.outgoingFrames }}</span>
            <span class="badge" v-if="state.metrics.totalEvents">Events: {{ state.metrics.totalEvents }}</span>
          </div>
        </div>
        <div class="controls">
          <button class="button" @click="refresh">Refresh</button>
        </div>
      </header>
      <div class="error-banner" v-if="state.error">
        {{ state.error }}
      </div>
      <div class="layout">
        <aside class="sidebar">
          <section class="panel frame-panel">
            <div class="panel-header">
              <h2>Frames</h2>
              <span class="badge" v-if="filteredFrames.length">{{ filteredFrames.length }}</span>
            </div>
            <input
              class="search-input"
              v-model="state.filters.search"
              placeholder="Search frames by uuid, stream, agent..."
            />
            <div class="frame-list">
              <div
                v-for="frame in filteredFrames"
                :key="frame.uuid"
                :class="['frame-card', state.selectedFrameId === frame.uuid ? 'active' : '']"
                @click="selectFrame(frame.uuid)"
              >
                <div class="frame-card-header">
                  <span>#{{ frame.sequence }}</span>
                  <span class="pill" :class="frame.kind">{{ frame.kind }}</span>
                </div>
                <div class="frame-card-meta">
                  <span>{{ formatTimestamp(frame.timestamp) }}</span>
                  <span>{{ frame.operations?.length || 0 }} ops</span>
                  <span>{{ frame.events?.length || 0 }} events</span>
                  <span v-if="frame.durationMs">{{ frame.durationMs.toFixed(1) }} ms</span>
                </div>
                <div class="frame-card-meta" v-if="frame.activeStream">
                  <span>stream: {{ frame.activeStream.streamId }}</span>
                </div>
              </div>
              <div v-if="!filteredFrames.length" class="text-muted">No frames yet.</div>
            </div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <h2>Active Facets</h2>
              <span class="badge" v-if="state.facets.length">{{ state.facets.length }}</span>
            </div>
            <div class="facet-list">
              <div v-for="facet in state.facets" :key="facet.facetId" class="facet-item">
                <h3>{{ facet.displayName || facet.id }}</h3>
                <div class="facet-body">{{ summarizeFacet(facet) }}</div>
              </div>
              <div v-if="!state.facets.length" class="text-muted">No active facets.</div>
            </div>
          </section>
        </aside>
        <section class="content-area">
          <section class="panel timeline-panel" v-if="timelineFrames.length">
            <div class="panel-header">
              <h2>Frame Timeline</h2>
              <span class="badge">Newest {{ timelineFrames.length }}</span>
            </div>
            <div class="timeline-body">
              <div
                v-for="frame in timelineFrames"
                :key="frame.uuid"
                :class="['timeline-node', { active: state.selectedFrameId === frame.uuid, outgoing: frame.kind === 'outgoing' }]"
                @click="selectFrame(frame.uuid)"
              >
                <span class="timeline-seq">#{{ frame.sequence }}</span>
                <span class="timeline-kind">{{ frame.kind }}</span>
              </div>
            </div>
          </section>
          <section class="panel frame-detail" v-if="selectedFrame">
            <div class="panel-header frame-header">
              <h2>Frame {{ selectedFrame.sequence }}</h2>
              <div class="frame-meta">
                <span class="meta-pill">UUID: {{ shorten(selectedFrame.uuid, 18) }}</span>
                <span class="meta-pill">{{ formatTimestamp(selectedFrame.timestamp) }}</span>
                <span class="meta-pill kind" :class="selectedFrame.kind">{{ selectedFrame.kind }}</span>
              </div>
            </div>
            <div class="info-grid">
              <div class="info-card" v-if="selectedFrame.activeStream">
                <h4>Active Stream</h4>
                <span>{{ selectedFrame.activeStream.streamId }}</span>
              </div>
              <div class="info-card" v-if="selectedFrame.agent">
                <h4>Agent</h4>
                <span>{{ selectedFrame.agent.name || selectedFrame.agent.id }}</span>
              </div>
            </div>
            <div class="section" v-if="selectedFrame.renderedContext">
              <h3>Rendered Context</h3>
              <div class="section-body message-list">
                <div
                  class="message-card"
                  v-for="(msg, idx) in selectedFrame.renderedContext.messages"
                  :key="idx"
                >
                  <div class="role">{{ msg.role }}</div>
                  <pre>{{ msg.content }}</pre>
                </div>
                <div class="message-card" v-if="selectedFrame.renderedContext.metadata">
                  <div class="role">metadata</div>
                  <pre>{{ stringify(selectedFrame.renderedContext.metadata) }}</pre>
                </div>
              </div>
            </div>
            <div class="section" v-if="selectedFrame.renderedContext">
              <h3>LLM Request JSON</h3>
              <div class="section-body">
                <pre class="code-block">{{ stringify(selectedFrame.renderedContext) }}</pre>
              </div>
            </div>
            <div class="section">
              <h3>Operations</h3>
              <div class="section-body pills">
                <div v-if="!selectedFrame.operations?.length" class="text-muted">No operations.</div>
                <div class="pill-list" v-else>
                  <div
                    v-for="(op, idx) in selectedFrame.operations"
                    :key="idx"
                    :class="['pill-item', { active: state.selectedOperationIndex === idx }]"
                    @click="selectOperation(op, idx)"
                  >
                    <span class="pill-title">{{ summarizeOperation(op) }}</span>
                    <span
                      v-if="operationMeta(op)"
                      class="pill-meta"
                    >
                      {{ operationMeta(op) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div class="section">
              <h3>Events</h3>
              <div class="section-body pills">
                <div v-if="!selectedFrame.events?.length" class="text-muted">No events observed for this frame.</div>
                <div class="pill-list" v-else>
                  <div
                    v-for="(event, idx) in selectedFrame.events"
                    :key="event.id || idx"
                    :class="['pill-item', { active: state.selectedEventIndex === idx }]"
                    @click="selectEvent(event, idx)"
                  >
                    <span class="pill-title">{{ summarizeEvent(event) }}</span>
                    <span
                      v-if="eventMeta(event)"
                      class="pill-meta"
                    >
                      {{ eventMeta(event) }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section v-else class="panel frame-detail">
            <div class="panel-header">
              <h2>Frame Details</h2>
            </div>
            <div class="section-body text-muted">
              Select a frame from the left to inspect operations and rendered context.
            </div>
          </section>
          <section class="panel element-tree">
            <div class="panel-header">
              <h2>Element Tree</h2>
            </div>
            <ul v-if="state.elementTree" class="tree-view">
              <element-tree
                :node="state.elementTree"
                :depth="0"
                :expanded="expandedElements"
                @toggle="toggleElement"
                @show-detail="handleTreeDetail"
              />
            </ul>
            <div v-else class="text-muted">Tree not available yet.</div>
          </section>
        </section>
        <aside class="inspector" :class="{ 'inspector-visible': state.activeDetail }">
          <section class="panel inspector-panel">
            <div class="panel-header inspector-header">
              <h2>Inspector</h2>
              <button class="button" v-if="state.activeDetail" @click="closeDetail">Close</button>
            </div>
            <div v-if="state.activeDetail" class="inspector-body">
              <div class="inspector-title">{{ state.activeDetail.title }}</div>
              <div v-if="state.activeDetail.subtitle" class="inspector-subtitle">{{ state.activeDetail.subtitle }}</div>
              <div class="inspector-json">
                <pre class="code-block">{{ stringify(state.activeDetail.payload) }}</pre>
              </div>
            </div>
            <div v-else class="inspector-placeholder">
              Select an operation, event, or element to inspect.
            </div>
          </section>
        </aside>
      </div>
    </div>
  `
};

const app = createApp(App);
app.component('element-tree', ElementTree);
app.mount('#app');
