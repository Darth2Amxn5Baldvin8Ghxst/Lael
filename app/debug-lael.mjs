console.log("DEBUG: Starting...");

// Force TTY detection
Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });
Object.defineProperty(process.stdin, 'isTTY', { value: true });

console.log("DEBUG: TTY forced, importing entry...");

try {
  await import('./dist/entry.js');
  console.log("DEBUG: Import completed");
} catch (e) {
  console.error("DEBUG: Import failed:", e);
}
