const fs = require('fs');
const path = require('path');

const dataDir = path.join(process.cwd(), 'data');

if (!fs.existsSync(dataDir)) {
	console.log('data directory does not exist');
	process.exit(0);
}

fs.rmSync(dataDir, { recursive: true, force: true });
console.log('local data index was cleared');
