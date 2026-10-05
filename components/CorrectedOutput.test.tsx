import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CorrectedOutput from './CorrectedOutput';
import type { CorrectionResult } from '@/lib/types';

/**
 * Ajouts QA : le texte, l'extrait, le remplacement et l'explication viennent
 * respectivement de l'utilisateur et du modèle, donc tous non fiables. Ces tests
 * verrouillent le fait qu'ils ne sont jamais interprétés comme du HTML.
 */

const SOURCE = 'Texte <img src=x onerror="window.__pwned = 1"> ici';
const PAYLOAD = '<img src=x onerror="window.__pwned = 1">';

const RESULT: CorrectionResult = {
  source: SOURCE,
  corrected: SOURCE.replace('<img src=x onerror="window.__pwned = 1">', 'une image'),
  errors: [
    {
      id: 'e6-40',
      excerpt: PAYLOAD,
      replacement: '<b>une image</b>',
      explanation: `Balisage à supprimer : ${PAYLOAD}`,
      category: 'syntaxe',
      severity: 'erreur',
      start: SOURCE.indexOf(PAYLOAD),
      end: SOURCE.indexOf(PAYLOAD) + PAYLOAD.length,
    },
  ],
  warnings: [`<script>window.__pwned = 2</script>`],
  language: 'fr',
  model: 'test-model',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CorrectedOutput — contenu non fiable rendu comme texte', () => {
  it('n’interprète jamais le HTML du texte source, ni celui renvoyé par le modèle', () => {
    const { container } = render(
      <CorrectedOutput result={RESULT} onErrorClick={() => undefined} />,
    );

    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(container.querySelectorAll('b')).toHaveLength(0);
    expect((window as unknown as Record<string, unknown>)['__pwned']).toBeUndefined();
  });

  it('affiche le remplacement du modèle littéralement dans le mark', () => {
    const { container } = render(
      <CorrectedOutput result={RESULT} onErrorClick={() => undefined} />,
    );

    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark?.textContent).toBe('<b>une image</b>');
    expect(mark?.getAttribute('title')).toContain('<b>une image</b>');
  });

  it('propose le texte brut corrigé dans un <pre> sans l’interpréter', () => {
    const { container } = render(
      <CorrectedOutput result={RESULT} onErrorClick={() => undefined} />,
    );

    const pre = container.querySelector('pre');
    expect(pre?.textContent).toBe(RESULT.corrected);
    expect(container.ownerDocument.body.innerHTML).not.toContain('<script>');
  });

  it('déclenche la sélection au clic sur un mark', () => {
    const onErrorClick = vi.fn();
    const { container } = render(
      <CorrectedOutput result={RESULT} onErrorClick={onErrorClick} />,
    );

    const mark = container.querySelector('mark');
    expect(mark).not.toBeNull();
    fireEvent.click(mark!);

    expect(onErrorClick).toHaveBeenCalledWith(RESULT.errors[0]);
  });
});