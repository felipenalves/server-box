import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Monitor de saúde do host Android (o Mac nunca roda serviço em background).
 * Lê tudo local: /proc, propriedades do Android, sysfs/Termux:API da bateria,
 * df, crontab, processos e o estado do digest.
 */

const TTL_MS = 3_000;
const HISTORY_WINDOW_MS = 90_000;
const HISTORY_MAX = 90;
const HISTORY_KEYS = ["j5.bat", "j5.ram"];
const DIGEST_STALE_MS = 12 * 60 * 60 * 1000;
const NEWS_DIR = join(homedir(), "newsdigest");

function readFile(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function sh(cmd) {
  try {
    return execFileSync("sh", ["-c", cmd], { encoding: "utf8", timeout: 3_000 });
  } catch {
    return null;
  }
}

function cleanText(value) {
  const text = value == null ? "" : String(value).trim();
  return text && !["unknown", "<unknown>", "n/a", "null"].includes(text.toLowerCase()) ? text : null;
}

function numberOrNull(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function percentageOrNull(value) {
  const number = numberOrNull(value);
  return number != null && number >= 0 && number <= 100 ? number : null;
}

export function parseGetpropOutput(raw) {
  const props = {};
  for (const line of String(raw || "").split("\n")) {
    const match = line.match(/^\[([^\]]+)\]\s*:\s*\[([^\]]*)\]\s*$/)
      || line.match(/^([\w.-]+)\s*[:=]\s*(.+)$/);
    if (!match) continue;
    const value = cleanText(match[2]);
    if (value) props[match[1]] = value;
  }

  const first = (...keys) => keys.map(key => props[key]).find(Boolean) || null;
  return {
    manufacturer: first("ro.product.manufacturer", "ro.product.vendor.manufacturer"),
    brand: first("ro.product.brand", "ro.product.vendor.brand"),
    model: first("ro.product.model", "ro.product.vendor.model"),
    market_name: first("ro.product.marketname", "ro.product.market_name", "ro.product.odm.marketname"),
    product: first("ro.product.name", "ro.product.device"),
  };
}

function displayBrand(value) {
  const text = cleanText(value);
  if (!text) return null;
  if (text.toLowerCase() === "samsung") return "Samsung";
  return text.replace(/\b\w/g, letter => letter.toUpperCase());
}

export function formatDeviceName(device = {}) {
  const brand = displayBrand(device.manufacturer || device.brand);
  const model = cleanText(device.market_name || device.model || device.product);
  if (!brand && !model) return "Android";
  if (!brand) return model;
  if (!model) return brand;
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
}

export function collectDevice({ shell = sh } = {}) {
  const props = parseGetpropOutput(shell("getprop 2>/dev/null") || "");
  return {
    ...props,
    name: formatDeviceName(props),
    source: Object.values(props).some(Boolean) ? "getprop" : null,
  };
}

function normalizeSysfsTemperature(value) {
  const number = numberOrNull(value);
  if (number == null) return null;
  if (Math.abs(number) >= 10_000) return Math.round(number / 1_000);
  if (Math.abs(number) >= 100) return Math.round(number / 10);
  return number;
}

function listPowerSupplyPaths(shell) {
  const raw = shell("ls -1 /sys/class/power_supply 2>/dev/null");
  return String(raw || "")
    .split("\n")
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => /^[\w.-]+$/.test(value))
    .map(value => join("/sys/class/power_supply", value));
}

function batteryPathScore(path, read) {
  const name = String(path).split("/").pop().toLowerCase();
  const type = cleanText(read(`${path}/type`))?.toLowerCase();
  if (type === "battery") return 100;
  if (type) return -1;
  if (name === "battery") return 90;
  if (name.includes("bms")) return 80;
  if (name.includes("battery")) return 70;
  return -1;
}

function readSysfsBattery(path, read) {
  const capacity = percentageOrNull(read(`${path}/capacity`));
  const chargeNow = numberOrNull(read(`${path}/charge_now`));
  const chargeFull = numberOrNull(read(`${path}/charge_full`));
  const energyNow = numberOrNull(read(`${path}/energy_now`));
  const energyFull = numberOrNull(read(`${path}/energy_full`));
  const calculated = chargeNow != null && chargeFull != null && chargeFull > 0 ? (chargeNow / chargeFull) * 100
    : energyNow != null && energyFull != null && energyFull > 0 ? (energyNow / energyFull) * 100
      : null;
  const pct = capacity ?? percentageOrNull(calculated);
  if (pct == null) return null;

  const status = cleanText(read(`${path}/status`));
  const temp = normalizeSysfsTemperature(read(`${path}/temp`));
  return { pct, status, temp, source: "sysfs" };
}

