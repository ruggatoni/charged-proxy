# ⚡ The Charged Proxy

A web proxy with a teal-to-violet "charged" look and the Charged Goat as its mascot. It runs on your own computer, either as the **Charged Browser** desktop app or as a site at `localhost`.

## Charged Browser (desktop app)

```bash
npm install
npm run browser
```

This starts the proxy on `localhost:8080` and opens it in its own window, with a custom title bar and browser shortcuts. If a Charged Proxy is already running there (from `npm start`), the app connects to that one instead.

To build an app you can double-click:

```bash
npm run package
```

That writes `dist/Charged Browser-win32-x64/Charged Browser.exe` (or the macOS/Linux equivalent when you build on those systems). The whole folder is the app, so keep it together.

### Shortcuts

| Keys | Does |
|---|---|
| `Ctrl+L` | Jump to the address bar |
| `Ctrl+R` / `F5` | Reload the page |
| `Alt+←` / `Alt+→` | Back / forward (mouse side buttons work too) |
| `Alt+Home` | Home screen |
| `Ctrl+T` / `Ctrl+N` | New window |
| `Ctrl+W` | Close window |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom in / out / reset |
| `F11` | Full screen |
| `Ctrl+Shift+R` | Reload the whole app |

On macOS, use `Cmd` instead of `Ctrl`.

## In a regular browser

```bash
npm start
```

Then open http://localhost:8080.

## What's inside

| Piece | What it does |
|---|---|
| `server.js` | Express server. Serves the site and the proxy engines, and carries proxy traffic over a Wisp WebSocket at `/wisp/`. Listens on `127.0.0.1` only. |
| `electron/` | The Charged Browser app: `main.js` (window, shortcuts, permissions), `preload.cjs`, the icon, and `package.js` (the build script). |
| `public/` | The front-end: home page, in-page browser and settings. |
| `public/sw.js` | Service worker that hands proxied requests to Scramjet (`/scramjet/…`) or Ultraviolet (`/uv/service/…`). |

**Proxy engines** (Settings → Proxy engine): Scramjet is the default and handles heavy sites such as YouTube. Ultraviolet is the fallback.
**Transports** (Settings → Transport): libcurl is the default. Epoxy currently fails on Google/YouTube with an HTTP/2 error.

## Settings you can change

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Port to listen on. The app tries the next 9 ports if this one is taken by something else. |
| `HOST` | `127.0.0.1` | Address `npm start` listens on. Leave it alone to keep the proxy private to this computer. |

## Security

- **Don't sign in to accounts that matter through the proxy.** Every site you open shares one `localhost` origin, so a hostile site that breaks out of the proxy's rewriting could read other sites' logins or show a fake address in the address bar. That's true of all web proxies.
- The proxy only listens on this computer (`127.0.0.1`).
- Only the Charged Proxy's own pages can open the `/wisp/` tunnel. Other websites, scripts and DNS-rebinding tricks get `403`, so nobody can route traffic through your computer.
- Proxied pages can't reach your own machine or local network (loopback, private, link-local and IPv6 equivalents are all blocked), and UDP is off.
- The app never gives sites your camera, microphone, location or notifications, and pages can't take over its window.
- `npm run package` locks the built app's Electron fuses, so it can't be used as a plain Node.js runtime or have code injected through `--inspect` or `NODE_OPTIONS`.

## Notes

- Service workers only run over **HTTPS or localhost**, which is why everything runs at `localhost`.

## License

Copyright (C) 2026 ruggatoni

The Charged Proxy and Charged Browser are licensed under the [GNU Affero General Public License v3.0](LICENSE), because they include AGPL-licensed proxy transports (libcurl and Epoxy). If you give someone the app, you also need to offer them this source code.
