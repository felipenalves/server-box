import test from "node:test";
import assert from "node:assert/strict";
import {
  collectBattery,
  collectServices,
  deriveHealth,
  formatCronSchedule,
  formatDeviceName,
  nextCronRun,
  parseCrontab,
  parseGetpropOutput,
  parseTermuxBatteryStatus,
  parseUptimeOutput,
  summarizeHistory,
} from "../monitor.js";

test("identifica um Galaxy A10s a partir do getprop do Android", () => {
  const device = parseGetpropOutput([
    "[ro.product.manufacturer]: [samsung]",
    "[ro.product.brand]: [samsung]",
    "[ro.product.model]: [SM-A107M]",
    "[ro.product.marketname]: [Galaxy A10s]",
  ].join("\n"));

  assert.equal(device.manufacturer, "samsung");
  assert.equal(device.model, "SM-A107M");
  assert.equal(device.market_name, "Galaxy A10s");
  assert.equal(formatDeviceName(device), "Samsung Galaxy A10s");
});

test("usa o modelo técnico quando o Android não expõe o nome comercial", () => {
  assert.equal(formatDeviceName({ manufacturer: "samsung", model: "SM-A107M" }), "Samsung SM-A107M");
  assert.equal(formatDeviceName({}), "Android");
});

test("lê bateria por qualquer diretório de power_supply do tipo Battery", () => {
  const files = new Map([
    ["/sys/class/power_supply/bms/type", "Battery\n"],
    ["/sys/class/power_supply/bms/capacity", "73\n"],
    ["/sys/class/power_supply/bms/status", "Charging\n"],
    ["/sys/class/power_supply/bms/temp", "295\n"],
  ]);

  assert.deepEqual(collectBattery({
    paths: ["/sys/class/power_supply/usb", "/sys/class/power_supply/bms"],
    read: path => files.get(path) || null,
    shell: () => null,
  }), {
    pct: 73,
    status: "Charging",
    temp: 30,
    source: "sysfs",
  });
});

test("calcula a carga quando o Android não expõe capacity", () => {
  const files = new Map([
    ["/sys/class/power_supply/battery/type", "Battery"],
    ["/sys/class/power_supply/battery/charge_now", "450"],
    ["/sys/class/power_supply/battery/charge_full", "1000"],
  ]);

  assert.equal(collectBattery({
    paths: ["/sys/class/power_supply/battery"],
    read: path => files.get(path) || null,
    shell: () => null,
  }).pct, 45);
});

test("usa Termux:API quando o sysfs não oferece a bateria", () => {
  const raw = JSON.stringify({
    percentage: 42,
    status: "DISCHARGING",
    temperature: 31.5,
  });

  assert.deepEqual(parseTermuxBatteryStatus(raw), {
    pct: 42,
    status: "DISCHARGING",
    temp: 31.5,
    source: "termux-api",
  });
  assert.deepEqual(collectBattery({ paths: [], read: () => null, shell: command => command.includes("termux-battery-status") ? raw : null }), {
    pct: 42,
    status: "DISCHARGING",
    temp: 31.5,
    source: "termux-api",
  });
});

test("não inventa bateria quando nenhuma fonte está disponível", () => {
  assert.deepEqual(collectBattery({ paths: [], read: () => null, shell: () => null }), {
    pct: null,
    status: null,
    temp: null,
    source: null,
    reason: "não exposta pelo sistema",
  });
});

test("não publica Newsdigest quando não há digest configurado", () => {
  const services = collectServices("123 node server.js", {
    scheduler: { state: "idle", pid: null },
    jobs: [],
  }, null);

  assert.deepEqual(services.map(service => service.id), ["server-box", "crond"]);
});

test("mantém o Newsdigest quando há evidência do módulo configurado", () => {
  const services = collectServices("123 node server.js", {
    scheduler: { state: "ok", pid: 456 },
    jobs: [{ kind: "newsdigest" }],
  }, { last_run: null });

  assert.deepEqual(services.map(service => service.id), ["server-box", "crond", "newsdigest"]);
});

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
  assert.equal(deriveHealth(host, { scheduler: { state: "error" }, jobs: [] }, services).state, "ok");
  assert.equal(
    deriveHealth(host, { scheduler: { state: "idle" }, jobs: [] }, services).reason,
    "Painel online. Nenhum cron configurado ainda.",
  );
  assert.equal(deriveHealth(host, { scheduler: { state: "error" }, jobs: [{ id: "cron-1", state: "ok" }] }, services).state, "error");
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
