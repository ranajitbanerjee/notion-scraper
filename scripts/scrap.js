const sanitizeDocs = require('../src/index');

const args = process.argv.slice(2, process.argv.length);
const [inputDir, outDirPath] = args;

sanitizeDocs(inputDir, outDirPath);
