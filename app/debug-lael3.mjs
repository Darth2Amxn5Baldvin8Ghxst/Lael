import fs from 'fs';

// Force TTY
Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });
Object.defineProperty(process.stdin, 'isTTY', { value: true });

// Capture all stdout writes to a file
const logFile = fs.createWriteStream('output.log');
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...args) => {
  logFile.write(chunk);
  return originalWrite(chunk, ...args);
};

await import('./dist/entry.js');
logFile.end();
