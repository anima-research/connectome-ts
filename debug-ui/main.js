import {
  createApp,
  reactive,
  ref,
  computed,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick
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

const ACTION_SNIPPET_REGEX = /@[a-zA-Z0-9_.-]+(?:\([^@\n]*?\))?/g;

function extractActionSnippets(facets) {
  if (!Array.isArray(facets) || facets.length === 0) {
    return [];
  }

  const snippets = new Map();

  const addSnippet = (snippet, facet) => {
    if (!snippet) return;
    const normalized = snippet.trim();
    if (!normalized) return;
    if (snippets.has(normalized)) return;
    snippets.set(normalized, {
      text: normalized,
      source: facet.displayName || facet.id || facet.type || null,
      facetId: facet.id || null,
      facetType: facet.type || null
    });
  };

  const scanValue = (value, facet) => {
    if (value === null || value === undefined) {
      return;
    }
    if (typeof value === 'string') {
      let match;
      while ((match = ACTION_SNIPPET_REGEX.exec(value)) !== null) {
        addSnippet(match[0], facet);
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        scanValue(item, facet);
      }
    } else if (typeof value === 'object') {
      for (const key of Object.keys(value)) {
        scanValue(value[key], facet);
      }
    }
  };

  const walkFacet = facet => {
    if (!facet || typeof facet !== 'object') {
      return;
    }
    scanValue(facet.content, facet);
    scanValue(facet.displayName, facet);
    scanValue(facet.attributes, facet);
    scanValue(facet.scope, facet);
    scanValue(facet.saliency, facet);
    if (Array.isArray(facet.children)) {
      for (const child of facet.children) {
        walkFacet(child);
      }
    }
  };

  for (const facet of facets) {
    walkFacet(facet);
  }

  return Array.from(snippets.values());
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

function formatComponents(components, maxCount = 3) {
  if (!components?.length) return '';
  const names = components.map(c => c.name || c.id || c.type || 'component');
  if (names.length <= maxCount) {
    return names.join(', ');
  }
  return `${names.slice(0, maxCount).join(', ')} +${names.length - maxCount}`;
}

function formatChildren(children, maxCount = 2) {
  if (!children?.length) return '';
  const items = children.map((c, idx) => {
    if (c.content && c.content.length > 20) {
      return truncate(c.content, 30);
    }
    const name = c.name || c.id || (c.content ? truncate(c.content, 15) : null) || `${c.type || 'child'}${idx + 1}`;
    const type = c.type || 'unknown';
    return c.name || c.id ? `${name}(${type})` : name;
  });
  if (items.length <= maxCount) {
    return items.join(' > ');
  }
  return `${items.slice(0, maxCount).join(' > ')} +${items.length - maxCount}`;
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
  const targetPath = event.target?.elementPath?.join('/') || event.target?.elementId;
  const sourcePath = event.source?.elementPath?.join('/') || event.source?.elementId;
  const target = targetPath || sourcePath;
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
    <li class="compact-tree-item">
      <div class="compact-tree-row" :style="{ paddingLeft: depth * 16 + 'px' }">
        <span class="tree-connector" v-if="depth > 0"></span>
        <button
          v-if="hasChildren"
          class="compact-toggle"
          @click.stop="toggle"
        >
          {{ isExpanded ? '▾' : '▸' }}
        </button>
        <span v-else class="compact-toggle-spacer"></span>
        <div class="compact-element-info" @click="showElementDetail">
          <span class="element-name">{{ node.name }}</span>
          <span class="element-type">({{ node.type }})</span>
          <span v-if="node.content" class="element-content">{{ node.content }}</span>
          <span v-if="node.components?.length" class="element-comps">[{{ node.components.length }}c]</span>
        </div>
      </div>
      <div v-if="node.components?.length" class="compact-components">
        <div
          v-for="(comp, index) in node.components"
          :key="index"
          class="compact-component-row"
          :style="{ paddingLeft: (depth + 1) * 16 + 'px' }"
          @click.stop="showComponentDetail(comp)"
        >
          <span class="component-marker">○</span>
          <span class="component-name">{{ comp.type }}</span>
          <span v-if="componentSummary(comp)" class="component-summary">{{ componentSummary(comp) }}</span>
        </div>
      </div>
      <ul v-if="hasChildren && isExpanded" class="compact-tree-children">
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

// Component for JSON viewer
const JsonViewer = {
  name: 'JsonViewer',
  props: {
    data: { required: true },
    depth: { type: Number, default: 0 },
    expandAll: { type: Boolean, default: false }
  },
  setup(props) {
    const isExpanded = ref(props.expandAll || props.depth < 2);
    
    // Watch for expandAll changes
    watch(() => props.expandAll, (newVal) => {
      if (newVal) {
        isExpanded.value = true;
      }
    });
    
    const dataType = computed(() => {
      const d = props.data;
      if (d === null) return 'null';
      if (d === undefined) return 'undefined';
      if (Array.isArray(d)) return 'array';
      return typeof d;
    });
    
    const isExpandable = computed(() => {
      return dataType.value === 'object' || dataType.value === 'array';
    });
    
    const isEmpty = computed(() => {
      if (dataType.value === 'array') return props.data.length === 0;
      if (dataType.value === 'object') return Object.keys(props.data).length === 0;
      return false;
    });
    
    const toggle = () => {
      if (isExpandable.value) {
        isExpanded.value = !isExpanded.value;
      }
    };
    
    const formatValue = (value) => {
      if (value === null) return 'null';
      if (value === undefined) return 'undefined';
      if (typeof value === 'string') {
        // Check if it's a timestamp string
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          return `"${value}"`;
        }
        return `"${value}"`;
      }
      if (typeof value === 'boolean') return value.toString();
      if (typeof value === 'number') {
        // Check if it's likely a timestamp
        if (value > 1600000000000 && value < 2000000000000) {
          return `${value} (${new Date(value).toISOString()})`;
        }
        return value.toString();
      }
      // Handle empty containers
      if (Array.isArray(value) && value.length === 0) return '[]';
      if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) return '{}';
      return value;
    };
    
    const isElementRef = (obj) => {
      return obj && typeof obj === 'object' && 
             'elementId' in obj && 
             ('elementPath' in obj || 'elementType' in obj);
    };
    
    const formatElementRef = (ref) => {
      if (ref.elementPath?.length) {
        return ref.elementPath.join('/');
      }
      return ref.elementId;
    };
    
    // Check if a value is scalar or empty container (should be displayed inline)
    const isScalar = (value) => {
      if (value === null || value === undefined) return true;
      const type = typeof value;
      if (type === 'string' || type === 'number' || type === 'boolean') return true;
      
      // Include empty arrays and empty objects
      if (Array.isArray(value) && value.length === 0) return true;
      if (type === 'object' && value !== null && Object.keys(value).length === 0) return true;
      
      return false;
    };

    // Sort object keys for consistent display
    const sortedEntries = computed(() => {
      if (dataType.value !== 'object') return [];
      return Object.entries(props.data).sort(([a], [b]) => {
        // Put important keys first
        const priority = ['id', 'name', 'type', 'topic', 'timestamp'];
        const aIdx = priority.indexOf(a);
        const bIdx = priority.indexOf(b);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return a.localeCompare(b);
      });
    });
    
    return {
      isExpanded,
      dataType,
      isExpandable,
      isEmpty,
      toggle,
      formatValue,
      isElementRef,
      formatElementRef,
      isScalar,
      sortedEntries
    };
  },
  template: `
    <div class="json-viewer">
      <template v-if="!isExpandable">
        <span :class="'json-' + dataType">{{ formatValue(data) }}</span>
      </template>
      <template v-else-if="isElementRef(data)">
        <span class="json-element-ref">{{ formatElementRef(data) }}</span>
      </template>
      <template v-else>
        <span 
          class="json-toggle"
          @click="toggle"
          v-if="!isEmpty"
        >
          {{ isExpanded ? '▾' : '▸' }}
        </span>
        <span v-else class="json-toggle-spacer"></span>
        
        <span class="json-bracket">{{ dataType === 'array' ? '[' : '{' }}</span>
        <span v-if="!isExpanded && !isEmpty" class="json-ellipsis">...</span>
        <span v-if="isEmpty" class="json-empty">{{ dataType === 'array' ? '' : '' }}</span>
        <span v-if="!isExpanded || isEmpty" class="json-bracket">{{ dataType === 'array' ? ']' : '}' }}</span>
        
        <div v-if="isExpanded && !isEmpty" class="json-content">
          <template v-if="dataType === 'array'">
            <div v-for="(item, index) in data" :key="index" class="json-item json-array-item">
              <json-viewer :data="item" :depth="depth + 1" :expandAll="expandAll" />
            </div>
          </template>
          <template v-else>
            <div v-for="[key, value] in sortedEntries" :key="key" class="json-item">
              <span class="json-key">{{ key }}:</span>
              <template v-if="isScalar(value)">
                <span :class="'json-' + (value === null ? 'null' : 
                                       value === undefined ? 'undefined' : 
                                       Array.isArray(value) ? 'bracket' :
                                       typeof value === 'object' && value !== null ? 'bracket' :
                                       typeof value)">{{ formatValue(value) }}</span>
              </template>
              <template v-else>
                <json-viewer :data="value" :depth="depth + 1" :expandAll="expandAll" />
              </template>
            </div>
          </template>
        </div>
        <div v-if="isExpanded && !isEmpty" class="json-bracket-line">
          <span class="json-bracket">{{ dataType === 'array' ? ']' : '}' }}</span>
        </div>
      </template>
    </div>
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
    <li class="compact-facet-item">
      <div class="compact-facet-row" :style="{ paddingLeft: depth * 16 + 'px' }">
        <span class="tree-connector" v-if="depth > 0"></span>
        <button
          v-if="hasChildren"
          class="compact-toggle"
          @click.stop="toggle"
        >
          {{ isExpanded ? '▾' : '▸' }}
        </button>
        <span v-else class="compact-toggle-spacer"></span>
        <div class="compact-facet-info" @click="showFacetDetail">
          <span class="veil-facet-name">{{ facet.displayName || facet.name || facet.id }}</span>
          <span class="veil-facet-type">({{ facet.type }})</span>
          <span v-if="facet.content" class="veil-facet-content">{{ facet.content }}</span>
          <span v-if="facet.components?.length" class="veil-facet-comps">[{{ facet.components.length }}c]</span>
        </div>
      </div>
      <ul v-if="hasChildren && isExpanded" class="compact-facet-children">
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

const InlineFacetTree = {
  name: 'InlineFacetTree',
  props: {
    facet: { type: Object, required: true },
    depth: { type: Number, default: 0 }
  },
  setup(props, { emit }) {
    const showDetail = () => {
      emit('show-detail', {
        title: 'Facet Details',
        subtitle: `${props.facet.name || props.facet.id} (${props.facet.type})`,
        payload: props.facet
      });
    };

    const hasChildren = computed(() => props.facet.children?.length > 0);
    
    const formatValue = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    };

    return { 
      showDetail, 
      hasChildren, 
      formatValue,
      truncate: (value, max) => truncate(value, max),
      shorten: (value, max) => shorten(value, max) 
    };
  },
  template: `
    <div class="inline-tree-node">
      <div 
        class="inline-tree-row" 
        :style="{ paddingLeft: depth * 16 + 'px' }"
        @click="showDetail"
      >
        <span class="tree-connector" v-if="depth > 0"></span>
        <span class="inline-tree-name">{{ facet.name || facet.id || facet.type || 'facet' }}</span>
        <span class="inline-tree-type">({{ facet.type || 'unknown' }})</span>
        <span v-if="facet.content" class="inline-tree-content">{{ facet.content }}</span>
        <span v-if="facet.attributes" class="inline-tree-attrs-inline">
          <template v-for="(value, key, index) in facet.attributes" :key="key">
            <span v-if="index > 0" class="attr-separator">|</span>
            <span class="attr-key">{{ key }}:</span>
            <span class="attr-value">{{ formatValue(value) }}</span>
          </template>
        </span>
        <span v-if="facet.components?.length" class="inline-tree-components">[{{ facet.components.length }}c]</span>
      </div>
      <div v-if="hasChildren" class="inline-tree-children">
        <inline-facet-tree
          v-for="(child, idx) in facet.children"
          :key="child.id || idx"
          :facet="child"
          :depth="depth + 1"
          @show-detail="$emit('show-detail', $event)"
        />
      </div>
    </div>
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
      frameFacetsSequence: null,
      elementTree: null,
      selectedFrameId: null,
      filters: {
        search: ''
      },
      connectionStatus: 'connecting',
      debugLLMEnabled: false,
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
      inspectorWidth: 360,
      sidebarWidth: 320,
      framePanelHeight: 320,
      jsonExpandAll: false,
      veilViewMode: 'turns', // 'original' or 'turns'
      // Frame deletion dialog
      showDeleteDialog: false,
      deleteCount: 1,
      deleting: false,
      deleteError: null,
      // Manual LLM provider
      debugLLMRequests: [],
      selectedLLMRequestId: null,
      llmResponseDrafts: {},
      llmModelOverrides: {},
      llmSubmitting: false,
      llmSubmitError: null,
      panelCollapsed: {
        llm: false,
        timeline: false,
        frameDetail: false,
        elementTree: false,
        inspector: false
      }
    });

    const socketRef = ref(null);
    const reconnectTimer = ref(null);
    const refreshTimer = ref(null);
    const expandedElements = reactive({});
    const layoutRef = ref(null);
    const sidebarRef = ref(null);
    const isResizingInspector = ref(false);
    const isResizingSidebar = ref(false);
    const isResizingSidebarPanels = ref(false);
    const frameDetailCache = new Map();
    let frameLoadSequence = 0;
    let sidebarResizeState = { startX: 0, startWidth: 0 };
    let sidebarPanelResizeState = { startY: 0, startHeight: 0 };

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

    function applyDebugLLMRequests(requests) {
      if (!state.debugLLMEnabled) {
        state.debugLLMRequests = [];
        return;
      }
      if (!Array.isArray(requests)) return;
      const sorted = [...requests].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state.debugLLMRequests = sorted;
      ensureSelectedLLMRequest();
    }

    function applyDebugLLMRequest(request) {
      if (!state.debugLLMEnabled) return;
      if (!request || !request.id) return;
      const existingIndex = state.debugLLMRequests.findIndex(item => item.id === request.id);
      let next = [];
      if (existingIndex === -1) {
        next = [request, ...state.debugLLMRequests];
      } else {
        next = [...state.debugLLMRequests];
        next[existingIndex] = { ...next[existingIndex], ...request };
      }
      next.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      state.debugLLMRequests = next;
      if (request.status && request.status !== 'pending' && state.selectedLLMRequestId === request.id) {
        state.llmSubmitError = null;
      }
      ensureSelectedLLMRequest();
    }

    function ensureSelectedLLMRequest() {
      if (!state.debugLLMRequests.length) {
        state.selectedLLMRequestId = null;
        return;
      }
      if (state.selectedLLMRequestId) {
        const stillExists = state.debugLLMRequests.some(request => request.id === state.selectedLLMRequestId);
        if (stillExists) {
          return;
        }
      }
      const pending = state.debugLLMRequests.find(request => request.status === 'pending');
      const nextId = pending ? pending.id : state.debugLLMRequests[0]?.id || null;
      if (nextId) {
        selectLLMRequest(nextId);
      } else {
        state.selectedLLMRequestId = null;
      }
    }

    function selectLLMRequest(requestId) {
      state.selectedLLMRequestId = requestId;
      state.llmSubmitError = null;
      if (requestId && state.llmResponseDrafts[requestId] === undefined) {
        state.llmResponseDrafts[requestId] = '';
      }
    }

    function setDebugLLMEnabled(enabled) {
      if (state.debugLLMEnabled === enabled) {
        return;
      }
      state.debugLLMEnabled = enabled;
      if (!enabled) {
        state.debugLLMRequests = [];
        state.selectedLLMRequestId = null;
        state.llmResponseDrafts = {};
        state.llmModelOverrides = {};
        state.llmSubmitError = null;
        state.llmSubmitting = false;
      }
    }

    async function loadDebugLLMRequests() {
      if (!state.debugLLMEnabled) {
        state.debugLLMRequests = [];
        return;
      }
      try {
        const response = await fetch('/api/debug-llm/requests');
        if (!response.ok) throw new Error(`debug llm requests failed: ${response.status}`);
        const payload = await response.json();
        if (payload && payload.enabled === false) {
          setDebugLLMEnabled(false);
          return;
        }
        if (payload && payload.enabled === true && !state.debugLLMEnabled) {
          setDebugLLMEnabled(true);
        }
        applyDebugLLMRequests(payload.requests || []);
      } catch (err) {
        console.warn('Failed to load manual LLM requests', err);
      }
    }

    async function submitLLMResponse(requestId) {
      const targetId = requestId || state.selectedLLMRequestId;
      if (!targetId) return;
      const draft = state.llmResponseDrafts[targetId];
      if (!draft || !draft.trim()) {
        state.llmSubmitError = 'Response content is required.';
        return;
      }

      state.llmSubmitting = true;
      state.llmSubmitError = null;

      try {
        const payload = {
          content: draft.trim()
        };
        const overrideModel = state.llmModelOverrides[targetId];
        if (overrideModel && overrideModel.trim()) {
          payload.modelId = overrideModel.trim();
        }

        const response = await fetch(`/api/debug-llm/requests/${targetId}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || 'Failed to submit response');
        }

        if (result.request) {
          applyDebugLLMRequest(result.request);
        }

        delete state.llmResponseDrafts[targetId];
        delete state.llmModelOverrides[targetId];
        ensureSelectedLLMRequest();
      } catch (err) {
        state.llmSubmitError = err.message || 'Failed to submit response';
      } finally {
        state.llmSubmitting = false;
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
        state.frameFacetsSequence = null;
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
        if (typeof payload.manualLLMEnabled === 'boolean') {
          const wasEnabled = state.debugLLMEnabled;
          setDebugLLMEnabled(payload.manualLLMEnabled);
          if (payload.manualLLMEnabled && !wasEnabled) {
            await loadDebugLLMRequests();
          }
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
        debugLog('fetchFrameDetail raw payload', {
          uuid,
          payloadKeys: Object.keys(payload || {}),
          facetsSequence: payload.facetsSequence
        });

        const facetsTree = payload.facetsTree || [];
        frameDetailCache.set(uuid, {
          facetsTree,
          sequence: payload.facetsSequence ?? null
        });
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
          state.frameFacetsSequence = payload.facetsSequence ?? null;
          debugLog('fetchFrameDetail applied to state', {
            uuid,
            facetsCount: facetsTree.length,
            facets: facetsTree.map(f => ({
              id: f.id,
              type: f.type,
              displayName: f.displayName,
              content: f.content,
              children: f.children?.length || 0,
              facetsSequence: payload.facetsSequence
            })),
            facetsSequence: payload.facetsSequence
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
        state.frameFacetsSequence = null;
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
        state.frameFacetsSequence = cached.sequence ?? null;
        debugLog('setSelectedFrame using cached facets', {
          uuid,
          facetsCount: cached.facetsTree?.length || 0,
          facets: cached.facetsTree?.map(f => ({
            id: f.id,
            type: f.type,
            displayName: f.displayName,
            content: f.content,
            children: f.children?.length || 0,
            sequence: cached.sequence ?? null
          }))
        });
      } else {
        state.frameFacets = [];
        state.frameFacetsSequence = null;
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
      const tasks = [
        loadFrames({ reset: true }),
        loadSystemState()
      ];
      if (state.debugLLMEnabled) {
        tasks.push(loadDebugLLMRequests());
      }
      await Promise.all(tasks);
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
          const manualEnabled = Boolean(message.payload?.manualLLMEnabled);
          setDebugLLMEnabled(manualEnabled);
          if (manualEnabled) {
            applyDebugLLMRequests(message.payload?.debugLLMRequests || []);
          }
          (message.payload?.frames || []).forEach(upsertFrame);
          if (message.payload?.metrics) {
            state.metrics = {
              ...state.metrics,
              ...message.payload.metrics
            };
          }
          if (Array.isArray(message.payload?.debugLLMRequests)) {
            applyDebugLLMRequests(message.payload.debugLLMRequests);
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
        case 'frame-deletion': {
          // Handle frame deletion notification
          console.log('Frame deletion completed:', message.payload);
          if (message.payload?.deletedCount) {
            // Show a temporary notification
            const msg = `Deleted ${message.payload.deletedCount} frames, reverted to sequence ${message.payload.afterSequence}`;
            console.log(msg);
            // Refresh to get updated state
            refresh();
          }
          break;
        }
        case 'debugLLM:request-created':
        case 'debugLLM:request-updated': {
          applyDebugLLMRequest(message.payload);
          break;
        }
        case 'debugLLM:enabled': {
          const wasEnabled = state.debugLLMEnabled;
          const enabled = Boolean(message.payload?.enabled);
          setDebugLLMEnabled(enabled);
          if (enabled && !wasEnabled) {
            loadDebugLLMRequests();
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

    // Frame deletion methods
    function showDeleteDialog() {
      state.showDeleteDialog = true;
      state.deleteCount = 1;
      state.deleteError = null;
    }
    
    function closeDeleteDialog() {
      state.showDeleteDialog = false;
      state.deleteError = null;
    }
    
    const framesToDelete = computed(() => {
      if (!state.deleteCount || state.deleteCount <= 0) return [];
      // Frames are already sorted by sequence in descending order (highest first)
      // So we take the first N frames to delete the most recent ones
      const toDelete = state.frames.slice(0, state.deleteCount);
      console.log('[DebugUI] Frames to delete:', {
        deleteCount: state.deleteCount,
        totalFrames: state.frames.length,
        framesToDelete: toDelete.map(f => ({ sequence: f.sequence, kind: f.kind })),
        allFrameSequences: state.frames.map(f => f.sequence)
      });
      return toDelete;
    });
    
    async function confirmDelete() {
      if (!state.deleteCount || state.deleteCount > state.frames.length) return;
      
      state.deleting = true;
      state.deleteError = null;
      
      try {
        const response = await fetch('/api/frames/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ count: state.deleteCount })
        });
        
        const result = await response.json();
        
        if (!response.ok) {
          throw new Error(result.error || 'Failed to delete frames');
        }
        
        // Close dialog on success
        closeDeleteDialog();
        
        // Refresh the UI to show updated state
        await refresh();
        
        // Show success message in console
        console.log(`Successfully deleted ${result.deletedCount} frames`);
        if (result.warnings?.length > 0) {
          console.warn('Warnings:', result.warnings);
        }
        
      } catch (error) {
        state.deleteError = error.message || 'Frame deletion failed';
        console.error('Frame deletion error:', error);
      } finally {
        state.deleting = false;
      }
    }

    onMounted(async () => {
      await refresh();
      connectSocket();
      nextTick(() => {
        clampFramePanelHeight();
        window.addEventListener('resize', clampFramePanelHeight);
      });
      // Disabled auto-refresh - WebSocket provides real-time updates
      // refreshTimer.value = setInterval(refresh, 7000);
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
      window.removeEventListener('resize', clampFramePanelHeight);
      stopInspectorResize();
      stopSidebarResize();
      stopSidebarPanelResize();
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
    
    function toggleExpandAll() {
      state.jsonExpandAll = !state.jsonExpandAll;
    }
    
    function toggleVeilView() {
      state.veilViewMode = state.veilViewMode === 'original' ? 'turns' : 'original';
    }
    
    function copyToClipboard(data) {
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      navigator.clipboard.writeText(text).then(() => {
        console.log('Copied to clipboard');
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
    }
    
    function inspectVeilSnapshot() {
      if (!selectedFrame.value) return;
      state.activeDetail = {
        type: 'veil-snapshot',
        title: `VEIL Snapshot - Frame ${selectedFrame.value.sequence}`,
        data: {
          sequence: selectedFrame.value.facetsSequence,
          facets: state.frameFacets,
          totalFacets: state.frameFacets.length
        }
      };
    }
    
    function inspectFrame() {
      if (!selectedFrame.value) return;
      state.activeDetail = {
        type: 'frame',
        title: `Frame ${selectedFrame.value.sequence}`,
        data: selectedFrame.value
      };
    }
    
    function inspectElementTree() {
      if (!state.elementTree) return;
      state.activeDetail = {
        type: 'element-tree',
        title: 'Element Tree',
        data: state.elementTree
      };
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

    function startInspectorResize(event) {
      isResizingInspector.value = true;
      event.preventDefault();
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', onInspectorResize);
      window.addEventListener('mouseup', stopInspectorResize);
    }

    function onInspectorResize(event) {
      if (!isResizingInspector.value) return;
      const layout = layoutRef.value;
      if (!layout) return;
      const rect = layout.getBoundingClientRect();
      const minWidth = 260;
      const maxWidth = 600;
      const gap = 12; // matches CSS grid gap
      const handleWidth = 10;
      const rightEdge = rect.right;
      const newWidth = rightEdge - event.clientX - gap - handleWidth / 2;
      state.inspectorWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));
    }

    function stopInspectorResize() {
      if (!isResizingInspector.value) return;
      isResizingInspector.value = false;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onInspectorResize);
      window.removeEventListener('mouseup', stopInspectorResize);
    }

    function clampFramePanelHeight() {
      const sidebar = sidebarRef.value;
      if (!sidebar) return;
      const rect = sidebar.getBoundingClientRect();
      const minHeight = 180;
      const maxHeight = Math.max(minHeight, rect.height - 180);
      state.framePanelHeight = Math.max(minHeight, Math.min(maxHeight, state.framePanelHeight));
    }

    function startSidebarResize(event) {
      isResizingSidebar.value = true;
      event.preventDefault();
      document.body.style.cursor = 'col-resize';
      sidebarResizeState = {
        startX: event.clientX,
        startWidth: state.sidebarWidth
      };
      window.addEventListener('mousemove', onSidebarResize);
      window.addEventListener('mouseup', stopSidebarResize);
    }

    function onSidebarResize(event) {
      if (!isResizingSidebar.value) return;
      const delta = event.clientX - sidebarResizeState.startX;
      const minWidth = 220;
      const maxWidth = 520;
      const newWidth = sidebarResizeState.startWidth + delta;
      state.sidebarWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));
      clampFramePanelHeight();
    }

    function stopSidebarResize() {
      if (!isResizingSidebar.value) return;
      isResizingSidebar.value = false;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onSidebarResize);
      window.removeEventListener('mouseup', stopSidebarResize);
    }

    function startSidebarPanelResize(event) {
      const sidebar = sidebarRef.value;
      if (!sidebar) return;
      clampFramePanelHeight();
      isResizingSidebarPanels.value = true;
      event.preventDefault();
      document.body.style.cursor = 'row-resize';
      sidebarPanelResizeState = {
        startY: event.clientY,
        startHeight: state.framePanelHeight
      };
      window.addEventListener('mousemove', onSidebarPanelResize);
      window.addEventListener('mouseup', stopSidebarPanelResize);
    }

    function onSidebarPanelResize(event) {
      if (!isResizingSidebarPanels.value) return;
      const sidebar = sidebarRef.value;
      const rect = sidebar ? sidebar.getBoundingClientRect() : null;
      const delta = event.clientY - sidebarPanelResizeState.startY;
      const minHeight = 180;
      const rectLimit = rect ? rect.height - 180 : undefined;
      const maxHeight = rectLimit !== undefined ? Math.max(minHeight, rectLimit) : sidebarPanelResizeState.startHeight + delta;
      const newHeight = sidebarPanelResizeState.startHeight + delta;
      state.framePanelHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
    }

    function stopSidebarPanelResize() {
      if (!isResizingSidebarPanels.value) return;
      isResizingSidebarPanels.value = false;
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', onSidebarPanelResize);
      window.removeEventListener('mouseup', stopSidebarPanelResize);
    }

    const pendingLLMRequests = computed(() => {
      if (!state.debugLLMEnabled) return [];
      return state.debugLLMRequests.filter(request => request.status === 'pending');
    });

    const selectedLLMRequest = computed(() => {
      if (!state.debugLLMEnabled || !state.selectedLLMRequestId) return null;
      return state.debugLLMRequests.find(request => request.id === state.selectedLLMRequestId) || null;
    });

    function insertActionSnippet(snippet) {
      if (!snippet) return;
      const request = selectedLLMRequest.value;
      if (!request) return;
      const requestId = request.id;
      const current = state.llmResponseDrafts[requestId] ?? '';
      const needsLeadingNewline = current && !current.endsWith('\n') ? '\n' : '';
      const snippetText = snippet.endsWith('\n') ? snippet : `${snippet}\n`;
      state.llmResponseDrafts[requestId] = `${current}${needsLeadingNewline}${snippetText}`;
    }

    function onActionSelect(event) {
      const value = event?.target?.value;
      if (!value) return;
      insertActionSnippet(value);
      event.target.value = '';
    }

    function togglePanel(panel) {
      if (!state.panelCollapsed || !(panel in state.panelCollapsed)) {
        return;
      }
      state.panelCollapsed[panel] = !state.panelCollapsed[panel];
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

    // Group facets by conversational turns and reverse order
    const processedVeilFacets = computed(() => {
      if (!state.frameFacets || state.frameFacets.length === 0) {
        return { turns: [], reversed: [] };
      }

      // Reverse the order to show newest first
      const reversed = [...state.frameFacets].reverse();
      
      // Group facets by type to simulate conversational turns
      const turns = [];
      let currentTurn = null;
      const turnCounters = new Map(); // Track counters by turn type

      for (const facet of reversed) {
        const isAgentGenerated = facet.attributes?.agentGenerated === true;
        const facetType = facet.type;
        
        // Determine turn type
        let turnType;
        if (isAgentGenerated) {
          if (facetType === 'speech') {
            turnType = 'agent-speech';
          } else if (facetType === 'action') {
            turnType = 'agent-action';
          } else if (facetType === 'thought') {
            turnType = 'agent-thought';
          } else {
            turnType = 'agent-other';
          }
        } else {
          if (facetType === 'event') {
            turnType = 'external-event';
          } else if (facetType === 'state') {
            turnType = 'state-update';
          } else {
            turnType = 'external-other';
          }
        }

        // Create a new turn if type changes or if we don't have one
        if (!currentTurn || currentTurn.type !== turnType) {
          // Increment counter for this turn type
          const currentCount = turnCounters.get(turnType) || 0;
          turnCounters.set(turnType, currentCount + 1);
          
          currentTurn = {
            type: turnType,
            label: getTurnLabel(turnType, currentCount + 1),
            facets: []
          };
          turns.push(currentTurn);
        }

        currentTurn.facets.push(facet);
      }

      // Since we want newest first but highest numbers for newest,
      // we need to reverse the counter assignments
      const maxCounters = new Map();
      for (const [turnType, count] of turnCounters) {
        maxCounters.set(turnType, count);
      }
      
      // Re-assign labels with reversed numbering
      const reversedCounters = new Map();
      for (const turn of turns) {
        const maxCount = maxCounters.get(turn.type);
        const currentReversedCount = reversedCounters.get(turn.type) || 0;
        const reversedNumber = maxCount - currentReversedCount;
        reversedCounters.set(turn.type, currentReversedCount + 1);
        
        turn.label = getTurnLabel(turn.type, reversedNumber);
      }

      return { turns, reversed };
    });

    const availableActions = computed(() => {
      if (!state.frameFacets || state.frameFacets.length === 0) {
        return [];
      }
      const snippets = extractActionSnippets(state.frameFacets);
      if (!snippets.length) {
        return [];
      }
      const sorted = [...snippets].sort((a, b) => a.text.localeCompare(b.text));
      return sorted.slice(0, 30);
    });

    function getTurnLabel(turnType, counter) {
      switch (turnType) {
        case 'agent-speech': return `🗣️ Agent Turn ${counter}`;
        case 'agent-action': return `⚡ Agent Actions ${counter}`;
        case 'agent-thought': return `💭 Agent Thoughts ${counter}`;
        case 'agent-other': return `🤖 Agent Activity ${counter}`;
        case 'external-event': return `📨 External Events ${counter}`;
        case 'state-update': return `📊 State Changes ${counter}`;
        case 'external-other': return `🌐 External Activity ${counter}`;
        default: return `📝 Activity ${counter}`;
      }
    }

    const layoutStyle = computed(() => ({
      '--inspector-width': `${state.inspectorWidth}px`,
      '--sidebar-width': `${state.sidebarWidth}px`,
      '--frame-panel-height': `${state.framePanelHeight}px`
    }));

    return {
      state,
      filteredFrames,
      selectedFrame,
      selectedOperation,
      selectedEvent,
      timelineFrames,
      processedVeilFacets,
      availableActions,
      formatTime,
      formatTimestamp,
      shorten,
      truncate,
      formatComponents,
      formatChildren,
      summarizeFacet,
      summarizeOperation,
      summarizeEvent,
      operationMeta,
      eventMeta,
      stringify,
      selectFrame,
      selectOperation,
      selectEvent,
      selectLLMRequest,
      insertActionSnippet,
      onActionSelect,
      togglePanel,
      submitLLMResponse,
      closeDetail,
      toggleExpandAll,
      toggleVeilView,
      getTurnLabel,
      copyToClipboard,
      inspectVeilSnapshot,
      inspectFrame,
      inspectElementTree,
      expandedElements,
      toggleElement,
      handleTreeDetail,
      refresh,
      loadOlderFrames,
      layoutRef,
      sidebarRef,
      layoutStyle,
      pendingLLMRequests,
      selectedLLMRequest,
      startInspectorResize,
      startSidebarResize,
      startSidebarPanelResize,
      // Frame deletion
      showDeleteDialog,
      closeDeleteDialog,
      confirmDelete,
      framesToDelete
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
          <button class="button button--danger" @click="showDeleteDialog" :disabled="!state.frames.length">Delete Frames</button>
        </div>
      </header>
      <div class="error-banner" v-if="state.error">
        {{ state.error }}
      </div>
      <div class="layout" :style="layoutStyle" ref="layoutRef">
        <aside class="sidebar" ref="sidebarRef">
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
                :class="['frame-item', state.selectedFrameId === frame.uuid ? 'active' : '']"
                @click="selectFrame(frame.uuid)"
              >
                <span class="frame-seq">#{{ frame.sequence }}</span>
                <span class="frame-kind" :class="frame.kind">{{ frame.kind }}</span>
                <span class="frame-time">{{ formatTimestamp(frame.timestamp).split(' ')[1] }}</span>
                <span class="frame-stats">{{ frame.operations?.length || 0 }}op {{ frame.events?.length || 0 }}ev</span>
                <span v-if="frame.durationMs" class="frame-duration">{{ frame.durationMs.toFixed(0) }}ms</span>
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
          <div class="sidebar-splitter" @mousedown="startSidebarPanelResize"></div>
          <section class="panel veil-panel">
            <div class="panel-header">
              <h2>VEIL Snapshot</h2>
              <div class="header-badges">
                <span class="badge" v-if="state.frameFacetsSequence != null">seq {{ state.frameFacetsSequence }}</span>
                <span class="badge" v-else-if="state.frameFacets.length">{{ state.frameFacets.length }}</span>
                <button class="button button--small" @click="toggleVeilView" v-if="state.frameFacets.length" :title="state.veilViewMode === 'original' ? 'Switch to Turn View' : 'Switch to Original Order'">
                  {{ state.veilViewMode === 'original' ? '🔄' : '⏰' }}
                </button>
                <button class="button button--small" @click="inspectVeilSnapshot" v-if="state.frameFacets.length" title="Inspect full snapshot">
                  🔍
                </button>
              </div>
            </div>
            <div class="veil-tree" v-if="state.frameFacets.length">
              <template v-if="state.veilViewMode === 'original'">
                <facet-tree
                  :facets="state.frameFacets"
                  :expanded-depth="1"
                  @show-detail="handleTreeDetail"
                />
              </template>
              <template v-else>
                <div v-for="turn in processedVeilFacets.turns" :key="turn.type" class="veil-turn" :data-turn-type="turn.type">
                  <div class="turn-header">{{ turn.label }}</div>
                  <facet-tree
                    :facets="turn.facets"
                    :expanded-depth="1"
                    @show-detail="handleTreeDetail"
                  />
                </div>
              </template>
            </div>
            <div v-else class="text-muted">No active facets for this frame.</div>
          </section>
        </aside>
        <div class="splitter splitter-left" @mousedown="startSidebarResize"></div>
        <section class="content-area">
          <section
            class="panel llm-panel"
            v-if="state.debugLLMEnabled"
            :class="{ 'panel-collapsed': state.panelCollapsed.llm }"
          >
            <div class="panel-header">
              <div class="panel-header-title">
                <button
                  class="panel-toggle"
                  type="button"
                  :aria-expanded="!state.panelCollapsed.llm"
                  :title="state.panelCollapsed.llm ? 'Expand panel' : 'Collapse panel'"
                  @click="togglePanel('llm')"
                >
                  {{ state.panelCollapsed.llm ? '▸' : '▾' }}
                </button>
                <h2>Manual LLM Completions</h2>
              </div>
              <div class="panel-header-actions" v-if="pendingLLMRequests.length">
                <span class="badge">{{ pendingLLMRequests.length }} pending</span>
              </div>
            </div>
            <div class="llm-body" v-show="!state.panelCollapsed.llm">
              <div class="llm-request-list">
                <div
                  v-for="request in state.debugLLMRequests"
                  :key="request.id"
                  :class="['llm-request-item', { active: state.selectedLLMRequestId === request.id, resolved: request.status !== 'pending' }]"
                  @click="selectLLMRequest(request.id)"
                >
                  <div class="llm-request-header">
                    <span class="llm-request-id">{{ shorten(request.id, 10) }}</span>
                    <span class="llm-request-provider">{{ request.providerId || 'debug' }}</span>
                    <span class="llm-request-status" :class="request.status">{{ request.status }}</span>
                  </div>
                  <div class="llm-request-summary">
                    {{ truncate(request.messages?.[request.messages.length - 1]?.content || '—', 80) }}
                  </div>
                  <div class="llm-request-timestamp">{{ formatTimestamp(request.createdAt) }}</div>
                </div>
                <div v-if="!state.debugLLMRequests.length" class="llm-empty text-muted">
                  Awaiting LLM requests…
                </div>
              </div>
              <div class="llm-request-detail" v-if="selectedLLMRequest">
                <div class="llm-detail-header">
                  <div class="detail-meta">
                    <span>Request {{ shorten(selectedLLMRequest.id, 12) }}</span>
                    <span v-if="selectedLLMRequest.metadata?.description">· {{ selectedLLMRequest.metadata.description }}</span>
                    <span>· {{ formatTimestamp(selectedLLMRequest.createdAt) }}</span>
                    <span v-if="selectedLLMRequest.completedAt">· Completed {{ formatTimestamp(selectedLLMRequest.completedAt) }}</span>
                  </div>
                  <div class="detail-status" :class="selectedLLMRequest.status">{{ selectedLLMRequest.status }}</div>
                </div>
                <div class="llm-context">
                  <div
                    v-for="(msg, idx) in selectedLLMRequest.messages"
                    :key="idx"
                    class="message-card"
                  >
                    <div class="role">{{ msg.role }}</div>
                    <pre>{{ msg.content }}</pre>
                  </div>
                </div>
                <div v-if="selectedLLMRequest.status === 'pending'" class="llm-response-editor">
                  <div class="llm-action-bar" v-if="availableActions.length">
                    <label
                      class="llm-action-label"
                      :for="'llm-actions-' + selectedLLMRequest.id"
                    >
                      Registered Actions
                    </label>
                    <select
                      class="llm-action-select"
                      :id="'llm-actions-' + selectedLLMRequest.id"
                      @change="onActionSelect"
                    >
                      <option value="">Insert action…</option>
                      <option
                        v-for="action in availableActions"
                        :key="action.text"
                        :value="action.text"
                        :title="action.source ? 'Facet: ' + action.source : 'Insert action snippet'"
                      >
                        {{ action.text }}
                      </option>
                    </select>
                  </div>
                  <textarea
                    class="llm-textarea"
                    v-model="state.llmResponseDrafts[selectedLLMRequest.id]"
                    placeholder="Type the assistant response…"
                    rows="6"
                  ></textarea>
                  <div class="llm-response-controls">
                    <input
                      class="input"
                      type="text"
                      placeholder="Model override (optional)"
                      v-model="state.llmModelOverrides[selectedLLMRequest.id]"
                    />
                    <button
                      class="button"
                      :disabled="state.llmSubmitting"
                      @click="submitLLMResponse(selectedLLMRequest.id)"
                    >
                      {{ state.llmSubmitting ? 'Submitting…' : 'Send Response' }}
                    </button>
                  </div>
                  <div class="error-message" v-if="state.llmSubmitError">{{ state.llmSubmitError }}</div>
                </div>
                <div v-else class="llm-response-view">
                  <h3>Submitted Response</h3>
                  <pre>{{ selectedLLMRequest.response?.content || '—' }}</pre>
                  <div class="llm-response-meta" v-if="selectedLLMRequest.response?.modelId || selectedLLMRequest.response?.tokensUsed">
                    <span v-if="selectedLLMRequest.response?.modelId">Model: {{ selectedLLMRequest.response.modelId }}</span>
                    <span v-if="selectedLLMRequest.response?.tokensUsed">Tokens: {{ selectedLLMRequest.response.tokensUsed }}</span>
                  </div>
                </div>
              </div>
              <div class="llm-request-detail llm-request-placeholder" v-else>
                <div class="text-muted">Select a request to inspect the prompt and provide a response.</div>
              </div>
            </div>
          </section>
          <section
            class="panel timeline-panel"
            v-if="timelineFrames.length"
            :class="{ 'panel-collapsed': state.panelCollapsed.timeline }"
          >
            <div class="panel-header">
              <div class="panel-header-title">
                <button
                  class="panel-toggle"
                  type="button"
                  :aria-expanded="!state.panelCollapsed.timeline"
                  :title="state.panelCollapsed.timeline ? 'Expand panel' : 'Collapse panel'"
                  @click="togglePanel('timeline')"
                >
                  {{ state.panelCollapsed.timeline ? '▸' : '▾' }}
                </button>
                <h2>Frame Timeline</h2>
              </div>
              <div class="panel-header-actions">
                <span class="badge">Newest {{ timelineFrames.length }}</span>
              </div>
            </div>
            <div class="timeline-body" v-show="!state.panelCollapsed.timeline">
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
          <section
            class="panel frame-detail"
            :class="{ 'panel-collapsed': state.panelCollapsed.frameDetail }"
          >
            <div class="panel-header frame-header">
              <div class="panel-header-title">
                <button
                  class="panel-toggle"
                  type="button"
                  :aria-expanded="!state.panelCollapsed.frameDetail"
                  :title="state.panelCollapsed.frameDetail ? 'Expand panel' : 'Collapse panel'"
                  @click="togglePanel('frameDetail')"
                >
                  {{ state.panelCollapsed.frameDetail ? '▸' : '▾' }}
                </button>
                <h2 v-if="selectedFrame">Frame {{ selectedFrame.sequence }}</h2>
                <h2 v-else>Frame Details</h2>
              </div>
              <div class="panel-header-actions frame-header-actions">
                <button
                  class="button button--small"
                  v-if="selectedFrame"
                  @click="inspectFrame"
                  title="Inspect full frame"
                >
                  🔍
                </button>
                <div class="frame-meta" v-if="selectedFrame">
                  <span class="meta-pill">UUID: {{ shorten(selectedFrame.uuid, 18) }}</span>
                  <span class="meta-pill">{{ formatTimestamp(selectedFrame.timestamp) }}</span>
                  <span class="meta-pill kind" :class="selectedFrame.kind">{{ selectedFrame.kind }}</span>
                  <span class="meta-pill" v-if="state.frameFacetsSequence != null">VEIL seq {{ state.frameFacetsSequence }}</span>
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
            </div>
            <div class="frame-detail-body" v-show="!state.panelCollapsed.frameDetail">
              <template v-if="selectedFrame">
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
                      <div style="padding: 8px;">
                        <json-viewer :data="selectedFrame.renderedContext.metadata" :expandAll="state.jsonExpandAll" />
                      </div>
                    </div>
                  </div>
                </div>
                <div class="section" v-if="selectedFrame.renderedContext">
                  <h3>LLM Request JSON</h3>
                  <div class="section-body">
                    <json-viewer :data="selectedFrame.renderedContext" :expandAll="state.jsonExpandAll" />
                  </div>
                </div>
                <div class="section">
                  <h3>Operations</h3>
                  <div class="log-viewer operations">
                    <div v-if="!selectedFrame.operations?.length" class="text-muted">No operations.</div>
                    <template v-for="(op, idx) in selectedFrame.operations" :key="idx">
                      <div v-if="op.type === 'addFacet' && op.facet" class="log-entry facet-entry">
                        <div class="facet-header" @click="selectOperation(op, idx)">
                          <span class="log-type">{{ op.type }}</span>
                          <span class="log-meta" v-if="operationMeta(op)">{{ operationMeta(op) }}</span>
                        </div>
                        <inline-facet-tree
                          :facet="op.facet"
                          :depth="0"
                          @show-detail="handleTreeDetail"
                        />
                      </div>
                      <div v-else class="log-entry" @click="selectOperation(op, idx)">
                        <span class="log-type">{{ op.type }}</span>
                        <span class="log-content">
                          <template v-if="op.type === 'speak'">
                            <span class="log-speak">{{ truncate(op.content, 120) }}</span>
                            <span class="log-meta" v-if="op.target"> → {{ op.target }}</span>
                          </template>
                          <template v-else-if="op.type === 'changeState'">
                            <span v-if="op.updates?.content" class="log-state">content: {{ truncate(op.updates.content, 80) }}</span>
                            <span v-else-if="op.updates?.attributes" class="log-state">
                              {{ Object.keys(op.updates.attributes).join(', ') }}
                            </span>
                          </template>
                          <template v-else-if="op.type === 'action'">
                            <span class="log-action">{{ (op.path || []).join('.') }}</span>
                          </template>
                          <template v-else>
                            <span class="log-raw">{{ truncate(stringify(op), 100) }}</span>
                          </template>
                        </span>
                        <span class="log-meta" v-if="operationMeta(op)">{{ operationMeta(op) }}</span>
                      </div>
                    </template>
                  </div>
                </div>
                <div class="section">
                  <h3>Events</h3>
                  <div class="log-viewer events">
                    <div v-if="!selectedFrame.events?.length" class="text-muted">No events observed for this frame.</div>
                    <div
                      v-for="(event, idx) in selectedFrame.events"
                      :key="event.id || idx"
                      class="log-entry"
                      @click="selectEvent(event, idx)"
                    >
                      <span class="log-timestamp">{{ formatTimestamp(event.timestamp).split(' ')[1] }}</span>
                      <span class="log-type">{{ event.topic }}</span>
                      <span class="log-content">
                        <span v-if="event.phase && event.phase !== 'none'" class="log-phase">[{{ event.phase }}]</span>
                        <span v-if="event.target" class="log-target">{{ event.target.elementPath?.join('/') || event.target.elementId }}</span>
                        <span v-if="event.payload" class="log-payload">{{ truncate(stringify(event.payload), 80) }}</span>
                      </span>
                      <span class="log-meta" v-if="eventMeta(event)">{{ eventMeta(event) }}</span>
                    </div>
                  </div>
                </div>
              </template>
              <div v-else class="section-body text-muted">
                Select a frame from the left to inspect operations and rendered context.
              </div>
            </div>
          </section>
          <section
            class="panel element-tree"
            :class="{ 'panel-collapsed': state.panelCollapsed.elementTree }"
          >
            <div class="panel-header">
              <div class="panel-header-title">
                <button
                  class="panel-toggle"
                  type="button"
                  :aria-expanded="!state.panelCollapsed.elementTree"
                  :title="state.panelCollapsed.elementTree ? 'Expand panel' : 'Collapse panel'"
                  @click="togglePanel('elementTree')"
                >
                  {{ state.panelCollapsed.elementTree ? '▸' : '▾' }}
                </button>
                <h2>Element Tree</h2>
              </div>
              <div class="panel-header-actions" v-if="state.elementTree">
                <button class="button button--small" @click="inspectElementTree" title="Inspect full tree">
                  🔍
                </button>
              </div>
            </div>
            <div class="element-tree-body" v-show="!state.panelCollapsed.elementTree">
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
            </div>
          </section>
        </section>
        <div class="splitter splitter-right" @mousedown="startInspectorResize"></div>
        <aside class="inspector" :class="{ 'inspector-visible': state.activeDetail }">
          <section
            class="panel inspector-panel"
            :class="{ 'panel-collapsed': state.panelCollapsed.inspector }"
          >
            <div class="panel-header inspector-header">
              <div class="panel-header-title">
                <button
                  class="panel-toggle"
                  type="button"
                  :aria-expanded="!state.panelCollapsed.inspector"
                  :title="state.panelCollapsed.inspector ? 'Expand panel' : 'Collapse panel'"
                  @click="togglePanel('inspector')"
                >
                  {{ state.panelCollapsed.inspector ? '▸' : '▾' }}
                </button>
                <h2>Inspector</h2>
              </div>
              <div class="panel-header-actions header-actions" v-if="state.activeDetail">
                <button class="button button--small" @click="toggleExpandAll" :title="state.jsonExpandAll ? 'Collapse All' : 'Expand All'">
                  {{ state.jsonExpandAll ? '📁' : '📂' }} {{ state.jsonExpandAll ? 'Collapse' : 'Expand' }}
                </button>
                <button class="button button--small" @click="copyToClipboard(state.activeDetail.payload ?? state.activeDetail)" title="Copy to clipboard">
                  📋 Copy
                </button>
                <button class="button" @click="closeDetail">Close</button>
              </div>
            </div>
            <div class="inspector-content" v-show="!state.panelCollapsed.inspector">
              <div v-if="state.activeDetail" class="inspector-body">
                <div class="inspector-title">{{ state.activeDetail.title }}</div>
                <div v-if="state.activeDetail.subtitle" class="inspector-subtitle">{{ state.activeDetail.subtitle }}</div>
                <div class="inspector-json">
                  <json-viewer :data="state.activeDetail.payload ?? state.activeDetail" :expandAll="state.jsonExpandAll" />
                </div>
              </div>
              <div v-else class="inspector-placeholder">
                Select an operation, event, or element to inspect.
              </div>
            </div>
          </section>
        </aside>
      </div>
      
      <!-- Frame Deletion Dialog -->
      <div class="modal-overlay" v-if="state.showDeleteDialog" @click="closeDeleteDialog">
        <div class="modal" @click.stop>
          <div class="modal-header">
            <h2>Delete Recent Frames</h2>
            <button class="close-button" @click="closeDeleteDialog">&times;</button>
          </div>
          <div class="modal-body">
            <p class="warning">
              <strong>⚠️ Warning:</strong> This will delete recent frames and revert the agent state. 
              Fork-invariant components will be preserved, but stateful components will be reinitialized.
            </p>
            
            <div class="form-group">
              <label>Number of frames to delete:</label>
              <input 
                type="number" 
                v-model.number="state.deleteCount" 
                min="1" 
                :max="state.frames.length"
                class="input"
              />
              <small>Total frames available: {{ state.frames.length }}</small>
            </div>
            
            <div v-if="state.deleteCount > 0 && state.deleteCount <= state.frames.length" class="frame-preview">
              <h3>Frames to be deleted:</h3>
              <ul class="frame-list">
                <li v-for="frame in framesToDelete" :key="frame.uuid">
                  Seq {{ frame.sequence }} - {{ frame.kind }} 
                  <span class="timestamp">{{ formatTime(frame.timestamp) }}</span>
                </li>
              </ul>
            </div>
            
            <div v-if="state.deleteError" class="error-message">
              {{ state.deleteError }}
            </div>
          </div>
          <div class="modal-footer">
            <button class="button" @click="closeDeleteDialog">Cancel</button>
            <button 
              class="button button--danger" 
              @click="confirmDelete"
              :disabled="!state.deleteCount || state.deleteCount > state.frames.length || state.deleting"
            >
              {{ state.deleting ? 'Deleting...' : 'Delete Frames' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `
};

const app = createApp(App);
app.component('element-tree', ElementTree);
app.component('facet-tree', FacetTree);
app.component('facet-node', FacetNode);
app.component('inline-facet-tree', InlineFacetTree);
app.component('json-viewer', JsonViewer);
app.mount('#app');
