#!/usr/bin/env node
// codex-spend: what your Codex CLI use on this computer would cost at OpenAI's API list prices.
// An API-equivalent estimate, not your bill: a ChatGPT plan costs a fixed monthly price.
// Source, releases and checksums: https://github.com/shurikenharness/codex-spend
// SPDX-License-Identifier: MIT
//
// It reads the session logs Codex writes to <CODEX_HOME>/sessions/**/rollout-*.jsonl (~/.codex by
// default, archived sessions too), and from them only each request's model name, token counts
// and time. It makes no network calls and writes nothing.
// Several accounts? Shuriken tracks them all: https://shuriken.sh
import { closeSync, openSync, readdirSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const NAME = "codex-spend";
export const VERSION = "1.0.0";

// ---------------------------------------------------------------------------------------------
// Prices. US dollars per million tokens, OpenAI's Standard-tier list prices on the day below.

export const PRICES_AS_OF = "2026-10-28";
export const PRICE_SOURCES = ["https://developers.openai.com/api/docs/pricing"];

/** Requests with more input tokens than this pay the long-context prices, where a model has them. */
export const LONG_CONTEXT = 272_000;

/** input, cached input, output; `long`: the same three above LONG_CONTEXT. A "pro" model has no cached-input discount. */
export const PRICES = {
  "gpt-6-astra": listPrice(10, 1, 50, [20, 2, 75]),
  "gpt-6.1-sol": listPrice(2, 0.1, 10, [4, 0.2, 15]),
  "gpt-6.1-terra": listPrice(1, 0.05, 5, [2, 0.1, 7.5]),
  "gpt-6-sol": listPrice(2, 0.2, 10, [4, 0.4, 15]),
  "gpt-6-luna": listPrice(0.1, 0.01, 0.5),
  "gpt-5.6-sol": listPrice(4, 0.4, 20, [8, 0.8, 30]),
  "gpt-5.6-terra": listPrice(2, 0.2, 12),
  "gpt-5.6-luna": listPrice(0.2, 0.02, 1.2),
  "gpt-5.6-cyber": listPrice(12.5, 1.25, 75),
  "gpt-5.5-cyber": listPrice(12.5, 1.25, 75),
  "gpt-5.5": listPrice(5, 0.5, 30, [10, 1, 45]),
  "gpt-5.5-pro": listPrice(30, 30, 180),
  "gpt-5.4": listPrice(2.5, 0.25, 15, [5, 0.5, 22.5]),
  "gpt-5.4-pro": listPrice(30, 30, 180),
  "gpt-5.4-mini": listPrice(0.75, 0.075, 4.5),
  "gpt-5.4-nano": listPrice(0.2, 0.02, 1.25),
  "gpt-5.3-codex": listPrice(1.75, 0.175, 14),
  "gpt-5.2": listPrice(1.75, 0.175, 14),
  "gpt-5.2-pro": listPrice(21, 21, 168),
  "gpt-5.1": listPrice(1.25, 0.125, 10),
  "gpt-5": listPrice(1.25, 0.125, 10),
  "gpt-5-mini": listPrice(0.25, 0.025, 2),
  "gpt-5-nano": listPrice(0.05, 0.005, 0.4),
  "gpt-5-pro": listPrice(15, 15, 120),
};

/**
 * Codex models the price page no longer lists, priced as the listed model they were sold at
 * (each was the same price as its base model while it was listed).
 */
export const ALIASES = {
  "gpt-5-codex": "gpt-5",
  "gpt-5-codex-mini": "gpt-5-mini",
  "gpt-5.1-codex": "gpt-5.1",
  "gpt-5.1-codex-max": "gpt-5.1",
  "gpt-5.1-codex-mini": "gpt-5-mini",
  "gpt-5.2-codex": "gpt-5.2",
  "gpt-5.3": "gpt-5.3-codex",
};

function listPrice(input, cachedInput, output, long) {
  const rates = { input, cachedInput, output };
  return long
    ? { rates, long: { input: long[0], cachedInput: long[1], output: long[2] } }
    : { rates };
}

const REASONING = /-(?:minimal|low|medium|high|xhigh|auto|none)$/;
const DATED = /-\d{4}-\d{2}-\d{2}$/;
const TIER = /^gpt-(\d+)(?:\.(\d+))?-(astra|sol|terra|luna)(?:$|-)/;

/**
 * The listed model a model id is priced as, or null. An exact id first; then a listed id the
 * name starts with (the longest: `gpt-5.4-mini-…` is gpt-5.4-mini, never gpt-5.4); then, for a
 * newer model of a tier (`gpt-6.2-sol`), the tier's newest listed model.
 */
export function priceOf(model) {
  let id = model
    .toLowerCase()
    .trim()
    .replace(/^openai\//, "");
  while (REASONING.test(id)) id = id.replace(REASONING, "");
  id = id.replace(DATED, "");
  const listed = (name) => (PRICES[name] ? name : (ALIASES[name] ?? null));
  const exact = listed(id);
  if (exact) return { as: exact, guessed: exact !== id, ...PRICES[exact] };
  const prefix = [...Object.keys(PRICES), ...Object.keys(ALIASES)]
    .filter((name) => id.startsWith(`${name}-`))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix) return { as: listed(prefix), guessed: true, ...PRICES[listed(prefix)] };
  const tier = TIER.exec(id)?.[3];
  if (!tier) return null;
  let newest = null;
  for (const name of Object.keys(PRICES)) {
    const match = TIER.exec(name);
    if (!match || match[3] !== tier) continue;
    const version = Number(match[1]) * 1000 + Number(match[2] ?? 0);
    if (!newest || version > newest.version) newest = { name, version };
  }
  return newest ? { as: newest.name, guessed: true, ...PRICES[newest.name] } : null;
}

/** A request's API-equivalent cost in US dollars, or null when the model has no price. */
export function costOf(call) {
  const row = priceOf(call.model);
  if (!row) return null;
  const rates = call.promptTokens > LONG_CONTEXT && row.long ? row.long : row.rates;
  return (
    (call.input * rates.input + call.cacheRead * rates.cachedInput + call.output * rates.output) /
    1_000_000
  );
}

// ---------------------------------------------------------------------------------------------
// Reading the session logs.

/** The folders to read: --dir folders, else CODEX_HOME, else ~/.codex. */
export function defaultDirs(env = process.env, home = homedir()) {
  return [env.CODEX_HOME?.trim() || path.join(home, ".codex")];
}

/** A Codex home's sessions and archived sessions, or the folder itself when it has neither. */
function sessionRoots(dir) {
  const roots = ["sessions", "archived_sessions"].map((name) => path.join(dir, name)).filter(isDir);
  return roots.length ? roots : [dir];
}

const TURN_CONTEXT = Buffer.from('"turn_context"');
const TOKEN_COUNT = Buffer.from('"token_count"');

/**
 * Reads every model request in the files. `turn_context` rows name the model of the turns after
 * them; each `token_count` event carries the last request's usage (`last_token_usage`) and the
 * session's running total. Codex repeats an event when nothing new was used (the same total
 * again), and a forked session copies earlier events; both are counted once.
 */
export function readCalls(files, onProgress) {
  const calls = [];
  const seen = new Set();
  let state = null;
  forEachLine(files, onProgress, (line, file) => {
    if (state?.file !== file) state = { file, model: null, previous: null };
    const row = rowOf(line);
    if (row?.type === "turn_context") {
      if (typeof row.payload.model === "string" && row.payload.model)
        state.model = row.payload.model;
      return;
    }
    const call = row && state.model ? callOf(row, state) : null;
    if (!call) return;
    if (call.key) {
      if (seen.has(call.key)) return;
      seen.add(call.key);
    }
    delete call.key;
    calls.push(call);
  });
  return calls;
}

/** A turn_context or token_count row, parsed; null for every other line. */
function rowOf(line) {
  if (line.indexOf(TURN_CONTEXT) < 0 && line.indexOf(TOKEN_COUNT) < 0) return null;
  let row;
  try {
    row = JSON.parse(line.toString("utf8"));
  } catch {
    return null;
  }
  return row?.payload && typeof row.payload === "object" ? row : null;
}

/** A token_count event as one request (the model the last turn_context named), or null. */
function callOf(row, state) {
  const { payload } = row;
  if (row.type !== "event_msg" || payload.type !== "token_count" || !payload.info) return null;
  const total = usageOf(payload.info.total_token_usage);
  let last = usageOf(payload.info.last_token_usage);
  if (total && state.previous && sameUsage(total, state.previous)) return null;
  if (!last && total) last = state.previous ? difference(total, state.previous) : null;
  if (total) state.previous = total;
  const time = Date.parse(row.timestamp);
  if (!last || !Number.isFinite(time)) return null;
  const cached = Math.min(last.cached, last.input);
  return {
    key: total ? `${row.timestamp}|${total.input}|${total.cached}|${total.output}` : null,
    model: state.model,
    time,
    input: last.input - cached,
    cacheRead: cached,
    output: last.output,
    cacheWrite: 0,
    promptTokens: last.input,
  };
}

function usageOf(value) {
  if (!value || typeof value !== "object") return null;
  return {
    input: count(value.input_tokens),
    cached: count(value.cached_input_tokens),
    output: count(value.output_tokens),
  };
}

const sameUsage = (a, b) => a.input === b.input && a.cached === b.cached && a.output === b.output;
const difference = (a, b) => ({
  input: Math.max(a.input - b.input, 0),
  cached: Math.max(a.cached - b.cached, 0),
  output: Math.max(a.output - b.output, 0),
});
const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

// Shared by claude-code-spend, codex-spend and kimi-spend (the same code in each).

/** Every `*.jsonl` file under the folders, each once. */
export function findFiles(roots, accept = (name) => name.endsWith(".jsonl")) {
  const found = new Map();
  const walk = (dir, depth) => {
    if (depth > 12) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if ((entry.isFile() || entry.isSymbolicLink()) && accept(entry.name, full)) {
        try {
          const stat = statSync(full);
          if (stat.isFile()) found.set(realpathSync(full), stat.size);
        } catch {
          // Gone between the listing and the stat.
        }
      }
    }
  };
  for (const root of roots) walk(root, 0);
  return [...found].map(([file, size]) => ({ file, size }));
}

