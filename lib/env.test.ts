import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_INPUT_CHARS,
  EnvError,
  getDefaultLanguage,
  getLlmConfig,
  getMaxInputChars,
} from './env';

const COMPLETE = {
  LLM_BASE_URL: 'https://api.example.test/v1/',
  LLM_API_KEY: 'secret',
};

describe('getLlmConfig', () => {
  it('applique les valeurs par défaut', () => {
    const config = getLlmConfig(COMPLETE);

    expect(config).toMatchObject({
      model: 'gpt-4o-mini',
      language: 'fr',
      temperature: 0,
      timeoutMs: 60_000,
      maxInputChars: 8_000,
      structuredOutput: true,
      logText: false,
    });
  });

  it('normalise l’URL de base en retirant les barres obliques finales', () => {
    expect(getLlmConfig(COMPLETE).baseUrl).toBe('https://api.example.test/v1');
  });

  it('lit les valeurs numériques et les drapeaux', () => {
    const config = getLlmConfig({
      ...COMPLETE,
      LLM_TEMPERATURE: '0.4',
      LLM_TIMEOUT_MS: '1500',
      LLM_MAX_INPUT_CHARS: '120',
      LLM_STRUCTURED_OUTPUT: 'false',
      LOG_TEXT: 'true',
    });

    expect(config).toMatchObject({
      temperature: 0.4,
      timeoutMs: 1500,
      maxInputChars: 120,
      structuredOutput: false,
      logText: true,
    });
  });

  it('échoue explicitement quand la clé ou l’URL manquent', () => {
    expect(() => getLlmConfig({ LLM_BASE_URL: 'https://api.example.test/v1' })).toThrow(EnvError);
    expect(() => getLlmConfig({ LLM_API_KEY: 'secret' })).toThrow(EnvError);
  });

  it('échoue sur une valeur numérique invalide', () => {
    expect(() => getLlmConfig({ ...COMPLETE, LLM_TIMEOUT_MS: 'bientôt' })).toThrow(EnvError);
    expect(() => getLlmConfig({ ...COMPLETE, LLM_TEMPERATURE: '9' })).toThrow(EnvError);
  });

  it('n’inclut jamais la clé dans le message d’erreur', () => {
    try {
      getLlmConfig({ ...COMPLETE, LLM_TIMEOUT_MS: 'bientôt' });
      expect.unreachable();
    } catch (error) {
      expect((error as EnvError).message).not.toContain('secret');
      expect((error as EnvError).fields).toEqual(['LLM_TIMEOUT_MS']);
    }
  });
});

describe('getDefaultLanguage', () => {
  it('retombe sur fr si la configuration est absente', () => {
    expect(getDefaultLanguage({})).toBe('fr');
  });

  it('utilise la langue configurée', () => {
    expect(getDefaultLanguage({ LLM_LANGUAGE: 'en' })).toBe('en');
  });
});

describe('getMaxInputChars', () => {
  it('retombe sur le défaut si la configuration est absente', () => {
    expect(getMaxInputChars({})).toBe(DEFAULT_MAX_INPUT_CHARS);
  });

  it('reflète une valeur personnalisée supérieure au défaut', () => {
    expect(getMaxInputChars({ LLM_MAX_INPUT_CHARS: '20000' })).toBe(20_000);
  });

  it('reflète une valeur personnalisée inférieure au défaut', () => {
    expect(getMaxInputChars({ LLM_MAX_INPUT_CHARS: '500' })).toBe(500);
  });

  it('retombe sur le défaut si la valeur est invalide', () => {
    expect(getMaxInputChars({ LLM_MAX_INPUT_CHARS: 'bientôt' })).toBe(DEFAULT_MAX_INPUT_CHARS);
    expect(getMaxInputChars({ LLM_MAX_INPUT_CHARS: '0' })).toBe(DEFAULT_MAX_INPUT_CHARS);
    expect(getMaxInputChars({ LLM_MAX_INPUT_CHARS: '-5' })).toBe(DEFAULT_MAX_INPUT_CHARS);
    expect(getMaxInputChars({ LLM_MAX_INPUT_CHARS: '12.5' })).toBe(DEFAULT_MAX_INPUT_CHARS);
  });

  it('tolère une configuration par ailleurs inexploitable', () => {
    // La page doit pouvoir rendre même sans clé d'API : seule la limite compte ici.
    expect(getMaxInputChars({ LLM_MAX_INPUT_CHARS: '3000' })).toBe(3000);
  });

  it('utilise la même valeur que celle appliquée par l’API', () => {
    const source = { ...COMPLETE, LLM_MAX_INPUT_CHARS: '1234' };

    expect(getMaxInputChars(source)).toBe(getLlmConfig(source).maxInputChars);
  });
});
