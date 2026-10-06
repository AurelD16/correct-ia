import { describe, expect, it } from 'vitest';
import { buildCorrected, mergeAdjacentSegments } from './build';
import type { TextError } from '../types';

function textError(overrides: Partial<TextError> = {}): TextError {
  return {
    id: 'e0-1',
    excerpt: 'a',
    replacement: 'b',
    explanation: 'Explication.',
    category: 'orthographe',
    severity: 'erreur',
    start: 0,
    end: 1,
    ...overrides,
  };
}

/** Référence indépendante : application naïve des remplacements. */
function applyNaively(source: string, errors: readonly TextError[]): string {
  let result = '';
  let cursor = 0;
  for (const error of [...errors].sort((a, b) => a.start - b.start)) {
    result += source.slice(cursor, error.start) + error.replacement;
    cursor = error.end;
  }
  return result + source.slice(cursor);
}

describe('buildCorrected', () => {
  it('applique un remplacement simple', () => {
    const source = 'le chat noir';
    const { corrected } = buildCorrected(source, [
      textError({ excerpt: 'noir', replacement: 'blanc', start: 8, end: 12 }),
    ]);

    expect(corrected).toBe('le chat blanc');
  });

  it('applique une insertion (replacement plus long que l’extrait)', () => {
    const source = 'Bonjour le monde';
    const { corrected } = buildCorrected(source, [
      textError({ excerpt: 'monde', replacement: 'monde !', start: 11, end: 16 }),
    ]);

    expect(corrected).toBe('Bonjour le monde !');
  });

  it('applique une suppression quand replacement est vide', () => {
    const source = 'Bonjour le monde';
    const { corrected } = buildCorrected(source, [
      textError({ excerpt: 'le ', replacement: '', start: 7, end: 10 }),
    ]);

    expect(corrected).toBe('Bonjour monde');
  });

  it('applique des erreurs consécutives', () => {
    const source = 'un deux trois';
    const { corrected } = buildCorrected(source, [
      textError({ start: 0, end: 2, replacement: 'UN' }),
      textError({ start: 3, end: 7, replacement: 'DEUX' }),
      textError({ start: 8, end: 13, replacement: 'TROIS' }),
    ]);

    expect(corrected).toBe('UN DEUX TROIS');
  });

  it('supporte des erreurs désordonnées en entrée', () => {
    const source = 'un deux trois';
    const { corrected } = buildCorrected(source, [
      textError({ start: 8, end: 13, replacement: 'TROIS' }),
      textError({ start: 0, end: 2, replacement: 'UN' }),
      textError({ start: 3, end: 7, replacement: 'DEUX' }),
    ]);

    expect(corrected).toBe('UN DEUX TROIS');
  });

  it('renvoie le source inchangé sans erreur', () => {
    const source = 'aucune erreur ici';
    expect(buildCorrected(source, []).corrected).toBe(source);
  });

  it('supprime les erreurs au début et à la fin', () => {
    const source = 'a la lettre b';
    const { corrected } = buildCorrected(source, [
      textError({ start: 0, end: 1, replacement: '' }),
      textError({ start: 12, end: 13, replacement: '' }),
    ]);

    expect(corrected).toBe(' la lettre ');
  });

  it('ignore les erreurs dont les offsets sont invalides', () => {
    const source = 'texte court';
    const { corrected } = buildCorrected(source, [
      textError({ start: 5, end: 2, replacement: 'X' }),
      textError({ start: -3, end: 2, replacement: 'X' }),
      textError({ start: 10, end: 999, replacement: 'X' }),
    ]);

    expect(corrected).toBe(source);
  });

  it("n'échoue jamais : texte vide, erreurs vides, source incohérente", () => {
    expect(() => buildCorrected('', [])).not.toThrow();
    expect(buildCorrected('', []).corrected).toBe('');
    expect(buildCorrected('abc', []).corrected).toBe('abc');
  });

  it('produit exactement le même texte que l’application naïve des remplacements', () => {
    const source = "J'ai fais une faute, mais c'etait long.";
    const errors = [
      textError({ start: 5, end: 9, replacement: 'fait', excerpt: 'fais' }),
      textError({ start: 26, end: 33, replacement: "c'était", excerpt: "c'etait" }),
    ];

    expect(buildCorrected(source, errors).corrected).toBe(applyNaively(source, errors));
  });

  it('expose des segments traçables : chaque portion corrigée est liée à son erreur', () => {
    const source = 'le chat noir';
    const error = textError({ excerpt: 'noir', replacement: 'blanc', start: 8, end: 12 });
    const { segments } = buildCorrected(source, [error]);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ text: 'le chat ', error: null });
    expect(segments[1]).toEqual({ text: 'blanc', error });
    expect(segments.map((segment) => segment.text).join('')).toBe('le chat blanc');
  });
});

describe('mergeAdjacentSegments', () => {
  it('rejoint les segments intacts voisins et retire les segments vides', () => {
    const error = textError();
    const merged = mergeAdjacentSegments([
      { text: 'a', error: null },
      { text: 'b', error: null },
      { text: '', error: null },
      { text: 'c', error },
      { text: 'd', error: null },
    ]);

    expect(merged).toEqual([
      { text: 'ab', error: null },
      { text: 'c', error },
      { text: 'd', error: null },
    ]);
  });
});
