# What's new in Rammerhead Stream 1.2.0

Rammerhead Stream is a rework of Rammerhead 1.2.63 by Simon Cheng (binary-person). This file lists what is different from it.

## New in 1.2.0

* **Free software.** Rammerhead Stream is now licensed under the GNU AGPL-3.0, so anyone who changes it and runs it as a service must share their changes.
  A "Source code" link appears in the footer when `site.sourceUrl` is set.
* **libcurl and Epoxy are included.** The two well-known transports ship with the project (with their licenses and sources recorded), and can still be removed,
  replaced or re-added with `npm run transport`.
* **No contact page.** It is gone, and so is every mention of contacting anyone. The help page says plainly that a forgotten password cannot be recovered.
* **Delete my account.** Settings now lets you delete your own account (it asks for your password). The privacy policy points there.
* The optional `site.contactEmail` setting became `site.reportEmail` and only affects the Report page.

## Earlier in this version line (1.1.0)

* **Transports are plug-ins.** Choose how requests are carried in Settings: built-in HTTP, libcurl, Epoxy, Bare or anything an engine offers.
  Add and remove them with `npm run transport` (backups and rollback included). Name a fallback and the page switches to it if the first fails its check.
  A transport is only offered if the engine supports it.
* **No engine in this copy.** `engines/active/` ships empty. You install an engine with `npm run engine -- install`; the interface works without one and explains what is missing.
* **Information pages.** About, Help, Privacy, Terms, Report abuse and Status, written to match what the software really stores.
* **Stronger security.** Strict content-security policy and other headers on every page; the public status page reveals nothing about the server; files that
  should stay private can never be served; automatic checks guard against leaking paths, keys or personal details in what ships.
* **Settings that merge.** `config.js` is merged into the defaults, so a partial setting can no longer wipe out the rest of its group.
* **Renamed credit:** Created by BlackJ.

## Since Rammerhead 1.2.63

* **Your own account.** No more shared password. Passwords and usernames take any characters; only salted hashes are stored; sign-in tokens can be revoked;
  sessions belong to the account that made them; sign-in is rate limited. Invite codes and a one-time setup code make first run easy.
* **A safety layer.** Refuses local files, loopback, private and cloud-metadata addresses and mail or database ports, resists DNS rebinding, and applies to HTTP/2 too.
* **Replaceable engine.** The browsing engine moved behind a versioned contract with an installer, validation, backups and rollback.
* **A new interface.** Sign-in, tabs (real browser tabs, no iframes), bookmarks, history, light and dark themes, search choice, an engine guide.
* **Fixed caching.** The in-memory script cache never returned anything; cache keys ignored the context; disk writes could be read half-finished. All fixed.
* **Fixes from Rammerhead 1.2.64** in the engine package: a `postMessage` problem, a transport-worker crash, a websocket fix, and HTTP/2 allowed by default.
* **Dependencies.** Current versions throughout, zero `npm audit` findings, and a vendored load balancer replacing a vulnerable dependency.
* **Tests.** Well over a hundred automated tests, including a real-engine suite that runs once an engine is installed.
