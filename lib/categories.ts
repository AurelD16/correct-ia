import { ERROR_CATEGORIES, SEVERITIES } from './types';
import type { ErrorCategory, Severity } from './types';

/** Catégorie par défaut quand le modèle en renvoie une inconnue. */
export const DEFAULT_CATEGORY: ErrorCategory = 'autre';

/** Sévérité par défaut quand le modèle en renvoie une inconnue. */
export const DEFAULT_SEVERITY: Severity = 'avertissement';

/** Accepte une catégorie libre (accent, casse, pluriel) ou inconnue. */
export function toCategory(value: unknown): ErrorCategory {
  if (typeof value !== 'string') return DEFAULT_CATEGORY;
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[ _-]+/g, ' ');
  return (ERROR_CATEGORIES as readonly string[]).includes(normalized)
    ? (normalized as ErrorCategory)
    : DEFAULT_CATEGORY;
}

/** Accepte une sévérité libre ou inconnue. */
export function toSeverity(value: unknown): Severity {
  if (typeof value !== 'string') return DEFAULT_SEVERITY;
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
  return (SEVERITIES as readonly string[]).includes(normalized)
    ? (normalized as Severity)
    : DEFAULT_SEVERITY;
}

interface CategoryMeta {
  label: string;
  /** Classes Tailwind du `<mark>` : fond, texte et liseré. */
  mark: string;
  badge: string;
  /** Rôle ARIA / texte alternatif pour les pastilles de la liste. */
  short: string;
}

export const CATEGORY_META: Record<ErrorCategory, CategoryMeta> = {
  orthographe: {
    label: 'Orthographe',
    mark: 'bg-red-100 text-red-950 border-b-2 border-red-500',
    badge: 'bg-red-100 text-red-800 ring-1 ring-red-300',
    short: 'O',
  },
  grammaire: {
    label: 'Grammaire',
    mark: 'bg-amber-100 text-amber-950 border-b-2 border-amber-500',
    badge: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300',
    short: 'G',
  },
  syntaxe: {
    label: 'Syntaxe',
    mark: 'bg-violet-100 text-violet-950 border-b-2 border-violet-500',
    badge: 'bg-violet-100 text-violet-900 ring-1 ring-violet-300',
    short: 'S',
  },
  ponctuation: {
    label: 'Ponctuation',
    mark: 'bg-sky-100 text-sky-950 border-b-2 border-sky-500',
    badge: 'bg-sky-100 text-sky-900 ring-1 ring-sky-300',
    short: 'P',
  },
  style: {
    label: 'Style',
    mark: 'bg-emerald-100 text-emerald-950 border-b-2 border-emerald-500',
    badge: 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300',
    short: 'St',
  },
  autre: {
    label: 'Autre',
    mark: 'bg-slate-200 text-slate-950 border-b-2 border-slate-500',
    badge: 'bg-slate-200 text-slate-800 ring-1 ring-slate-400',
    short: 'A',
  },
};

export interface SeverityMeta {
  label: string;
  badge: string;
}

export const SEVERITY_META: Record<Severity, SeverityMeta> = {
  erreur: { label: 'Erreur', badge: 'bg-red-600 text-white' },
  avertissement: { label: 'Avertissement', badge: 'bg-amber-500 text-amber-950' },
  suggestion: { label: 'Suggestion', badge: 'bg-sky-600 text-white' },
};

/** Libellé lisible d'un remplacement, y compris le cas « suppression ». */
export function describeReplacement(replacement: string): string {
  return replacement === '' ? '(suppression)' : replacement;
}
