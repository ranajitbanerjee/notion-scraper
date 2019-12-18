const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const util = require('util');
const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const writeFile = util.promisify(fs.writeFile);
const removeDir = require('./dir-remove');
const replaceLink = require('./replace-link');
const TABLE_ID = '__id';
const PAGE_LINK_CLASS = '.link-to-page';
const CODE_PEN_HEIGHT = 600;
const args = process.argv.slice(2, process.argv.length);
let [inputDir, outDirPath] = args;
inputDir = path.resolve(inputDir);
outDirPath = outDirPath || `${path.dirname(inputDir)}/out`;
outDirPath = path.resolve(outDirPath);
const rootDirName = path.basename(inputDir);
let rootDirPath = inputDir;

const santizeElement = (elem, $) => {
    const textContent = elem.text();

    if (/codepen/.test(textContent)) {
        const url = `https://codepen.io/api/oembed?format=json&url=${textContent}&height=${CODE_PEN_HEIGHT}`;
        return replaceLink(url, elem);
    }
};

const normalizeCodeBlocks = ($) => {
    return new Promise((res, rej) => {
        const links = $('a');
        const promises = [];

        links.each(function () {
            promises.push(santizeElement($(this)));
        });

        Promise.all(promises).then(() => {
            res(true);
        }).catch((errmsg) => {
            rej(errmsg);
        });
    });
};

const removeTableIds = ($) => {
    const columnTh = $(`table th:contains(${TABLE_ID})`);
    const columnIndex = columnTh.index() + 1;
    $('table tr td:nth-child(' + columnIndex + ')').remove();
    columnTh.remove();
};

const addHighLightJSResources = ($) => {
    const { IFRAME_ASSETS_PATH ,LOCAL_CSS, LOCAL_SCRIPT} = process.env;

    const cssList = fs.readdirSync(path.resolve(LOCAL_CSS));
    const scriptList = fs.readdirSync(path.resolve(LOCAL_SCRIPT));
  
    cssList.forEach(css => $('head').append(`<link rel="stylesheet" href="${IFRAME_ASSETS_PATH}/css/${css}">`));
    scriptList.forEach(js => $('head').append(`<script src="${IFRAME_ASSETS_PATH}/js/${js}"></script>`));
    scriptList.forEach(js => $('body').after('<script>hljs.initHighlightingOnLoad();</script>'));   
}

const sanitizeHtml = filePath => new Promise((res, rej) => {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) throw rej(err);
        const $ = cheerio.load(data);
        const hasLinks = $(PAGE_LINK_CLASS);
        removeTableIds($);
        
        addHighLightJSResources($);
        normalizeCodeBlocks($).then(() => {
            res({
                html: $.html(),
                hasLinks: !!hasLinks.length
            });
        });
    });
});

async function sanitizeFile (filePath, outDir, jsonObj) {
    const ext = path.extname(filePath);
    const dirpath = path.dirname(filePath);
    const dirname = path.basename(dirpath);
    const basename = path.basename(filePath).replace('.html', '');

    if (ext === '.html') {
        try {
            const { html, hasLinks } = await sanitizeHtml(filePath);
            const newFilePath = `${outDir}/${basename}.html`;
            await writeFile(newFilePath, html);

            if (rootDirName === dirname) {
                rootDirPath = `${inputDir}/${basename}`;
                await traverseDirectory(filePath.replace('.html', ''), jsonObj, basename);
            } else {
                if (hasLinks) {
                    jsonObj[basename] = {
                        subPages: {},
                        path: filePath.replace(rootDirPath, '.')
                    };
                    await traverseDirectory(filePath.replace('.html', ''), jsonObj[basename].subPages, basename);
                } else {
                    if (!jsonObj[basename]) {
                        jsonObj[basename] = {
                            title: basename,
                            path: filePath.replace(rootDirPath, '.')
                        };
                    }
                }
            }


        } catch (e) {
            throw new Error(e);
        }
    }
}

async function processFiles (files, dir, outDir, jsonObj) {
    return await Promise.all(files.map(async file => {
        const filePath = path.resolve(dir, file);
        return await sanitizeFile(filePath, outDir, jsonObj);
    }));
}

async function traverseDirectory (dir, jsonObj = {}) {
    try {
        const files = await readdir(dir);
        const newDir = `${outDirPath}${dir.replace(`${inputDir}`, '')}`;
        await mkdir(newDir);
        await processFiles(files, dir, newDir, jsonObj);
    }  catch (e) {
        throw new Error(e);
    }
}

removeDir(outDirPath);

const json = {};
traverseDirectory(inputDir, json).then(() => {
    const jsonStr = JSON.stringify(json, null, 4);

    if (jsonStr) {
        writeFile(`${outDirPath}/page-links.json`, jsonStr).then(() => {
            console.log('Done');
        });
    }
});
