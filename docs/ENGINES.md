# Engines and transports

Rammerhead Stream is split in two. The **core** is the interface, accounts, safety rules and settings. The **engine** is the part that
fetches and rewrites web pages. They talk through a small versioned contract, so the engine can be replaced without changing
anything else. **Transports** are a second kind of plug-in: the methods an engine can use to carry its requests (HTTP, libcurl,
Epoxy, ...). You add and remove both with a command, and both are backed up so you can go back.

This copy ships **without an engine**. You install the one you want, then add any transports it supports.

---

## 1. Installing or replacing an engine

The engine lives in `engines/active/`. The folder is permanent; **its contents are the engine**. (The same steps are on the page `/engine`
in the running site.)

```
npm run engine -- install /path/to/new-engine   # backs up the current engine, puts the new one in the folder
npm run engine:setup                            # installs its dependencies and builds it
npm run engine -- validate                      # loads it and checks health
npm start
npm run engine -- rollback                      # if anything is wrong
```

`npm run engine -- status` shows what is installed; `npm run engine -- backups` lists backups. You can also do it by hand: stop the app,
empty `engines/active/` (keep the folder), copy the new engine in so that `manifest.json` sits directly inside it, then run `setup`,
`validate` and `npm start`.

* `install` only reads `manifest.json`; it does not run the new engine. `setup` runs `npm ci --ignore-scripts` and then the engine's own
  `build` script, and `validate` loads it. Review an engine's source before installing it: it runs with this app's permissions.
* Symlinks inside an engine package are refused.
* If the engine is missing, broken or incompatible the app still starts, keeps the interface up, and says why. It never falls back to an
  incompatible engine.

| Status | Meaning | What to do |
|---|---|---|
| `ready` | Loaded and healthy | |
| `missing` | `engines/active/` is empty or has no `manifest.json` | Install an engine |
| `invalid-manifest` | The manifest is broken or the entry has no `create()` | `npm run engine -- status` |
| `incompatible` | Different contract version, needs a newer Node, or an incomplete engine | Use an engine built for contract 1 |
| `failed` | It threw while loading (often missing dependencies) | `npm run engine:setup`, then `validate` |

## 2. The engine contract (version 1)

An engine is a folder with `manifest.json`, an entry file, and optionally its own `package.json` and dependencies.

```json
{
  "contract": 1, "id": "my-engine", "name": "My Engine", "version": "2.3.0", "entry": "index.js", "node": ">=20",
  "capabilities": { "websocket": true, "scriptEngines": ["js"], "transports": ["http", "libcurl"], "transportTest": true }
}
```

The entry file exports `create(host)` and returns the engine:

```js
exports.create = async function create(host) { /* ... */ return engine; };
```

**host** (given by the core)

| field | meaning |
|---|---|
| `host.logger` | `.debug/.info/.warn/.error(string)` |
| `host.config` | `bindingAddress, port, crossDomainPort, ssl, enableWorkers, workers, getServerInfo(req), getIP(req), disableLocalStorageSync, jsCache, sessionStore, restrictSessionToIP, stripClientHeaders, rewriteServerHeaders, disableHttp2, scriptEngine, transport, isMaster` |
| `host.guard` | `checkDestination(url)` -> reason or `null`; `parseDestination(path)`; `lookup` (a `dns.lookup` replacement, or `null` when private targets are allowed); `checkProxyHost(host)` |
| `host.transports` | `get(id)` -> the loaded server part of a transport plug-in (or `null`); `list()`. Filled after the engine is created, so read it at request time |

**engine** (returned)

| member | required | meaning |
|---|---|---|
| `info` | yes | `{ id, name, version }` |
| `http.GET(route, handler)`, `http.POST(route, handler)` | yes | register a route; the handler is `(req,res)=>` or `{content, contentType}` |
| `http.addToOnRequestPipeline(fn, atEnd)`, `http.addToOnUpgradePipeline(fn, atEnd)` | yes | hooks that run before proxying; return `true` to stop |
| `http.servers` | yes | array of node `http(s)` servers (main, optional cross-domain) |
| `sessions.create({owner, ip})` | yes | returns a new session id (32 alphanumeric characters) |
| `sessions.exists(id)`, `sessions.ownerOf(id)`, `sessions.remove(id)` | yes | |
| `sessions.configure(id, opts)` | yes | async. `opts` may hold `httpProxy`, `shuffle`, `scriptEngine` and `transport`. Throw an error with a 4xx `.status` and a safe `.message` for bad input |
| `sessions.shuffleDict(id)` | yes | the dictionary string, or `null` |
| `sessionIdFromUrl(url)` | yes | keeps a session on one worker process |
| `health()` | yes | `{ ok: boolean, details?: { name: number\|boolean\|short string } }`. Signed-in users can see `details` in the status (for example counters), so keep secrets out of it |
| `close()` | yes | release ports and flush state |
| `transports.test(id)` | no | `async` -> `{ ok, error? }`; lets Settings check a transport (also declare `capabilities.transportTest: true`) |
| `reservedRoutes` | no | paths the interface must not use |

**Rules an engine must follow**

* Browsing URLs are `/<sessionId>/<destination url>`. Before connecting anywhere, call `host.guard.checkDestination` and refuse with HTTP 403, and
  use `host.guard.lookup` for name resolution when it is not `null`. This is what blocks `file:`, loopback and private addresses.
* When `host.config.enableWorkers` is `false` the engine listens itself; when `true` it must not, because the load balancer attaches to `http.servers`.
* A session may only be used by the account that created it (the core enforces this on the session routes).
* Never log cookies, `Authorization` headers or session ids at `info` level or above.
* Throw from `create()` rather than returning a half-working object.

