# Third-party notices

Rammerhead Stream is licensed under the GNU AGPL-3.0 (see `LICENSE` and `NOTICE.md`). It includes or builds on the components below. Each is used
under its own license, and these notices must be kept with any copy of this software.

## Code this project is derived from or ships

| Component | License | Copyright / author | Source |
|---|---|---|---|
| Rammerhead (parts of the server, the session model and the URL obscuring routine are derived from 1.2.x) | MIT | Copyright (c) Simon Cheng (binary-person) | https://github.com/binary-person/rammerhead |
| sticky-session-custom (vendored in `vendor/sticky-session-custom`) | MIT | Copyright (c) Simon Cheng; derived from sticky-session, Copyright (c) Fedor Indutny | https://github.com/binary-person/sticky-session-custom |
| async-exit-hook | MIT | Copyright (c) Sindre Sorhus | https://github.com/sindresorhus/async-exit-hook |
| debug | MIT | Copyright (c) 2014-2017 TJ Holowaychuk; Copyright (c) 2018-2021 Josh Junon | https://github.com/debug-js/debug |
| http-parser-js | MIT | Copyright (c) 2015 Tim Caswell and other contributors | https://github.com/creationix/http-parser-js |
| ms | MIT | Copyright (c) 2020 Vercel, Inc. | https://github.com/vercel/ms |

## Transport plug-ins bundled in `transports/`

These are the built files (`dist/`) of the official npm packages, copied without changes. Each folder holds the package's license text and a
`NOTICE.txt` naming the exact package and version. Both can be removed or replaced with `npm run transport -- remove <id>` (see `docs/ENGINES.md`).

| Plug-in | Package and version | License | Author | Corresponding source |
|---|---|---|---|---|
| `transports/libcurl` | `@mercuryworkshop/libcurl-transport@2.0.6` | AGPL-3.0-only | ading2210 | https://github.com/MercuryWorkshop/libcurl-transport |
| built into the libcurl plug-in | `libcurl.js@0.7.5` (builds on libcurl and other libraries; see its repository for their licenses) | LGPL-3.0-or-later | ading2210 | https://github.com/ading2210/libcurl.js |
| `transports/epoxy` | `@mercuryworkshop/epoxy-transport@3.0.2` | AGPL-3.0-only | MercuryWorkshop | https://github.com/MercuryWorkshop/epoxy-transport |
| built into the Epoxy plug-in | `@mercuryworkshop/epoxy-tls@2.1.20-1` | AGPL-3.0-only | MercuryWorkshop | https://github.com/MercuryWorkshop/epoxy-tls |

The licenses and authors above were read from the packages' own npm metadata. The same files can be rebuilt from the sources listed, and the
exact published packages are at `https://www.npmjs.com/package/<package>/v/<version>`.

An engine installed in `engines/active/` is a separate component with its own license and notices, which the person who installs or ships it
is responsible for keeping. A transport added later with `npm run transport -- add` records the same details in its own `NOTICE.txt`.

## MIT License (applies to each MIT component above, with that component's copyright holder)

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
