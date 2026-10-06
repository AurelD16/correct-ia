export const ERROR_CATEGORIES = [
  'orthographe',
  'grammaire',
  'syntaxe',
  'ponctuation',
  'style',
  'autre',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const SEVERITIES = ['erreur', 'avertissement', 'suggestion'] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface TextError {
  /** Stable, généré côté serveur : `e${start}-${end}`. */
  id: string;
  /** Copie verbatim du passage fautif dans le texte source. */
  excerpt: string;
  /** Forme corrigée. La chaîne vide signifie « suppression ». */
  replacement: string;
  /** Une phrase, texte brut, sans markdown, dans la langue demandée. */
  explanation: string;
  category: ErrorCategory;
  severity: Severity;
  /** Offset caractère (UTF-16) dans le texte source. */
  start: number;
  end: number;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface CorrectionResult {
  source: string;
  /** Exactement `source` + remplacements appliqués, calculé localement. */
  corrected: string;
  errors: TextError[];
  warnings: string[];
  language: string;
  model: string;
  usage?: Usage;
}

/** Erreur telle que renvoyée par le modèle, avant alignement. */
export interface ModelError {
  excerpt: string;
  replacement: string;
  explanation: string;
  category: ErrorCategory;
  severity: Severity;
}

export interface CorrectRequestBody {
  text: string;
  language?: string;
}

export type CorrectionErrorKind =
  | 'validation'
  | 'not_configured'
  | 'upstream'
  | 'timeout'
  | 'invalid_model_output';

export interface CorrectionErrorBody {
  error: CorrectionErrorKind;
  message: string;
}