function isDir(dir) {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Calls `visit` with each line of each file as a Buffer (no line end) and the file, reading 4 MB at a time.
 * A line is only turned into text by the visitor, and only the parts it needs.
 */
export function forEachLine(files, onProgress, visit) {
  const chunk = Buffer.allocUnsafe(4 * 1024 * 1024);
  let done = 0;
  for (const { file, size } of files) {
    let fd;
    try {
      fd = openSync(file, "r");
    } catch {
      done += size;
      continue;
    }
    try {
      let carry = null;
      for (;;) {
        const read = readSync(fd, chunk, 0, chunk.length, null);
        if (read === 0) break;
        let buffer = chunk.subarray(0, read);
        if (carry) buffer = Buffer.concat([carry, buffer]);
        let start = 0;
        for (let nl = buffer.indexOf(10, start); nl >= 0; nl = buffer.indexOf(10, start)) {
          visit(trimCr(buffer.subarray(start, nl)), file);
          start = nl + 1;
        }
        carry = start < buffer.length ? Buffer.from(buffer.subarray(start)) : null;
        done += read;
        onProgress?.(done);
      }
      if (carry) visit(trimCr(carry), file);
    } finally {
      closeSync(fd);
    }
  }
}

const trimCr = (line) =>
  line.length && line[line.length - 1] === 13 ? line.subarray(0, line.length - 1) : line;

const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite"];

/** Calls added up for today, the last 7 and 30 days (calendar days, your time zone), all time, and per model. */
export function summarize(calls, cost, now = new Date()) {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysBack = (days) =>
    new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - days).getTime();
  const periods = [
    { key: "today", label: "Today", since: midnight.getTime() },
    { key: "last7Days", label: "Last 7 days", since: daysBack(6) },
    { key: "last30Days", label: "Last 30 days", since: daysBack(29) },
    { key: "allTime", label: "All time", since: -Infinity },
  ].map((period) => Object.assign(period, empty()));
  const models = new Map();
  let first = Infinity;
  let last = -Infinity;
  for (const call of calls) {
    const usd = cost(call);
    first = Math.min(first, call.time);
    last = Math.max(last, call.time);
    for (const period of periods) if (call.time >= period.since) add(period, call, usd);
    const row = models.get(call.model) ?? { model: call.model, ...empty() };
    add(row, call, usd);
    models.set(call.model, row);
  }
  const byModel = [...models.values()].sort((a, b) => b.usd - a.usd || b.tokens - a.tokens);
  return {
    periods,
    models: byModel,
    first: calls.length ? first : null,
    last: calls.length ? last : null,
  };
}

