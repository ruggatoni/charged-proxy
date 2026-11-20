# ⚡ The Charged Proxy

A web proxy with a teal-to-violet "charged" look, the Charged Goat as its mascot, and built-in DMs.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:8080.

Requires Node 22.13 or newer, for the built-in SQLite that stores DMs.

## What's inside

| Piece | What it does |
|---|---|
| `server.js` | Express server. Serves the site and the proxy engines, and routes WebSocket upgrades (`/wisp/` for proxy traffic, `/chat` for DMs). |
| `chat.js` | Accounts and DMs: sign up, log in, conversations, blocking, live delivery over WebSocket. Data lives in `data/charged.db`. |
| `public/` | The front-end: home page, in-page browser, settings, and the Messages panel. |
| `public/sw.js` | Service worker that hands proxied requests to Scramjet (`/scramjet/…`) or Ultraviolet (`/uv/service/…`). |

**Proxy engines** (Settings → Proxy engine): Scramjet is the default and handles heavy sites such as YouTube. Ultraviolet is the fallback.
**Transports** (Settings → Transport): libcurl is the default. Epoxy currently fails on Google/YouTube with an HTTP/2 error.

## Settings you can change

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on |
| `DATA_DIR` | `./data` | Where `charged.db` (accounts + DMs) is stored. On a host, point this at a persistent disk or DMs are lost on every redeploy. |

## Notes

- Service workers only run over **HTTPS or localhost**, so a hosted copy needs HTTPS.
- Passwords are hashed with scrypt. Sessions use an HttpOnly cookie that lasts 30 days.
- Proxied pages can't reach your own machine or local network (Wisp blocks loopback and private IPs).
