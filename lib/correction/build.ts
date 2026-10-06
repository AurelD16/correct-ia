import type { TextError } from '../types';

export interface BuildResult {
  /** `source` + remplacements appliqués. */
  corrected: string;
  /** Segments du texte corrigé : intacts, ou remplacés (alors liés à une erreur). */
  segments: BuildSegment[];
}

export interface BuildSegment {
  text: string;
  /** `null` pour un segment intact du texte source. */
  error: TextError | null;
}

/**
 * Reconstruit le texte corrigé à partir du source et des erreurs alignées.
 *
 * Les remplacements sont appliqués **localement** : c'est ce qui garantit que le
 * texte affiché à droite et la liste d'erreurs ne peuvent pas diverger. Les
 * remplacements peuvent être plus longs (ponctuation ajoutée), plus courts
 * (suppression, `replacement === ''`) ou de même longueur.
 */
export function buildCorrected(source: string, errors: readonly TextError[]): BuildResult {
  const ordered = [...errors].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: BuildSegment[] = [];
  let cursor = 0;

  for (const error of ordered) {
    if (!isValidSpan(source, error)) continue;

    if (error.start > cursor) {
      segments.push({ text: source.slice(cursor, error.start), error: null });
    }
    if (error.replacement !== '') {
      segments.push({ text: error.replacement, error });
    }
    cursor = error.end;
  }

  if (cursor < source.length) {
    segments.push({ text: source.slice(cursor), error: null });
  }

  const corrected = segments.map((segment) => segment.text).join('');
  return { corrected, segments };
}

/**
 * Rejoint les segments voisins de même nature (un `null` suivi d'un `null`) :
 * évite des `<mark>` et des `<span>` fragmentés pour rien.
 */
export function mergeAdjacentSegments(segments: readonly BuildSegment[]): BuildSegment[] {
  const merged: BuildSegment[] = [];
  for (const segment of segments) {
    if (segment.text === '') continue;
    const previous = merged[merged.length - 1];
    if (previous !== undefined && previous.error === null && segment.error === null) {
      previous.text += segment.text;
      continue;
    }
    merged.push({ text: segment.text, error: segment.error });
  }
  return merged;
}

function isValidSpan(source: string, error: TextError): boolean {
  return (
    Number.isInteger(error.start) &&
    Number.isInteger(error.end) &&
    error.start >= 0 &&
    error.end > error.start &&
    error.end <= source.length
  );
}
