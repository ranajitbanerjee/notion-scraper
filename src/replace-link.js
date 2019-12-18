const https = require('https');
const cheerio = require('cheerio');

module.exports = (url, elem) => new Promise((res, rej) => {
    https.get(url, (resp) => {
        let data = '';
        resp.on('data', (chunk) => {
            data += chunk;
        });
        resp.on('end', () => {
            try {
                let { html } = JSON.parse(data);
                const $ = cheerio.load(html);
                const src = `${$('iframe').attr('src')}&editable=true`;
                // $('iframe').attr('src', 'sss');
                $('iframe').attr('src', src);
                res($.html());
                elem.replaceWith($.html());
            } catch (err) {
                console.log('Error parsing', data, url);
                rej();
            }
        });
    });
});