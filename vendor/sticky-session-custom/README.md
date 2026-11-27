# sticky-session-custom (vendored)

Copy of https://github.com/binary-person/sticky-session-custom v1.2.1 (MIT).
Change: `lib/sticky/master.js` uses `lib/ip-to-buffer.js` instead of the `ip` package, which has an advisory with no upstream fix (GHSA-2p57-rm9w-gvfp). Only `toBuffer()` was ever used here.
