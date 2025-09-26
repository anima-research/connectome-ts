import { InteractiveComponent } from './base-components';
import { persistable, persistent, Serializers } from '../persistence/decorators';
import { SpaceEvent } from '../spaces/types';

/**
 * Simple note structure for shared knowledge
 */
interface Note {
  id: string;
  content: string;  // Includes author attribution in text
  created: string;
  tags?: string[];
}

/**
 * SpaceNotesComponent - Notes within a Space
 * 
 * For agents to accumulate knowledge in their shared Space.
 * Notes exist within the Space boundaries - visible to all agents there,
 * not broadcast beyond. Attribution by including author in note text.
 * 
 * Example usage by Haiku (monitoring agent):
 * @notes.add({ content: "User asked about weather at 3pm. Responded with no data available. -Haiku" })
 * 
 * Example usage by Opus (main agent):
 * @notes.add({ content: "Philosophical discussion about consciousness. User struggling with mortality. -Opus" })
 */
@persistable(1)
export class SpaceNotesComponent extends InteractiveComponent {
  @persistent({ serializer: Serializers.map<Note>() }) private notes: Map<string, Note> = new Map();
  @persistent({ serializer: Serializers.set<string>() }) private openNotes: Set<string> = new Set(); // Currently open in context
  
  onMount(): void {
    
    // Core operations
    this.registerAction('add', this.addNote.bind(this));
    this.registerAction('search', this.searchNotes.bind(this));
    this.registerAction('browse', this.browseNotes.bind(this));
    this.registerAction('read', this.readNote.bind(this));
    this.registerAction('close', this.closeNote.bind(this));
    this.registerAction('clear', this.clearContext.bind(this));
    
    // Subscribe to frame events to emit actions
    this.element.subscribe('frame:start');
  }
  
  private actionsEmitted = false;
  
