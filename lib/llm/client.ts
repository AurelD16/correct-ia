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

/**
 * Appelle un endpoint chat-completions compatible OpenAI et renvoie les erreurs
 * détectées, validées par schéma.
 *
 * `LLM_TIMEOUT_MS` borne l'appel **entier** : envoi, réception des en-têtes et
 * lecture du corps de la réponse. Une interruption pendant cette lecture est un
 * `TimeoutError`, donc un `504` côté API, jamais un `502`.
 *
 * Sur la forme de la réponse, la progression est détaillée au bloc de la chaîne
 * d'étapes, plus bas : au plus trois requêtes par correction.
 */
export async function callLlm(options: CallLlmOptions): Promise<LlmCorrection> {
  const { text, config } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());

  const messages = buildMessages(text, config);

  const startedAt = now();

  /**
   * Chaîne d'étapes, au plus 3 requêtes par correction :
   *  1. `json_schema` (ou `json_object` si le mode structuré est désactivé) ;
   *  2. `json_object` si l'hôte refuse le mode structuré ;
   *  3. aucun `response_format` du tout, pour les moteurs qui refusent le
   *     paramètre lui-même (vLLM, Ollama, llama.cpp).
   *
   * Le passage à l'étape suivante n'a lieu que sur un refus de format ; tout
   * autre statut non 2xx est une erreur amont, en une seule requête.
   */
  const stages: (ResponseFormat | null)[] = config.structuredOutput
    ? [
        {
          type: 'json_schema',
          json_schema: {
            name: MODEL_OUTPUT_SCHEMA_NAME,
            strict: true,
            schema: modelOutputJsonSchema,
          },
        },
        { type: 'json_object' },
        null,
      ]
    : [{ type: 'json_object' }, null];

  let completion: { content: string; usage?: Usage } | null = null;
  let succeededStage = -1;

  for (let index = 0; index < stages.length; index += 1) {
    const responseFormat = stages[index] as ResponseFormat | null;
    const attempt = await postChatCompletion({
      doFetch,
      config,
      messages,
      responseFormat,
    });

    if (attempt.detail === null) {
      completion = attempt.completion;
      succeededStage = index;
      break;
    }
    if (!isFormatRejection(attempt.detail)) {
      throw new UpstreamError(sanitize(attempt.detail, config.apiKey), attempt.detail.status);
    }
    log(config, `étape ${index + 1} refusée (${describeStage(responseFormat)}), repli`);
  }

  if (completion === null) {
    throw new UpstreamError(
      `le service de correction a refusé les ${stages.length} formes de réponse demandées`,
      400,
    );
  }

  const durationMs = now() - startedAt;
  const usage = completion.usage;

  log(
    config,
    `appel LLM terminé (étape ${succeededStage + 1}/${stages.length}) en ${durationMs} ms`,
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

/** `null` = aucun champ `response_format` dans le corps de la requête. */
type ResponseFormat =
  | { type: 'json_schema'; json_schema: { name: string; strict: true; schema: unknown } }
  | { type: 'json_object' }
  | null;

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

  /**
   * Le délai couvre **l'appel entier** : envoi, réception des en-têtes *et* lecture
   * du corps. `fetch` ne résout qu'à la réception des en-têtes, donc `clearTimeout`
   * est volontairement placé après `safeReadText`. Sans cela, un amont qui répond
   * `200` puis se tait bloquerait l'interface indéfiniment.
   *
   * `Promise.race` rend la borne déterministe même avec une implémentation de
   * `fetch` qui n'honore pas le signal d'annulation ; l'`abort` reste nécessaire
   * pour libérer la connexion en amont.
   */
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(`le service de correction n'a pas répondu en ${config.timeoutMs} ms`));
    }, config.timeoutMs);
  });

  const payload: RequestInit['body'] = JSON.stringify({
    model: config.model,
    messages,
    temperature: config.temperature,
    max_tokens: 4096,
    // Étape « sans `response_format` » : le champ est absent, pas \`null\`.
    ...(responseFormat === null ? {} : { response_format: responseFormat }),
  });

  let response: Response;
  let raw: string;
  try {
    response = await Promise.race([
      args.doFetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: payload,
        signal: controller.signal,
      }),
      deadline,
    ]);

    if (!response.ok) {
      raw = await Promise.race([safeReadText(response), deadline]);
      return { completion: { content: '' }, detail: { status: response.status, body: raw } };
    }

    raw = await Promise.race([safeReadText(response), deadline]);
  } catch (error) {
    if (error instanceof TimeoutError) throw error;
    if (isAbortError(error)) {
      throw new TimeoutError(`le service de correction n'a pas répondu en ${config.timeoutMs} ms`);
    }
    // Le message d'une erreur réseau peut contenir des chemins internes : on
    // n'en garde que la nature, jamais le détail.
    throw new UpstreamError('le service de correction est injoignable', 0);
  } finally {
    clearTimeout(timer);
  }

  const parsed = chatCompletionSchema.safeParse(safeJsonParse(raw));
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

