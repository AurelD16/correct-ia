'use client';

import { useCallback, useRef, useState } from 'react';
import TextInputPanel from './TextInputPanel';
import type { TextInputPanelHandle } from './TextInputPanel';
import CorrectedOutput from './CorrectedOutput';
import ErrorList from './ErrorList';
import StatusBanner from './StatusBanner';
import type { CorrectionErrorKind, CorrectionResult, TextError } from '@/lib/types';

const EXAMPLE_TEXT = `La réunion de projet aura lieu demain a 14 heur.
J'ai beaucoup de travail a faire, mais le rapport doit etre fini.
Malgrés le retard, nous avons quand meme reussi à advanced le calendrier.`;

interface CorrectionAppProps {
  defaultLanguage: string;
  maxInputChars: number;
}

interface SelectedRange {
  start: number;
  end: number;
  token: number;
}

/**
 * Composant client propriétaire de l'état de la correction. Seul point d'entrée
 * de l'API : il n'a accès qu'à `/api/correct`, jamais à la configuration du LLM.
 */
export default function CorrectionApp({
  defaultLanguage,
  maxInputChars,
}: CorrectionAppProps) {
  const [text, setText] = useState(EXAMPLE_TEXT);
  const [result, setResult] = useState<CorrectionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ kind: CorrectionErrorKind; message: string } | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<SelectedRange | null>(null);
  const panelRef = useRef<TextInputPanelHandle>(null);
  const selectionToken = useRef(0);

  const handleSelectError = useCallback((error: TextError) => {
    setSelectedId(error.id);
    selectionToken.current += 1;
    setSelectedRange({ start: error.start, end: error.end, token: selectionToken.current });
    panelRef.current?.selectRange(error.start, error.end);
  }, []);

  const runCorrection = useCallback(async () => {
    if (loading) return;
    if (text.trim() === '') {
      setError({ kind: 'validation', message: 'Le texte à corriger est vide.' });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: defaultLanguage }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setResult(null);
        setSelectedId(null);
        setError(readError(payload, response.status));
        return;
      }
      setResult(payload as CorrectionResult);
      setSelectedId(null);
      setSelectedRange(null);
    } catch {
      setResult(null);
      setError({
        kind: 'upstream',
        message: "L'application n'a pas pu joindre le service de correction.",
      });
    } finally {
      setLoading(false);
    }
  }, [defaultLanguage, loading, text]);

  const isOverLimit = text.length > maxInputChars;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <StatusBanner error={error} onRetry={() => void runCorrection()} retryDisabled={loading} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-h-0 flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <TextInputPanel
            value={text}
            onChange={(next) => {
              setText(next);
              setSelectedId(null);
              setSelectedRange(null);
            }}
            onSubmit={() => void runCorrection()}
            disabled={loading}
            maxChars={maxInputChars}
            inputRef={panelRef}
            selectedRange={selectedRange}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void runCorrection()}
              disabled={loading || isOverLimit}
              className="rounded-md bg-sky-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {loading ? 'Correction en cours…' : 'Corriger le texte'}
            </button>
            <button
              type="button"
              onClick={() => {
                setText('');
                setResult(null);
                setError(null);
                setSelectedId(null);
                setSelectedRange(null);
              }}
              disabled={loading || text === ''}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            >
              Effacer
            </button>
            {isOverLimit ? (
              <p className="text-xs text-red-700">
                Le texte dépasse {maxInputChars} caractères : raccourcissez-le pour lancer la
                correction.
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <CorrectedOutput result={result} onErrorClick={handleSelectError} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <ErrorList result={result} selectedId={selectedId} onSelect={handleSelectError} />
      </div>
    </div>
  );
}

/** Traduit la réponse d'erreur de l'API en message affichable. */
function readError(payload: unknown, status: number): { kind: CorrectionErrorKind; message: string } {
  if (payload !== null && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const kind = record['error'];
    const message = record['message'];
    if (typeof kind === 'string' && typeof message === 'string') {
      return { kind: kind as CorrectionErrorKind, message };
    }
  }
  return { kind: 'upstream', message: `La correction a échoué (statut ${status}).` };
}
