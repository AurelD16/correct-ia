import { describe, expect, it } from 'vitest';
import { alignErrors } from './align';
import type { ModelError } from '../types';

function modelError(overrides: Partial<ModelError> = {}): ModelError {
  return {
    excerpt: 'faut',
    replacement: 'correct',
    explanation: 'Explication.',
    category: 'orthographe',
    severity: 'erreur',
    ...overrides,
  };
}

describe('alignErrors — correspondance directe', () => {
  it('localise un extrait verbatim et renvoie ses offsets', () => {
    const source = "J'ai fais une faute de frappe.";
    const { errors, warnings } = alignErrors(source, [
      modelError({ excerpt: 'fais', replacement: 'fait', category: 'grammaire' }),
    ]);

    expect(warnings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ start: 5, end: 9, excerpt: 'fais', id: 'e5-9' });
  });

  it("reconstruit l'extrait depuis le source, pas depuis la sortie du modèle", () => {
    const source = 'Le chat dort.';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'LE CHAT', replacement: 'Le chat', category: 'style' }),
    ]);

    expect(errors[0]?.excerpt).toBe('Le chat');
    expect(errors[0]?.excerpt).toBe(source.slice(errors[0]!.start, errors[0]!.end));
  });

  it('tolère la casse, les diacritiques et les apostrophes typographiques', () => {
    const source = 'Écris « Ça paraît déjà » pour l’ENFANT.';
    const { errors, warnings } = alignErrors(source, [
      modelError({ excerpt: 'Écris', replacement: 'Écrivez' }),
      modelError({ excerpt: 'ça parait', replacement: 'cela paraît' }),
      modelError({ excerpt: 'l’enfant', replacement: "l'enfant" }),
    ]);

    expect(warnings).toEqual([]);
    expect(errors.map((error) => error.excerpt)).toEqual(['Écris', 'Ça paraît', 'l’ENFANT']);
    expect(errors.map((error) => [error.start, error.end])).toEqual([
      [0, 5],
      [8, 17],
      [30, 38],
    ]);
  });

  it('tolère les espaces multiples entre les mots de l’extrait', () => {
    const source = 'un   deux\n\t trois';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'un    deux   trois', replacement: 'un deux trois' }),
    ]);

    expect(errors[0]).toMatchObject({ start: 0, end: 17 });
  });

  it("aligne un extrait dont la ponctuation finale est absente du source", () => {
    const source = 'Je suis parti hier';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'Je suis parti hier.', replacement: 'Je suis parti hier' }),
    ]);

    expect(errors[0]).toMatchObject({ start: 0, end: 18, excerpt: 'Je suis parti hier' });
  });

  it('n’aligne pas un extrait sur un mot qui le contient seulement', () => {
    const source = 'Il a le droit de partir';
    const { errors } = alignErrors(source, [modelError({ excerpt: 'le', replacement: 'la' })]);

    expect(errors[0]).toMatchObject({ start: 5, end: 7, excerpt: 'le' });
  });

  it('n’aligne pas une lettre unique à l’intérieur d’un mot', () => {
    const source = 'La reunion a lieu demain';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'a', replacement: 'à' }),
      modelError({ excerpt: 'La', replacement: 'LA' }),
    ]);

    expect(errors.map((error) => [error.start, error.end, error.excerpt])).toEqual([
      [0, 2, 'La'],
      [11, 12, 'a'],
    ]);
  });

  it('accepte un extrait commençant par une ponctuation', () => {
    const source = 'un, deux et trois';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: ', deux', replacement: ' et deux' }),
    ]);

    expect(errors[0]).toMatchObject({ start: 2, end: 8, excerpt: ', deux' });
  });

  it('préserve les caractères non latins dans les offsets', () => {
    const source = 'Le café «très» chaud';
    const { errors } = alignErrors(source, [modelError({ excerpt: 'très', replacement: 'Tres' })]);

    expect(source.slice(errors[0]!.start, errors[0]!.end)).toBe('très');
  });
});