Changing the contract incompatibly means raising the version in `src/engine/manifest.js` (`SUPPORTED_CONTRACTS`); engines declaring an unsupported
version are refused with a clear message.

---

## 3. Transports

> ### Make sure your engine is compatible with the transport
> **A transport can only be used if the installed engine supports it.** Adding a transport to the `transports/` folder does not make an engine
> able to use it. If the engine does not list the transport in `capabilities.transports`, Settings shows it as unusable and the server refuses to
> select it. Before you add libcurl, Epoxy or any other transport, check that **your engine is built for it** and works with it. If it does not,
> you simply cannot use that transport with that engine.

A transport is *how requests reach the web*. The built-in **HTTP** method is always available. Others are plug-ins in `transports/<id>/`.
Users choose one in **Settings -> Connection**, can name a **fallback**, and can **test** it. When a fallback is set and the engine can check
transports, the chosen one is tested before each page opens and the fallback is used if the test fails.

### Included, and the ones you can add

**libcurl** and **Epoxy** (also written "eproxy") come with the project, in `transports/libcurl/` and `transports/epoxy/`. Remove either one, or replace it with
a different version or your own build, whenever you like (see below). **Bare** and anything else can be added later.

| Transport | Included? | License of the package | It also needs |
|---|---|---|---|
| libcurl | Yes (`@mercuryworkshop/libcurl-transport` 2.0.6) | AGPL-3.0-only (it contains libcurl.js, LGPL-3.0-or-later) | An engine built for it, and a Wisp server endpoint |
| Epoxy | Yes (`@mercuryworkshop/epoxy-transport` 3.0.2) | AGPL-3.0-only (it contains epoxy-tls, AGPL-3.0-only) | An engine built for it, and a Wisp server endpoint |
| Bare | No: `npm run transport -- add bare --accept-license` | LGPL-3.0 | An engine built for it, and a Bare server endpoint |

Rammerhead Stream is itself licensed under the AGPL-3.0, which is what allows the AGPL-licensed libcurl and Epoxy packages to ship with it. Their license
texts and sources are in each plug-in folder (`LICENSE`, `NOTICE.txt`) and in `THIRD-PARTY-NOTICES.md`. Keep them if you pass the project on. Packages added later
carry their own license, so read it: the `add` command shows it first.

### Managing transports

```
npm run transport -- list                       # what is installed and what can be added
npm run transport -- add libcurl --accept-license
npm run transport -- install /path/to/transport # a plug-in you already have (folder or .tgz)
npm run transport -- remove libcurl             # backed up first; bring it back with rollback
npm run transport -- validate [id]              # check manifests and load server parts
npm run transport -- backups
npm run transport -- rollback [name]
```

Restart the server after adding or removing one. A user who had chosen a transport that is gone is moved back to the default automatically.
`install` and `add` only copy files and read `manifest.json`; nothing runs until the server starts. Symlinks in a plug-in are refused. Removing one is safe and reversible: the folder moves to `transports/_backups/`, and `rollback` puts it back. Installing a plug-in with an id that already exists replaces it (the old one is backed up first), which is how you swap libcurl or Epoxy for another build.

### When is a transport usable?

All of these must be true. Settings explains which one is missing.

1. It is the built-in HTTP method, **or** a plug-in that is installed and loaded **or** an engine-internal transport the engine lists in `capabilities.builtinTransports`.
2. The engine lists it in `capabilities.transports`.
3. The plug-in's manifest says it works with this engine (`"engines": ["*"]`, or a list containing the engine's id).
4. The administrator has not excluded it (`transport.allowed` in `config.js`; empty means everything is allowed).

### Plug-in format

```
transports/libcurl/
  manifest.json      required
  public/            optional: served read-only at /transports/libcurl/ (names starting with "_" or "." are never served)
  index.js           optional: a server part exporting create(host)
  LICENSE            keep the license that came with it
```

```json
{ "contract": 1, "id": "libcurl", "name": "libcurl", "version": "2.0.6", "description": "...", "license": "AGPL-3.0-only",
  "assets": "public", "entry": "index.js", "engines": ["*"], "node": ">=20" }
```

The folder name must equal `id`. A server part's `create(host)` receives `host.logger`, `host.guard`, `host.http` (the same route surface the engine has),
`host.auth.authenticate(req)`, `host.engine` (`{id, name, version, capabilities}` or `null`) and `host.transport` (`{id, dir}`). It may return `test()`
(used by Settings) and `close()` (called on shutdown). A plug-in that fails to load is reported and skipped; it never stops the server.

**Security for transport authors.** Anything that opens connections for users (a Wisp or Bare server, for example) is a relay for whoever can reach it.
It must require sign-in (`host.auth.authenticate`), must refuse destinations that `host.guard.checkDestination` refuses, and must resolve names with
`host.guard.lookup`. A relay without these checks would undo the protections the rest of the site has.

### Notes for engine authors

* List the transports you can drive in `capabilities.transports` (ids such as `http`, `libcurl`, `epoxy`, `bare`; `node` is accepted as an alias of `http`,
  `eproxy` as an alias of `epoxy`). Only list what is genuinely supported.
* Read the user's choice from `sessions.configure(id, { transport })`. The core has already checked that it is usable.
* A transport's browser files are at `/transports/<id>/`, and its server part, if any, is `host.transports.get(id)`.
* Declare `capabilities.transportTest: true` and implement `engine.transports.test(id)` if you can check a transport; plug-ins can also provide their own `test()`.
