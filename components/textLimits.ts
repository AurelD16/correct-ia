/**
 * Valeur de repli de la limite de saisie, utilisée uniquement quand la
 * configuration serveur est illisible. La valeur effective est lue par l'API,
 * qui refuse au-delà de `LLM_MAX_INPUT_CHARS` : ce nombre ne sert qu'à l'affichage
 * du compteur et de l'alerte.
 */
export const MAX_INPUT_CHARS_FALLBACK = 8000;
