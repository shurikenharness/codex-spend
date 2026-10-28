// Made-up Codex session logs for the tests, shaped like the rollout files the Codex CLI writes to
// ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl. Never anyone's real data. Text a report must
// never show carries CANARY.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CANARY = "CANARY-9c1d";

const usage = (input, cached, output) => ({
  input_tokens: input,
  cached_input_tokens: cached,
  output_tokens: output,
  reasoning_output_tokens: Math.floor(output / 2),
  total_tokens: input + output,
});

export const row = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
export const context = (timestamp, model) =>
  row(timestamp, "turn_context", {
    cwd: `/Users/dev/${CANARY}`,
    approval_policy: "on-request",
    model,
    effort: "high",
    summary: "auto",
  });
export const tokens = (timestamp, last, total) =>
  row(timestamp, "event_msg", {
    type: "token_count",
    info: {
      ...(last ? { last_token_usage: usage(...last) } : {}),
      ...(total ? { total_token_usage: usage(...total) } : {}),
      model_context_window: 400000,
    },
    rate_limits: { primary: { used_percent: 12 } },
  });

/** Writes the fixture logs under `<home>/sessions` and `<home>/archived_sessions`; returns what they add up to. */
export function writeFixtures(home, now = new Date()) {
  const day = (back) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, 12).toISOString();
  const folder = path.join(home, "sessions", "2026", "10", "01");
  mkdirSync(folder, { recursive: true });
  mkdirSync(path.join(home, "archived_sessions"), { recursive: true });
  const first = tokens(day(0), [200_000, 100_000, 100_000], [200_000, 100_000, 100_000]);
  writeFileSync(
    path.join(folder, "rollout-a.jsonl"),
    [
      row(day(0), "session_meta", { id: "a", cwd: `/Users/dev/${CANARY}`, instructions: CANARY }),
      context(day(0), "gpt-5.5"),
      row(day(0), "response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: CANARY }],
      }),
      first,
      // Codex repeats the event when nothing new was used (the same total): counted once.
      tokens(day(0), [200_000, 100_000, 100_000], [200_000, 100_000, 100_000]),
      row(day(0), "event_msg", { type: "token_count", info: null, rate_limits: {} }),
      // Over 272K input tokens: gpt-5.5's long-context prices.
      tokens(day(2), [300_000, 0, 0], [500_000, 100_000, 100_000]),
      context(day(10), "gpt-5.1-codex-max-high"),
      tokens(day(10), [1_000_000, 0, 1_000_000], [1_500_000, 100_000, 1_100_000]),
      "not json",
    ].join("\n") + "\n",
  );
  // A forked session copies the first event (same time, same total): counted once.
  writeFileSync(
    path.join(folder, "rollout-b.jsonl"),
    `${context(day(0), "gpt-5.5")}\n${first}\n${context(day(0), "llama3")}\n${tokens(day(0), [1_000_000, 0, 0], [1_200_000, 100_000, 100_000])}\n`,
  );
  // An older log with running totals only, and a tier model newer than the table.
  writeFileSync(
    path.join(home, "archived_sessions", "rollout-c.jsonl"),
    [
      context(day(40), "gpt-6.2-sol"),
      tokens(day(40), null, [5_000_000, 0, 0]),
      tokens(day(40), null, [6_000_000, 0, 0]),
    ].join("\r\n"),
  );
  return {
    calls: 5,
    // gpt-5.5: 100K x 5 + 100K x 0.5 + 100K x 30 = 3.55; long: 300K x 10 = 3; gpt-5.1: 1M x 1.25 + 1M x 10 = 11.25;
    // gpt-6.2-sol as gpt-6.1-sol, a 1M-token prompt at its long-context price: 1M x 4 = 4; llama3: no price.
    usd: { today: 3.55, last7Days: 6.55, last30Days: 17.8, allTime: 21.8 },
  };
}
