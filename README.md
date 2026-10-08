# correct-ia

Web app that corrects text (spelling, grammar, syntax, punctuation, style) through any
**OpenAI-compatible LLM**, with LanguageTool-style highlighting.

- **Left** — the text you type, editable.
- **Right** — the corrected text, every error highlighted and colour-coded by category,
  with the explanation on hover.
- **Bottom** — the list of errors (excerpt, replacement, explanation, category, severity).
  Clicking a card selects the matching passage in the input text.

The model returns text *excerpts*, never positions: the server locates them and rebuilds
the corrected text locally, so the highlighted text and the error list can never disagree.
The full specification is in [`docs/spec-v1.md`](docs/spec-v1.md).

## Requirements

Node.js **≥ 20**, or Docker.

## Quick start

```bash
npm install
cp .env.example .env.local    # then fill in LLM_BASE_URL and LLM_API_KEY
npm run dev
```

Then <http://localhost:3000>.

No API key at hand? `npm run mock:llm` starts a fake OpenAI-compatible server on port
`8787` that flags four common French mistakes — enough to try the whole UI end to end:

```bash
# terminal 1
npm run mock:llm

# terminal 2
LLM_BASE_URL=http://localhost:8787/v1 LLM_API_KEY=mock LLM_MODEL=mock-1 npm run dev
```

## Configuration

All variables are read **on the server** (`lib/env.ts`). None is prefixed with
`NEXT_PUBLIC_`, so the API key can never reach the browser.

| Variable | Default | Role |
|---|---|---|
| `LLM_BASE_URL` | *(none)* | OpenAI-compatible base URL, usually ending in `/v1`. **Required.** |
| `LLM_API_KEY` | *(none)* | API key. **Required.** Never exposed to the client. |
| `LLM_MODEL` | `gpt-4o-mini` | Model identifier. |
| `LLM_LANGUAGE` | `fr` | Working language of the corrector and default UI language. |
| `LLM_TEMPERATURE` | `0` | Sampling temperature, 0 to 2. |
| `LLM_TIMEOUT_MS` | `60000` | Timeout for one provider call. Exceeded → `504`. |
| `LLM_MAX_INPUT_CHARS` | `8000` | Maximum accepted length. Beyond it: `400` refusal, never a silent truncation. |
| `LLM_STRUCTURED_OUTPUT` | `true` | `true` → strict `json_schema`; `false` → `json_object`. |
| `LOG_TEXT` | `false` | Logs the user text. Keep `false` outside development. |

An incomplete configuration does not stop the server: the UI still loads and the API
answers `503 service not configured`.

## Running with Docker

```bash
docker pull ghcr.io/aureld16/correct-ia:latest

docker run --rm -p 3000:3000 \
  -e LLM_BASE_URL=https://api.openai.com/v1 \
  -e LLM_API_KEY=sk-... \
  -e LLM_MODEL=gpt-4o-mini \
  ghcr.io/aureld16/correct-ia:latest
```

Then <http://localhost:3000>. The image runs as the unprivileged `node` user (uid 1000)
and carries **no secret**: the `LLM_*` variables are read at request time, so they are
passed at run time and cannot be recovered from `docker history`.

To try it against the local mock, the mock must run **on the host** — it is not part of
the image:

```bash
npm run mock:llm                  # terminal 1, otherwise the API answers 502
npm run docker:build              # terminal 2
npm run docker:run
```

### Releasing a new version

`.github/workflows/docker-image.yml` publishes the image to **GitHub Container Registry**
(`ghcr.io/aureld16/correct-ia`). Pushing a `v*` git tag on a commit already merged into
`main` publishes that version under **two tags** — the version itself, and `latest`:

```bash
git tag -a v1.01 -m "correct-ia v1.01"
git push origin v1.01
```

```
ghcr.io/aureld16/correct-ia:v1.01
ghcr.io/aureld16/correct-ia:latest
```

An immutable `sha-<short>` tag is produced too, to trace a running container back to a
commit. Lint, typecheck, tests and build run first and **gate** the publication: a
regression never reaches a published tag. No secret has to be configured, `GITHUB_TOKEN`
is enough, and *Run workflow* replays a release by hand.

Bump `"version"` in `package.json` in the same change as the tag (`v1.01` ↔ `1.0.1`).

**Package visibility.** The first `docker push` creates the package as `private`, so
`docker pull` needs a `docker login ghcr.io` until you change it:
<https://github.com/users/aurelien.djian/packages/container/correct-ia/settings> →
*Change visibility* → *Public*.

**⚠️ The API is neither authenticated nor rate-limited.** The endpoint is pre-existing,
but publishing the image makes it deployable: anyone who can reach it spends your
`LLM_API_KEY`. Put a reverse proxy providing authentication and rate limiting in front of
it instead of exposing port 3000.

## API

`POST /api/correct`, request body `{"text": "…", "language": "fr"}`.

| Code | Condition |
|---|---|
| `400` | Body not JSON, or `text` empty or too long |
| `422` | Model output unusable after validation |
| `502` | Upstream error or unreachable provider — sanitised message |
| `503` | Not configured |
| `504` | Upstream timeout |

A `200` answers with `corrected`, the list of `errors` (`excerpt`, `replacement`,
`explanation`, `category`, `severity`, `start`, `end`), `warnings`, `language`, `model`
and `usage`. An empty `replacement` means "delete this passage".

## Tests

```bash
npm test        # full suite, no API key needed
npm run lint
npm run typecheck
npm run build
```

`Dockerfile.test.ts` locks the guarantees of the `Dockerfile`, the `.dockerignore`, the
Next.js config and the release workflow by asserting on their content — no Docker needed.

## Other OpenAI-compatible providers

vLLM, Ollama, llama.cpp, LiteLLM, OpenRouter… anything answering
`POST {LLM_BASE_URL}/chat/completions` with an `Authorization: Bearer` header. Set
`LLM_BASE_URL` and `LLM_MODEL` to match the host; if it rejects structured output, set
`LLM_STRUCTURED_OUTPUT=false` — the app already falls back on its own
(`json_schema` → `json_object` → no `response_format`).

## Licence

To be defined.