# Rammerhead Stream

**Created by BlackJ.** A web proxy with accounts, browser tabs, bookmarks and history, a strict safety layer, and two kinds of plug-in:
a replaceable **engine** and replaceable **transports**. Built on ideas and code from Rammerhead by Simon Cheng (binary-person).
Free software under the **GNU AGPL-3.0**: see `LICENSE` and `NOTICE.md`. Third-party notices: `THIRD-PARTY-NOTICES.md`. What changed: `WHATS_NEW.md`.

> **This copy ships without an engine.** The interface, accounts and safety rules run on their own, but nothing can be browsed until you
> install an engine (and optionally transports). See `docs/ENGINES.md`, or the page `/engine` once the server is running.

## Quick start

```
npm run setup          # installs the app's dependencies
npm start              # http://localhost:8080
```

Requires **Node 20 or newer**. The first visit shows the sign-in screen and a banner saying that no engine is installed.

1. **Create an account.** There is no shared or default password. Usernames and passwords may contain any characters (password: 8+; username: 3 to 32).
   On a server that requires invite codes (the default for any address other than localhost) the first run prints a one-time setup code in the terminal.
   More codes: `npm run auth -- invite`. Reset a password: `npm run auth -- set-password <name>`.
2. **Install an engine** (see below), then restart.
3. **Optionally add transports** (see below).
4. Copy `config.example.js` to `config.js` to change settings. Only list what you change; settings are merged into the defaults.

## Engines

The engine fetches and rewrites web pages. It lives in `engines/active/` (the folder stays; its contents are the engine):

```
npm run engine -- install /path/to/engine   # backs up the current one, puts the new one in the folder
npm run engine:setup                        # installs its dependencies and builds it
npm run engine -- validate                  # loads it and checks health
npm run engine -- rollback                  # go back if something is wrong
```

An engine must implement the contract in `docs/ENGINES.md`. If it is missing or broken the app still starts and says why.

## Transports

A transport is the method used to carry requests: the built-in HTTP method, **libcurl**, **Epoxy** (also written "eproxy"), **Bare**, or others.
**libcurl and Epoxy come with the project.** All of them are plug-ins in `transports/`, removed, replaced and added with a command, and chosen per user
in **Settings -> Connection**, with a fallback and a Test button:

```
npm run transport -- list
npm run transport -- remove libcurl                    # backed up first; `rollback` brings it back
npm run transport -- add libcurl --accept-license      # downloads the official package again (also how you update it)
npm run transport -- add bare --accept-license         # others you can add
npm run transport -- install /path/to/transport        # your own build
```

> **A transport only works if the installed engine supports it.** Make sure your engine is compatible with a transport before you rely on it:
> if the engine does not list it, Settings shows it as unusable and the server refuses to select it. Details and the plug-in format: `docs/ENGINES.md`.

## What is in it

| Area | What | Where |
|---|---|---|
| Accounts | Own username and password per person (any characters), scrypt hashes, revocable tokens, rate limits, invite or closed sign-up, admin tool `npm run auth` | `src/auth/` |
| Safety | Refuses `file:`, loopback, private and metadata addresses, and mail and database ports; DNS-rebinding safe; sessions belong to their account | `src/util/destinationGuard.js` |
| Interface | Sign-in, address bar, tabs (real browser tabs, no iframes), bookmarks, history, themes, Settings | `public/` |
| Site pages | About, Help, Privacy, Terms, Report abuse, Status, Engine guide; shared header and footer | `public/` |
| Security headers | Strict content-security policy, `nosniff`, framing denied, HSTS over HTTPS; the public status shows only "ready or not" | `src/site/` |
| Engines and transports | Versioned contracts, installers, backups, rollback, compatibility checks | `src/engine/`, `src/transports/`, `scripts/` |
| Deployment | nginx template (HTTPS, rate limits, websockets, real client addresses) | `deploy/`, `docs/NETWORKING.md` |

## The site's pages

Set `site.operator` (and optionally `site.reportEmail`) in `config.js`: the Privacy, Terms and Report pages show them. Pages are plain HTML in `public/`
built from small shared parts in `public/_partials/`; files starting with `_` or `.` are never served. Turn the engine guide off with `site.engineGuide: false`.

## Tests

```
npm test            # runs everything that can run on this copy
```

Tests that need a real engine to carry real traffic (the safety guard against loopback and `file:`, a full proxied page, multi-worker mode) run
automatically once an engine is installed and are skipped before that. Everything else uses a small test engine.

## Known limitations

* **No engine is included**, so a fresh copy cannot browse until you install one. A transport only works with an engine built for it.
* The bundled libcurl and Epoxy plug-ins are served and managed by this software, but carrying real traffic with them needs an engine built for them and
  (for both) a Wisp server. That pairing was not tested here, because it needs an engine that supports them.
* Tabs are real browser tabs opened by the main page and listed there while it stays open. Pop-up blockers can force pages into the current tab.
* The interface is tested in a simulated browser, not in Chrome, Firefox or Safari. Please click through it once in a real browser.
* Login rate limits are per worker process. Server-side session data is stored on disk unencrypted (`sessions/`).
* The engine decides the caching headers of the pages it serves, so a changed page can take up to about 30 seconds to appear.

## License

Rammerhead Stream is free software under the **GNU Affero General Public License, version 3** (`LICENSE`). You may use, study, change and share it. If you
modify it and let people use your version over a network, the AGPL requires you to offer those users your source code: set `site.sourceUrl` in `config.js`
and the site shows a "Source code" link. Components it builds on or bundles keep their own licenses, listed in `THIRD-PARTY-NOTICES.md`.
