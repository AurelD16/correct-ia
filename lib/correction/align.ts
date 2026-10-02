import type { ModelError, TextError } from '../types';

const TYPOGRAPHIC_APOSTROPHES = /[\u2018\u2019\u201B\u02BC\uFF07]/g;
const COMBINING_MARKS = /\p{M}/gu;
const WHITESPACE = /\s/u;

/** Apostrophes alignées sur une même forme pour comparer « l' » et « l’ ». */
const APOSTROPHES = /['\u2019]/g;

/** Un caractère source « porteur de sens » : lettre ou chiffre. */
function isWordChar(char: string): boolean {
  return /\p{L}|\p{N}/u.test(char);
}

/**
 * Normalise un caractère unique : apostrophes typographiques ramenées à `'`,
 * diacritiques supprimés, minuscule. Renvoie `''` si le caractère ne porte rien
 * (combinaison isolée, blanc).
 */
function normalizeChar(char: string): string {
  const unified = char.replace(TYPOGRAPHIC_APOSTROPHES, "'");
  const stripped = unified.normalize('NFD').replace(COMBINING_MARKS, '');
  if (stripped === '') return '';
  return (stripped[0] as string).toLowerCase();
}

interface NormalizedSource {
  /** Source normalisée, sans espaces en bordure ni blancs multiples. */
  text: string;
  /** `map[j]` = index du caractère dans `source` correspondant à `text[j]`. */
  map: number[];
}

/**
 * Construit la forme normalisée du texte source et la table de correspondance.
 * Un espace normalisé est rattaché au premier caractère du mot suivant, ce qui
 * donne à tout index de la forme normalisée une position source bien définie.
 */
function normalizeSource(source: string): NormalizedSource {
  const chars: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;

  for (let index = 0; index < source.length; index += 1) {
    const raw = source[index] as string;
    if (WHITESPACE.test(raw)) {
      if (chars.length > 0) pendingSpace = true;
      continue;
    }
    const normalized = normalizeChar(raw);
    if (normalized === '') continue;
    if (pendingSpace) {
      chars.push(' ');
      map.push(index);
      pendingSpace = false;
    }
    chars.push(normalized);
    map.push(index);
  }

  return { text: chars.join(''), map };
}

/** Forme comparable d'un extrait renvoyé par le modèle. */
function normalizeExcerpt(excerpt: string): string {
  return excerpt
    .replace(APOSTROPHES, "'")
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.,;:!?…]+$/u, '').trimEnd();
}

/**
 * Plus longue suite **initiale** de mots entiers de `needle` : au moins 2 mots,
 * en laissant toujours le dernier mot de côté, et au moins 2 caractères
 * significatifs. Dernier filet quand le modèle a altéré la fin de l'extrait.
 */