  /**
   * Add a note to shared knowledge
   * Supports multiple syntaxes:
   * - @notes.add("content")                    → single string
   * - @notes.add("content", "tag1", "tag2")    → content + tags as positional
   * - @notes.add({ content: "...", tags: [...] }) → object format (legacy)
   */
  private async addNote(params: any): Promise<void> {
    // Safety check - should never happen now that restoration is fixed
    if (!(this.notes instanceof Map)) {
      console.error('[SpaceNotes] CRITICAL: notes is not a Map! Attempting recovery...');
      const oldNotes = this.notes as any;
      this.notes = new Map();
      
      if (Array.isArray(oldNotes)) {
        for (const [key, value] of oldNotes) {
          this.notes.set(key, value);
        }
      } else if (oldNotes && typeof oldNotes === 'object') {
        for (const [key, value] of Object.entries(oldNotes)) {
          this.notes.set(key, value as Note);
        }
      }
    }
    
    let content: string;
    let tags: string[] | undefined;
    
    // Handle different parameter formats
    if (typeof params === 'string') {
      // Direct string: @notes.add("content")
      content = params;
    } else if (params.value) {
      // Single positional: @notes.add("content")
      content = params.value;
    } else if (params.values && Array.isArray(params.values)) {
      // Multiple positional: @notes.add("content", "tag1", "tag2")
      content = params.values[0];
      tags = params.values.slice(1);
    } else if (params.content) {
      // Object format: @notes.add({ content: "...", tags: [...] })
      content = params.content;
      tags = params.tags;
    } else {
      // Fallback - try to stringify whatever we got
      content = typeof params === 'object' ? JSON.stringify(params) : String(params);
    }
    
    const noteId = `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const note: Note = {
      id: noteId,
      content,
      created: new Date().toISOString(),
      tags
    };
    
    this.notes.set(noteId, note);
    
    // Emit event for other agents
    this.element.emit({
      topic: 'notes:added',
      source: this.element.getRef(),
      payload: { noteId, preview: content.substring(0, 50) },
      timestamp: Date.now()
    });
    
    // Auto-open the note just created
    await this.readNote(noteId);
  }
  
  /**
   * Search notes by keyword
   * Supports: @notes.search("query") or @notes.search({ query: "...", limit: 10 })
   */
  private async searchNotes(params: any): Promise<void> {
    let query: string;
    let limit: number = 10;
    
    if (typeof params === 'string') {
      query = params;
    } else if (params.value) {
      query = params.value;
    } else if (params.query) {
      query = params.query;
      limit = params.limit || 10;
    } else {
      query = String(params);
    }
    
    const queryLower = query.toLowerCase();
    
    const matches: Note[] = [];
    for (const note of this.notes.values()) {
      if (note.content.toLowerCase().includes(queryLower) ||
          note.tags?.some(t => t.toLowerCase().includes(queryLower))) {
        matches.push(note);
      }
    }
    
    // Sort by recency
    matches.sort((a, b) => b.created.localeCompare(a.created));
    const results = matches.slice(0, limit);
    
    // Emit results as ambient facet
    this.addFacet({
      id: `search-results-${Date.now()}`,
      type: 'ambient',
      displayName: `Search Results: "${params.query}"`,
      content: results.length === 0 
        ? 'No notes found'
        : results.map(n => `[${n.id}] ${n.content.substring(0, 100)}...`).join('\n'),
      attributes: {
        resultCount: results.length,
        noteIds: results.map(n => n.id)
      }
    });
  }
  
  /**
   * Browse recent notes
   */
  private async browseNotes(params?: {
    days?: number;
    limit?: number;
  }): Promise<void> {
    const limit = params?.limit || 20;
    const days = params?.days;
    
    let notes = Array.from(this.notes.values());
    
    // Filter by date if specified
    if (days) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      notes = notes.filter(n => new Date(n.created) > cutoff);
    }
    
    // Sort by recency
    notes.sort((a, b) => b.created.localeCompare(a.created));
    const results = notes.slice(0, limit);
    
    // Emit as ambient
    this.addFacet({
      id: `browse-results-${Date.now()}`,
      type: 'ambient',
      displayName: `Recent Notes (${results.length})`,
      content: results.length === 0
        ? 'No notes yet'
        : results.map(n => `[${n.id}] (${new Date(n.created).toLocaleString()})\n${n.content.substring(0, 100)}...`).join('\n\n'),
      attributes: {
        noteCount: results.length
      }
    });
  }
  
  /**
   * Load a note into context
   * Supports: @notes.read("note-id") or @notes.read({ noteId: "..." })
   */
  private async readNote(params: any): Promise<void> {
    let noteId: string;
    
    if (typeof params === 'string') {
      noteId = params;
    } else if (params.value) {
      noteId = params.value;
    } else if (params.noteId) {
      noteId = params.noteId;
    } else {
      noteId = String(params);
    }
    
    const note = this.notes.get(noteId);
    if (!note) {
      this.addFacet({
        id: `note-error-${Date.now()}`,
        type: 'ambient',
        displayName: 'Note Not Found',
        content: `Note ${params.noteId} not found`
      });
      return;
    }
    
    // Add to open notes
    this.openNotes.add(params.noteId);
    
    // Add as ambient facet
    this.addFacet({
      id: `note-${params.noteId}`,
      type: 'ambient',
      displayName: `Note (${new Date(note.created).toLocaleDateString()})`,
      content: note.content,
      attributes: {
        noteId: params.noteId,
        created: note.created,
        tags: note.tags || [],
        canClose: true
      }
    });
  }
  
  /**
   * Remove a note from context
   * Supports: @notes.close("note-id") or @notes.close({ noteId: "..." })
   */
  private async closeNote(params: any): Promise<void> {
    let noteId: string;
    
    if (typeof params === 'string') {
      noteId = params;
    } else if (params.value) {
      noteId = params.value;
    } else if (params.noteId) {
      noteId = params.noteId;
    } else {
      noteId = String(params);
    }
    
    this.openNotes.delete(noteId);
    
    // Remove the facet
    this.addOperation({
      type: 'removeFacet',
      facetId: `note-${noteId}`,
      mode: 'delete'
    });
  }
  
  /**
   * Clear all notes from context
   */
  private async clearContext(): Promise<void> {
    for (const noteId of this.openNotes) {
      this.addOperation({
        type: 'removeFacet',
        facetId: `note-${noteId}`,
        mode: 'delete'
      });
    }
    this.openNotes.clear();
  }
  
  /**
   * Emit available actions as ambient
   */
  private emitActions(): void {
    this.addFacet({
      id: 'space-notes-actions',
      type: 'ambient',
      displayName: 'Space Notes',
      content: `Space Notes - Your workspace for thoughts and observations:

@notes.add("Your note here with -YourName") - Write a note
@notes.add("Note content", "tag1", "tag2") - Write with tags
@notes.search("concept") - Search by meaning
@notes.browse() - Browse recent notes (defaults to 20)
@notes.browse({ days: 7, limit: 10 }) - Browse with options  
@notes.read("note-id") - Load into active context
@notes.close("note-id") - Remove from context
@notes.clear() - Clear all from context

Notes exist in this Space - visible to agents here, not beyond.
A place for working memory, processing, and agent-to-agent messages.`,
      attributes: {
        component: 'SpaceNotes',
        persistent: true
      }
    });
  }
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    // Emit actions on first frame
    if (event.topic === 'frame:start' && !this.actionsEmitted) {
      this.emitActions();
      this.actionsEmitted = true;
    }
  }
}
