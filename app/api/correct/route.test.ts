import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import type { CorrectionResult } from '@/lib/types';

const SOURCE = 'La reunion a lieu demain a 14 heur.';

function post(body: unknown, raw = false): Request {
  return new Request('http://localhost/api/correct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function llmOk(errors: unknown[]): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify({ errors }) } }],
      usage: { prompt_tokens: 12, completion_tokens: 34 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function llmHttpError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ENV = {
  LLM_BASE_URL: 'https://upstream.test/v1',
  LLM_API_KEY: 'sk-secret-key',
  LLM_MODEL: 'test-model',
  LLM_LANGUAGE: 'fr',
  LLM_TEMPERATURE: '0',
  LLM_TIMEOUT_MS: '5000',
  LLM_MAX_INPUT_CHARS: '100',
  LLM_STRUCTURED_OUTPUT: 'true',
  LOG_TEXT: 'false',
};

let fetchMock: ReturnType<typeof vi.fn>;
let savedEnv: NodeJS.ProcessEnv;

/**
 * `vi.stubEnv` est sans effet sous l'environnement jsdom utilisé ici : on écrit
 * directement dans `process.env`, avec restauration complète après chaque test.
 */
function setEnv(overrides: Record<string, string> = {}): void {
  for (const [key, value] of Object.entries({ ...ENV, ...overrides })) {
    process.env[key] = value;
  }
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  savedEnv = { ...process.env };
  setEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe('POST /api/correct — validation', () => {
  it('refuse un corps non JSON en 400', async () => {
    const response = await POST(post('pas du json', true));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('JSON');
  });

  it('refuse un objet sans champ text en 400', async () => {
    const response = await POST(post({ nope: true }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('validation');
  });

  it('refuse un texte vide en 400', async () => {
    const response = await POST(post({ text: '   ' }));

    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('vide');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuse un texte trop long en 400 sans troncature silencieuse', async () => {
    const response = await POST(post({ text: 'a'.repeat(101) }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toContain('100');
    expect(body.message).toContain('101');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/correct — configuration', () => {
  it('répond 503 quand la clé d’API manque', async () => {
    setEnv({ LLM_API_KEY: '' });
    const response = await POST(post({ text: SOURCE }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toBe('not_configured');
    expect(body.message).toContain('non configuré');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('répond 503 quand l’URL de base manque', async () => {
    setEnv({ LLM_BASE_URL: '' });
    const response = await POST(post({ text: SOURCE }));

    expect(response.status).toBe(503);
  });

  it('ne divulgue ni la clé ni la liste des champs en réponse', async () => {
    setEnv({ LLM_API_KEY: '' });
    const body = await (await POST(post({ text: SOURCE }))).text();

    expect(body).not.toContain('sk-secret-key');
    expect(body).not.toContain('LLM_API_KEY');
  });
});

describe('POST /api/correct — chemin nominal', () => {
  it('renvoie le texte corrigé calculé localement', async () => {
    fetchMock.mockResolvedValueOnce(
      llmOk([
        { excerpt: 'reunion', replacement: 'réunion', explanation: 'Accent aigu.', category: 'orthographe', severity: 'erreur' },
        { excerpt: 'heur', replacement: 'heures', explanation: 'Pluriel manquant.', category: 'orthographe', severity: 'erreur' },
      ]),
    );

    const response = await POST(post({ text: SOURCE }));
    const body = (await response.json()) as CorrectionResult;

    expect(response.status).toBe(200);
    expect(body.source).toBe(SOURCE);
    expect(body.corrected).toBe('La réunion a lieu demain a 14 heures.');
    expect(body.model).toBe('test-model');
    expect(body.language).toBe('fr');
    expect(body.warnings).toEqual([]);
    expect(body.usage).toEqual({ promptTokens: 12, completionTokens: 34 });
    expect(body.errors.map((error) => error.excerpt)).toEqual(['reunion', 'heur']);
  });

  it('applique la langue demandée par le client', async () => {
    fetchMock.mockResolvedValueOnce(llmOk([]));

    const response = await POST(post({ text: SOURCE, language: 'en' }));

    expect((await response.json()).language).toBe('en');
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(JSON.stringify(body.messages)).toContain('« en »');
  });

  it('retire les anomalies non localisées et renvoie un warning', async () => {
    fetchMock.mockResolvedValueOnce(
      llmOk([
        { excerpt: 'reunion', replacement: 'réunion', explanation: 'Accent.', category: 'orthographe', severity: 'erreur' },
        { excerpt: 'passage inventé', replacement: 'x', explanation: 'Rien.', category: 'autre', severity: 'erreur' },
      ]),
    );

    const body = (await (await POST(post({ text: SOURCE }))).json()) as CorrectionResult;

    expect(body.errors).toHaveLength(1);
    expect(body.warnings[0]).toContain('1 anomalie non localisée');
    expect(body.corrected).toBe('La réunion a lieu demain a 14 heur.');
  });

  it('classe une catégorie invalide en « autre » sans casser la réponse', async () => {
    fetchMock.mockResolvedValueOnce(
      llmOk([
        { excerpt: 'heur', replacement: 'heures', explanation: 'Pluriel.', category: 'klingon', severity: 'critique' },
      ]),
    );

    const response = await POST(post({ text: SOURCE }));
    const body = (await response.json()) as CorrectionResult;

    expect(response.status).toBe(200);
    expect(body.errors[0]?.category).toBe('autre');
    expect(body.errors[0]?.severity).toBe('avertissement');
  });
});

describe('POST /api/correct — erreurs amont', () => {
  it('répond 502 sur une erreur HTTP amont, message assaini', async () => {
    fetchMock.mockResolvedValueOnce(llmHttpError(401, 'Incorrect API key provided: sk-secret-key'));
    const response = await POST(post({ text: SOURCE }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.error).toBe('upstream');
    expect(body.message).toContain('statut 401');
    expect(body.message).not.toContain('sk-secret-key');
  });

  it('répond 504 sur un timeout, avec un message distinct', async () => {
    setEnv({ LLM_TIMEOUT_MS: '20' });
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    });
    const response = await POST(post({ text: SOURCE }));
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body.error).toBe('timeout');
    expect(body.message).toContain('pas répondu à temps');
  });

  it('répond 422 quand la sortie du modèle est inexploitable', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'désolé' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const response = await POST(post({ text: SOURCE }));

    expect(response.status).toBe(422);
    expect((await response.json()).error).toBe('invalid_model_output');
  });

  it('ne renvoie jamais de stack trace', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom at /srv/app/lib/llm/client.ts:42'));

    const response = await POST(post({ text: SOURCE }));
    const body = await response.text();

    expect(response.status).toBe(502);
    expect(body).not.toContain('client.ts:42');
    expect(body).not.toContain('at /srv');
  });
});
