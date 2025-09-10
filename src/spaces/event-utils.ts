import { SpaceEvent } from './types';

/**
 * Stop the event from propagating to other elements
 */
export function stopPropagation(event: SpaceEvent): void {
  if (event.cancelable !== false) {
    event.propagationStopped = true;
  }
}

/**
 * Stop the event from propagating to other elements AND other handlers on the same element
 */
export function stopImmediatePropagation(event: SpaceEvent): void {
  if (event.cancelable !== false) {
    event.propagationStopped = true;
    event.immediatePropagationStopped = true;
  }
}

/**
 * Prevent the default action for this event
 */
export function preventDefault(event: SpaceEvent): void {
  if (event.cancelable !== false) {
    event.defaultPrevented = true;
  }
}

/**
 * Check if an event bubbles (defaults to true)
 */
export function eventBubbles(event: SpaceEvent): boolean {
  return event.bubbles !== false;
}

/**
 * Check if an event is cancelable (defaults to true)
 */
export function eventIsCancelable(event: SpaceEvent): boolean {
  return event.cancelable !== false;
}
