import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InvalidModelOutputError,
  TimeoutError,
  UpstreamError,
  callLlm,
} from './client';
import { getLlmConfig } from '../env';

const BASE_ENV = {
  LLM_BASE_URL: 'https://upstream.test/v1',
  LLM_API_KEY: 'sk-secret-key',
  LLM_MODEL: 'test-model',
  LLM_LANGUAGE: 'fr',
  LLM_TEMPERATURE: '0',
  LLM_TIMEOUT_MS: '5000',
  LLM_MAX_INPUT_CHARS: '8000',
  LLM_STRUCTURED_OUTPUT: 'true',
  LOG_TEXT: 'false',
};

function config(overrides: Record<string, string> = {}) {
  return getLlmConfig({ ...BASE_ENV, ...overrides });
}

function completionResponse(content: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

function errorResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fetchOk(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('callLlm — requête sortante', () => {
  it('appelle chat/completions avec la bearer key et le bon corps', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({ errors: [{ excerpt: 'a', replacement: 'à', explanation: 'x', category: 'orthographe', severity: 'erreur' }] }),
    );

    await callLlm({ text: 'un mot', config: config() });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://upstream.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk-secret-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.signal).toBeDefined();

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['model']).toBe('test-model');
    expect(body['temperature']).toBe(0);
    expect(body['max_tokens']).toBe(4096);
    expect(Array.isArray(body['messages'])).toBe(true);
  });

  it('demande json_schema strict quand LLM_STRUCTURED_OUTPUT=true', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ errors: [] }));

    await callLlm({ text: 'texte', config: config({ LLM_STRUCTURED_OUTPUT: 'true' }) });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'correction_errors', strict: true },
    });
    expect(body.response_format.json_schema.schema.properties.errors).toBeDefined();
  });

  it('demande json_object quand LLM_STRUCTURED_OUTPUT=false', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ errors: [] }));

    await callLlm({ text: 'texte', config: config({ LLM_STRUCTURED_OUTPUT: 'false' }) });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('renvoie les erreurs validées et les jetons', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({
        errors: [
          {
            excerpt: 'fais',
            replacement: 'fait',
            explanation: 'Passé composé.',
            category: 'grammaire',
            severity: 'erreur',
          },
        ],
      }),
    );

    const result = await callLlm({ text: 'il a fais', config: config() });

    expect(result.errors).toEqual([
      {
        excerpt: 'fais',
        replacement: 'fait',
        explanation: 'Passé composé.',
        category: 'grammaire',
        severity: 'erreur',
      },
    ]);
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20 });
  });

  it('replie une catégorie inconnue sur « autre » et une sévérité inconnue sur « avertissement »', async () => {
    fetchMock.mockResolvedValueOnce(
      completionResponse({
        errors: [
          {
            excerpt: 'fais',
            replacement: 'fait',
            explanation: 'x',
            category: 'inventée',
            severity: 'critique',
          },
        ],
      }),
    );

    const result = await callLlm({ text: 'il a fais', config: config() });

    expect(result.errors[0]?.category).toBe('autre');
    expect(result.errors[0]?.severity).toBe('avertissement');
  });

  it('accepte un JSON entouré d’un bloc Markdown', async () => {
    const content = '```json\n{"errors":[{"excerpt":"a","replacement":"b","explanation":"x","category":"style","severity":"suggestion"}]}\n```';
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await callLlm({ text: 'a', config: config() });
    expect(result.errors).toHaveLength(1);
  });
});

describe('callLlm — repli json_schema → json_object', () => {
  it('rejoue une seule fois sans response_format sur 400 mentionnant response_format', async () => {
    fetchMock
      .mockResolvedValueOnce(
        errorResponse(400, "Unsupported parameter: 'response_format' is not supported by this model."),
      )
      .mockResolvedValueOnce(completionResponse({ errors: [] }));

    const result = await callLlm({ text: 'texte', config: config({ LLM_STRUCTURED_OUTPUT: 'true' }) });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    const second = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(first.response_format.type).toBe('json_schema');
    expect(second.response_format).toEqual({ type: 'json_object' });
    expect(result.errors).toEqual([]);
  });

  it('ne rejoue pas sur un 400 sans rapport avec response_format', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400, 'invalid model name'));

    await expect(callLlm({ text: 'texte', config: config() })).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ne rejoue pas sur un 500', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, 'internal error mentioning response_format'));

    await expect(callLlm({ text: 'texte', config: config() })).rejects.toBeInstanceOf(UpstreamError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('propage une erreur assainie si le rejeu échoue aussi', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(400, 'response_format not supported'))
      .mockResolvedValueOnce(errorResponse(429, 'rate limited'));

    await expect(callLlm({ text: 'texte', config: config() })).rejects.toMatchObject({
      status: 429,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('callLlm — erreurs amont assainies', () => {
  it('ne divulgue jamais la clé sur une 401', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'Incorrect API key provided: sk-secret-key'));

    const error = await callLlm({ text: 'texte', config: config() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UpstreamError);
    expect((error as Error).message).toContain('statut 401');
    expect((error as Error).message).toContain('[clé masquée]');
    expect((error as Error).message).not.toContain('sk-secret-key');
  });

  it('masque une clé rappelée par l’hôte quel que soit son format', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'Incorrect API key provided: sk-abcdefgh12345678'));

    const error = (await callLlm({ text: 'texte', config: config() }).catch((e: unknown) => e)) as Error;

    expect(error.message).not.toContain('sk-abcdefgh12345678');
    expect(error.message).toContain('[clé masquée]');
  });

  it('tronque le détail amont à 200 caractères', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500, 'x'.repeat(1000)));

    const error = (await callLlm({ text: 'texte', config: config() }).catch((e: unknown) => e)) as Error;

    expect(error.message.length).toBeLessThan(300);
    expect(error.message.endsWith('…')).toBe(true);
  });

  it('signale un hôte injoignable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(callLlm({ text: 'texte', config: config() })).rejects.toMatchObject({
      status: 0,
    });
  });

  it('traduit un timeout en TimeoutError', async () => {
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    await expect(
      callLlm({ text: 'texte', config: config({ LLM_TIMEOUT_MS: '10' }) }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('callLlm — sortie inexploitable', () => {
  it('rejette un contenu qui n’est pas du JSON', async () => {
    fetchMock.mockResolvedValueOnce(
      fetchOk({ choices: [{ message: { role: 'assistant', content: 'Je ne peux pas.' } }] }),
    );

    await expect(callLlm({ text: 'texte', config: config() })).rejects.toBeInstanceOf(
      InvalidModelOutputError,
    );
  });

  it('rejette un JSON non conforme au schéma', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse({ erreurs: [] }));

    await expect(callLlm({ text: 'texte', config: config() })).rejects.toBeInstanceOf(
      InvalidModelOutputError,
    );
  });

  it('rejette un contenu vide', async () => {
    fetchMock.mockResolvedValueOnce(
      fetchOk({ choices: [{ message: { role: 'assistant', content: '   ' } }] }),
    );

    await expect(callLlm({ text: 'texte', config: config() })).rejects.toBeInstanceOf(
      InvalidModelOutputError,
    );
  });

  it('rejette une enveloppe de chat inattendue', async () => {
    fetchMock.mockResolvedValueOnce(fetchOk({ choices: [] }));

    await expect(callLlm({ text: 'texte', config: config() })).rejects.toBeInstanceOf(
      InvalidModelOutputError,
    );
  });
});
