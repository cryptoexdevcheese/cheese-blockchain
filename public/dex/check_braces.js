const fs = require('fs');
const content = fs.readFileSync('c:\\Users\\Robert Terre\\Documents\\CLEAN Blockchain Cloud\\deploy-dex\\public\\index.html', 'utf8');

const scriptMatches = content.match(/<script>(.*?)<\/script>/gs);
if (!scriptMatches) {
    console.log('No script blocks found');
    process.exit(0);
}

scriptMatches.forEach((script, i) => {
    const code = script.replace(/<script>|<\/script>/g, '');
    let openBraces = 0;
    let tryBlocks = [];
    const lines = code.split('\n');

    lines.forEach((line, lineIdx) => {
        // Count braces
        for (let char of line) {
            if (char === '{') openBraces++;
            if (char === '}') openBraces--;
        }

        // Find try blocks
        if (line.match(/try\s*\{/)) {
            tryBlocks.push({ line: lineIdx + 1, open: true });
        }
        if (line.match(/catch\s*\(|catch\s*\{|finally\s*\{/)) {
            if (tryBlocks.length > 0) {
                tryBlocks[tryBlocks.length - 1].open = false;
            }
        }
    });

    console.log(`Script block ${i}:`);
    console.log(`  Open braces at end: ${openBraces}`);
    tryBlocks.forEach(t => {
        if (t.open) console.log(`  UNCLOSED TRY at line ${t.line}`);
    });
});
