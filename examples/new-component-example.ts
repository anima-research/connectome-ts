/**
 * Example: Building a new component with the improved APIs
 * 
 * This shows how much easier it is to create components now.
 * Compare this to the struggle described in the developer feedback!
 */

import { Component } from '../src';
import type { SpaceEvent } from '../src';
import { createSpaceEvent, changeState } from '../src';

/**
 * A simple task tracker component
 * Demonstrates the new APIs in action
 */
export class TaskTrackerComponent extends Component {
  private tasks = new Map<string, { title: string; done: boolean }>();

  onFirstFrame() {
    // Set up persistent UI - one line!
    this.addState('task-count', `${this.tasks.size} tasks`, {
      component: 'TaskTracker'
    });
    
    // Add instructions
    this.addAmbient(
      'Task Tracker ready! Use @tasks.add, @tasks.complete, @tasks.list'
    );
  }

  // Adding a task - clean and simple
  addTask(title: string) {
    const taskId = `task-${Date.now()}`;
    this.tasks.set(taskId, { title, done: false });
    
    // Emit event - no more manual ElementRef construction!
    this.emit(
      createSpaceEvent('task:added', this.element, { taskId, title })
    );
    
    // Update UI state
    this.updateTaskCount();
    
    // Show the task
    this.addEvent(`New task: ${title}`, 'task-add', { taskId });
  }

  // Complete a task
  completeTask(taskId: string) {
    const task = this.tasks.get(taskId);
    if (!task) {
      // Error feedback is trivial now
      this.addAmbient(`Task ${taskId} not found!`, { error: true });
      return;
    }
    
    task.done = true;
    
    // Celebrate completion!
    this.addEvent(
      `✓ Completed: ${task.title}`,
      'task-complete',
      { taskId, celebratory: true }
    );
    
    this.updateTaskCount();
  }

  // List all tasks
  listTasks() {
    if (this.tasks.size === 0) {
      this.addAmbient('No tasks yet. Add one with @tasks.add("Your task")');
      return;
    }
    
    const taskList = Array.from(this.tasks.entries())
      .map(([id, task]) => `${task.done ? '✓' : '○'} [${id}] ${task.title}`)
      .join('\n');
    
    this.addAmbient(
      `Tasks (${this.tasks.size}):\n\n${taskList}`,
      { 
        totalTasks: this.tasks.size,
        completedTasks: Array.from(this.tasks.values()).filter(t => t.done).length
      }
    );
  }

  // Helper to update the task count
  private updateTaskCount() {
    // Frame safety built in!
    if (!this.inFrame()) {
      this.deferToNextFrame(() => this.updateTaskCount());
      return;
    }
    
    const completed = Array.from(this.tasks.values()).filter(t => t.done).length;
    
    this.updateState('task-count', {
      content: `${completed}/${this.tasks.size} tasks completed`,
      attributes: {
        component: 'TaskTracker',
        total: this.tasks.size,
        completed,
        pending: this.tasks.size - completed
      }
    });
  }
}

/**
 * What's remarkable here:
 * 
 * 1. NO manual facet construction with IDs and types
 * 2. NO ElementRef building for events  
 * 3. NO frame checking boilerplate
 * 4. NO complex operation objects
 * 
 * The component is 90% business logic, 10% framework.
 * 
 * This same component using the old APIs would be 2-3x longer
 * and full of framework plumbing code.
 * 
 * Most importantly: A developer can understand and modify this
 * without deep knowledge of Connectome's internals!
 */
