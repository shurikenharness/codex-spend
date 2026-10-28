// codex-spend against made-up session logs (test/fixtures.mjs), never a real home folder: every
// run gets HOME pointed at a temporary folder and no CODEX_* or OPENAI_* variables.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { costOf, findFiles, priceOf, readCalls, summarize } from "../codex-spend.mjs";
import { CANARY, context, tokens, writeFixtures } from "./fixtures.mjs";

const CLI = path.resolve(import.meta.dirname, "../codex-spend.mjs");
const ROOT = mkdtempSync(path.join(tmpdir(), "codex-spend-"));
const HOME = path.join(ROOT, "home");
const CODEX = path.join(HOME, ".codex");
let expected;

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    env: { PATH: process.env.PATH, HOME, ...env },
    encoding: "utf8",
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

before(() => {
  expected = writeFixtures(CODEX);
});
after(() => rmSync(ROOT, { recursive: true, force: true }));

const near = (actual, wanted, label) =>
  assert.ok(Math.abs(actual - wanted) < 1e-6, `${label}: ${actual} != ${wanted}`);
const roots = () => [path.join(CODEX, "sessions"), path.join(CODEX, "archived_sessions")];

describe("reading the session logs", () => {
  it("counts each request once: repeated events and forked copies are left out", () => {
    const calls = readCalls(findFiles(roots()));
    assert.equal(calls.length, expected.calls);
    assert.deepEqual(calls.map((call) => call.model).sort(), [
      "gpt-5.1-codex-max-high",
      "gpt-5.5",
      "gpt-5.5",
      "gpt-6.2-sol",
      "llama3",
    ]);
  });

  it("adds up today, 7 days, 30 days and all time at list prices", () => {
    const summary = summarize(readCalls(findFiles(roots())), costOf);
    for (const period of summary.periods) near(period.usd, expected.usd[period.key], period.key);
    assert.equal(summary.models.find((m) => m.model === "llama3").unpriced, 1);
  });
});

describe("prices", () => {
  it("prices cached input apart and long prompts at long-context prices", () => {
    const call = {
      model: "gpt-5.4",
      input: 1e6,
      cacheRead: 1e6,
      output: 1e6,
      promptTokens: 100_000,
    };
    near(costOf(call), 2.5 + 0.25 + 15, "short");
    near(costOf({ ...call, promptTokens: 272_001 }), 5 + 0.5 + 22.5, "long");
    near(costOf({ ...call, model: "gpt-5.5-pro" }), 30 + 30 + 180, "pro: no cached discount");
  });

  it("finds a model by its listed id, a variant, a snapshot, or its tier", () => {
    assert.equal(priceOf("gpt-5.4-mini-2026-03-01").as, "gpt-5.4-mini");
    assert.equal(priceOf("openai/gpt-6-astra-codex").as, "gpt-6-astra");
    assert.equal(priceOf("gpt-5.1-codex-mini").as, "gpt-5-mini");
    assert.equal(priceOf("gpt-7-luna").as, "gpt-6-luna");
    assert.equal(priceOf("gpt-5.5").guessed, false);
    assert.equal(priceOf("llama3"), null);
  });
});

describe("the command", () => {
  it("prints one screen: periods, models, the estimate note and where several accounts go", () => {
    const result = run([]);
    assert.equal(result.code, 0, result.stderr);
    for (const text of [
      "Codex spend on this computer (API-equivalent estimate)",
      "Today",
      "Last 7 days",
      "Last 30 days",
      "All time",
      "gpt-5.5",
      "$21.80*",
      "gpt-6.2-sol as gpt-6.1-sol",
      "Several accounts? Shuriken tracks them all → shuriken.sh",
    ]) {
      assert.ok(result.stdout.includes(text), `${text}\n${result.stdout}`);
    }
    assert.ok(!result.stdout.includes(CANARY));
  });

  it("gives the same numbers as JSON, reads CODEX_HOME and --dir", () => {
    const json = JSON.parse(run(["--json"]).stdout);
    near(json.periods.allTime.costUsd, expected.usd.allTime, "allTime");
    assert.equal(
      JSON.parse(run(["--json"], { HOME: ROOT, CODEX_HOME: CODEX }).stdout).periods.allTime.calls,
      expected.calls,
    );
    assert.equal(
      JSON.parse(run(["--json", "--dir", CODEX], { HOME: ROOT }).stdout).periods.allTime.calls,
      expected.calls,
    );
    const none = run([], { HOME: path.join(ROOT, "nobody") });
    assert.equal(none.code, 1);
    assert.match(none.stderr, /No Codex session logs found in .*--dir/);
  });

  it("reads 50 MB of logs in a couple of seconds", () => {
    const dir = path.join(ROOT, "big", "sessions");
    mkdirSync(dir, { recursive: true });
    const filler = JSON.stringify({
      timestamp: "2026-09-01T10:00:00Z",
      type: "response_item",
      payload: { type: "message", content: "x".repeat(20_000) },
    });
    for (let file = 0; file < 25; file++) {
      const rows = [context("2026-09-01T10:00:00Z", "gpt-5.5")];
      for (let i = 1; i <= 100; i++)
        rows.push(
          filler,
          tokens(
            `2026-09-01T10:00:${String(i % 60).padStart(2, "0")}Z`,
            [10, 0, 1],
            [10 * i, file, i],
          ),
        );
      writeFileSync(path.join(dir, `rollout-${file}.jsonl`), `${rows.join("\n")}\n`);
    }
    const started = Date.now();
    const json = JSON.parse(run(["--json", "--dir", path.join(ROOT, "big")]).stdout);
    assert.equal(json.periods.allTime.calls, 2500);
    assert.ok(Date.now() - started < 3000, `${Date.now() - started} ms`);
  });
});

describe("the source", () => {
  const source = readFileSync(CLI, "utf8");
  it("makes no network calls, starts no programs and writes no files", () => {
    for (const banned of [
      /from "node:(?:https?|http2|net|tls|dgram|dns|child_process|worker_threads)"/,
      /\bfetch\(/,
      /\bWebSocket\b/,
      /\b(?:writeFile|appendFile|createWriteStream|mkdir|rm|unlink|rename)(?:Sync)?\(/,
    ]) {
      assert.doesNotMatch(source, banned);
    }
    const imports = [...source.matchAll(/^import [^;]*? from "([^"]+)";$/gm)].map(
      (match) => match[1],
    );
    assert.deepEqual(imports.sort(), ["node:fs", "node:os", "node:path", "node:url"]);
  });
});
