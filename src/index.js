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
const fsExtra = require('fs-extra');
const removeDir = require('./dir-remove');
const replaceLink = require('./replace-link');
const TABLE_ID = '__id';
const PAGE_LINK_CLASS = '.link-to-page';
const CODE_PEN_HEIGHT = 600;

const stripEndSHAFromFileName = (filePath) => {
    const { name, ext, dir } = path.parse(filePath);
    const words = name.split(' ');
    const strippedFileName = `${words
        .slice(0, words.length - 1)
        .join(' ')}${ext}`;

    return dir === ''
        ? strippedFileName
        : dir === path.sep
            ? `${dir}${strippedFileName}`
            : `${dir}${path.sep}${strippedFileName}`;
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
        const jsonStr = JSON.stringify(json, null, 4);
        writeFile(`${outDirPath}/examples.json`, jsonStr).then(() => {
            console.log('Examples json file created');
        })
        .catch(err => console.log('Error in examples json file creation: ', err));
    });
};

module.exports = (inputDir, outDirPath, { IFRAME_ASSETS_PATH, LOCAL_CSS, LOCAL_SCRIPT, LOCAL_POST_BODY_SCRIPT, themeId, LATEST_VERSION }) => {
    inputDir = path.resolve(inputDir);
    outDirPath = outDirPath || `${inputDir}/out`;
    outDirPath = `${outDirPath}/${LATEST_VERSION}` || `${inputDir}/out/${LATEST_VERSION}`;
    outDirPath = path.resolve(outDirPath);
    const examplesFile = `${inputDir}/examples.html`;
    inputDir = `${inputDir}/docs`;
    const outPageDirPath = `${outDirPath}/pages`;
    const outExampleDirPath = `${outDirPath}/examples`;
    const pagesMap = {};
    const pageLinksMap = {};

    const santizeElement = (elem) => {
        const textContent = elem.text();

        if (/codepen/.test(textContent) && !/template/.test(textContent)) {
            const url = `https://codepen.io/api/oembed?format=json&url=${textContent}&height=${CODE_PEN_HEIGHT}`;
            return replaceLink(url, elem, themeId);
        }
        return null;
    };

    const fetchLinks = (links, res, retryCount) => {
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
                fetchLinks(fails.map(d => d.elem), res, retryCount - 1);
            } else {
                res(true);
            }
        });
    };

    const normalizeCodeBlocks = ($) => {
        return new Promise((res, rej) => {
            const links = [];

            $('a').each(function () {
                links.push($(this));
            });
            fetchLinks(links, res, 5);
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
        const postBodyScripts = fs.readdirSync(path.resolve(LOCAL_POST_BODY_SCRIPT));

        cssList.forEach(css => $('head').append(`<link rel="stylesheet" href="${IFRAME_ASSETS_PATH}/css/${css}">`));
        scriptList.forEach(js => $('head').append(`<script src="${IFRAME_ASSETS_PATH}/js/${js}"></script>`));
        $('head').append(`<script src="https://cdn.jsdelivr.net/npm/postmate@1.5.2/build/postmate.dev.js"></script>`);
        postBodyScripts.forEach(js => $('body').after(`<script src="${IFRAME_ASSETS_PATH}/js/${js}"></script>`))
        $('body').after('<script>hljs.initHighlightingOnLoad();</script>');
    };

    const hyphenate = (str) => {
        return [str.substring(0, 8), str.substring(8, 12), str.substring(12, 16),
            str.substring(16, 20), str.substring(20, 32)].join('-')
    };

    const resolveRelativeLinks = ($, destFilePath, sourceFilePath) => {
        let flag = false;
        $('a').each(function () {
            const href = $(this).attr('href');
            const currentPath = path.dirname(destFilePath);
            // const sourceDir = path.dirname(sourceDir);
            const destFileName = path.basename(destFilePath).replace('.html', '');
            const sourceFileName = path.basename(sourceFilePath).replace('.html', '').replace(/\s/g, '%20');

            if (href) {
                const fileName = path.basename(href).replace('.html', '').replace('%20', '-').toLowerCase();
                const sourcePathInLink = new RegExp(sourceFileName).test(href) && !href.startsWith('https://') &&
                    !href.startsWith('http://');

                if (/notion\.so/g.test(href)) {
                    const hash = href.substring(href.lastIndexOf('-') + 1);
                    const [id, hashStr] = hash.split('#');
                    if (pagesMap[id]) {
                        const relativePath = path.relative(currentPath, pagesMap[id]);

                        const withHash = hashStr ? `#${hyphenate(hashStr)}` : '';
                        $(this).attr('href', `${relativePath}${withHash}`);
                    }
                } else if (pageLinksMap[fileName]) {

                    // console.log(currentPath, pageLinksMap[fileName])
                    // const relPath = path.relative(currentPath, pageLinksMap[fileName]);
                    $(this).attr('href', path.relative(currentPath, pageLinksMap[fileName]));
                } else if (sourcePathInLink) {
                    // console.log(sourcePathInLink, sourceFileName, href, destFileName);
                    $(this).attr('href', href.replace(sourceFileName, destFileName));
                    const imgs = $(this).find('img');
                    imgs.each(function () {
                        const src = $(this).attr('src');
                        $(this).attr('src', src.replace(sourceFileName, destFileName));
                    });
                }
            } else {
                console.warn("Anchor tag with no href attribute detected. Is this intentional?");
                console.info(`Path to file: ${sourceFilePath}`);
            }
        });
        return flag;
    };

    const createPagesMap = (data, outFilePath) => {
        const $ = cheerio.load(data);
        const links = $(PAGE_LINK_CLASS);
        const linkNames = {};
        const title = $('title').text();

        links.each(function (i) {
            const html = $(this);
            const id = html.attr('id');
            const href = html.find('a').attr('href');
            const name = stripEndSHAFromFileName(path.basename(href).replace('.html', '').replace(/%20/g, ' '));
            linkNames[name] = i;
            pagesMap[id.replace(/-/g, '')] =
                `${outFilePath.replace('.html', '')}/${name.toLowerCase().split(' ').join('-')}.html`;
        });
        return {
            hasLinks: !!links.length,
            links: linkNames,
            title
        };
    };

    const sanitizeHtml = (data, destFilePath, sourceFilePath) => new Promise((res, rej) => {
        const $ = cheerio.load(data);

        removeTableIds($);
        const flag = resolveRelativeLinks($, destFilePath, sourceFilePath);
        addHighLightJSResources($);
        normalizeCodeBlocks($).then(() => {
            res({
                html: $.html(),
                flag
            });
        });
    });

    const readFile = (filePath) => new Promise((res, rej) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) throw rej(err);
            res(data);
        });
    });

    async function traverseDirectory (dir, writeDir, linksOrder = {}) {
        const files = await readdir(dir);
        const subDirectoryPath = `${writeDir.replace(`${stripEndSHAFromFileName(inputDir)}`, '')}`.toLowerCase().split(' ').join('-');
        const outDir = `${outPageDirPath}${subDirectoryPath}`;
        const subPages = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const extname = path.extname(file);
            if (extname === '.html') {
                const filePath = path.resolve(dir, file);
                const writeFilePath = stripEndSHAFromFileName(path.resolve(writeDir, file));
                const data = await readFile(filePath);
                const basename = path.basename(writeFilePath).replace('.html', '');
                const lowerCaseHyphenatedBaseName = basename.toLowerCase().split(' ').join('-');
                const newFilePath = `${outDir}/${lowerCaseHyphenatedBaseName}.html`;
                const { hasLinks, links, title } = createPagesMap(data, newFilePath);

                if (hasLinks) {
                    const pages = await traverseDirectory(filePath.replace('.html', ''), writeFilePath.replace('.html', ''), links);
                    subPages.push({
                        title,
                        path: newFilePath.replace(outPageDirPath, '.'),
                        sourcePath: filePath,
                        absolutePath: newFilePath,
                        order: linksOrder[basename],
                        subPages: pages
                    });

                } else {
                    pageLinksMap[lowerCaseHyphenatedBaseName] = newFilePath;
                    subPages.push({
                        title,
                        path: newFilePath.replace(outPageDirPath, '.'),
                        sourcePath: filePath,
                        absolutePath: newFilePath,
                        order: linksOrder[basename]
                    });
                }
            }
        }
        return subPages.sort((a, b) => a.order - b.order);
    }

    removeDir(outDirPath);
    mkdirSync(outDirPath);
    mkdirSync(outPageDirPath);
    mkdirSync(outExampleDirPath);

    async function createFiles (files) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (file.subPages) {
                await mkdir(file.absolutePath.replace('.html', ''));
                await createFiles(file.subPages);
            } else {
                const { sourcePath, absolutePath } = file;
                const data = await readFile(sourcePath);
                const { html } = await sanitizeHtml(data, absolutePath, sourcePath);
                await writeFile(absolutePath, html);
                const filename = path.basename(sourcePath).replace('.html', '');
                const pageResourcesDir = `${path.dirname(sourcePath)}/${filename}`
                if (existsSync(pageResourcesDir)) {
                    // console.log(pageResourcesDir);
                    const destDir = `${path.dirname(absolutePath)}/${path.basename(absolutePath).replace('.html', '')}`;
                    const resources = await readdir(pageResourcesDir);
                    const filesToWrite = [];
                    resources.forEach((resource) => {
                        const extname = path.extname(resource);
                        const resourceName = path.basename(resource);
                        if (extname.length && extname !== '.html') {
                            filesToWrite.push([`${pageResourcesDir}/${resourceName}`, `${destDir}/${resourceName}`]);
                        }
                    });
                    if (filesToWrite.length) {
                        await mkdir(destDir);
                        filesToWrite.forEach(async ([source, dest]) => {
                            await fsExtra.copy(source, dest);
                        });
                    }
                }
            }

            delete file.sourcePath;
            delete file.absolutePath;
            delete file.order;
        }
    };

    async function createDocs () {
        console.log('Generating docs...');

        const files = readdirSync(inputDir);
        for (let i = 0; i < files.length; i++) {
            const filePath = files[i];
            const extname = path.extname(filePath);
            if (extname === '.html') {
                const fullPath = path.resolve(inputDir, filePath);
                const data = await readFile(fullPath);
                const outFullPath = stripEndSHAFromFileName(fullPath);
                const { hasLinks, links } = createPagesMap(data, outFullPath);

                if (hasLinks) {
                    inputDir = fullPath.replace('.html', '');
                    rootDirPath = inputDir;
                    traverseDirectory(inputDir, stripEndSHAFromFileName(inputDir), links).then(async (data) => {

                        await createFiles(data);
                        console.log('Docs generation done');

                        const jsonStr = JSON.stringify(data, null, 4);
                        if (jsonStr) {
                            writeFile(`${outPageDirPath}/page-links.json`, jsonStr).then(() => {
                                console.log('Page links file created');
                            }).catch((err) => {
                                console.log('Failed at Page Links Creation', err);
                            });
                        }
                        existsSync(examplesFile) && createExamplesJson(examplesFile, outExampleDirPath);
                    });
                    break;
                }
            }
        }
    }

    createDocs();
};
