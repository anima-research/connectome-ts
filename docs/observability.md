# Observability System

The Connectome Lite system includes a comprehensive observability and tracing system that captures all internal operations, including full LLM request/response logs.

## Overview

The observability system provides:
- **File-based persistence** of all traces
- **Full LLM interaction capture** including requests, responses, and errors
- **Structured logging** with categories, components, and operations
- **Multiple export formats** (JSON, CSV, Markdown)
- **Automatic log rotation** to manage disk space

## Configuration

### Enabling Tracing

By default, tracing is enabled with file persistence. To disable:
```bash
ENABLE_TRACING=false npm run test:console
```

### Trace Storage Location

Traces are stored in the `./traces` directory as JSON Lines (`.jsonl`) files. Each line is a separate JSON object representing a trace event.

### Configuration Options

```typescript
createDefaultTracer({
  type: 'file',
  fileConfig: {
    directory: './traces',           // Where to store trace files
    maxFileSize: 50 * 1024 * 1024,  // 50MB per file
    rotationPolicy: 'size',          // Rotate based on file size
    keepFiles: 5                     // Keep last 5 files
  }
});
```

## Trace Categories

The system uses structured categories to organize traces:

### Event System
- `event.emit` - Event emission
- `event.receive` - Event reception
- `event.queue` - Event queuing

### Frame Processing
- `frame.start` - Frame processing start
- `frame.end` - Frame processing end
- `frame.operation` - Individual frame operations

### Agent Operations
- `agent.activation` - Agent activation decisions
- `agent.context_build` - Context building for LLM
- `agent.llm_call` - LLM API calls
- `agent.response_parse` - Response parsing

### LLM Interactions
- `llm.request` - Full LLM request details
- `llm.response` - Full LLM response details  
- `llm.error` - LLM errors
- `llm.token_usage` - Token usage tracking

### Adapter Operations
- `adapter.input` - External input (console, Discord, etc.)
- `adapter.output` - External output

## LLM Request/Response Capture

The system captures comprehensive LLM interaction data:

### Request Traces
```json
{
  "id": "llm-request-1234567890",
  "category": "llm.request",
  "component": "AnthropicProvider",
  "data": {
    "model": "claude-3-5-sonnet-20241022",
    "maxTokens": 200,
    "temperature": 1.0,
    "stopSequences": ["</my_turn>"],
    "messageCount": 2,
    "messages": [
      {
        "role": "system",
        "contentLength": 81,
        "contentPreview": "You're chatting through a console...",
        "metadata": {}
      }
    ]
  }
}
```

### Response Traces
```json
{
  "id": "llm-response-1234567890",
  "category": "llm.response",
  "component": "AnthropicProvider",
  "data": {
    "model": "claude-3-5-sonnet-20241022",
    "contentLength": 150,
    "contentPreview": "Hello! I can help you with...",
    "inputTokens": 100,
    "outputTokens": 50,
    "totalTokens": 150,
    "stopReason": "stop_sequence",
    "stopSequence": "</my_turn>"
  }
}
```

## Viewing Traces

### Real-time Console Output
Important traces are logged to the console in real-time with color coding:
- 🔴 Red: Errors
- 🟡 Yellow: Warnings
- 🔵 Cyan: Info
- ⚪ Gray: Debug

### Trace Files
Trace files are stored as JSON Lines format in `./traces/`:
```bash
# View latest trace file
tail -f traces/trace-*.jsonl | jq .

# Search for LLM interactions
grep "llm\." traces/trace-*.jsonl | jq .

# Filter by component
jq 'select(.component == "BasicAgent")' traces/trace-*.jsonl
```

### Export Formats

The system supports exporting traces in multiple formats:

```typescript
// Export as JSON
const json = tracer.export('json');

// Export as CSV
const csv = tracer.export('csv');

// Export as Markdown
const markdown = tracer.export('markdown');
```

## Example Analysis Queries

### Find All LLM Requests
```bash
jq 'select(.category | startswith("llm."))' traces/trace-*.jsonl
```

### Calculate Token Usage
```bash
jq 'select(.category == "llm.response") | .data.totalTokens' traces/trace-*.jsonl | jq -s add
```

### Find Errors
```bash
jq 'select(.level == "error")' traces/trace-*.jsonl
```

### Trace Agent Decision Making
```bash
jq 'select(.component == "BasicAgent")' traces/trace-*.jsonl | jq -s
```

## Integration with External Tools

The JSON Lines format makes it easy to integrate with log analysis tools:
- **Elasticsearch/Kibana** - Import as JSON documents
- **Splunk** - Use the JSON source type
- **DataDog** - Stream logs via their API
- **Custom Analysis** - Process with any JSON-capable tool

## Performance Considerations

- Traces are written asynchronously to minimize impact
- File rotation prevents unbounded disk usage
- Console logging can be disabled for production
- The system automatically manages file handles

## Privacy and Security

When using external LLM providers:
- Full message content is logged (configurable)
- API keys are never logged
- Consider data retention policies
- Use `ENABLE_TRACING=false` for sensitive conversations

## Future Enhancements

Planned improvements:
- Trace sampling for high-volume scenarios
- Remote trace collection endpoints
- Built-in trace analysis tools
- Grafana dashboard templates
- OpenTelemetry compatibility
