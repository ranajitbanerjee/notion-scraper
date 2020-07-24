const sanitizeDocs = require('../src/index');

const args = process.argv.slice(2, process.argv.length);
const [inputDir, outDirPath] = args;

const {
    IFRAME_ASSETS_PATH,
    LOCAL_CSS,
    LOCAL_SCRIPT,
    LOCAL_POST_BODY_SCRIPT,
    LATEST_VERSION,
} = process.env;

sanitizeDocs(inputDir, outDirPath, {
    IFRAME_ASSETS_PATH,
    LOCAL_CSS,
    LOCAL_SCRIPT,
    LOCAL_POST_BODY_SCRIPT,
    LATEST_VERSION,
});
