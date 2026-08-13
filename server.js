import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { networkInterfaces } from "node:os";
import { createMonitor } from "./monitor.js";

const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

const SEC_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  ...SEC_HEADERS,
};

function fail(res, err) {
  console.error("[server-box] monitor error:", err);
  res.writeHead(500, JSON_HEADERS);
  res.end(JSON.stringify({ ok: false, error: "não foi possível ler o status" }));
}

function bootIps() {
  const ips = { lan: null, tailscale: null };
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos || []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (info.address.startsWith("100.")) ips.tailscale = info.address;
      else if (ips.lan === null) ips.lan = info.address;
    }
  }
  return ips;
}

export async function startServer(opts = {}) {
  const root = opts.root ?? join(import.meta.dirname, "public");
  const port = opts.port ?? (Number(process.env.PORT) || 8080);
  const monitor = createMonitor();

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const ok = body => { res.writeHead(200, JSON_HEADERS); res.end(JSON.stringify(body)); };

    if (url.pathname === "/health") {
      res.writeHead(200, JSON_HEADERS);
      res.end(JSON.stringify({ ok: true, service: "server-box" }));
      return;
    }

    if (url.pathname === "/api/monitor") {
      Promise.resolve()
        .then(() => monitor.get())
        .then(d => ok({ ok: true, ...d }))
        .catch(err => fail(res, err));
      return;
    }

    // static (único html: status.html)
    const file = url.pathname === "/" ? "/status.html" : url.pathname;
    const p = join(root, file);
    if (!resolve(p).startsWith(resolve(root))) {
      res.writeHead(403, JSON_HEADERS);
      res.end(JSON.stringify({ ok: false, error: "acesso negado" }));
      return;
    }
    readFile(p).then(b => {
      res.writeHead(200, {
        "Content-Type": `${MIME[extname(p)] || "text/plain"}; charset=utf-8`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        ...SEC_HEADERS,
      });
      res.end(b);
    }).catch(() => { res.writeHead(404); res.end("not found"); });
  });

  await new Promise((res, rej) => {
    server.once("error", rej);
    server.listen(port, () => { server.off("error", rej); res(); });
  });

  const close = () => new Promise(resolve => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });

  return { port: server.address().port, close };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
    .then(({ port }) => {
      const ips = bootIps();
      console.log(`server-box ouvindo em http://0.0.0.0:${port}`);
      if (ips.lan) console.log(`  LAN:        http://${ips.lan}:${port}`);
      if (ips.tailscale) console.log(`  Tailscale:  http://${ips.tailscale}:${port}  (qualquer dispositivo, fora de casa)`);
    })
    .catch(err => { console.error(err); process.exitCode = 1; });
}
