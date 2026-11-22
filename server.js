// The Charged Proxy — server
// Serves the front-end, the Scramjet + Ultraviolet proxy engines, and a Wisp
// WebSocket endpoint that carries the proxied traffic. Listens on this
// computer only (127.0.0.1) unless HOST says otherwise.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import express from "express";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

const publicDir = fileURLToPath(new URL("./public/", import.meta.url));

// Don't let proxied pages reach this machine or your local network.
wisp.options.allow_loopback_ips = false;
wisp.options.allow_private_ips = false;
wisp.options.allow_udp_streams = false; // web pages only need TCP
wisp.options.wisp_motd = "The Charged Proxy";
logging.set_level(logging.WARN);

// Only the Charged Proxy's own pages may open the tunnel. Browsers let any
// website open a WebSocket to localhost, so without this check a site you
// visit in your normal browser could quietly route traffic through your
// computer. Matching Host too stops DNS-rebinding tricks.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function fromOwnPage(req) {
  const host = req.headers.host;
  const origin = req.headers.origin;
  if (!host || !origin) return false;
  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }
  return originUrl.protocol === "http:" && originUrl.host === host && LOCAL_HOSTNAMES.has(originUrl.hostname);
}

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("X-Frame-Options", "SAMEORIGIN"); // other websites can't embed the app
  next();
});

// public/ comes first so public/uv/uv.config.js overrides the stock config.
app.use(express.static(publicDir));
app.use("/scram/", express.static(scramjetPath));
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));
app.use("/baremux/", express.static(baremuxPath));

// Lets the Charged Browser recognise a proxy that's already running.
app.get("/charged.json", (req, res) => {
  res.json({ name: "charged-proxy" });
});

app.use((req, res) => {
  res.status(404).sendFile(join(publicDir, "404.html"));
});

/** Start the proxy. Resolves with the http.Server once it's listening. */
export function startServer({ port = 8080, host = "127.0.0.1" } = {}) {
  return new Promise((resolvePromise, reject) => {
    const server = createServer(app);

    server.on("upgrade", (req, socket, head) => {
      if (req.url === "/wisp/" && fromOwnPage(req)) {
        wisp.routeRequest(req, socket, head);
      } else {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      }
    });

    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolvePromise(server);
    });
  });
}

// `node server.js` / `npm start`: run it as a standalone server.
const runDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runDirectly) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || "127.0.0.1";
  const server = await startServer({ port, host });

  console.log("");
  console.log("  ⚡ The Charged Proxy is live");
  console.log(`  ➜ http://localhost:${port}`);
  console.log("");

  const shutdown = () => {
    console.log("\n  Powering down…");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
