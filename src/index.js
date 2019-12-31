const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');
const util = require('util');
const mkdirSync = fs.mkdirSync;
const existsSync = fs.existsSync;
const readdirSync = fs.readdirSync;
const mkdir = util.promisify(fs.mkdir);
const readdir = util.promisify(fs.readdir);
const writeFile = util.promisify(fs.writeFile);
const removeDir = require('./dir-remove');
const replaceLink = require('./replace-link');
const TABLE_ID = '__id';
const PAGE_LINK_CLASS = '.link-to-page';
const CODE_PEN_HEIGHT = 600;

const recurse = (obj) => {
    const subPages = [];
    for (let key in obj) {
        if (obj[key].subPages) {
            const childPages = recurse(obj[key].subPages);
            subPages.push({
                title: key,
                subPages: childPages,
                path: obj[key].path,
                order: obj[key].order
            });
        } else {
            subPages.push(obj[key]);
        }
    }
    return subPages.sort((a, b) => a.order - b.order);
};
const createExamplesJson = (examplesFile, outDirPath) => {
    fs.readFile(examplesFile, 'utf8', (err, data) => {
        if (err) throw rej(err);
        const $ = cheerio.load(data);
        const categories = $('h2');
        const json = [];
        categories.each(function () {
            const elem = $(this);
            const category = elem.text();

            elem.nextUntil('h2')
                .each(function () {
                    const links = $(this).find('a');
                    links.each(function () {
                        const link = $(this).attr('href');

                        json.push({
                            category,
                            link
                        });
                    });
                });

        });
        // console.log(json);
        const jsonStr = JSON.stringify(json, null, 4);
        writeFile(`${outDirPath}/examples.json`, jsonStr).then(() => {
            // console.log('Done');
        });
    });
};

