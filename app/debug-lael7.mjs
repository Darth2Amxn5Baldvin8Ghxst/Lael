Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });  
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'columns', { value: 120 });
Object.defineProperty(process.stdout, 'rows', { value: 40 });

process.argv = ['node', 'openclaw', '--help'];

// Import the isMainModule check
const { t: isMainModule } = await import('./dist/is-main-YViS6wOn.js');
console.log("isMainModule:", isMainModule);

// Import the help check
const { j: isRootHelpInvocation } = await import('./dist/logger-kwZIqwuw.js');
console.log("isRootHelpInvocation:", isRootHelpInvocation(process.argv));

await import('./dist/entry.js');
console.log("Finished");
