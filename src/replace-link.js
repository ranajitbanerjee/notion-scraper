const https = require('https');

module.exports = (url, elem) => new Promise((res, rej) => {
    https.get(url, (resp) => {
        let data = '';

        resp.on('data', (chunk) => {
            data += chunk;
        });

        resp.on('end', () => {
            try {
                const { html } = JSON.parse(data);
                res(html);
                elem.replaceWith(html);
            } catch (err) {
                console.log('Error parsing', data, url);
                rej();
            }
        });
    });
});
