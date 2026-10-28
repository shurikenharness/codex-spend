# codex-spend

What your Codex use on this computer would cost at OpenAI's API list prices: today,
the last 7 and 30 days, all time, and by model, on one screen, in a second or two.

It is an **API-equivalent estimate**, not your bill: a ChatGPT plan has a fixed monthly price, so the
number shows how much work went through it, priced as if you had paid per token.

**Several accounts? [Shuriken](https://shuriken.sh) tracks them all → shuriken.sh**

## Run it

You need Node.js 18 or later. Each command downloads one file from this repository's v1.0.1
release, checks its SHA-256, and runs it only when the checksum matches.

macOS and Linux:

```sh
curl -fsSLo codex-spend.mjs https://github.com/shurikenharness/codex-spend/releases/download/v1.0.1/codex-spend.mjs && openssl dgst -sha256 -r codex-spend.mjs | grep -q ^6426084dbef25502b909e014672b5f4ecc13eab2e53d87be0d6cd10fddb5a8b1 && node codex-spend.mjs
```

Windows (PowerShell):

```powershell
irm "https://github.com/shurikenharness/codex-spend/releases/download/v1.0.1/codex-spend.mjs" -OutFile codex-spend.mjs; if ((Get-FileHash codex-spend.mjs).Hash -eq '6426084dbef25502b909e014672b5f4ecc13eab2e53d87be0d6cd10fddb5a8b1') { node codex-spend.mjs } else { 'codex-spend.mjs does not match its SHA-256, so it was not run.' }
```

With npx (fetches this repository at the tag; no checksum step):

```sh
npx github:shurikenharness/codex-spend#v1.0.1
```

SHA-256 of `codex-spend.mjs` v1.0.1: `6426084dbef25502b909e014672b5f4ecc13eab2e53d87be0d6cd10fddb5a8b1`

### Read it first

It is one file with no dependencies, so it is quick to read before you run it:

```sh
curl -fsSLo codex-spend.mjs https://github.com/shurikenharness/codex-spend/releases/download/v1.0.1/codex-spend.mjs
openssl dgst -sha256 -r codex-spend.mjs     # 6426084dbef25502b909e014672b5f4ecc13eab2e53d87be0d6cd10fddb5a8b1
less codex-spend.mjs
node codex-spend.mjs
```

## What it prints

Made-up data from the tests:

```
Codex spend on this computer (API-equivalent estimate)
Read 3 session logs (5 KB) in 0.1 s from ~/.codex

                       Cost    Tokens     Calls
Today                $3.55*      1.3M         2
Last 7 days          $6.55*      1.6M         3
Last 30 days        $17.80*      3.6M         4
All time            $21.80*      4.6M         5

By model, all time                     Cost   Input  Output  Cached    Calls
gpt-5.1-codex-max-high              $11.25     1.0M    1.0M       0        1
gpt-5.5                              $6.55     400K    100K    100K        2
gpt-6.2-sol                          $4.00     1.0M       0       0        1
llama3                            no price     1.0M       0       0        1
* leaves out calls to models with no public list price.

Prices: OpenAI API list prices (Standard) as of 2026-10-28, with cached input and long-context
prices. Not your bill: a ChatGPT plan has a fixed monthly price.
Not on the price page, priced as the listed model: gpt-5.1-codex-max-high as gpt-5.1, gpt-6.2-sol as gpt-6.1-sol.
Several accounts? Shuriken tracks them all → shuriken.sh
```

Options: `--dir PATH` (a Codex home folder; repeatable), `--json`, `--version`, `--help`.

## What it reads, and what it doesn't

- It reads the session logs the Codex CLI writes to `~/.codex/sessions/**/rollout-*.jsonl` and `~/.codex/archived_sessions` (or `CODEX_HOME`).
- From them it keeps only each request's model (from the `turn_context` rows) and its token counts from the `token_count` events (input, cached input, output, reasoning included in output) and time.
- It prints numbers and model names only: never a prompt, a reply, a file path or a project name.
- It makes **no network calls** and writes nothing (the tests check the source for both). Nothing
  leaves your computer.

Codex repeats a `token_count` event when nothing new was used (the same running total); a forked session copies earlier events. Both are counted once. A log with running totals only is read as the difference between totals.

## Prices

OpenAI's Standard-tier API list prices: <https://developers.openai.com/api/docs/pricing>. Cached input is priced apart; a request with more than 272,000 input tokens pays the long-context prices on the models that have them. Codex models the page no longer lists (gpt-5-codex, gpt-5.1-codex, gpt-5.1-codex-max, gpt-5.1-codex-mini, gpt-5.2-codex) are priced as the listed model they were sold at; a snapshot or variant as its listed base model, and a newer model of a tier (astra, sol, terra, luna) as that tier's newest (the output says so). Requests to other providers' models (a local model, say) are counted but not priced.

The table, its date (`PRICES_AS_OF`) and its sources (`PRICE_SOURCES`) are at the top of
`codex-spend.mjs`. A new price is a new release.

## Tests

```sh
npm test
```

They run against made-up logs in `test/fixtures.mjs`, never a real home folder.

## License

MIT, see [LICENSE](LICENSE). Made by [Shuriken](https://shuriken.sh).
