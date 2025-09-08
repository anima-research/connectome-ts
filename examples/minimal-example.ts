// Minimal example showing VEIL frames and their rendered output
// This demonstrates the core concepts without the complexity of the full scenario

import { IncomingVEILFrame, OutgoingVEILFrame } from '../src/veil/types';

// Simple chat interaction with tool usage
export const minimalExample = {
  // VEIL Frames
  frames: [
    // Frame 1: Set up initial state
    {
      sequence: 1,
      timestamp: "2024-01-15T10:00:00Z",
      focus: "chat:main", // Default chat channel
      operations: [
        {
          type: "addFacet",
          facet: {
            id: "user-info",
            type: "state",
            content: "Current user: Alice",
            attributes: { role: "developer" }
          }
        },
        {
          type: "addFacet",
          facet: {
            id: "search-tool",
            type: "tool",
            definition: {
              name: "search_codebase",
              parameters: ["query", "file_type"],
              callback: "SearchElement.handle"
            }
          }
        }
      ]
    } as IncomingVEILFrame,

    // Frame 2: User asks a question
    {
      sequence: 2,
      timestamp: "2024-01-15T10:00:05Z", 
      operations: [
        {
          type: "addFacet",
          facet: {
            id: "user-message-001",
            type: "event",
            content: "Where is the authentication logic implemented?",
            attributes: { sender: "Alice" }
          }
        },
        {
          type: "agentActivation"
        }
      ]
    } as IncomingVEILFrame,

    // Frame 3: Agent responds
    {
      sequence: 3,
      timestamp: "2024-01-15T10:00:10Z",
      operations: [
        {
          type: "innerThoughts",
          content: "User is asking about authentication. I should search for auth-related files."
        },
        {
          type: "speak",
          content: "Let me search the codebase for authentication-related files."
        },
        {
          type: "toolCall",
          toolName: "search_codebase",
          parameters: {
            query: "authentication login",
            file_type: "typescript"
          }
        }
      ]
    } as OutgoingVEILFrame,

    // Frame 4: Tool results
    {
      sequence: 4,
      timestamp: "2024-01-15T10:00:12Z",
      operations: [
        {
          type: "addFacet",
          facet: {
            id: "search-results",
            type: "event",
            content: "Found 3 matches:\n- src/auth/login.ts\n- src/auth/middleware.ts\n- src/services/auth-service.ts"
          }
        },
        {
          type: "agentActivation"
        }
      ]
    } as IncomingVEILFrame,

    // Frame 5: Agent provides answer
    {
      sequence: 5,
      timestamp: "2024-01-15T10:00:15Z",
      operations: [
        {
          type: "innerThoughts", 
          content: "Found the auth files. The main logic seems to be split between login handling and middleware."
        },
        {
          type: "speak",
          content: "Based on the search results, the authentication logic is implemented across several files:\n\n1. **src/auth/login.ts** - Handles the login flow and user credential verification\n2. **src/auth/middleware.ts** - Contains middleware for protecting routes and validating sessions\n3. **src/services/auth-service.ts** - Core authentication service with business logic\n\nThe main authentication logic appears to be in the auth service, with the login flow handled separately and middleware for route protection."
        }
      ]
    } as OutgoingVEILFrame
  ],

  // Rendered Output
  rendered: `
<system>
You are a helpful development assistant with access to the codebase.
</system>

<user>
<cmd>assistant --help</cmd>
</user>

<assistant>
<!-- Frame 1: Initial state -->
<user_info role="developer">
Current user: Alice
</user_info>

<!-- Frame 2: User message -->
<message sender="Alice">
Where is the authentication logic implemented?
</message>

<!-- Frame 2: Agent activation -->
<my_turn>
<!-- Frame 3: Inner thoughts -->
<inner_thoughts>
User is asking about authentication. I should search for auth-related files.
</inner_thoughts>

<!-- Frame 3: Speak operation -->
Let me search the codebase for authentication-related files.

<!-- Frame 3: Tool call -->
<tool_call name="search_codebase">
<query>authentication login</query>
<file_type>typescript</file_type>
</tool_call>
</my_turn>

<!-- Frame 4: Search results -->
<search_results>
Found 3 matches:
- src/auth/login.ts
- src/auth/middleware.ts  
- src/services/auth-service.ts
</search_results>

<!-- Frame 4: Agent activation -->
<my_turn>
<!-- Frame 5: Inner thoughts -->
<inner_thoughts>
Found the auth files. The main logic seems to be split between login handling and middleware.
</inner_thoughts>

<!-- Frame 5: Speak operation -->
Based on the search results, the authentication logic is implemented across several files:

1. **src/auth/login.ts** - Handles the login flow and user credential verification
2. **src/auth/middleware.ts** - Contains middleware for protecting routes and validating sessions
3. **src/services/auth-service.ts** - Core authentication service with business logic

The main authentication logic appears to be in the auth service, with the login flow handled separately and middleware for route protection.
</my_turn>
</assistant>
`
};
