console.log("DEBUG: Args:", process.argv);

// Force TTY detection
Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });
Object.defineProperty(process.stdin, 'isTTY', { value: true });

// Intercept stdout.write to see what's being written
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  console.log("DEBUG STDOUT:", JSON.stringify(chunk.toString().slice(0, 200)));
  return originalWrite(chunk, ...args);
};

await import('./dist/entry.js');
console.log("DEBUG: Done");
