# Networking and deployment

## What this covers

| Topic | Where |
|---|---|
| Putting nginx (or another reverse proxy) in front: HTTPS, rate limits, real client addresses | this page, and `deploy/` |
| How requests reach the web (HTTP, libcurl, Epoxy, ...) | transports: `docs/ENGINES.md` |
| An upstream HTTP proxy for one user's browsing | Settings -> Connection (needs engine support) |

## nginx

1. Copy `deploy/nginx.conf.example` and `deploy/stream-proxy.conf.example` (save the second as `/etc/nginx/snippets/stream-proxy.conf`). Set your hostname
   and certificate paths, then check with `nginx -t`.
2. In `config.js`:
   ```js
   bindingAddress: '127.0.0.1',                                   // only nginx can reach the app
   network: { trustProxy: ['127.0.0.1'] },                        // read X-Forwarded-For only from nginx
   getServerInfo: () => ({ hostname: 'stream.example.com', port: 443, crossDomainPort: 8443, protocol: 'https:' }),
   ```
   (or the environment variable `RAMMERHEAD_TRUST_PROXY=127.0.0.1`).
3. nginx must **overwrite** `X-Forwarded-For` (the template does) so visitors cannot forge it. The app also trusts the header only when the TCP
   connection comes from an address listed in `trustProxy`.
4. With a non-local bind address, sign-up defaults to `invite`. The first run prints a one-time setup code; more codes: `npm run auth -- invite`.

The site sends its own security headers (`Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and
`Strict-Transport-Security` when the visit arrives over HTTPS, directly or through a trusted proxy). They apply to the site's own pages and
API only, never to the websites opened through the proxy.

## Transports

How requests are carried is chosen per user in **Settings -> Connection**. The built-in HTTP method is always available; libcurl, Epoxy, Bare and
others are plug-ins you add with `npm run transport -- ...`. **A transport only works if the installed engine supports it.** Everything about
them, including the license notes and the security rules for transports that run a relay, is in `docs/ENGINES.md`.

## Upstream proxy

A user may enter `host:port` (or `user:pass@host:port`) in Settings -> Connection. The server refuses a proxy host that is a private or loopback
address. Whether it is honoured depends on the installed engine. For a server-wide upstream proxy, use your operating system's or network's
egress rules.

## Deployment checklist

* Serve it over HTTPS; sign-in tokens are bearer credentials.
* Keep `network.allowPrivateDestinations` at `false` on any shared server.
* Keep `auth.registration` at `invite` or `closed` on a public address.
* Set `site.operator` (and optionally `site.reportEmail`) in `config.js`: the Privacy, Terms and Report pages show them.
* Back up `data/` (accounts and the token-signing secret). Deleting `data/token.secret` signs everyone out.
* Update the engine with `npm run engine -- install ...` and transports with `npm run transport -- ...` (see `docs/ENGINES.md`).
