'use client';

import type { CorrectionErrorKind } from '@/lib/types';

interface StatusBannerProps {
  error: { kind: CorrectionErrorKind; message: string } | null;
  onRetry: () => void;
  retryDisabled?: boolean;
}

const TITLES: Record<CorrectionErrorKind, string> = {
  not_configured: 'Service non configuré',
  validation: 'Requête refusée',
  timeout: 'Délai dépassé',
  upstream: 'Erreur du service de correction',
  invalid_model_output: 'Réponse du modèle inexploitable',
};

const STYLES: Record<CorrectionErrorKind, string> = {
  not_configured: 'bg-amber-50 text-amber-950 ring-amber-300',
  validation: 'bg-amber-50 text-amber-950 ring-amber-300',
  timeout: 'bg-sky-50 text-sky-950 ring-sky-300',
  upstream: 'bg-red-50 text-red-950 ring-red-300',
  invalid_model_output: 'bg-red-50 text-red-950 ring-red-300',
};

/**
 * Bandeau d'état : erreurs de configuration, amont ou timeout, avec le message
 * réel renvoyé par l'API et un bouton « Réessayer ».
 */
export default function StatusBanner({ error, onRetry, retryDisabled = false }: StatusBannerProps) {
  if (error === null) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="status-banner"
      className={`flex flex-col gap-3 rounded-lg p-4 ring-1 sm:flex-row sm:items-start sm:justify-between ${STYLES[error.kind]}`}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{TITLES[error.kind]}</p>
        <p className="text-sm">{error.message}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retryDisabled}
        className="shrink-0 self-start rounded-md bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-900 ring-1 ring-slate-300 transition hover:bg-white disabled:opacity-50"
      >
        Réessayer
      </button>
    </div>
  );
}
