import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveHealth,
  formatCronSchedule,
  nextCronRun,
  parseCrontab,
  parseUptimeOutput,
  summarizeHistory,
} from "../monitor.js";

test("parseia uptime do Termux com dias, relógio e carga", () => {
  const result = parseUptimeOutput(" 15:15:16 up 7 days, 23:31,  load average: 9.61, 8.89, 8.41");

  assert.deepEqual(result, {
    uptime: (7 * 86400) + (23 * 3600) + (31 * 60),
    load: [9.61, 8.89, 8.41],
  });
});

test("retorna nulo para saída sem métricas", () => {
  assert.equal(parseUptimeOutput("uptime indisponível"), null);
});

test("parseia crontab sem expor o comando completo", () => {
  const jobs = parseCrontab([
    "# comentário",
    "0 8,15,20 * * * cd ~/newsdigest && node digest.mjs >> digest.log 2>&1",
    "@reboot node server.js",
  ].join("\n"));

  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs[0], {
    id: "newsdigest",
    name: "Newsdigest",
    kind: "newsdigest",
    expression: "0 8,15,20 * * *",
    schedule: "diariamente às 08:00, 15:00 e 20:00",
  });
  assert.equal(jobs[1].schedule, "ao iniciar");
  assert.equal(jobs[0].command, undefined);
});

test("identifica o boot do server-box pelo comando", () => {
  const [job] = parseCrontab("@reboot cd ~/server-box && ./run.sh");
  assert.deepEqual(job, {
    id: "server-box-boot",
    name: "Server-box",
    kind: "server-box",
    expression: "@reboot",
    schedule: "ao iniciar",
  });
});

test("calcula próxima execução de um cron diário", () => {
  const from = new Date(2026, 7, 13, 14, 30, 0);
  const next = new Date(nextCronRun("0 8,15,20 * * *", from));

  assert.equal(next.getHours(), 15);
  assert.equal(next.getMinutes(), 0);
});

test("deriva status geral a partir de host, cron e serviços", () => {
  const host = {
    mem: { total: 100, avail: 60 },
    disk: { total: 100, used: 20 },
    bat: { pct: 80 },
  };
  const cron = { scheduler: { state: "ok" }, jobs: [{ id: "newsdigest", name: "Newsdigest", state: "ok" }] };
  const services = [{ id: "server-box", name: "server-box", state: "ok" }, { id: "crond", name: "crond", state: "ok" }];

  assert.equal(deriveHealth(host, cron, services).state, "ok");
  assert.equal(deriveHealth(host, { scheduler: { state: "error" }, jobs: [] }, services).state, "error");
});

test("formata cron desconhecido sem inventar frequência", () => {
  assert.equal(formatCronSchedule("15 2 * * 1"), "cron 15 2 * * 1");
});

test("resume mínimo, máximo e tendência do histórico", () => {
  assert.deepEqual(summarizeHistory([[1, 23], [2, 21], [3, 24]]), {
    count: 3,
    min: 21,
    max: 24,
    latest: 24,
    delta: 1,
  });
});
