// Copy of the client-side URL shuffler (public/script.js) so tests exercise the same algorithm the browser uses.
const mod = (n, m) => ((n % m) + m) % m;
const base = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~-';
module.exports = class Shuffler {
    constructor(dictionary) { this.dictionary = dictionary; }
    shuffle(str) {
        if (str.startsWith('_rhs')) return str;
        let out = '';
        for (let i = 0; i < str.length; i++) {
            const c = str.charAt(i);
            const idx = base.indexOf(c);
            if (c === '%' && str.length - i >= 3) out += c + str.charAt(++i) + str.charAt(++i);
            else if (idx === -1) out += c;
            else out += this.dictionary.charAt(mod(idx + i, base.length));
        }
        return '_rhs' + out;
    }
};
