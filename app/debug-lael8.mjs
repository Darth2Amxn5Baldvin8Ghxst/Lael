Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });  
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'columns', { value: 120 });
Object.defineProperty(process.stdout, 'rows', { value: 40 });

process.argv = ['node', 'openclaw', '--help'];

// Check isMainModule as a function
const { t: isMainModule } = await import('./dist/is-main-YViS6wOn.js');
console.log("isMainModule():", isMainModule(import.meta.url));

// Find and call the help function directly
const helpModule = await import('./dist/logger-kwZIqwuw.js');
console.log("Help module exports:", Object.keys(helpModule));

await import('./dist/entry.js');
console.log("Finished");
