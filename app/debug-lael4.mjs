// Force TTY and terminal dimensions
Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'columns', { value: 120 });
Object.defineProperty(process.stdout, 'rows', { value: 40 });

// Override process.argv to ensure --help is seen
process.argv = ['node', 'lael', '--help'];

console.log("Starting with argv:", process.argv);
await import('./dist/entry.js');
console.log("Finished");
