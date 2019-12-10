const fs = require('fs');
const path = require('path');

module.exports = function removeDir (dirPath) {
    if (fs.existsSync(dirPath)) {
        let list = fs.readdirSync(dirPath);
        for (let i = 0; i < list.length; i++) {
            let filename = path.join(dirPath, list[i]);
            let stat = fs.statSync(filename);

            if (filename == '.' || filename == '..') {
                // do nothing for current and parent dir
            } else if (stat.isDirectory()) {
                removeDir(filename);
            } else {
                fs.unlinkSync(filename);
            }
        }

        fs.rmdirSync(dirPath);
    }
};
