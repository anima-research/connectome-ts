# Reconciliation: VEIL Frames to Rendered Output

This document maps each line of rendered output back to its VEIL source.

## Mapping

### System Prompt
- **Source**: Hardcoded in HUD, not from VEIL
- **Content**: "You are the captain of a deep space exploration vessel..."

### User Message  
- **Source**: Hardcoded in HUD, not from VEIL
- **Content**: `<cmd>status --full</cmd>`

### Assistant Message

1. **Active Channels Display**
   - **Source**: Frame 1, `addStream` operation + `addFacet` for "available-channels" state
   - **Content**: "Active channels: Bridge"

2. **Ship Status**
   - **Source**: Frame 1, `addFacet` operation, facet "ship-status-001" (State)
   - **Rendered as**: `<ship_status>` block

3. **Sensor Alert**
   - **Source**: Frame 2, `addFacet` operation, facet "sensor-event-001" (Event)
   - **Rendered as**: `<sensor_alert>` with source attribute

4. **Scan Results**
   - **Source**: Frame 3, `addFacet` operation, facet "scan-results-001" (State)
   - **Rendered as**: `<scan_results>` block

5. **First Agent Turn**
   - **Source**: Frame 4, outgoing frame
   - **Natural dialogue**: `speak` operations
     - "Interesting. That energy signature wasn't there..."
     - "Lieutenant Rodriguez, can you get me more details..."
     - "Commander Chen, maintain our current orbit..."
   - **Tool call**: `toolCall` operation for "perform_deep_scan"

6. **Deep Scan Analysis**
   - **Source**: Frame 5, `addFacet` operation, facet "deep-scan-001" (State)
   - **Rendered as**: `<deep_scan_analysis>` block

7. **Crew Report**
   - **Source**: Frame 6, `addFacet` operation, facet "crew-report-001" (Event)
   - **Rendered as**: `<crew_report>` with source attribute

8. **Second Agent Turn**
   - **Source**: Frame 7, outgoing frame
   - **Natural dialogue**: `speak` operations
     - "All stop. Lt. Rodriguez, record everything..."
     - "And open a ship-wide channel."
   - **Tool calls**: `toolCall` operations for "analyze_transmission" and "ship_comms"

9. **Transmission Analysis**
   - **Source**: Frame 8, `addFacet` operation, facet "transmission-analysis-001" (State)
   - **Rendered as**: `<transmission_analysis>` block

10. **Ship Communications**
    - **Source**: Frame 8, `addFacet` operation, facet "ship-comms-status" (State)
    - **Rendered as**: `<ship_communications>` block

11. **Crew Activity**
    - **Source**: Frame 8, `addFacet` operation, facet "crew-activity-container" (State with children)
    - **Rendered as**: `<crew_activity>` with nested events

12. **Third Agent Turn**
    - **Source**: Frame 9, outgoing frame
    - **Inner thoughts**: `innerThoughts` operation
    - **Natural dialogue**: `speak` operation
      - "Dr. Tanaka, good timing. Look at this pattern..."
    - **Tool call**: `toolCall` operation for "request_cycle"

13. **Fourth Agent Turn (Log Decision)**
    - **Source**: Frame 9.5, outgoing frame
    - **Inner thoughts**: `innerThoughts` operation
    - **Tool call**: `toolCall` operation for "open_personal_log"

14. **Updated Channels Display**
    - **Source**: Frame 9.6, `changeState` operation on "available-channels"
    - **Content**: "Active channels: Bridge, Captain's Log"

15. **Log Entry**
    - **Source**: Frame 9.7, outgoing frame
    - **Log entry**: `speak` operation with explicit target "starship:captain-log"
    - **Rendered as**: `<log_entry>` with channel attribute

## Key Insights

1. **Every rendered element has a VEIL source** - Including agent dialogue via `speak` operations
2. **Facet types determine rendering style**:
   - Events → Tagged blocks with source
   - States → Status/info blocks
   - Ambient → Context blocks (not shown in this example)
   - Tools → Not rendered (used by HUD internally)
3. **Agent output uses four operation types**:
   - `speak` → Natural dialogue text
   - `toolCall` → `<tool_call>` blocks
   - `innerThoughts` → `<inner_thoughts>` blocks  
   - `cycleRequest` → System tool calls
4. **Focus determines default routing** - Unless `speak` has explicit target
5. **Streams are explicitly managed** - Via `addStream`/`updateStream` operations

## Rendering Rules Applied

1. States with `displayName` use it as the XML tag name
2. Events include source in attributes when available
3. Children facets are rendered nested within parent
4. Tool definitions are stored but not rendered
5. Agent's `speak` operations appear as natural text
6. Explicit targets on `speak` operations create special rendering (e.g., `<log_entry>`)