function leadingWordPrefix(needle: string): string | null {
  const words = needle.split(' ').filter((word) => word !== '');
  if (words.length < 2) return null;

  let prefix = words[0] as string;
  let longest: string | null = null;
  for (let index = 1; index <= words.length - 2; index += 1) {
    prefix = `${prefix} ${words[index] as string}`;
    if (prefix.replace(/\s/g, '').length >= 2) longest = prefix;
  }
  return longest;
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n > 1 ? plural : singular}`;
}

/**
 * Le passage trouvé commence-t-il un mot du texte source ? Évite d'aligner `a`
 * sur `La`, `le` sur `«le` ou `de` sur `demain`.
 *
 * Un extrait commençant par un caractère non alphabétique (guillemet, virgule,
 * espace de respiration) est toujours accepté : ce n'est pas un début de mot qui
 * peut entrer en collision.
 */
function startsOnWordBoundary(source: string, map: readonly number[], index: number, needle: string): boolean {
  const first = needle[0];
  if (first === undefined || !isWordChar(first)) return true;
  const start = map[index];
  if (start === undefined || start === 0) return true;
  // On interroge le caractère source qui précède réellement le passage :
  // l'espace normalisé qui le suit est rattaché au mot, pas à l'espace du source.
  const previousChar = source[start - 1] as string;
  return WHITESPACE.test(previousChar) || !isWordChar(previousChar);
}

function findIndex(
  normalized: NormalizedSource,
  source: string,
  needle: string,
  from: number,
  requireWordStart: boolean,
): number | null {
  let index = normalized.text.indexOf(needle, from);
  while (index !== -1) {
    if (!requireWordStart || startsOnWordBoundary(source, normalized.map, index, needle)) {
      return index;
    }
    index = normalized.text.indexOf(needle, index + 1);
  }
  return null;
}

/**
 * Échelle de repli, dans cet ordre : curseur, puis début du texte (le modèle a pu
 * réordonner ses erreurs), puis extrait sans ponctuation finale, puis plus long
 * préfixe de mots entiers.
 */
function locate(
  source: string,
  normalized: NormalizedSource,
  needle: string,
  cursor: number,
): { start: number; end: number } | null {
  if (needle === '') return null;

  const variants: { text: string; requireWordStart: boolean }[] = [];
  const withoutPunctuation = stripTrailingPunctuation(needle);
  if (withoutPunctuation !== '' && withoutPunctuation !== needle) {
    variants.push({ text: withoutPunctuation, requireWordStart: true });
  }
  const wordPrefix = leadingWordPrefix(needle);
  if (wordPrefix !== null && wordPrefix !== needle) {
    variants.push({ text: wordPrefix, requireWordStart: true });
  }

  for (const from of [cursor, 0]) {
    const exact = findIndex(normalized, source, needle, from, true);
    if (exact !== null) return toSpan(normalized, exact, needle.length);

    for (const variant of variants) {
      const found = findIndex(normalized, source, variant.text, from, variant.requireWordStart);
      if (found !== null) return toSpan(normalized, found, variant.text.length);
    }
  }
  return null;
}

function toSpan(normalized: NormalizedSource, index: number, length: number): { start: number; end: number } | null {
  const start = normalized.map[index];
  const lastIndex = normalized.map[index + length - 1];
  if (start === undefined || lastIndex === undefined) return null;
  return { start, end: lastIndex + 1 };
}

export interface AlignResult {
  errors: TextError[];
  warnings: string[];
}

/**
 * Associe chaque erreur du modèle à un intervalle de caractères du texte source.
 *
 * Le modèle renvoie des extraits textuels, pas des offsets : la position est
 * recalculée ici, par recherche séquentielle dans une version normalisée du source
 * (minuscules, sans diacritiques, apostrophes unifiées, blancs réduits), ce qui
 * rend le calcul déterministe et insensible à la casse comme aux accents. Le curseur
 * garantit des positions croissantes, donc sans chevauchement.
 *
 * Contrat : ne lève jamais. Un extrait vide ou introuvable produit un warning et
 * l'erreur est retirée de la liste.
 */
export function alignErrors(source: string, modelErrors: readonly ModelError[]): AlignResult {
  const normalized = normalizeSource(source);
  const errors: TextError[] = [];
  const warnings: string[] = [];
  let unlocatedCount = 0;
  let emptyCount = 0;

  let cursor = 0;
  for (const modelError of modelErrors) {
    const needle = normalizeExcerpt(modelError.excerpt);
    if (needle === '') {
      emptyCount += 1;
      continue;
    }
    const span = locate(source, normalized, needle, cursor);
    if (span === null) {
      unlocatedCount += 1;
      continue;
    }
    errors.push({
      id: `e${span.start}-${span.end}`,
      // `excerpt` est reconstruit depuis le source : c'est la garantie que
      // l'aperçu correspond exactement au passage surligné.
      excerpt: source.slice(span.start, span.end),
      replacement: modelError.replacement,
      explanation: modelError.explanation,
      category: modelError.category,
      severity: modelError.severity,
      start: span.start,
      end: span.end,
    });
    cursor = span.end;
  }

  if (unlocatedCount > 0) {
    warnings.push(
      `${count(unlocatedCount, 'anomalie non localisée', 'anomalies non localisées')} dans le texte source (ignorée${unlocatedCount > 1 ? 's' : ''}).`,
    );
  }
  if (emptyCount > 0) {
    warnings.push(
      `${count(emptyCount, 'anomalie sans extrait exploitable', 'anomalies sans extrait exploitable')} (ignorée${emptyCount > 1 ? 's' : ''}).`,
    );
  }

  errors.sort((a, b) => a.start - b.start || a.end - b.end);
  return { errors, warnings };
}
