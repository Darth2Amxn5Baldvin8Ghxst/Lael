Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'columns', { value: 120 });
Object.defineProperty(process.stdout, 'rows', { value: 40 });

// Use "openclaw" as the binary name like the tests do
process.argv = ['node', 'openclaw', '--help'];

console.log("Starting with argv:", process.argv);
await import('./dist/entry.js');
console.log("Finished");