export function parseTermuxBatteryStatus(raw) {
  try {
    const payload = JSON.parse(String(raw || ""));
    const pct = percentageOrNull(payload.percentage ?? payload.percent);
    if (pct == null) return null;
    const plugged = cleanText(payload.plugged);
    const status = cleanText(payload.status) || (plugged && plugged.toUpperCase() !== "UNPLUGGED" ? "CHARGING" : null);
    return {
      pct,
      status,
      temp: numberOrNull(payload.temperature),
      source: "termux-api",
    };
  } catch {
    return null;
  }
}

export function collectBattery({ read = readFile, shell = sh, paths } = {}) {
  const candidates = (Array.isArray(paths) ? paths : listPowerSupplyPaths(shell))
    .map(path => ({ path, score: batteryPathScore(path, read) }))
    .filter(candidate => candidate.score >= 0)
    .sort((a, b) => b.score - a.score);

  for (const candidate of candidates) {
    const battery = readSysfsBattery(candidate.path, read);
    if (battery) return battery;
  }

  const fromTermux = parseTermuxBatteryStatus(shell("termux-battery-status 2>/dev/null") || "");
  if (fromTermux) return fromTermux;
  return { pct: null, status: null, temp: null, source: null, reason: "não exposta pelo sistema" };
}

export function parseUptimeOutput(raw) {
  if (!raw) return null;

  const loadMatch = raw.match(/load average[s]?:\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  const upMatch = raw.match(/\bup\s+(.+?)(?:,\s*load average[s]?:|$)/i);
  if (!loadMatch && !upMatch) return null;

  let uptime = null;
  if (upMatch) {
    const duration = upMatch[1];
    const days = +(duration.match(/(\d+)\s+days?/i) || [])[1] || 0;
    const minutes = +(duration.match(/(\d+)\s+mins?/i) || [])[1] || 0;
    const clock = duration.match(/(\d+):(\d+)/);
    const clockSeconds = clock ? (+clock[1] * 3600) + (+clock[2] * 60) : 0;
    uptime = (days * 86400) + (minutes * 60) + clockSeconds;
  }

  return {
    uptime,
    load: loadMatch ? loadMatch.slice(1, 4).map(Number) : null,
  };
}

function cronValues(field, min, max) {
  const values = new Set();
  for (const piece of String(field).split(",")) {
    const [base, rawStep] = piece.split("/");
    const step = rawStep == null ? 1 : Number(rawStep);
    if (!Number.isInteger(step) || step < 1) return null;

    if (base === "*") {
      for (let value = min; value <= max; value += step) values.add(value);
      continue;
    }

    const range = base.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < min || end > max || start > end) return null;
      for (let value = start; value <= end; value += step) values.add(value);
      continue;
    }

    if (!/^\d+$/.test(base)) return null;
    const value = Number(base);
    if (value < min || value > max) return null;
    values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

export function nextCronRun(expression, from = new Date()) {
  const parts = String(expression || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  if (parts.slice(2).some(part => part !== "*")) return null;

  const minutes = cronValues(parts[0], 0, 59);
  const hours = cronValues(parts[1], 0, 23);
  if (!minutes || !hours) return null;

  const candidate = new Date(from);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let attempt = 0; attempt < 8 * 24 * 60; attempt += 1) {
    if (hours.includes(candidate.getHours()) && minutes.includes(candidate.getMinutes())) {
      return candidate.toISOString();
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return null;
}

function formatTimes(values, minute) {
  return values
    .map(hour => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`)
    .join(", ")
    .replace(/, ([^,]+)$/, " e $1");
}

export function formatCronSchedule(expression) {
  const parts = String(expression || "").trim().split(/\s+/);
  if (parts.length === 1 && parts[0].startsWith("@")) {
    const labels = {
      "@reboot": "ao iniciar",
      "@hourly": "a cada hora",
      "@daily": "diariamente",
      "@weekly": "semanalmente",
      "@monthly": "mensalmente",
      "@annually": "anualmente",
      "@yearly": "anualmente",
    };
    return labels[parts[0]] || parts[0];
  }

  if (parts.length === 5 && parts[2] === "*" && parts[3] === "*" && parts[4] === "*") {
    const minute = Number(parts[0]);
    const hours = cronValues(parts[1], 0, 23);
    if (Number.isInteger(minute) && minute >= 0 && minute <= 59 && hours?.length) {
      return `diariamente às ${formatTimes(hours, minute)}`;
    }
  }
  return `cron ${String(expression || "não definido")}`;
}

export function parseCrontab(raw) {
  if (!raw) return [];
  const jobs = [];

  for (const line of String(raw).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    const special = parts[0].startsWith("@");
    if ((!special && parts.length < 6) || (special && parts.length < 2)) continue;

    const expression = special ? parts[0] : parts.slice(0, 5).join(" ");
    const command = parts.slice(special ? 1 : 5).join(" ");
    const isDigest = /newsdigest|digest\.mjs/i.test(command);
    const isServerBox = /server-box|server\.js/i.test(command);
    const kind = isDigest ? "newsdigest" : isServerBox ? "server-box" : "generic";
    const baseId = kind === "newsdigest" ? "newsdigest" : kind === "server-box" ? "server-box-boot" : `cron-${jobs.length + 1}`;
    const id = jobs.some(job => job.id === baseId) ? `${baseId}-${jobs.length + 1}` : baseId;

    jobs.push({
      id,
      name: kind === "newsdigest" ? "Newsdigest" : kind === "server-box" ? "Server-box" : `Cron ${jobs.length + 1}`,
      kind,
      expression,
      schedule: formatCronSchedule(expression),
    });
  }
  return jobs;
}

export function summarizeHistory(points) {
  const values = (Array.isArray(points) ? points : [])
    .map(point => Array.isArray(point) ? Number(point[1]) : Number(point?.v))
    .filter(Number.isFinite);
  if (!values.length) return { count: 0, min: null, max: null, latest: null, delta: null };

  const latest = values[values.length - 1];
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    latest,
    delta: values.length > 1 ? latest - values[0] : null,
  };
}

function processInfo(raw, pattern) {
  if (!raw) return { running: null, pid: null };
  for (const line of String(raw).split("\n")) {
    if (!pattern.test(line)) continue;
    const pid = line.trim().split(/\s+/).find(token => /^\d+$/.test(token));
    return { running: true, pid: pid ? Number(pid) : null };
  }
  return { running: false, pid: null };
}

function collectHost() {
  const out = { device: collectDevice(), mem: null, load: null, uptime: null, disk: null, bat: null, digest: null, cores: null, cpuTemp: null };

  try {
    const mem = {};
    const s = readFile("/proc/meminfo") || "";
    for (const ln of s.split("\n")) {
      const m = /^(\w+):\s+(\d+)/.exec(ln);
      if (m) mem[m[1]] = +m[2] * 1024;
    }
    out.mem = { total: mem.MemTotal || 0, avail: mem.MemAvailable || 0 };
  } catch {}

  try {
    const raw = readFile("/proc/loadavg");
    if (raw) {
      const values = raw.trim().split(/\s+/).slice(0, 3).map(Number);
      if (values.length === 3 && values.every(Number.isFinite)) out.load = values;
    }
  } catch {}

  try {
    const raw = readFile("/proc/uptime");
    const seconds = raw ? Number(raw.trim().split(/\s+/)[0]) : NaN;
    if (Number.isFinite(seconds)) out.uptime = seconds;
  } catch {}

  if (out.load === null || out.uptime === null) {
    const fallback = parseUptimeOutput(sh("uptime"));
    if (fallback) {
      if (out.load === null) out.load = fallback.load;
      if (out.uptime === null) out.uptime = fallback.uptime;
    }
  }

  try {
    const ci = readFile("/proc/cpuinfo") || "";
    out.cores = (ci.match(/^processor\s*:/gm) || []).length || null;
  } catch {}

  try {
    const base = "/sys/class/thermal";
    const list = sh(`ls ${base} 2>/dev/null | grep thermal_zone`);
    if (list) {
      for (const z of String(list).trim().split("\n")) {
        const type = ((readFile(`${base}/${z}/type`) || "").trim() || "").toLowerCase();
        if (type.includes("cpu")) {
          const raw = +(readFile(`${base}/${z}/temp`) || "").trim();
          if (raw) { out.cpuTemp = Math.round(raw / 1000); break; }
        }
      }
    }
  } catch {}

  try {
    const df = sh("df -k /data 2>/dev/null") || sh("df -k / 2>/dev/null");
    const lines = String(df).trim().split("\n");
    const l = lines[lines.length - 1].split(/\s+/);
    out.disk = { total: +l[1] * 1024, used: +l[2] * 1024, avail: +l[3] * 1024 };
  } catch {}

  try { out.bat = collectBattery(); } catch {}

  try {
    const stateRaw = readFile(join(NEWS_DIR, "state.json"));
    const logRaw = readFile(join(NEWS_DIR, "digest.log"));
    const state = stateRaw ? JSON.parse(stateRaw) : null;
    const lines = (logRaw || "").trim().split("\n").filter(Boolean);
    if (stateRaw !== null || logRaw !== null) {
      out.digest = {
        available: true,
        last_run: state?.last_run || null,
        sent: state?.sent ? Object.keys(state.sent).length : 0,
        log: lines.length ? lines[lines.length - 1] : null,
      };
    }
  } catch {}

  return out;
}

function collectCron(processes, digest, now) {
  const schedulerProcess = processInfo(processes, /\bcrond\b/i);
  const crontabAvailable = sh("command -v crontab 2>/dev/null") !== null;
  const raw = crontabAvailable ? sh("crontab -l 2>/dev/null") : null;
  const parsedJobs = parseCrontab(raw);
  const schedulerState = parsedJobs.length === 0
    ? "idle"
    : schedulerProcess.running === true
      ? "ok"
      : schedulerProcess.running === false ? "error" : "unknown";

  const jobs = parsedJobs.map(job => {
    const lastRun = job.kind === "newsdigest" ? digest?.last_run || null : null;
    const lastAt = lastRun ? Date.parse(lastRun) : NaN;
    const stale = job.kind === "newsdigest" && (!Number.isFinite(lastAt) || now - lastAt > DIGEST_STALE_MS);
    const state = job.kind !== "newsdigest" ? "ok" : !lastRun ? "unknown" : stale ? "warn" : "ok";
    return {
      id: job.id,
      name: job.name,
      kind: job.kind,
      expression: job.expression,
      schedule: job.schedule,
      state,
      last_run: lastRun,
      next_run: nextCronRun(job.expression, new Date(now)),
      age_ms: Number.isFinite(lastAt) ? Math.max(0, now - lastAt) : null,
      sent: job.kind === "newsdigest" ? digest?.sent ?? null : null,
      log: job.kind === "newsdigest" ? digest?.log ?? null : null,
    };
  });

  const state = schedulerState === "error"
    ? "error"
    : schedulerState === "unknown" || jobs.some(job => job.state === "warn" || job.state === "unknown")
      ? "warn"
      : "ok";

  return {
    state,
    available: crontabAvailable,
    scheduler: {
      name: "crond",
      state: schedulerState,
      pid: schedulerProcess.pid,
    },
    jobs,
  };
}

export function collectServices(processes, cron, digest = null) {
  const digestProcess = processInfo(processes, /(?:node\s+.*digest\.mjs|\bdigest\.mjs\b)/i);
  const digestConfigured = Boolean(digest)
    || digestProcess.running === true
    || cron?.jobs?.some(job => job.kind === "newsdigest");
  const services = [
    {
      id: "server-box",
      name: "server-box",
      state: "ok",
      pid: process.pid,
      detail: `PID ${process.pid}`,
    },
    {
      id: "crond",
      name: "Agendador",
      state: cron.scheduler.state,
      pid: cron.scheduler.pid,
      detail: cron.scheduler.state === "ok"
        ? "agendador ativo"
        : cron.scheduler.state === "idle" ? "nenhuma rotina configurada" : "agendador não confirmado",
    },
  ];
  if (digestConfigured) {
    services.push({
      id: "newsdigest",
      name: "Newsdigest",
      state: digestProcess.running === true ? "ok" : digestProcess.running === false ? "idle" : "unknown",
      pid: digestProcess.pid,
      detail: digestProcess.running === true ? "executando agora" : "aguardando próximo cron",
    });
  }
  return services;
}

function resourceState(pct) {
  if (!Number.isFinite(pct)) return "unknown";
  if (pct >= 95) return "error";
  if (pct >= 85) return "warn";
  return "ok";
}

export function deriveHealth(host, cron, services, now = Date.now()) {
  if (!host || !host.mem || !host.mem.total) {
    return {
      state: "offline",
      label: "Offline",
      reason: "O Android não respondeu às métricas do host.",
      issues: [{ state: "offline", code: "host-unavailable", message: "Métricas do host indisponíveis." }],
    };
  }

  const issues = [];
  const addIssue = (state, code, message) => issues.push({ state, code, message });
  const ramPct = ((host.mem.total - host.mem.avail) / host.mem.total) * 100;
  const diskPct = host.disk?.total ? (host.disk.used / host.disk.total) * 100 : null;
  const batteryPct = host.bat?.pct;

  if (resourceState(ramPct) === "error") addIssue("error", "ram-critical", `RAM em ${Math.round(ramPct)}%.`);
  else if (resourceState(ramPct) === "warn") addIssue("warn", "ram-high", `RAM em ${Math.round(ramPct)}%.`);
  if (resourceState(diskPct) === "error") addIssue("error", "disk-critical", `Disco em ${Math.round(diskPct)}%.`);
  else if (resourceState(diskPct) === "warn") addIssue("warn", "disk-high", `Disco em ${Math.round(diskPct)}%.`);
  if (Number.isFinite(batteryPct) && batteryPct <= 20) addIssue("error", "battery-critical", `Bateria em ${Math.round(batteryPct)}%.`);
  else if (Number.isFinite(batteryPct) && batteryPct <= 50) addIssue("warn", "battery-low", `Bateria em ${Math.round(batteryPct)}%.`);

  const cronJobs = Array.isArray(cron?.jobs) ? cron.jobs : [];
  if (cronJobs.length && cron?.scheduler?.state === "error") addIssue("error", "crond-down", "O agendador não está ativo para as rotinas configuradas.");
  else if (cronJobs.length && cron?.scheduler?.state !== "ok") addIssue("warn", "crond-unknown", "O estado do agendador não foi confirmado.");
  for (const job of cronJobs) {
    if (job.state === "unknown") addIssue("warn", `${job.id}-unknown`, `${job.name} ainda não tem uma execução registrada.`);
    if (job.state === "warn") addIssue("warn", `${job.id}-stale`, `${job.name} está atrasado.`);
  }
  for (const service of services || []) {
    if (service.id !== "newsdigest" && ["error", "unknown"].includes(service.state)) {
      addIssue(service.state === "error" ? "error" : "warn", `${service.id}-${service.state}`, `${service.name} não está confirmado.`);
    }
  }

  const state = issues.some(issue => issue.state === "error")
    ? "error"
    : issues.length ? "warn" : "ok";
  const labels = { ok: "Operacional", warn: "Atenção", error: "Crítico", offline: "Offline" };
  const reason = issues[0]?.message
    || (cronJobs.length ? "Métricas, agendamentos e serviços normais." : "Painel online. Nenhum cron configurado ainda.");
  return {
    state,
    label: labels[state],
    reason,
    issues,
    checked_at: new Date(now).toISOString(),
  };
}

export function createMonitor() {
  let cache = null;
  const history = new Map();
  for (const key of HISTORY_KEYS) history.set(key, []);

  function push(key, time, value) {
    if (value == null || !Number.isFinite(value)) return;
    const points = history.get(key) || [];
    points.push([time, value]);
    while (points.length && time - points[0][0] > HISTORY_WINDOW_MS) points.shift();
    while (points.length > HISTORY_MAX) points.shift();
    history.set(key, points);
  }

  async function collect() {
    const at = Date.now();
    const host = collectHost();
    push("j5.bat", at, host.bat ? host.bat.pct : null);
    push("j5.ram", at, host.mem && host.mem.total
      ? Math.round(((host.mem.total - host.mem.avail) / host.mem.total) * 100)
      : null);

    const processes = sh("ps -A 2>/dev/null || ps 2>/dev/null");
    const cron = collectCron(processes, host.digest, at);
    const services = collectServices(processes, cron, host.digest);
    const status = deriveHealth(host, cron, services, at);
    const data = { at, j5: host, j5via: "local", cron, services, status, history: {}, history_stats: {} };
    for (const [key, points] of history) {
      data.history[key] = points;
      data.history_stats[key] = summarizeHistory(points);
    }
    return data;
  }

  return {
    async get() {
      if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
      const data = await collect();
      cache = { at: Date.now(), data };
      return data;
    },
  };
}
