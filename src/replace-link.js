const https = require('https');
const cheerio = require('cheerio');

function tryParseJSON (jsonString) {
    try {
        const o = JSON.parse(jsonString);

        if (o && typeof o === 'object') {
            return o;
        }
    }
    catch (e) { }

    return false;
}

module.exports = (url, elem, themeId) => new Promise((res, rej) => {
    const req = https.get(url, (resp) => {
        let data = '';
        resp.on('data', (chunk) => {
            data += chunk;
        });
        resp.on('end', () => {
            if (tryParseJSON(data)) {
                let { html } = JSON.parse(data);
                const $ = cheerio.load(html);
                const src = `${$('iframe').attr('src')}&editable=true&theme-id=${themeId}`;
                // $('iframe').attr('src', 'sss');
                $('iframe').attr('src', src);
                elem.replaceWith($.html());

                res({ type: 'success', html: $.html() });
            } else {
                res({ type: 'fail', elem, url });
            }
        });
    });
    req.on('error', (e) => {
        console.log('Codepen error', e);
    });
});
