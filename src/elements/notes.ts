import { Element } from '../spaces/element';
import { SpaceNotesComponent } from '../components/space-notes';

/**
 * NotesElement - A note-taking element for the Space
 * 
 * Notes that exist within the Space - visible to all agents there,
 * not broadcast beyond. For working memory, processing, and 
 * agent-to-agent communication.
 * 
 * Perfect for Opus+Haiku collaboration where a monitoring agent
 * logs observations and a main agent reviews when awakened.
 * 
 * Attribution by including name in note content.
 */
export class NotesElement extends Element {
  constructor(id: string = 'notes') {
    super(id, 'notes');
    
    // Add the space notes component
    this.addComponent(new SpaceNotesComponent());
  }
}
