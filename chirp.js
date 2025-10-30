const path = require('path');
const { spawn } = require('child_process');

console.log("It looks like you've typed 'chirp.js' but the script is 'chrip.js'; it's a kind of joke you see...");
console.log("Don't worry, I'll run it for you in a moment.");

setTimeout(() => {
    console.log("Running chrip.js...");
    const child = spawn('node', [path.join(__dirname, 'chrip.js')], {
        stdio: 'inherit'
    });

    child.on('error', (error) => {
        console.error('Failed to start chrip.js:', error);
    });

    child.on('close', (code) => {
        if (code !== 0) {
            console.log(`chrip.js exited with code ${code}`);
        }
    });
}, 5000);
