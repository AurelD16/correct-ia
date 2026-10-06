import { NextResponse } from 'next/server';
import { EnvError, getLlmConfig } from '@/lib/env';
import type { LlmConfig } from '@/lib/env';
import { correctRequestSchema } from '@/lib/schemas';
import { alignErrors } from '@/lib/correction/align';
import { buildCorrected } from '@/lib/correction/build';
import {
  InvalidModelOutputError,
  TimeoutError,
  UpstreamError,
  callLlm,
} from '@/lib/llm/client';
import type { CorrectionErrorBody, CorrectionResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NOT_CONFIGURED_MESSAGE =
  'Service de correction non configuré : aucun fournisseur LLM n’est défini sur le serveur. Renseignez la configuration puis réessayez.';

function jsonError(status: number, body: CorrectionErrorBody): NextResponse<CorrectionErrorBody> {
  return NextResponse.json(body, { status });
}

/**
 * `POST /api/correct` — corrige un texte via un LLM compatible OpenAI.
 *
 * Codes : 400 validation, 503 configuration absente, 502 erreur ou sortie amont
 * inexploitable, 504 timeout, 422 sortie du modèle non conforme.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, {
      error: 'validation',
      message: 'Corps de requête invalide : un objet JSON avec la clé « text » est attendu.',
    });
  }

  const parsed = correctRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, {
      error: 'validation',
      message: 'Corps de requête invalide : le champ « text » doit être une chaîne de caractères.',
    });
  }

  const { text, language } = parsed.data;
  const trimmed = text.trim();
  if (trimmed === '') {
    return jsonError(400, {
      error: 'validation',
      message: 'Le texte à corriger est vide.',
    });
  }

  let config;
  try {
    config = getLlmConfig();
  } catch (error) {
    if (error instanceof EnvError && process.env.NODE_ENV !== 'production') {
      console.error(`[correct] configuration LLM invalide : ${error.fields.join(', ')}`);
    }
    return jsonError(503, { error: 'not_configured', message: NOT_CONFIGURED_MESSAGE });
  }

  if (text.length > config.maxInputChars) {
    return jsonError(400, {
      error: 'validation',
      message: `Le texte dépasse la limite de ${config.maxInputChars} caractères (${text.length} fournis). Aucun texte n'est tronqué automatiquement : raccourcissez la saisie.`,
    });
  }

  const activeLanguage = language ?? config.language;
  // La langue demandée par le client pilote le prompt, pas seulement la réponse.
  const effectiveConfig: LlmConfig = { ...config, language: activeLanguage };

  try {
    const completion = await callLlm({ text, config: effectiveConfig });
    const aligned = alignErrors(text, completion.errors);
    const { corrected } = buildCorrected(text, aligned.errors);

    const result: CorrectionResult = {
      source: text,
      corrected,
      errors: aligned.errors,
      warnings: aligned.warnings,
      language: activeLanguage,
      model: config.model,
      ...(completion.usage === undefined ? {} : { usage: completion.usage }),
    };

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof TimeoutError) {
      return jsonError(504, {
        error: 'timeout',
        message: `Le service de correction n'a pas répondu à temps (${config.timeoutMs} ms). Réessayez dans un instant.`,
      });
    }
    if (error instanceof InvalidModelOutputError) {
      return jsonError(422, {
        error: 'invalid_model_output',
        message: `La réponse du modèle est inexploitable : ${error.message}`,
      });
    }
    if (error instanceof UpstreamError) {
      return jsonError(502, {
        error: 'upstream',
        message: `${error.message}. Vérifiez la configuration du fournisseur.`,
      });
    }
    console.error('[correct] erreur inattendue', error instanceof Error ? error.message : error);
    return jsonError(502, {
      error: 'upstream',
      message: 'Le service de correction a renvoyé une erreur inattendue.',
    });
  }
}