/** Étape en cours, pour les journaux et les messages d'erreur. */
function describeStage(responseFormat: ResponseFormat): string {
  if (responseFormat === null) return 'sans response_format';
  return responseFormat.type;
}

/**
 * Un 400 qui mentionne `json_schema` ou `response_format` signale un hôte dont le
 * support du mode structuré est incomplet : c'est le seul cas qui fasse avancer la
 * chaîne de repli. Tout autre statut non 2xx est une erreur amont franche.
 */
function isFormatRejection(detail: UpstreamDetail): boolean {
  if (detail.status !== 400) return false;
  return /response[_ ]?format|json_schema|structured output/i.test(detail.body);
}

/** Jamais de clé d'API ni de stack trace dans un message remonté au client. */
function sanitize(detail: UpstreamDetail, apiKey: string): string {
  const status = detail.status === 0 ? 'injoignable' : `statut ${detail.status}`;
  const body = redact(detail.body, apiKey).trim();
  return body === ''
    ? `le service de correction a répondu ${status} sans détail`
    : `le service de correction a répondu ${status} : ${truncate(body, MAX_UPSTREAM_DETAIL_CHARS)}`;
}

const REDACTION = '[clé masquée]';

/**
 * Un hôte peut rappeler la clé reçue dans son message d'erreur (401 « incorrect
 * API key », « Authorization was Bearer … »). Elle est donc retirée avant tout
 * retour au client.
 *
 * L'ordre compte, et il est contre-intuitif : les motifs génériques sont appliqués
 * **d'abord**, sur le texte d'origine. Le substitut contient lui-même un espace, donc
 * `Bearer\s+\S+` s'arrêterait à `[clé` et laisserait un ` masquée]` résiduel —
 * `Bearer [clé masquée] masquée]`. Masquer d'abord la clé exacte, puis retaille par
 * le motif générique, produit exactement cette casse.
 */
function redact(value: string, apiKey: string): string {
  const generic = redactGeneric(value);
  return apiKey.length >= 8 ? generic.replaceAll(apiKey, REDACTION) : generic;
}

function redactGeneric(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, `Bearer ${REDACTION}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, REDACTION);
}

function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

/**
 * Lecture leniente du JSON renvoyé par le modèle, indispensable à l'étape « sans
 * `response_format` » : sans contrainte du serveur, le modèle peut préfixer ou
 * suffixer son JSON d'un commentaire. Trois tentatives, de la plus stricte à la
 * plus tolérante.
 */
function safeJsonParse(value: string): unknown {
  const candidates = [value.trim(), stripCodeFence(value), extractFirstJsonObject(value)];
  for (const candidate of candidates) {
    if (candidate === null || candidate === '') continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // on tente la stratégie suivante
    }
  }
  return undefined;
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

/**
 * Premier objet `{…}` équilibré, chaînes et échappements respectés, pour extraire
 * le JSON d'un texte qui l'entoure. `null` si l'on n'en trouve pas.
 */
function extractFirstJsonObject(value: string): string | null {
  const start = value.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index] as string;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return null;
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
