import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NEWS_DIR = join(homedir(), "newsdigest");
const TZ = "America/Sao_Paulo";

const SOURCE_NAMES = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  xai: "xAI",
  claude: "Claude Code",
  "hacker-news": "Hacker News",
  cursor: "Cursor",
  deepmind: "DeepMind",
  "hugging-face": "Hugging Face",
  "meta-ai": "Meta AI",
};

function readFile(path) {
  try { return readFileSync(path, "utf8"); } catch { return null; }
}

function localDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
}

const emptyDay = (date) => ({
  date,
  runs: 0,
  sent: 0,
  items: 0,
  rejected: 0,
  no_hot: 0,
  nothing: 0,
  errors: 0,
});

export function parseDigestLog(raw, days = 7) {
  const byDay = new Map();
  const lastRuns = [];
  const lineRe = /^\[([^\]]+)\]\s*(.*)$/;

  for (const line of String(raw || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = lineRe.exec(trimmed);
    if (!match) continue;
    const [time, msg] = [match[1], match[2]];
    const day = localDay(time);
    if (day && !byDay.has(day)) byDay.set(day, emptyDay(day));
    const bucket = day ? byDay.get(day) : null;

    if (bucket) bucket.runs += 1;
    if (bucket) {
      const sent = msg.match(/enviado digest com (\d+) itens/);
      if (sent) {
        bucket.sent += 1;
        bucket.items += Number(sent[1]);
      } else if (msg.includes("LLM não aprovou nenhuma candidata")) {
        bucket.rejected += 1;
      } else if (msg.includes("sem notícia quente nesta hora")) {
        bucket.no_hot += 1;
      } else if (msg.includes("nada enviado") || msg.includes("nenhuma novidade")) {
        bucket.nothing += 1;
      } else if (msg.startsWith("ERRO")) {
        bucket.errors += 1;
      }
    }
    lastRuns.push({ time, msg });
  }

  return {
    days: [...byDay.values()].slice(-days),
    lastRuns: lastRuns.slice(-10).reverse(),
  };
}

export function collectDigestStats({ newsDir = NEWS_DIR, days = 7 } = {}) {
  const stateRaw = readFile(join(newsDir, "state.json"));
  const logRaw = readFile(join(newsDir, "digest.log"));
  let state = null;
  try { state = stateRaw ? JSON.parse(stateRaw) : null; } catch { /* estado corrompido: degrada */ }

  const sources = state?.source_health
    ? Object.entries(state.source_health).map(([id, health]) => ({
        id,
        name: SOURCE_NAMES[id] || id,
        ok: health?.ok === true,
        count: health?.count ?? null,
        latest: health?.latestPublishedAt ?? null,
        error: health?.error || "",
        checkedAt: health?.checkedAt ?? null,
      })).sort((left, right) => left.name.localeCompare(right.name))
    : [];

  const parsed = parseDigestLog(logRaw, days);
  const today = localDay(new Date().toISOString());

  return {
    available: stateRaw !== null || logRaw !== null,
    last_run: state?.last_run || null,
    sent_total: state?.sent ? Object.keys(state.sent).length : 0,
    pending_documente: state?.documente_pending ? Object.keys(state.documente_pending).length : 0,
    today,
    sources,
    days: parsed.days,
    last_runs: parsed.lastRuns,
  };
}

export function createDigestStats({ ttlMs = 30_000, newsDir } = {}) {
  let cache = null;
  return {
    async get() {
      if (cache && Date.now() - cache.at < ttlMs) return cache.data;
      const data = collectDigestStats(newsDir ? { newsDir } : {});
      cache = { at: Date.now(), data };
      return data;
    },
  };
}
