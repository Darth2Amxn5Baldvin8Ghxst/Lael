Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'columns', { value: 120 });
Object.defineProperty(process.stdout, 'rows', { value: 40 });

// Try version instead of help
process.argv = ['node', 'lael', '--version'];

console.log("Starting with argv:", process.argv);
await import('./dist/entry.js');
console.log("Finished");
