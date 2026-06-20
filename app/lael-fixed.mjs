#!/usr/bin/env node

// Force TTY for Windows Git Bash compatibility
if (!process.stdout.isTTY) {
  Object.defineProperty(process.stdout, 'isTTY', { value: true });
  Object.defineProperty(process.stderr, 'isTTY', { value: true });
  Object.defineProperty(process.stdin, 'isTTY', { value: true });
}

// Set terminal dimensions if missing
if (!process.stdout.columns) {
  Object.defineProperty(process.stdout, 'columns', { value: 120 });
  Object.defineProperty(process.stdout, 'rows', { value: 40 });
}

// Import and run the entry
await import('./dist/entry.js');
