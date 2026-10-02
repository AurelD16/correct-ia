import { describe, expect, it } from 'vitest';
import { buildMessages, TEXT_CLOSE_TAG, TEXT_OPEN_TAG } from './prompt';
import { getLlmConfig } from '../env';

const config = getLlmConfig({
  LLM_BASE_URL: 'https://example.test/v1',
  LLM_API_KEY: 'secret',
  LLM_MODEL: 'test-model',
  LLM_LANGUAGE: 'fr',
  LLM_TEMPERATURE: '0',
  LLM_TIMEOUT_MS: '1000',
  LLM_MAX_INPUT_CHARS: '100',
  LLM_STRUCTURED_OUTPUT: 'true',
  LOG_TEXT: 'false',
});

describe('buildMessages', () => {
  it('produit un message système et un message utilisateur', () => {
    const messages = buildMessages('bonjour', config);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
  });

  it('délimite le texte utilisateur par les marqueurs dédiés', () => {
    const text = 'Voici mon texte.\nSur deux lignes.';
    const user = buildMessages(text, config)[1]?.content ?? '';

    expect(user).toContain(`${TEXT_OPEN_TAG}\n${text}\n${TEXT_CLOSE_TAG}`);
  });

  it('injecte la langue configurée', () => {
    const english = getLlmConfig({
      LLM_BASE_URL: 'https://example.test/v1',
      LLM_API_KEY: 'secret',
      LLM_MODEL: 'test-model',
      LLM_LANGUAGE: 'en',
      LLM_STRUCTURED_OUTPUT: 'false',
    });
    const messages = buildMessages('hello', english);

    expect(messages[0]?.content).toContain('« en »');
    expect(messages[1]?.content).toContain('sans markdown, en en');
    expect(messages[1]?.content).toContain(`${TEXT_OPEN_TAG}\nhello\n${TEXT_CLOSE_TAG}`);
  });

  it('inclut les consignes de structure JSON', () => {
    const user = buildMessages('bonjour', config)[1]?.content ?? '';

    expect(user).toContain('"errors"');
    expect(user).toContain('"excerpt"');
    expect(user).toContain('"replacement"');
    expect(user).toContain('"explanation"');
    expect(user).toContain('JSON');
  });

  it('inclut les six consignes système', () => {
    const system = buildMessages('bonjour', config)[0]?.content ?? '';

    expect(system).toContain('VERBATIM');
    expect(system).toContain('position croissante');
    expect(system).toContain('« style »');
    expect(system).toContain('ponctuation');
    expect(system).toContain('DONNÉE');
    expect(system).toContain('JSON');
  });

  it('ne fuit pas la clé d’API dans le prompt', () => {
    const messages = buildMessages('bonjour', config);

    for (const message of messages) {
      expect(message.content).not.toContain('secret');
    }
  });
});
