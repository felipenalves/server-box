import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDigestLog, collectDigestStats } from "../digest-stats.mjs";
import { startServer } from "../server.js";

const publicRoot = fileURLToPath(new URL("../public", import.meta.url));

const LOG_FIXTURE = [
  "[2026-08-17T11:00:47.435Z] coletados OpenAI 1130 + Anthropic 14 · candidatas 3 · fontes reais 3",
  "[2026-08-17T11:05:07.485Z] enviado digest com 2 itens; marcadas 4 chaves",
  "[2026-08-17T12:00:07.588Z] sem notícia quente nesta hora; nada enviado (acordo)",
  "[2026-08-17T13:00:06.182Z] sem notícia quente nesta hora; nada enviado (acordo)",
  "[2026-08-17T14:00:37.212Z] LLM não aprovou nenhuma candidata; digest não enviado",
  "[2026-08-17T15:00:28.464Z] LLM não aprovou nenhuma candidata; digest não enviado",
  "[2026-08-17T16:00:44.622Z] enviado digest com 1 itens; marcadas 2 chaves",
  "[2026-08-17T17:00:42.218Z] LLM não aprovou nenhuma candidata; digest não enviado",
  "[2026-08-17T18:00:37.212Z] LLM não aprovou nenhuma candidata; digest não enviado",
  "[2026-08-17T19:00:03.001Z] ERRO: LLM falhou em todos os modelos: 429",
].join("\n");

const STATE_FIXTURE = JSON.stringify({
  last_run: "2026-08-17T19:00:01.218Z",
  sent: { a: "2026-08-17T11:05:07.485Z", b: "2026-08-17T16:00:44.622Z" },
  documente_pending: { "2026-08-17": { editionKey: "2026-08-17" } },
  source_health: {
    openai: { ok: true, checkedAt: "2026-08-17T19:00:07.218Z", count: 1132 },
    anthropic: { ok: false, checkedAt: "2026-08-17T19:00:08.218Z", count: 0, error: "HTTP 500" },
    cursor: { ok: true, checkedAt: "2026-08-17T19:00:09.218Z", count: 50 },
  },
});

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "sb-digest-test-"));
  writeFileSync(join(dir, "digest.log"), LOG_FIXTURE);
  writeFileSync(join(dir, "state.json"), STATE_FIXTURE);
  return dir;
}

test("parseDigestLog agrupa por dia e conta envios, rejeições e erros", () => {
  const parsed = parseDigestLog(LOG_FIXTURE);
  assert.equal(parsed.days.length, 1);
  const day = parsed.days[0];
  assert.equal(day.runs, 10);
  assert.equal(day.sent, 2);
  assert.equal(day.items, 3);
  assert.equal(day.rejected, 4);
  assert.equal(day.no_hot, 2);
  assert.equal(day.errors, 1);
  assert.equal(parsed.lastRuns.length, 10);
  assert.equal(parsed.lastRuns[0].msg, "ERRO: LLM falhou em todos os modelos: 429");
});

test("parseDigestLog ignora linhas sem timestamp e limites de janela", () => {
  const parsed = parseDigestLog("linha solta\n[2026-08-17T11:00:01.000Z] modo morning", 7);
  assert.equal(parsed.days.length, 1);
  assert.equal(parsed.days[0].runs, 1);
  assert.equal(parsed.lastRuns.length, 1);
});

test("collectDigestStats lê state e log do diretório informado", () => {
  const stats = collectDigestStats({ newsDir: fixtureDir() });
  assert.equal(stats.available, true);
  assert.equal(stats.last_run, "2026-08-17T19:00:01.218Z");
  assert.equal(stats.sent_total, 2);
  assert.equal(stats.pending_documente, 1);
  assert.equal(stats.sources.length, 3);
  const anthropic = stats.sources.find((source) => source.id === "anthropic");
  assert.equal(anthropic.ok, false);
  assert.equal(anthropic.error, "HTTP 500");
  const cursor = stats.sources.find((source) => source.id === "cursor");
  assert.equal(cursor.name, "Cursor");
  assert.equal(cursor.count, 50);
});

test("collectDigestStats degrada sem diretório", () => {
  const stats = collectDigestStats({ newsDir: "/caminho/que/nao/existe" });
  assert.equal(stats.available, false);
  assert.equal(stats.last_run, null);
  assert.equal(stats.sent_total, 0);
  assert.deepEqual(stats.sources, []);
  assert.deepEqual(stats.days, []);
});

test("rota /api/digest-stats serve dados do diretório informado", async t => {
  const running = await startServer({ port: 0, root: publicRoot, newsDir: fixtureDir() });
  t.after(() => running.close());
  const response = await fetch(`http://127.0.0.1:${running.port}/api/digest-stats`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.sent_total, 2);
  assert.equal(body.sources.length, 3);
  assert.equal(body.days[0].sent, 2);
  assert.match(await response.headers.get("content-type"), /application\/json/);
});

test("página expõe abas de sistema e digest", async t => {
  const running = await startServer({ port: 0, root: publicRoot });
  t.after(() => running.close());
  const html = await (await fetch(`http://127.0.0.1:${running.port}/`)).text();
  assert.match(html, /class="tab"[^>]*data-tab="tab-sistema"/);
  assert.match(html, /class="tab"[^>]*data-tab="tab-digest"/);
  assert.match(html, /id="tab-digest"/);
  assert.match(html, /id="digestSources"/);
  assert.match(html, /id="digestDays"/);
  assert.match(html, /id="digestRuns"/);
  assert.match(html, /href="#tab-sistema"/);
});
