import { z } from 'zod';
import type { LlmConfig } from '../env';
import { MODEL_OUTPUT_SCHEMA_NAME, modelOutputJsonSchema, parseModelOutput } from '../schemas';
import type { ModelError, Usage } from '../types';
import { buildMessages } from './prompt';

/** Erreur amont, déjà assainie : jamais de clé d'API, jamais de stack trace. */
export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class InvalidModelOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidModelOutputError';
  }
}

/** Détail brut renvoyé par l'hôte : sert à décider du repli. */
interface UpstreamDetail {
  status: number;
  body: string;
}

export interface LlmCorrection {
  errors: ModelError[];
  usage?: Usage;
}

export interface CallLlmOptions {
  text: string;
  config: LlmConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const chatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullish() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullish(),
});

const MAX_UPSTREAM_DETAIL_CHARS = 200;

type ResponseFormat =
  | { type: 'json_schema'; json_schema: { name: string; strict: true; schema: unknown } }
  | { type: 'json_object' };

/**
 * Appelle un endpoint chat-completions compatible OpenAI et renvoie les erreurs
 * détectées, validées par schéma.
 *
 * Robustesse visée : un hôte qui ne supporte pas `response_format: json_schema`
 * renvoie 400 ; on rejoue alors **une seule fois** en `json_object`, ce qui couvre
 * vLLM, Ollama et llama.cpp. Aucune autre erreur n'est retentée.
 */
export async function callLlm(options: CallLlmOptions): Promise<LlmCorrection> {
  const { text, config } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());

  const messages = buildMessages(text, config);
  const primaryFormat: ResponseFormat = config.structuredOutput
    ? {
        type: 'json_schema',
        json_schema: {
          name: MODEL_OUTPUT_SCHEMA_NAME,
          strict: true,
          schema: modelOutputJsonSchema,
        },
      }
    : { type: 'json_object' };

  const startedAt = now();
  const primary = await postChatCompletion({
    doFetch,
    config,
    messages,
    responseFormat: primaryFormat,
  });

  let completion = primary.completion;
  let usedFallback = false;

  if (primary.detail !== null && isResponseFormatRejection(primary.detail)) {
    log(config, 'repli json_object après 400 response_format');
    const retry = await postChatCompletion({
      doFetch,
      config,
      messages,
      responseFormat: { type: 'json_object' },
    });
    if (retry.detail !== null) {
      throw new UpstreamError(sanitize(retry.detail, config.apiKey), retry.detail.status);
    }
    completion = retry.completion;
    usedFallback = true;
  } else if (primary.detail !== null) {
    // Statut amont non-2xx qui n'appelle pas de rejeu : erreur déjà assainie.
    throw new UpstreamError(sanitize(primary.detail, config.apiKey), primary.detail.status);
  }

  const durationMs = now() - startedAt;
  const usage = completion.usage;

  log(
    config,
    `appel LLM terminé${usedFallback ? ' (repli)' : ''} en ${durationMs} ms`,
    usage,
  );

  const content = completion.content;
  const parsed = safeJsonParse(content);
  if (parsed === undefined) {
    throw new InvalidModelOutputError(
      `réponse du modèle illisible (${truncate(content, MAX_UPSTREAM_DETAIL_CHARS)})`,
    );
  }

  try {
    return { errors: parseModelOutput(parsed).errors, usage };
  } catch (error) {
    throw new InvalidModelOutputError(
      `réponse du modèle non conforme au schéma : ${error instanceof Error ? error.message : 'raison inconnue'}`,
    );
  }
}

interface PostArgs {
  doFetch: typeof fetch;
  config: LlmConfig;
  messages: ReturnType<typeof buildMessages>;
  responseFormat: ResponseFormat;
}

async function postChatCompletion(args: PostArgs): Promise<{
  completion: { content: string; usage?: Usage };
  detail: UpstreamDetail | null;
}> {
  const { config, messages, responseFormat } = args;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  let response: Response;
  try {
    response = await args.doFetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: config.temperature,
        max_tokens: 4096,
        response_format: responseFormat,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new TimeoutError(`le service de correction n'a pas répondu en ${config.timeoutMs} ms`);
    }
    // Le message d'une erreur réseau peut contenir des chemins internes : on
    // n'en garde que la nature, jamais le détail.
    throw new UpstreamError('le service de correction est injoignable', 0);
  } finally {
    clearTimeout(timer);
  }

  const body = await safeReadText(response);

  if (!response.ok) {
    return { completion: { content: '' }, detail: { status: response.status, body } };
  }

  const parsed = chatCompletionSchema.safeParse(safeJsonParse(body));
  if (!parsed.success) {
    throw new InvalidModelOutputError('réponse du service de correction au format inattendu');
  }
  const first = parsed.data.choices[0] as { message: { content: string | null | undefined } };
  const content = first.message.content;
  if (typeof content !== 'string' || content.trim() === '') {
    throw new InvalidModelOutputError('réponse du modèle vide');
  }

  const usage: Usage | undefined =
    parsed.data.usage === null || parsed.data.usage === undefined
      ? undefined
      : {
          promptTokens: parsed.data.usage.prompt_tokens,
          completionTokens: parsed.data.usage.completion_tokens,
        };

  return { completion: { content, usage }, detail: null };
}

/**
 * Un 400 qui mentionne `response_format` signale un hôte sans support du mode
 * structuré : c'est le seul cas où l'on rejoue la requête.
 */
function isResponseFormatRejection(detail: UpstreamDetail): boolean {
  if (detail.status !== 400) return false;
  return /response[_ ]?format|json_schema/i.test(detail.body);
}

/** Jamais de clé d'API ni de stack trace dans un message remonté au client. */
function sanitize(detail: UpstreamDetail, apiKey: string): string {
  const status = detail.status === 0 ? 'injoignable' : `statut ${detail.status}`;
  const body = redact(detail.body, apiKey).trim();
  return body === ''
    ? `le service de correction a répondu ${status} sans détail`
    : `le service de correction a répondu ${status} : ${truncate(body, MAX_UPSTREAM_DETAIL_CHARS)}`;
}

/**
 * Un hôte peut rappeler la clé reçue dans son message d'erreur (401 « incorrect
 * API key »). Elle est donc retirée avant tout retour au client.
 */
function redact(value: string, apiKey: string): string {
  let result = value;
  if (apiKey.length >= 8) {
    result = result.replaceAll(apiKey, '[clé masquée]');
  }
  return result
    .replace(/Bearer\s+\S+/gi, 'Bearer [clé masquée]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[clé masquée]');
}

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(stripCodeFence(value));
  } catch {
    return undefined;
  }
}

/** Certains hébergeurs entourent encore le JSON d'un bloc Markdown. */
function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed
    .replace(/^```[a-zA-Z]*\s*/u, '')
    .replace(/```$/u, '')
    .trim();
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function isAbortError(error: unknown): boolean {
  // `DOMException` n'hérite pas de `Error` dans tous les environnements
  // (jsdom notamment) : on teste le nom plutôt que le prototype.
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * Journalisation : modèle, latence, jetons et longueurs seulement. Le texte n'est
 * journalisé que si `LOG_TEXT=true` le demande explicitement.
 */
function log(config: LlmConfig, message: string, usage?: Usage): void {
  if (config.logText) {
    console.warn(`[llm] ${message} (usage: ${JSON.stringify(usage ?? {})})`);
    return;
  }
  console.info(`[llm] ${message} model=${config.model}`);
}
