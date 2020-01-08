const handshake = new Postmate.Model({
    height: () => document.height || document.body.offsetHeight,
    href: () => window.location.href
});
handshake.then((parent) => {
    window.onclick = (e) => {
        if (e.target.href) {
            parent.emit('click', e.target.href);
        }
        if (e.tagName === 'A') {
            e.preventDefault();
            e.stopPropagation();
        }
    };
});
