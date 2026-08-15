import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.js";

const publicRoot = fileURLToPath(new URL("../public", import.meta.url));

test("libera métricas na rede sem pedir PIN", async t => {
  const running = await startServer({ port: 0, root: publicRoot });
  t.after(() => running.close());

  const base = `http://127.0.0.1:${running.port}`;
  const response = await fetch(`${base}/api/monitor`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.ok(body.status);
  assert.ok(Array.isArray(body.services));
  assert.ok(body.history_stats);

  const html = await (await fetch(`${base}/`)).text();
  assert.doesNotMatch(html, /id="systemDetailsToggle"/);
  assert.match(html, /id="systemDetails"[^>]*aria-label="Detalhes do host"[^>]*>/);
  assert.doesNotMatch(html, /id="systemDetails"[^>]*\bhidden\b/);
  assert.match(html, /id="operationList"/);
  assert.doesNotMatch(html, /id="cronTitle"/);
  assert.doesNotMatch(html, /id="serviceTitle"/);
});
