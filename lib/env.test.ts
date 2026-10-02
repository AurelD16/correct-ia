import { describe, expect, it } from 'vitest';
import { EnvError, getDefaultLanguage, getLlmConfig } from './env';

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
