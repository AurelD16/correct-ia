import { z } from 'zod';

/**
 * Valeur de repli de `LLM_MAX_INPUT_CHARS`, source unique du défaut : utilisée par
 * le schéma, par `getMaxInputChars` et donc par l'interface comme par l'API.
 */
export const DEFAULT_MAX_INPUT_CHARS = 8_000;

/**
 * Configuration LLM. Volontairement **sans** `NEXT_PUBLIC_` : ce module est
 * importé uniquement par le code serveur (route handler), jamais par un composant
 * client, pour que la clé d'API ne puisse pas atterrir dans le bundle navigateur.
 *
 * Les accesseurs `getDefaultLanguage` et `getMaxInputChars` renvoient uniquement
 * des valeurs non sensibles : la page serveur s'en sert pour composer l'interface.
 */
const envSchema = z.object({
  LLM_BASE_URL: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
  LLM_LANGUAGE: z.string().min(1).default('fr'),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LLM_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(DEFAULT_MAX_INPUT_CHARS),
  LLM_STRUCTURED_OUTPUT: booleanFlag(true),
  LOG_TEXT: booleanFlag(false),
});

/** Source de configuration : `process.env` ou un objet injecté par les tests. */
export type EnvSource = Record<string, string | undefined>;

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  language: string;
  temperature: number;
  timeoutMs: number;
  maxInputChars: number;
  structuredOutput: boolean;
  logText: boolean;
}

export class EnvError extends Error {
  constructor(
    message: string,
    readonly fields: string[],
  ) {
    super(message);
    this.name = 'EnvError';
  }
}

function booleanFlag(defaultValue: boolean): z.ZodType<boolean, z.ZodTypeDef, string | undefined> {
  const schema = z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
    });
  return schema;
}

/**
 * Lit et valide la configuration. En développement, une configuration incomplète
 * échoue immédiatement avec un message explicite ; ailleurs, l'appelant transforme
 * l'erreur en 503 « service non configuré » sans exposer la cause.
 */
export function getLlmConfig(source: EnvSource = process.env): LlmConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.'));
    throw new EnvError(
      `Configuration LLM incomplète ou invalide : ${fields.join(', ')}`,
      fields,
    );
  }
  const data = parsed.data;
  return {
    baseUrl: data.LLM_BASE_URL.replace(/\/+$/, ''),
    apiKey: data.LLM_API_KEY,
    model: data.LLM_MODEL,
    language: data.LLM_LANGUAGE,
    temperature: data.LLM_TEMPERATURE,
    timeoutMs: data.LLM_TIMEOUT_MS,
    maxInputChars: data.LLM_MAX_INPUT_CHARS,
    structuredOutput: data.LLM_STRUCTURED_OUTPUT,
    logText: data.LOG_TEXT,
  };
}

/** Langue par défaut de l'interface ; tolère une configuration absente ou invalide. */
export function getDefaultLanguage(source: EnvSource = process.env): string {
  const parsed = envSchema.shape.LLM_LANGUAGE.safeParse(source.LLM_LANGUAGE);
  return parsed.success ? parsed.data : 'fr';
}

/**
 * Limite de saisie annoncée à l'interface (compteur, alerte à 80 %, blocage de la
 * soumission). Tolère une configuration absente ou invalide : le repli évite de
 * faire échouer le rendu de la page alors que la route API, seule à appliquer la
 * limite, refusera de toute façon ce qu'elle n'accepte pas.
 */
export function getMaxInputChars(source: EnvSource = process.env): number {
  const parsed = envSchema.shape.LLM_MAX_INPUT_CHARS.safeParse(source.LLM_MAX_INPUT_CHARS);
  return parsed.success ? parsed.data : DEFAULT_MAX_INPUT_CHARS;
}
