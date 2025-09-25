#!/usr/bin/env node

/**
 * Test program for interactive input and signal handling
 */

import * as readline from 'readline';

console.log('=== Interactive Test Program ===');
console.log('Commands:');
console.log('  "hello" - Get a greeting');
console.log('  "count" - Start counting (use Ctrl+C to stop)');
console.log('  "quit" - Exit the program');
console.log('');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'test> '
});

// Handle SIGINT (Ctrl+C)
let counting = false;
let countInterval: NodeJS.Timeout | null = null;

process.on('SIGINT', () => {
  if (counting) {
    console.log('\n[SIGINT received] Stopping counter...');
    if (countInterval) {
      clearInterval(countInterval);
      countInterval = null;
    }
    counting = false;
    rl.prompt();
  } else {
    console.log('\n[SIGINT received] Use "quit" to exit');
    rl.prompt();
  }
});

// Show initial prompt
rl.prompt();

// Handle user input
rl.on('line', (line) => {
  const command = line.trim().toLowerCase();
  
  switch (command) {
    case 'hello':
      console.log('Hello from the interactive test program!');
      break;
      
    case 'count':
      if (!counting) {
        counting = true;
        let count = 0;
        console.log('Starting counter... (Press Ctrl+C to stop)');
        countInterval = setInterval(() => {
          console.log(`Count: ${++count}`);
        }, 1000);
      } else {
        console.log('Already counting!');
      }
      break;
      
    case 'quit':
    case 'exit':
      console.log('Goodbye!');
      process.exit(0);
      break;
      
    default:
      console.log(`Unknown command: ${command}`);
      console.log('Try "hello", "count", or "quit"');
  }
  
  if (!counting) {
    rl.prompt();
  }
});

// Handle close
rl.on('close', () => {
  console.log('\nExiting...');
  process.exit(0);
});





