'use client';

import { useId, useState } from 'react';
import { CATEGORY_META } from '@/lib/categories';
import { ERROR_CATEGORIES } from '@/lib/types';
import type { CorrectionResult, TextError } from '@/lib/types';
import ErrorCard from './ErrorCard';

interface ErrorListProps {
  result: CorrectionResult | null;
  selectedId: string | null;
  onSelect: (error: TextError) => void;
}

type CategoryFilter = 'toutes' | (typeof ERROR_CATEGORIES)[number];

/**
 * Liste des erreurs détectées, filtrable par catégorie. Les warnings renvoyés par
 * le serveur (anomalies non localisées, catégories inconnues) sont affichés dans la
 * liste : une correction partielle reste visible, jamais silencieuse.
 */
export default function ErrorList({ result, selectedId, onSelect }: ErrorListProps) {
  const [filter, setFilter] = useState<CategoryFilter>('toutes');
  const filterId = useId();

  if (result === null) {
    return (
      <section className="flex min-h-0 flex-col gap-3" aria-labelledby="liste-erreurs-titre">
        <h2 id="liste-erreurs-titre" className="text-base font-semibold text-slate-900">
          Liste des erreurs
        </h2>
        <p className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-4 text-sm text-slate-500">
          Aucune correction pour le moment.
        </p>
      </section>
    );
  }

  const visible =
    filter === 'toutes' ? result.errors : result.errors.filter((e) => e.category === filter);

  return (
    <section className="flex min-h-0 flex-col gap-3" aria-labelledby="liste-erreurs-titre">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="liste-erreurs-titre" className="text-base font-semibold text-slate-900">
          Liste des erreurs
        </h2>
        <span className="text-xs text-slate-500">
          {visible.length} / {result.errors.length} affichée
          {visible.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={filterId} className="text-xs font-medium text-slate-700">
          Filtrer par catégorie
        </label>
        <select
          id={filterId}
          value={filter}
          onChange={(event) => setFilter(event.target.value as CategoryFilter)}
          className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
        >
          <option value="toutes">Toutes les catégories</option>
          {ERROR_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_META[category].label}
            </option>
          ))}
        </select>
      </div>

      {result.warnings.length > 0 ? (
        <ul className="flex flex-col gap-1" aria-label="Avertissements">
          {result.warnings.map((warning) => (
            <li
              key={warning}
              className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200"
            >
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-4 text-sm text-slate-500">
          {result.errors.length === 0
            ? 'Aucune erreur détectée dans ce texte.'
            : 'Aucune erreur dans cette catégorie.'}
        </p>
      ) : (
        <ul className="scroll-area flex max-h-[32rem] flex-col gap-2 overflow-auto pr-1">
          {visible.map((error) => (
            <ErrorCard
              key={error.id}
              error={error}
              isSelected={error.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