module.exports = (inputDir, outDirPath, { IFRAME_ASSETS_PATH, LOCAL_CSS, LOCAL_SCRIPT, themeId }) => {
    inputDir = path.resolve(inputDir);
    outDirPath = outDirPath || `${inputDir}/out`;
    outDirPath = path.resolve(outDirPath);
    const examplesFile = `${inputDir}/examples.html`;
    inputDir = `${inputDir}/docs`;
    const rootDirName = path.basename(inputDir);
    let rootDirPath = inputDir;
    const pagesMap = {};

    const santizeElement = (elem) => {
        const textContent = elem.text();

        if (/codepen/.test(textContent) && !/template/.test(textContent)) {
            const url = `https://codepen.io/api/oembed?format=json&url=${textContent}&height=${CODE_PEN_HEIGHT}`;
            return replaceLink(url, elem, themeId);
        }
        return null;
    };

    const fetchLinks = (links, res, retryCount, filePath) => {
        const promises = [];

        links.forEach((link) => {
            const promise = santizeElement(link);
            if (promise) {
                promises.push(promise);
            }
        });

        Promise.all(promises).then((results) => {
            const fails = results.filter(d => d.type === 'fail');
            if (fails.length && retryCount > 0) {
                // console.log(fails, results.length, filePath);
                fetchLinks(fails.map(d => d.elem), res, retryCount - 1, filePath);
            } else {
                res(true);
            }
        });
    };

    const normalizeCodeBlocks = ($, filePath) => {
        return new Promise((res, rej) => {
            const links = [];

            $('a').each(function () {
                links.push($(this));
            });
            fetchLinks(links, res, 5, filePath);
        });
    };

    const removeTableIds = ($) => {
        const columnTh = $(`table th:contains(${TABLE_ID})`);
        const columnIndex = columnTh.index() + 1;
        $('table tr td:nth-child(' + columnIndex + ')').remove();
        columnTh.remove();
    };

    const addHighLightJSResources = ($) => {
        const cssList = fs.readdirSync(path.resolve(LOCAL_CSS));
        const scriptList = fs.readdirSync(path.resolve(LOCAL_SCRIPT));

        cssList.forEach(css => $('head').append(`<link rel="stylesheet" href="${IFRAME_ASSETS_PATH}/css/${css}">`));
        scriptList.forEach(js => $('head').append(`<script src="${IFRAME_ASSETS_PATH}/js/${js}"></script>`));
        scriptList.forEach(js => $('body').after('<script>hljs.initHighlightingOnLoad();</script>'));
    };

    const hyphenate = (str) => {
        return [str.substring(0, 8), str.substring(8, 12), str.substring(12, 16),
            str.substring(16, 20), str.substring(20, 32)].join('-')
    };

    const resolveRelativeLinks = ($, filePath) => {
        $('a').each(function () {
            const href = $(this).attr('href');
            if (/notion\.so/g.test(href)) {
                const hash = href.substring(href.lastIndexOf('-') + 1);
                const [id, hashStr] = hash.split('#');
                if (pagesMap[id]) {
                    const newPath = path.dirname(filePath);
                    const relativePath = path.relative(newPath, pagesMap[id]);

                    const withHash = hashStr ? `#${hyphenate(hashStr)}` : '';
                    $(this).attr('href', `${relativePath}${withHash}`);
                }
            }
        });
    };

    const sanitizeHtml = filePath => new Promise((res, rej) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) throw rej(err);
            const $ = cheerio.load(data);
            const links = $(PAGE_LINK_CLASS);
            const linkNames = {};
            links.each(function (i) {
                const html = $(this);
                const id = html.attr('id');
                const href = html.find('a').attr('href');
                const name = path.basename(href).replace('.html', '').replace(/%20/g, ' ');
                linkNames[name] = i;
                pagesMap[id.replace(/-/g, '')] =  `${filePath.replace('.html', '')}/${name}.html`;
            });

            removeTableIds($);
            resolveRelativeLinks($, filePath);
            addHighLightJSResources($);
            normalizeCodeBlocks($, filePath).then(() => {
                res({
                    html: $.html(),
                    hasLinks: !!links.length,
                    links: linkNames
                });
            });
        });
    });

    async function sanitizeFile (filePath, outDir, jsonObj, linksOrder = {}) {
        const ext = path.extname(filePath);
        const dirpath = path.dirname(filePath);
        const dirname = path.basename(dirpath);
        const basename = path.basename(filePath).replace('.html', '');

        if (ext === '.html') {
            try {
                const { html, hasLinks, links } = await sanitizeHtml(filePath);
                const newFilePath = `${outDir}/${basename}.html`;
                !hasLinks && await writeFile(newFilePath, html);
                // console.log(linksOrder);
                if (rootDirName === dirname) {
                    // rootDirPath = `${inputDir}/${basename}`;
                    await traverseDirectory(filePath.replace('.html', ''), jsonObj, links);
                } else {

                    if (hasLinks) {
                        jsonObj[basename] = {
                            subPages: {},
                            path: filePath.replace(rootDirPath, '.'),
                            order: linksOrder[basename]
                        };
                        await traverseDirectory(filePath.replace('.html', ''), jsonObj[basename].subPages, links);
                    } else {
                        if (!jsonObj[basename]) {
                            jsonObj[basename] = {
                                title: basename,
                                path: filePath.replace(rootDirPath, '.'),
                                order: linksOrder[basename]
                            };
                        }
                    }
                }
            } catch (e) {
                throw new Error(e);
            }
        }
    }

    async function processFiles (files, dir, outDir, jsonObj, linkTitles) {
        return await Promise.all(files.map(async file => {
            const filePath = path.resolve(dir, file);
            return await sanitizeFile(filePath, outDir, jsonObj, linkTitles);
        }));
    }

    async function traverseDirectory (dir, jsonObj = {}, linkTitles = {}) {
        try {
            let newDir;
            const files = await readdir(dir);
            const subDirectoryPath = `${dir.replace(`${inputDir}`, '')}`;

            newDir = `${outDirPath}/docs/${subDirectoryPath}`;

            !existsSync(newDir) && await mkdir(newDir);
            // console.log(linkTitles);
            await processFiles(files, dir, newDir, jsonObj, linkTitles);
        }  catch (e) {
            throw new Error(e);
        }
    }

    removeDir(outDirPath);
    mkdirSync(`${outDirPath}`);

    let json = {};
    async function createDocs () {
        const files = readdirSync(inputDir);
        for (let i = 0; i < files.length; i++) {
            const filePath = files[i];
            const extname = path.extname(filePath);
            if (extname === '.html') {
                const fullPath = path.resolve(inputDir, filePath);
                const { hasLinks, links } = await sanitizeHtml(fullPath);

                if (hasLinks) {
                    inputDir = fullPath.replace('.html', '');
                    rootDirPath = inputDir;
                    // console.log(links);
                    traverseDirectory(inputDir, json, {}, links).then(() => {
                        removeDir(outDirPath);
                        mkdirSync(`${outDirPath}`);

                        json = {};
                        traverseDirectory(inputDir, json, links).then(() => {
                            const jsonStr = JSON.stringify(recurse(json), null, 4);
                            if (jsonStr) {
                                writeFile(`${outDirPath}/page-links.json`, jsonStr).then(() => {
                                    console.log('Done');
                                });

                                createExamplesJson(examplesFile, outDirPath);
                            }
                        });
                    });
                    break;
                }
            }
        }
    }

    createDocs();
};
