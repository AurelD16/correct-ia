import { z } from 'zod';
import { DEFAULT_CATEGORY, DEFAULT_SEVERITY, toCategory, toSeverity } from './categories';
import type { ModelError } from './types';

/**
 * Forme attendue du modèle. Les catégories et sévérités sont volontairement
 * permissives : une valeur inconnue bascule sur le repli plutôt que de faire
 * échouer la réponse (cf. `lib/categories.ts`).
 */
export const modelErrorSchema = z.object({
  excerpt: z.string().max(2000),
  replacement: z.string().max(2000),
  explanation: z.string().max(2000),
  category: z.string().default(DEFAULT_CATEGORY),
  severity: z.string().default(DEFAULT_SEVERITY),
});

export const modelOutputSchema = z.object({
  errors: z.array(modelErrorSchema),
});

export interface ParsedModelOutput {
  errors: ModelError[];
}

export const correctRequestSchema = z.object({
  text: z.string(),
  language: z.string().min(1).max(32).optional(),
});

export type CorrectRequest = z.infer<typeof correctRequestSchema>;

/**
 * Analyse la sortie brute du modèle. Tolère un objet enveloppé (`{ result: … }`)
 * ou une racine qui est directement un tableau d'erreurs.
 */
export function parseModelOutput(raw: unknown): ParsedModelOutput {
  const unwrapped = unwrapRoot(raw);
  const parsed = modelOutputSchema.safeParse(unwrapped);
  if (!parsed.success) {
    throw new Error('sortie du modèle non conforme au schéma attendu');
  }
  return {
    errors: parsed.data.errors.map((error) => ({
      excerpt: error.excerpt,
      replacement: error.replacement,
      explanation: error.explanation,
      category: toCategory(error.category),
      severity: toSeverity(error.severity),
    })),
  };
}

function unwrapRoot(raw: unknown): unknown {
  if (Array.isArray(raw)) return { errors: raw };
  if (raw !== null && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if (!Array.isArray(record['errors'])) {
      for (const key of ['result', 'data', 'output', 'response'] as const) {
        const nested = record[key];
        if (Array.isArray(nested)) return { errors: nested };
        if (nested !== null && typeof nested === 'object' && Array.isArray((nested as Record<string, unknown>)['errors'])) {
          return nested;
        }
      }
    }
  }
  return raw;
}

/**
 * Schéma JSON strict transmis à `response_format.json_schema` lorsque
 * `LLM_STRUCTURED_OUTPUT=true`. Volontairement minimal : `additionalProperties`
 * est requis par le mode strict de certains hébergeurs.
 */
export const modelOutputJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['errors'],
  properties: {
    errors: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['excerpt', 'replacement', 'explanation', 'category', 'severity'],
        properties: {
          excerpt: { type: 'string', description: 'Copie verbatim du passage fautif.' },
          replacement: { type: 'string', description: 'Forme corrigée ; chaîne vide pour supprimer.' },
          explanation: { type: 'string', description: 'Une phrase expliquant la correction.' },
          category: {
            type: 'string',
            enum: [
              'orthographe',
              'grammaire',
              'syntaxe',
              'ponctuation',
              'style',
              'autre',
            ],
          },
          severity: { type: 'string', enum: ['erreur', 'avertissement', 'suggestion'] },
        },
      },
    },
  },
} as const;

export const MODEL_OUTPUT_SCHEMA_NAME = 'correction_errors';
