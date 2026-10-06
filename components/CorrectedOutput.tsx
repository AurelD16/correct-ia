'use client';

import { CATEGORY_META, SEVERITY_META } from '@/lib/categories';
import { mergeAdjacentSegments, buildCorrected } from '@/lib/correction/build';
import type { CorrectionResult, TextError } from '@/lib/types';

interface CorrectedOutputProps {
  result: CorrectionResult | null;
  onErrorClick: (error: TextError) => void;
}

/**
 * Panneau de droite : texte corrigé en lecture seule, un `<mark>` par erreur,
 * coloré par catégorie, explication en infobulle (`title` + `aria-label`).
 *
 * Le texte provient de `buildCorrected(source, errors)` : il ne peut donc pas
 * diverger de la liste d'erreurs affichée à gauche.
 */
export default function CorrectedOutput({ result, onErrorClick }: CorrectedOutputProps) {
  if (result === null) {
    return (
      <section className="flex min-h-0 flex-col gap-3" aria-labelledby="texte-corrige-titre">
        <h2 id="texte-corrige-titre" className="text-base font-semibold text-slate-900">
          Texte corrigé
        </h2>
        <div className="scroll-area flex-1 overflow-auto rounded-lg border border-dashed border-slate-300 bg-white/60 p-4">
          <p className="text-sm text-slate-500">
            Le texte corrigé apparaîtra ici, avec chaque erreur surlignée.
          </p>
        </div>
      </section>
    );
  }

  const { segments } = buildCorrected(result.source, result.errors);
  const merged = mergeAdjacentSegments(segments);

  return (
    <section className="flex min-h-0 flex-col gap-3" aria-labelledby="texte-corrige-titre">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="texte-corrige-titre" className="text-base font-semibold text-slate-900">
          Texte corrigé
        </h2>
        <p className="text-xs text-slate-500">
          {result.errors.length} erreur{result.errors.length > 1 ? 's' : ''} · modèle{' '}
          {result.model}
        </p>
      </div>
      <div
        className="scroll-area flex-1 overflow-auto rounded-lg border border-slate-300 bg-white p-4"
        lang="fr"
        data-testid="corrected-output"
      >
        <p className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-slate-900">
          {merged.map((segment, index) => {
            if (segment.error === null) {
              return <span key={`t${index}`}>{segment.text}</span>;
            }
            const error = segment.error;
            const meta = CATEGORY_META[error.category];
            const label = `${meta.label} : « ${error.excerpt} » → « ${
              error.replacement === '' ? 'suppression' : error.replacement
            } ». ${error.explanation}`;
            return (
              <mark
                key={error.id}
                data-segment="true"
                data-error-id={error.id}
                className={meta.mark}
                title={label}
                aria-label={label}
                onClick={() => onErrorClick(error)}
              >
                {segment.text}
              </mark>
            );
          })}
        </p>
      </div>
      <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">
          Texte brut corrigé ({result.errors.length} remplacement
          {result.errors.length > 1 ? 's' : ''} appliqué{result.errors.length > 1 ? 's' : ''})
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-slate-700">
          {result.corrected}
        </pre>
      </details>
      <p className="sr-only">
        Légende : {Object.values(CATEGORY_META).map((meta) => meta.label).join(', ')}.
        Sévérités :{' '}
        {Object.values(SEVERITY_META)
          .map((meta) => meta.label)
          .join(', ')}
        .
      </p>
    </section>
  );
}