describe('alignErrors — occurrences multiples', () => {
  it('sélectionne la bonne occurrence d’un mot répété (cas d’acceptation 12)', () => {
    const source = 'Le chat dort. Le chien dort. Le chat ronronne.';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'Le chat', replacement: 'Le Chat' }),
      modelError({ excerpt: 'dort', replacement: 'dort encore' }),
      modelError({ excerpt: 'Le chien', replacement: 'Le chien' }),
      modelError({ excerpt: 'ronronne', replacement: 'ronronne' }),
    ]);

    expect(errors.map((error) => error.excerpt)).toEqual([
      'Le chat',
      'dort',
      'Le chien',
      'ronronne',
    ]);
    expect(errors.map((error) => [error.start, error.end])).toEqual([
      [0, 7],
      [8, 12],
      [14, 22],
      [37, 45],
    ]);
  });

  it('aligne deux occurrences identiques d’un même mot', () => {
    const source = 'le vent souffle et le vent tombe';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'le vent', replacement: 'Le vent' }),
      modelError({ excerpt: 'le vent', replacement: 'les vents' }),
    ]);

    expect(errors.map((error) => [error.start, error.end])).toEqual([
      [0, 7],
      [19, 26],
    ]);
  });

  it('reprend la recherche après un extrait introuvable sans casser le curseur', () => {
    const source = 'alpha beta gamma';
    const { errors, warnings } = alignErrors(source, [
      modelError({ excerpt: 'gamma' }),
      modelError({ excerpt: 'absent' }),
      modelError({ excerpt: 'alpha', replacement: 'ALPHA' }),
    ]);

    expect(errors.map((error) => error.excerpt)).toEqual(['alpha', 'gamma']);
    expect(errors.map((error) => [error.start, error.end])).toEqual([
      [0, 5],
      [11, 16],
    ]);
    expect(warnings[0]).toContain('1 anomalie non localisée');
  });

  it('retombe sur la bonne occurrence si le modèle a réordonné ses erreurs', () => {
    const source = 'test un, test deux';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'test deux' }),
      modelError({ excerpt: 'test un' }),
    ]);

    expect(errors.map((error) => error.excerpt)).toEqual(['test un', 'test deux']);
    expect(errors.map((error) => [error.start, error.end])).toEqual([
      [0, 7],
      [9, 18],
    ]);
  });

  it('garantit des positions croissantes et sans chevauchement', () => {
    const source = 'a b a b a b';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'a' }),
      modelError({ excerpt: 'b' }),
      modelError({ excerpt: 'a' }),
      modelError({ excerpt: 'b' }),
      modelError({ excerpt: 'a' }),
    ]);

    expect(errors).toHaveLength(5);
    for (let index = 1; index < errors.length; index += 1) {
      expect(errors[index]!.start).toBeGreaterThanOrEqual(errors[index - 1]!.end);
    }
  });
});

describe('alignErrors — replis et cas dégradés', () => {
  it('retire un excerpt introuvable et émet un warning', () => {
    const source = 'bonjour le monde';
    const { errors, warnings } = alignErrors(source, [
      modelError({ excerpt: 'bonjour' }),
      modelError({ excerpt: 'au revoir' }),
    ]);

    expect(errors).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('1 anomalie non localisée');
  });

  it('retire un excerpt vide et émet un warning', () => {
    const { errors, warnings } = alignErrors('bonjour', [modelError({ excerpt: '   ' })]);

    expect(errors).toHaveLength(0);
    expect(warnings[0]).toContain('1 anomalie sans extrait exploitable');
  });

  it('retombe sur le plus long préfixe de mots entiers quand le dernier mot diffère', () => {
    const source = 'Il a plu hier soir';
    const { errors } = alignErrors(source, [modelError({ excerpt: 'Il a plu hier soirs' })]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ start: 0, end: 13, excerpt: 'Il a plu hier' });
  });

  it('conserve la catégorie et la sévérité fournies par le modèle', () => {
    const { errors } = alignErrors('un mot', [
      modelError({ excerpt: 'mot', category: 'ponctuation', severity: 'suggestion' }),
    ]);

    expect(errors[0]).toMatchObject({ category: 'ponctuation', severity: 'suggestion' });
  });

  it('ne lève jamais, y compris sur une source vide', () => {
    expect(() => alignErrors('', [modelError({ excerpt: 'quoi' })])).not.toThrow();
    expect(alignErrors('', [])).toEqual({ errors: [], warnings: [] });
  });

  it('supporte une sortie du modèle désordonnée', () => {
    const source = 'un deux trois quatre';
    const { errors } = alignErrors(source, [
      modelError({ excerpt: 'quatre' }),
      modelError({ excerpt: 'deux' }),
      modelError({ excerpt: 'un' }),
      modelError({ excerpt: 'trois' }),
    ]);

    expect(errors.map((error) => error.excerpt)).toEqual(['un', 'deux', 'trois', 'quatre']);
    expect(errors.map((error) => error.start)).toEqual([0, 3, 8, 14]);
  });

  it('agrège le compte des anomalies non localisées', () => {
    const { errors, warnings } = alignErrors('bonjour', [
      modelError({ excerpt: 'au revoir' }),
      modelError({ excerpt: 'salut' }),
    ]);

    expect(errors).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2 anomalies non localisées');
  });
});
