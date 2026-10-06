'use client';

import { CATEGORY_META, SEVERITY_META, describeReplacement } from '@/lib/categories';
import type { TextError } from '@/lib/types';

interface ErrorCardProps {
  error: TextError;
  isSelected: boolean;
  onSelect: (error: TextError) => void;
}

/**
 * Carte d'une erreur : extrait, remplacement, explication, badges catégorie et
 * sévérité. Cliquable : sélectionne et met en évidence le passage correspondant
 * dans le textarea de gauche.
 */
export default function ErrorCard({ error, isSelected, onSelect }: ErrorCardProps) {
  const category = CATEGORY_META[error.category];
  const severity = SEVERITY_META[error.severity];
  const handle = `${error.id}-bouton`;

  return (
    <li>
      <button
        type="button"
        id={handle}
        aria-pressed={isSelected}
        onClick={() => onSelect(error)}
        className={`w-full rounded-lg border p-3 text-left transition ${
          isSelected
            ? 'border-sky-600 bg-sky-50 ring-2 ring-sky-200'
            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${category.badge}`}
            data-testid="categorie"
          >
            {category.label}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${severity.badge}`}
            data-testid="severite"
          >
            {severity.label}
          </span>
        </span>

        <span className="mt-2 flex flex-wrap items-baseline gap-2 text-sm">
          <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-red-800 line-through decoration-red-400">
            {error.excerpt}
          </span>
          <span aria-hidden="true" className="text-slate-400">
            →
          </span>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-emerald-800">
            {describeReplacement(error.replacement)}
          </span>
        </span>

        <span className="mt-2 block text-sm text-slate-700">{error.explanation}</span>
      </button>
    </li>
  );
}
