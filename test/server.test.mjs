import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.js";

const publicRoot = fileURLToPath(new URL("../public", import.meta.url));

test("run.sh inicia o servidor a partir da própria pasta", async () => {
  const runScript = await readFile(new URL("../run.sh", import.meta.url), "utf8");
  assert.match(runScript, /cd \"\$\(dirname \"\$0\"\)\"/);
  assert.match(runScript, /exec node server\.js/);
});

test("libera métricas na rede sem pedir PIN", async t => {
  const running = await startServer({ port: 0, root: publicRoot });
  t.after(() => running.close());

  const base = `http://127.0.0.1:${running.port}`;
  const response = await fetch(`${base}/api/monitor`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.j5.device);
  assert.ok(body.j5.bat);
  assert.ok(body.status);
  assert.ok(Array.isArray(body.services));
  assert.ok(body.history_stats);

  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /id="deviceLabel"/);
  assert.doesNotMatch(html, /Samsung Galaxy J5 Prime · pocket VPS/);
  assert.match(html, /id="digestTab"[^>]*hidden/);
  assert.match(html, /id="operationHelp"/);
  assert.match(html, /Nenhum cron configurado/);
  assert.match(html, /function setDigestVisibility\(visible\)/);
  assert.doesNotMatch(html, /id="systemDetailsToggle"/);
  assert.match(html, /id="systemDetails"[^>]*aria-label="Detalhes do host"[^>]*>/);
  assert.doesNotMatch(html, /id="systemDetails"[^>]*\bhidden\b/);
  assert.match(html, /id="operationList"/);
  assert.match(html, /id="statusFavicon"/);
  assert.match(html, /function setStatusFavicon\(state\)/);
  assert.match(html, /state === "ok" \? "#30d158"/);
  assert.match(html, /\["warn", "error", "offline"\]/);
  assert.match(html, /setStatusFavicon\(state\)/);
  assert.match(html, /setConnection\("offline", "sem conexão"\)/);
  assert.match(html, /setState\(\$\("connectionStatus"\), state === "offline" \? "offline" : stale \? "warn" : state\)/);
  assert.doesNotMatch(html, /id="cronTitle"/);
  assert.doesNotMatch(html, /id="serviceTitle"/);
});