function empty() {
  return {
    calls: 0,
    usd: 0,
    unpriced: 0,
    tokens: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function add(into, call, usd) {
  into.calls++;
  if (usd === null) into.unpriced++;
  else into.usd += usd;
  for (const field of TOKEN_FIELDS) {
    into[field] += call[field] ?? 0;
    into.tokens += call[field] ?? 0;
  }
}

export const usd = (value) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function short(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(value >= 1e11 ? 0 : 1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e8 ? 0 : 1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e5 ? 0 : 1)}K`;
  return String(value);
}

const pad = (text, width) => (text.length >= width ? text : text + " ".repeat(width - text.length));
const padStart = (text, width) =>
  text.length >= width ? text : " ".repeat(width - text.length) + text;

/** The one-screen summary. */
export function render({ title, summary, read, notes, label = (model) => model }) {
  const out = [];
  out.push(`${title} (API-equivalent estimate)`);
  out.push(read);
  out.push("");
  if (!summary.periods[3].calls) {
    out.push("No usage found.");
  } else {
    out.push(
      `${pad("", 14)}${padStart("Cost", 13)}${padStart("Tokens", 10)}${padStart("Calls", 10)}`,
    );
    for (const period of summary.periods) {
      const cost = usd(period.usd) + (period.unpriced ? "*" : " ");
      out.push(
        `${pad(period.label, 14)}${padStart(cost, 13)}${padStart(short(period.tokens), 10)}${padStart(period.calls.toLocaleString("en-US"), 10)}`,
      );
    }
    out.push("");
    out.push(
      `${pad("By model, all time", 30)}${padStart("Cost", 13)}${padStart("Input", 8)}${padStart("Output", 8)}${padStart("Cached", 8)}${padStart("Calls", 9)}`,
    );
    const shown = summary.models.slice(0, 12);
    for (const row of shown) {
      const cost =
        row.unpriced === row.calls ? "no price " : usd(row.usd) + (row.unpriced ? "*" : " ");
      const name = label(row.model);
      out.push(
        `${pad(name.length > 29 ? `${name.slice(0, 28)}…` : name, 30)}${padStart(cost, 13)}${padStart(short(row.input), 8)}${padStart(short(row.output), 8)}${padStart(short(row.cacheRead + row.cacheWrite), 8)}${padStart(row.calls.toLocaleString("en-US"), 9)}`,
      );
    }
    if (summary.models.length > shown.length)
      out.push(`  and ${summary.models.length - shown.length} more (--json lists them all)`);
    if (summary.models.some((row) => row.unpriced))
      out.push("* leaves out calls to models with no public list price.");
  }
  out.push("");
  for (const note of notes) out.push(note);
  out.push("Several accounts? Shuriken tracks them all → shuriken.sh");
  return `${out.join("\n")}\n`;
}

/** The --json output. */
export function asJson({ summary, files, bytes, extra = {} }) {
  const period = (p) => ({
    costUsd: round(p.usd),
    calls: p.calls,
    unpricedCalls: p.unpriced,
    tokens: pick(p),
  });
  return `${JSON.stringify(
    {
      tool: NAME,
      version: VERSION,
      estimate: "API-equivalent",
      pricesAsOf: PRICES_AS_OF,
      priceSources: PRICE_SOURCES,
      files,
      bytes,
      firstCall: summary.first === null ? null : new Date(summary.first).toISOString(),
      lastCall: summary.last === null ? null : new Date(summary.last).toISOString(),
      periods: Object.fromEntries(summary.periods.map((p) => [p.key, period(p)])),
      models: summary.models.map((m) => ({ model: m.model, ...period(m) })),
      ...extra,
    },
    null,
    2,
  )}\n`;
}

const round = (value) => Math.round(value * 1e6) / 1e6;
const pick = (row) => Object.fromEntries(TOKEN_FIELDS.map((field) => [field, row[field]]));

/** Arguments: --dir PATH (repeatable), --json, --help, --version. */
export function parseArgs(argv, extra = {}) {
  const options = { dirs: [], json: false, help: false, version: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir") {
      if (i + 1 >= argv.length) throw new Error("--dir needs a folder.");
      options.dirs.push(argv[++i]);
    } else if (arg.startsWith("--dir=")) options.dirs.push(arg.slice(6));
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (extra[arg]) {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
      options[extra[arg]] = argv[++i];
    } else throw new Error(`Unknown option ${arg}. Try --help.`);
  }
  return options;
}

/** A progress line on stderr while a big folder is read, only in a terminal. */
export function progress(total) {
  if (!process.stderr.isTTY || total < 64 * 1024 * 1024) return { tick() {}, done() {} };
  let shown = -1;
  return {
    tick(done) {
      const pct = Math.floor((100 * done) / total);
      if (pct !== shown) {
        shown = pct;
        process.stderr.write(`\rReading… ${pct}%`);
      }
    },
    done() {
      process.stderr.write("\r            \r");
    },
  };
}

export function mb(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

const tilde = (dir, home = homedir()) =>
  dir === home || dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;

/** True when this file is the program being run (also through npx's link), not imported. */
export function isMain(url) {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------

const HELP = `${NAME} ${VERSION}: what your Codex CLI use on this computer would cost at OpenAI's API list prices.

  npx ${NAME}            today, 7 days, 30 days, all time, and by model
  --dir PATH             read this Codex folder (repeatable); default: CODEX_HOME, else ~/.codex
  --json                 the same numbers as JSON
  --version, --help

Reads only <folder>/sessions and archived_sessions on this computer. No network, nothing uploaded.
Prices: OpenAI's Standard-tier list prices as of ${PRICES_AS_OF} (${PRICE_SOURCES[0]}).
`;

export function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (options.help || options.version) {
    process.stdout.write(options.help ? HELP : `${VERSION}\n`);
    return 0;
  }
  const started = performance.now();
  const dirs = (options.dirs.length ? options.dirs : defaultDirs()).filter(isDir);
  const files = findFiles(dirs.flatMap(sessionRoots));
  if (!files.length) {
    const looked = (options.dirs.length ? options.dirs : defaultDirs())
      .map((dir) => tilde(dir))
      .join(", ");
    process.stderr.write(
      `No Codex session logs found in ${looked}. Use --dir to point at the folder.\n`,
    );
    return 1;
  }
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  const bar = progress(bytes);
  const calls = readCalls(files, bar.tick);
  bar.done();
  const summary = summarize(calls, costOf);
  if (options.json) {
    process.stdout.write(asJson({ summary, files: files.length, bytes }));
    return 0;
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const priced = summary.models
    .map((row) => ({ model: row.model, price: priceOf(row.model) }))
    .filter(({ price }) => price?.guessed)
    .map(({ model, price }) => `${model} as ${price.as}`);
  const notes = [
    `Prices: OpenAI API list prices (Standard) as of ${PRICES_AS_OF}, with cached input and long-context`,
    "prices. Not your bill: a ChatGPT plan has a fixed monthly price.",
  ];
  if (priced.length)
    notes.push(`Not on the price page, priced as the listed model: ${priced.join(", ")}.`);
  process.stdout.write(
    render({
      title: "Codex spend on this computer",
      summary,
      read: `Read ${files.length.toLocaleString("en-US")} session logs (${mb(bytes)}) in ${seconds} s from ${dirs.map((dir) => tilde(dir)).join(", ")}`,
      notes,
    }),
  );
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
