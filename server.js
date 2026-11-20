// The Charged Proxy — server
// Serves the front-end, the Scramjet + Ultraviolet proxy engines, a Wisp
// WebSocket endpoint that carries the proxied traffic, and the DM system.

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import express from "express";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";

import { createChat } from "./chat.js";

const PORT = Number(process.env.PORT) || 8080;
const publicDir = fileURLToPath(new URL("./public/", import.meta.url));
const dataDir = process.env.DATA_DIR || fileURLToPath(new URL("./data/", import.meta.url));

const chat = createChat({ dataDir });

// Don't let proxied pages reach this machine or your local network.
wisp.options.allow_loopback_ips = false;
wisp.options.allow_private_ips = false;
wisp.options.wisp_motd = "The Charged Proxy";
logging.set_level(logging.WARN);

const app = express();
app.disable("x-powered-by");

// public/ comes first so public/uv/uv.config.js overrides the stock config.
app.use(express.static(publicDir));
app.use("/scram/", express.static(scramjetPath));
app.use("/uv/", express.static(uvPath));
app.use("/epoxy/", express.static(epoxyPath));
app.use("/libcurl/", express.static(libcurlPath));
app.use("/baremux/", express.static(baremuxPath));
app.use("/api/", chat.router);

app.use((req, res) => {
  res.status(404).sendFile(join(publicDir, "404.html"));
});

const server = createServer(app);

server.on("upgrade", (req, socket, head) => {
  if (req.url.endsWith("/wisp/")) {
    wisp.routeRequest(req, socket, head);
  } else if (req.url === "/chat") {
    chat.handleUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log("  ⚡ The Charged Proxy is live");
  console.log(`  ➜ http://localhost:${PORT}`);
  console.log("");
});

function shutdown() {
  console.log("\n  Powering down…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
