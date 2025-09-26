/**
 * SpaceNotesComponent - Refactored with new helper APIs
 * 
 * This component demonstrates how the new helper methods reduce boilerplate:
 * 
 * BEFORE: Manual construction of facets, events, and operations
 * AFTER:  Clean helper methods that handle the details
 * 
 * Key improvements shown:
 * - addAmbient() for quick feedback messages
 * - addState() for persistent UI elements  
 * - updateState() for reactive updates
 * - createSpaceEvent() for clean event creation
 * - removeFacet() factory for operations
 * - Frame safety with inFrame() and deferToNextFrame()
 * 
 * The component is now focused on its logic, not framework plumbing!
 */

import { InteractiveComponent } from './base-components';
import { persistable, persistent } from '../persistence/decorators';
import { SpaceEvent } from '../spaces/types';
import { createSpaceEvent, removeFacet } from '../helpers/factories';

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
  @persistent() private notes: Map<string, Note> = new Map();
  @persistent() private openNotes: Set<string> = new Set(); // Currently open in context
  
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
   */
  private async addNote(params: {
    content: string;
    tags?: string[];
  }): Promise<void> {
    const noteId = `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const note: Note = {
      id: noteId,
      content: params.content,
      created: new Date().toISOString(),
      tags: params.tags
    };
    
    this.notes.set(noteId, note);
    
    // Emit event for other agents - much cleaner now!
    this.element.emit(
      createSpaceEvent('notes:added', this.element, {
        noteId,
        preview: params.content.substring(0, 50)
      })
    );
    
    // Auto-open the note just created
    await this.readNote({ noteId });
    
    // Update stats - safe to call anytime!
    this.changeStats();
  }
  
  /**
   * Search notes by keyword
   */
  private async searchNotes(params: {
    query: string;
    limit?: number;
  }): Promise<void> {
    const queryLower = params.query.toLowerCase();
    const limit = params.limit || 10;
    
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
    
    // Emit results as ambient facet - so much simpler!
    const content = results.length === 0 
      ? 'No notes found'
      : results.map(n => `[${n.id}] ${n.content.substring(0, 100)}...`).join('\n');
    
    this.addAmbient(
      `Search Results: "${params.query}"\n\n${content}`,
      {
        resultCount: results.length,
        noteIds: results.map(n => n.id),
        searchQuery: params.query
      }
    );
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
    
    // Emit as ambient - clean and clear
    const content = results.length === 0
      ? 'No notes yet'
      : results.map(n => `[${n.id}] (${new Date(n.created).toLocaleString()})\n${n.content.substring(0, 100)}...`).join('\n\n');
    
    this.addAmbient(
      `Recent Notes (${results.length})\n\n${content}`,
      { noteCount: results.length }
    );
  }
  
  /**
   * Load a note into context
   */
  private async readNote(params: { noteId: string }): Promise<void> {
    const note = this.notes.get(params.noteId);
    if (!note) {
      // Error case - simple one-liner!
      this.addAmbient(
        `Note Not Found: ${params.noteId} not found`,
        { error: true, noteId: params.noteId }
      );
      return;
    }
    
    // Add to open notes
    this.openNotes.add(params.noteId);
    
    // Add as ambient facet with stable ID for removal
    this.addAmbient(
      `Note (${new Date(note.created).toLocaleDateString()})\n\n${note.content}`,
      `note-${params.noteId}`, // Stable ID
      {
        noteId: params.noteId,
        created: note.created,
        tags: note.tags || [],
        canClose: true
      }
    );
  }
  
  /**
   * Remove a note from context
   */
  private async closeNote(params: { noteId: string }): Promise<void> {
    this.openNotes.delete(params.noteId);
    
    // Remove the facet - one clean function call!
    this.addOperation(
      removeFacet(`note-${params.noteId}`, 'delete')
    );
  }
  
  /**
   * Clear all notes from context
   */
  private async clearContext(): Promise<void> {
    // Batch remove all open notes - so much cleaner!
    for (const noteId of this.openNotes) {
      this.addOperation(
        removeFacet(`note-${noteId}`, 'delete')
      );
    }
    this.openNotes.clear();
  }
  
  /**
   * Emit available actions as state (persistent UI)
   */
  private emitActions(): void {
    // Use addState for persistent UI elements - they survive frame changes!
    this.addState('notes-help', 
      `Space Notes - Your workspace for thoughts and observations:

@notes.add({ content: "Your note here with -YourName" }) - Write a note
@notes.search({ query: "concept" }) - Search by meaning
@notes.browse({ days: 7, limit: 10 }) - Browse recent notes  
@notes.read({ noteId: "note-id" }) - Load into active context
@notes.close({ noteId: "note-id" }) - Remove from context
@notes.clear() - Clear all from context

Notes exist in this Space - visible to agents here, not beyond.
A place for working memory, processing, and agent-to-agent messages.`,
      {
        component: 'SpaceNotes',
        noteCount: this.notes.size,
        openNotes: this.openNotes.size
      }
    );
  }
  
  async handleEvent(event: SpaceEvent): Promise<void> {
    await super.handleEvent(event);
    
    // Emit actions on first frame
    if (event.topic === 'frame:start' && !this.actionsEmitted) {
      this.emitActions();
      this.actionsEmitted = true;
    }
  }
  
  /**
   * Update the help text with current stats
   * Demonstrates using the new helper methods
   */
  private changeStats(): void {
    // Safe to call anytime - will defer if not in frame
    if (!this.inFrame()) {
      this.deferToNextFrame(() => this.changeStats());
      return;
    }
    
    // Update just the attributes of our help state
    this.changeState('notes-help', {
      attributes: {
        component: 'SpaceNotes',
        noteCount: this.notes.size,
        openNotes: this.openNotes.size,
        lastUpdate: new Date().toISOString()
      }
    });
  }
}
