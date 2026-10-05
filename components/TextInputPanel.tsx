'use client';

import { useEffect, useImperativeHandle, useRef } from 'react';
import type { RefObject } from 'react';

const CHARACTER_WARNING_RATIO = 0.8;

export interface TextInputPanelHandle {
  /** Amène le focus sur le textarea et sélectionne le passage `[start, end)`. */
  selectRange: (start: number, end: number) => void;
}

interface TextInputPanelProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  maxChars: number;
  inputRef?: RefObject<TextInputPanelHandle | null>;
  selectedRange?: { start: number; end: number; token: number } | null;
  inputId?: string;
}

/**
 * Panneau de saisie : texte éditable, compteur de caractères avec alerte au-delà
 * de 80 % de la limite, `Ctrl/Cmd+Entrée` pour lancer la correction.
 */
export default function TextInputPanel({
  value,
  onChange,
  onSubmit,
  disabled = false,
  maxChars,
  inputRef,
  selectedRange = null,
  inputId = 'texte-source',
}: TextInputPanelProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const ratio = maxChars > 0 ? value.length / maxChars : 0;
  const isOverLimit = value.length > maxChars;
  const isNearLimit = ratio >= CHARACTER_WARNING_RATIO;

  useImperativeHandle(
    inputRef,
    () => ({
      selectRange: (start: number, end: number) => {
        const element = textareaRef.current;
        if (element === null) return;
        element.focus();
        const from = Math.max(0, Math.min(start, element.value.length));
        const to = Math.max(from, Math.min(end, element.value.length));
        element.setSelectionRange(from, to);
      },
    }),
    [],
  );

  // Applique aussi la sélection lorsque le parent change l'état (clic sur une
  // carte d'erreur) : le handle n'est pas le seul chemin d'entrée.
  useEffect(() => {
    if (selectedRange === null) return;
    const element = textareaRef.current;
    if (element === null) return;
    element.focus();
    element.setSelectionRange(selectedRange.start, selectedRange.end);
  }, [selectedRange]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!disabled && !isOverLimit) onSubmit();
    }
  };

  const counterClass = isOverLimit
    ? 'text-red-700 font-semibold'
    : isNearLimit
      ? 'text-amber-700'
      : 'text-slate-500';

  return (
    <section className="flex min-h-0 flex-col gap-3" aria-labelledby={`${inputId}-titre`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={`${inputId}-titre`} className="text-base font-semibold text-slate-900">
          Texte à corriger
        </h2>
        {/*
          Volontairement hors région `aria-live` : le compteur est réécrit à chaque
          frappe et un lecteur d'écran annoncerait « N / max caractères » en continu.
          Le dépassement de limite, lui, est signalé plus bas par un message dédié.
        */}
        <p className={`text-xs tabular-nums ${counterClass}`}>
          {value.length} / {maxChars} caractères
        </p>
      </div>
      <label htmlFor={inputId} className="sr-only">
        Texte à corriger
      </label>
      {isOverLimit ? (
        <p role="status" className="text-xs font-medium text-red-700">
          Le texte dépasse {maxChars} caractères. Raccourcissez-le pour lancer la correction :
          aucun texte n&rsquo;est tronqué automatiquement.
        </p>
      ) : null}
      <textarea
        id={inputId}
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        spellCheck
        lang="fr"
        aria-describedby={`${inputId}-aide`}
        aria-invalid={isOverLimit}
        className="scroll-area min-h-[16rem] w-full flex-1 resize-y rounded-lg border border-slate-300 bg-white p-4 font-mono text-sm leading-relaxed text-slate-900 shadow-sm placeholder:text-slate-400 disabled:bg-slate-50"
        placeholder="Collez ici le texte à corriger…"
      />
      <p id={`${inputId}-aide`} className="text-xs text-slate-500">
        Raccourci&nbsp;: <kbd className="rounded border border-slate-300 px-1">Ctrl</kbd> +{' '}
        <kbd className="rounded border border-slate-300 px-1">Entrée</kbd> pour lancer la
        correction.
      </p>
    </section>
  );
}
