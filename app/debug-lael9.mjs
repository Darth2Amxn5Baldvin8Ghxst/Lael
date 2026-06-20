Object.defineProperty(process.stdout, 'isTTY', { value: true });
Object.defineProperty(process.stderr, 'isTTY', { value: true });  
Object.defineProperty(process.stdin, 'isTTY', { value: true });
Object.defineProperty(process.stdout, 'columns', { value: 120 });
Object.defineProperty(process.stdout, 'rows', { value: 40 });

process.argv = ['node', 'openclaw', '--help'];

// Call outputRootHelp directly
const { outputRootHelp } = await import('./dist/root-help-CjYrrcPr.js');
console.log("Calling outputRootHelp...");
outputRootHelp();
console.log("Done");
