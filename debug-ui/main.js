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

function cloneFacetsTree(tree) {
  if (!tree) return [];
  return JSON.parse(JSON.stringify(tree));
}

const DEBUG_LOGGING = true;

function debugLog(...args) {
  if (!DEBUG_LOGGING) return;
  try {
    console.log('[DebugUI]', ...args);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.log('[DebugUI]', args);
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
      return `speak → ${shorten(op.content || '', 80)}`;
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
        type: 'element',
        title: `Element · ${props.node.name}`,
        subtitle: props.node.type,
        payload: props.node
      });
    };

    const showComponentDetail = comp => {
      emit('show-detail', {
        type: 'component',
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

const FacetNode = {
  name: 'FacetNode',
  props: {
    facet: { type: Object, required: true },
    depth: { type: Number, default: 0 },
    expandedDepth: { type: Number, default: 1 }
  },
  emits: ['show-detail'],
  setup(props, { emit }) {
    const hasChildren = computed(() => props.facet.children && props.facet.children.length > 0);
    const isExpanded = ref(props.depth < props.expandedDepth);

    watch(
      () => props.expandedDepth,
      value => {
        if (props.depth < value) {
          isExpanded.value = true;
        }
      }
    );

    const toggle = () => {
      if (!hasChildren.value) return;
      isExpanded.value = !isExpanded.value;
    };

    const showFacetDetail = () => {
      emit('show-detail', {
        type: 'facet',
        title: `Facet · ${props.facet.displayName || props.facet.id}`,
        subtitle: props.facet.type,
        payload: props.facet
      });
    };

    return {
      hasChildren,
      isExpanded,
      toggle,
      showFacetDetail,
      truncate,
      shorten
    };
  },
  template: `
    <li class="facet-node" :style="{ '--depth': depth }">
      <div class="facet-row">
        <button
          v-if="hasChildren"
          class="facet-toggle"
          @click.stop="toggle"
        >
          {{ isExpanded ? '▾' : '▸' }}
        </button>
        <div class="facet-info" @click="showFacetDetail">
          <span class="facet-name">{{ facet.displayName || facet.id }}</span>
          <span class="facet-type">{{ facet.type }}</span>
          <span v-if="facet.content" class="facet-content">{{ truncate(facet.content, 120) }}</span>
        </div>
      </div>
      <div v-if="facet.attributes" class="facet-attributes">
        <div
          v-for="(value, key) in facet.attributes"
          :key="key"
          class="facet-attribute"
        >
          <span class="attr-key">{{ key }}</span>
          <span class="attr-value">{{ truncate(value, 80) }}</span>
        </div>
      </div>
      <ul v-if="hasChildren && isExpanded" class="facet-children">
        <facet-node
          v-for="child in facet.children"
          :key="child.id"
          :facet="child"
          :depth="depth + 1"
          :expanded-depth="expandedDepth"
          @show-detail="$emit('show-detail', $event)"
        />
      </ul>
    </li>
  `
};

const FacetTree = {
  name: 'FacetTree',
  props: {
    facets: { type: Array, required: true },
    expandedDepth: { type: Number, default: 1 }
  },
  emits: ['show-detail'],
  components: { FacetNode },
  template: `
    <ul class="facet-tree">
      <facet-node
        v-for="facet in facets"
        :key="facet.id"
        :facet="facet"
        :depth="0"
        :expanded-depth="expandedDepth"
        @show-detail="$emit('show-detail', $event)"
      />
    </ul>
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
      frameFacets: [],
      elementTree: null,
      selectedFrameId: null,
      filters: {
        search: ''
      },
      connectionStatus: 'connecting',
      lastUpdated: null,
      loadingFrame: false,
      framePagination: {
        limit: 150,
        nextOffset: 0,
        hasMore: true,
        loading: false
      },
      error: null,
      selectedOperationIndex: null,
      selectedEventIndex: null,
      activeDetail: null,
      inspectorWidth: 360
    });

    const socketRef = ref(null);
    const reconnectTimer = ref(null);
    const refreshTimer = ref(null);
    const expandedElements = reactive({});
    const layoutRef = ref(null);
    const isResizingInspector = ref(false);
    const frameDetailCache = new Map();
    let frameLoadSequence = 0;

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
      state.framePagination.nextOffset = state.frames.length;
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

    async function loadFrames({ reset = false, append = false } = {}) {
      if (state.framePagination.loading) {
        debugLog('loadFrames skip (already loading)', { reset, append });
        return;
      }
      const { limit, nextOffset } = state.framePagination;
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      const offset = append ? nextOffset : 0;
      if (append && offset > 0) {
        params.set('offset', String(offset));
      }

      if (reset) {
        debugLog('loadFrames reset state');
        state.frames = [];
        state.framePagination.nextOffset = 0;
        state.framePagination.hasMore = true;
        frameDetailCache.clear();
        state.frameFacets = [];
      }

      state.framePagination.loading = true;
      debugLog('loadFrames request', { reset, append, limit, offset, url: `/api/frames?${params.toString()}` });
      let frames = [];

      try {
        const response = await fetch(`/api/frames?${params.toString()}`);
        if (!response.ok) throw new Error(`frames request failed: ${response.status}`);
        const payload = await response.json();
        frames = payload.frames || [];
        frames.forEach(upsertFrame);
        state.metrics = {
          ...state.metrics,
          ...(payload.metrics || {})
        };
        state.lastUpdated = new Date().toISOString();
        if (append) {
          if (frames.length < limit) {
            state.framePagination.hasMore = false;
          }
        } else {
          state.framePagination.hasMore = frames.length === limit;
        }
      } catch (err) {
        state.error = `Failed to load frames: ${err.message}`;
        debugLog('loadFrames error', { error: err });
      } finally {
        state.framePagination.loading = false;
        debugLog('loadFrames complete', {
          reset,
          append,
          received: frames.length,
          totalFrames: state.frames.length,
          hasMore: state.framePagination.hasMore
        });
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

    async function fetchFrameDetail(uuid) {
      if (!uuid) return null;

      const requestId = ++frameLoadSequence;
      const showSpinner = state.selectedFrameId === uuid;
      if (showSpinner) {
        state.loadingFrame = true;
      }

      debugLog('fetchFrameDetail start', {
        uuid,
        requestId,
        selectedFrameId: state.selectedFrameId,
        showSpinner
      });

      try {
        const response = await fetch(`/api/frames/${uuid}`);
        if (!response.ok) throw new Error(`frame request failed: ${response.status}`);
        const payload = await response.json();

        const facetsTree = payload.facetsTree || [];
        frameDetailCache.set(uuid, { facetsTree });
        debugLog('fetchFrameDetail response', {
          uuid,
          requestId,
          facetsCount: facetsTree.length,
          frameLoadSequence,
          selectedFrameId: state.selectedFrameId
        });

        upsertFrame(payload);

        if (requestId === frameLoadSequence && state.selectedFrameId === uuid) {
          state.frameFacets = cloneFacetsTree(facetsTree);
          debugLog('fetchFrameDetail applied to state', {
            uuid,
            facetsCount: facetsTree.length
          });
        } else {
          debugLog('fetchFrameDetail ignored (stale request)', {
            uuid,
            requestId,
            frameLoadSequence,
            selectedFrameId: state.selectedFrameId
          });
        }

        return payload;
      } catch (err) {
        if (requestId === frameLoadSequence && state.selectedFrameId === uuid) {
          state.error = `Failed to load frame ${uuid}: ${err.message}`;
        }
        debugLog('fetchFrameDetail error', { uuid, error: err });
        throw err;
      } finally {
        if (showSpinner && requestId === frameLoadSequence && state.selectedFrameId === uuid) {
          state.loadingFrame = false;
        }
        debugLog('fetchFrameDetail complete', {
          uuid,
          requestId,
          selectedFrameId: state.selectedFrameId,
          loading: state.loadingFrame
        });
      }
    }

    async function setSelectedFrame(uuid, { forceReload = false } = {}) {
      if (!uuid) {
        state.selectedFrameId = null;
        state.selectedOperationIndex = null;
        state.selectedEventIndex = null;
        state.activeDetail = null;
        state.frameFacets = [];
        state.loadingFrame = false;
        debugLog('setSelectedFrame cleared');
        return;
      }

      const changed = state.selectedFrameId !== uuid;
      state.selectedFrameId = uuid;
      debugLog('setSelectedFrame', {
        uuid,
        forceReload,
        changed,
        cached: frameDetailCache.has(uuid),
        cachedFacets: frameDetailCache.get(uuid)?.facetsTree?.length || 0
      });

      const frame = state.frames.find(f => f.uuid === uuid);
      if (changed) {
        state.selectedOperationIndex = frame?.operations?.length ? 0 : null;
        state.selectedEventIndex = frame?.events?.length ? 0 : null;
      } else {
        if (frame?.operations?.length) {
          if (state.selectedOperationIndex == null) {
            state.selectedOperationIndex = 0;
          } else if (state.selectedOperationIndex >= frame.operations.length) {
            state.selectedOperationIndex = frame.operations.length - 1;
          }
        } else {
          state.selectedOperationIndex = null;
        }

        if (frame?.events?.length) {
          if (state.selectedEventIndex == null) {
            state.selectedEventIndex = 0;
          } else if (state.selectedEventIndex >= frame.events.length) {
            state.selectedEventIndex = frame.events.length - 1;
          }
        } else {
          state.selectedEventIndex = null;
        }
      }
      state.activeDetail = null;

      const cached = frameDetailCache.get(uuid);
      if (cached && !forceReload) {
        state.frameFacets = cloneFacetsTree(cached.facetsTree || []);
        debugLog('setSelectedFrame using cached facets', {
          uuid,
          facetsCount: cached.facetsTree?.length || 0
        });
      } else {
        state.frameFacets = [];
        debugLog('setSelectedFrame cleared facets pending fetch', { uuid, forceReload, cached: !!cached });
      }

      if (!cached || forceReload || changed) {
        try {
          await fetchFrameDetail(uuid);
        } catch (err) {
          // error already surfaced via state.error
          debugLog('setSelectedFrame fetch failed', { uuid, error: err });
        }
      }
    }

    async function refresh() {
      state.error = null;
      debugLog('refresh start', { existingFrames: state.frames.length, selectedFrameId: state.selectedFrameId });
      await Promise.all([loadFrames({ reset: true }), loadSystemState()]);
      if (!state.frames.length) {
        await setSelectedFrame(null);
        return;
      }

      const hasSelected = state.selectedFrameId && state.frames.some(f => f.uuid === state.selectedFrameId);
      const initialId = hasSelected ? state.selectedFrameId : state.frames[0].uuid;
      debugLog('refresh selecting initial frame', { initialId, hasSelected, framesLoaded: state.frames.length });
      await setSelectedFrame(initialId, { forceReload: true });
      debugLog('refresh complete', { selectedFrameId: state.selectedFrameId });
    }

    async function selectFrame(uuid) {
      if (!uuid) return;
      const forceReload = state.selectedFrameId === uuid;
      debugLog('selectFrame invoked', { uuid, forceReload });
      await setSelectedFrame(uuid, { forceReload });
    }

    async function loadOlderFrames() {
      if (!state.framePagination.hasMore || state.framePagination.loading) {
        debugLog('loadOlderFrames skipped', {
          hasMore: state.framePagination.hasMore,
          loading: state.framePagination.loading
        });
        return;
      }
      await loadFrames({ append: true });
    }

    function handleSocketMessage(message) {
      debugLog('handleSocketMessage', { type: message.type });
      switch (message.type) {
        case 'hello': {
          (message.payload?.frames || []).forEach(upsertFrame);
          if (message.payload?.metrics) {
            state.metrics = {
              ...state.metrics,
              ...message.payload.metrics
            };
          }
          if (!state.selectedFrameId && state.frames.length) {
            setSelectedFrame(state.frames[0].uuid, { forceReload: true });
          }
          break;
        }
        case 'frame:start':
        case 'frame:complete':
        case 'frame:outgoing':
        case 'frame:context': {
          if (message.payload?.uuid) {
            debugLog('handleSocketMessage invalidate cache', { uuid: message.payload.uuid });
            frameDetailCache.delete(message.payload.uuid);
          }
          upsertFrame(message.payload);
          if (!state.selectedFrameId && state.frames.length) {
            setSelectedFrame(state.frames[0].uuid, { forceReload: true });
          } else if (message.payload?.uuid && message.payload.uuid === state.selectedFrameId) {
            setSelectedFrame(state.selectedFrameId, { forceReload: true });
          }
          break;
        }
        case 'frame:event': {
          const { frameId, event } = message.payload || {};
          if (frameId && event) {
            debugLog('handleSocketMessage frame:event', {
              frameId,
              eventTopic: event.topic,
              selectedFrameId: state.selectedFrameId
            });
            frameDetailCache.delete(frameId);
            applyEventToFrame(frameId, event);
            if (frameId === state.selectedFrameId) {
              setSelectedFrame(state.selectedFrameId, { forceReload: true });
            }
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
      debugLog('connectSocket', { url: `${protocol}://${window.location.host}` });

      socket.addEventListener('open', () => {
        state.connectionStatus = 'live';
        state.error = null;
        debugLog('socket open');
      });

      socket.addEventListener('close', () => {
        state.connectionStatus = 'offline';
        if (reconnectTimer.value) {
          clearTimeout(reconnectTimer.value);
        }
        reconnectTimer.value = setTimeout(connectSocket, 2000);
        debugLog('socket close - will retry');
      });

      socket.addEventListener('message', event => {
        try {
          const payload = JSON.parse(event.data);
          debugLog('socket message', payload?.type ? { type: payload.type } : {});
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

    function setDetail(detail) {
      state.activeDetail = detail;
    }

    function closeDetail() {
      state.activeDetail = null;
    }

    function selectOperation(op, idx) {
      state.selectedOperationIndex = idx;
      setDetail({
        type: 'operation',
        title: `Operation · ${op.type}`,
        subtitle: operationMeta(op),
        operation: op,
        payload: op
      });
    }

    function selectEvent(event, idx) {
      state.selectedEventIndex = idx;
      setDetail({
        type: 'event',
        title: `Event · ${event.topic}`,
        subtitle: eventMeta(event),
        event,
        payload: event
      });
    }

    function toggleElement(id) {
      expandedElements[id] = !expandedElements[id];
    }

    function handleTreeDetail(detail) {
      setDetail({
        type: detail.type || 'element',
        title: detail.title,
        subtitle: detail.subtitle,
        payload: detail.payload
      });
    }

    function startResize(event) {
      isResizingInspector.value = true;
      event.preventDefault();
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', onResize);
      window.addEventListener('mouseup', stopResize);
    }

    function onResize(event) {
      if (!isResizingInspector.value) return;
      const layout = layoutRef.value;
      if (!layout) return;
      const rect = layout.getBoundingClientRect();
      const minWidth = 260;
      const maxWidth = 600;
      const gap = 18; // matches CSS grid gap
      const handleWidth = 10;
      const rightEdge = rect.right;
      const newWidth = rightEdge - event.clientX - gap - handleWidth / 2;
      state.inspectorWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));
    }

    function stopResize() {
      if (!isResizingInspector.value) return;
      isResizingInspector.value = false;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onResize);
      window.removeEventListener('mouseup', stopResize);
    }

    onBeforeUnmount(() => {
      stopResize();
    });

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

    const layoutStyle = computed(() => ({
      '--inspector-width': `${state.inspectorWidth}px`
    }));

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
      truncate,
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
      refresh,
      loadOlderFrames,
      layoutRef,
      layoutStyle,
      startResize
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
      <div class="layout" :style="layoutStyle" ref="layoutRef">
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
              <div
                v-else-if="state.framePagination.hasMore"
                class="frame-load-more"
              >
                <button
                  class="button"
                  :disabled="state.framePagination.loading"
                  @click="loadOlderFrames"
                >
                  {{ state.framePagination.loading ? 'Loading…' : 'Load Older Frames' }}
                </button>
              </div>
              <div
                v-else
                class="frame-load-more text-muted"
              >
                Start of retained history
              </div>
            </div>
          </section>
          <section class="panel veil-panel">
            <div class="panel-header">
              <h2>VEIL Snapshot</h2>
              <span class="badge" v-if="state.frameFacets.length">{{ state.frameFacets.length }}</span>
            </div>
            <div class="veil-tree" v-if="state.frameFacets.length">
              <facet-tree
                :facets="state.frameFacets"
                :expanded-depth="1"
                @show-detail="handleTreeDetail"
              />
            </div>
            <div v-else class="text-muted">No active facets for this frame.</div>
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
                <span
                  class="meta-pill"
                  v-if="selectedFrame.activeStream"
                >
                  Stream: {{ shorten(selectedFrame.activeStream.streamId, 18) }}
                </span>
                <span
                  class="meta-pill"
                  v-if="selectedFrame.agent"
                >
                  Agent: {{ shorten(selectedFrame.agent.name || selectedFrame.agent.id, 18) }}
                </span>
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
              <div class="section-body operations">
                <div v-if="!selectedFrame.operations?.length" class="text-muted">No operations.</div>
                <div
                  v-for="(op, idx) in selectedFrame.operations"
                  :key="idx"
                  class="operation-card"
                >
                  <div class="operation-card-header">
                    <span class="operation-type">{{ op.type }}</span>
                    <span class="operation-meta" v-if="operationMeta(op)">{{ operationMeta(op) }}</span>
                  </div>
                  <div class="operation-card-body">
                    <template v-if="op.type === 'speak'">
                      <pre class="operation-message">{{ op.content }}</pre>
                      <div class="pill-meta" v-if="op.target">Target: {{ op.target }}</div>
                      <div class="pill-meta" v-if="op.targets">Targets: {{ op.targets.join(', ') }}</div>
                    </template>
                    <template v-else-if="op.type === 'addFacet' && op.facet">
                      <facet-tree :facets="[op.facet]" :expanded-depth="2" @show-detail="handleTreeDetail" />
                    </template>
                    <template v-else-if="op.type === 'changeState'">
                      <div class="operation-kv">
                        <div class="kv-item" v-if="op.updates?.content">
                          <span class="kv-key">content</span>
                          <span class="kv-value">{{ op.updates.content }}</span>
                        </div>
                        <div
                          class="kv-item"
                          v-for="(value, key) in op.updates?.attributes || {}"
                          :key="key"
                        >
                          <span class="kv-key">{{ key }}</span>
                          <span class="kv-value">{{ stringify(value) }}</span>
                        </div>
                      </div>
                    </template>
                    <template v-else-if="op.type === 'action'">
                      <div class="pill-meta">Path: {{ (op.path || []).join('.') }}</div>
                      <div class="operation-kv" v-if="op.parameters">
                        <div class="kv-item" v-for="(value, key) in op.parameters" :key="key">
                          <span class="kv-key">{{ key }}</span>
                          <span class="kv-value">{{ stringify(value) }}</span>
                        </div>
                      </div>
                    </template>
                    <template v-else>
                      <pre class="operation-json">{{ truncate(stringify(op), 500) }}</pre>
                    </template>
                  </div>
                  <div class="operation-actions">
                    <button class="mini-button" @click="selectOperation(op, idx)">View JSON</button>
                  </div>
                </div>
              </div>
            </div>
            <div class="section">
              <h3>Events</h3>
              <div class="section-body events">
                <div v-if="!selectedFrame.events?.length" class="text-muted">No events observed for this frame.</div>
                <div
                  v-for="(event, idx) in selectedFrame.events"
                  :key="event.id || idx"
                  class="event-card"
                >
                  <div class="event-card-header">
                    <span class="event-topic">{{ event.topic }}</span>
                    <span class="event-meta" v-if="eventMeta(event)">{{ eventMeta(event) }}</span>
                  </div>
                  <div class="event-card-body">
                    <div class="pill-meta">Timestamp: {{ formatTimestamp(event.timestamp) }}</div>
                    <div class="pill-meta" v-if="event.phase && event.phase !== 'none'">Phase: {{ event.phase }}</div>
                    <div class="pill-meta" v-if="event.target">Target: {{ event.target.elementId }}</div>
                    <div class="event-payload" v-if="event.payload">{{ truncate(stringify(event.payload), 200) }}</div>
                  </div>
                  <div class="operation-actions">
                    <button class="mini-button" @click="selectEvent(event, idx)">View JSON</button>
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
        <div class="splitter" @mousedown="startResize"></div>
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
                <pre class="code-block">{{ stringify(state.activeDetail.payload ?? state.activeDetail) }}</pre>
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
app.component('facet-tree', FacetTree);
app.component('facet-node', FacetNode);
app.mount('#app');
