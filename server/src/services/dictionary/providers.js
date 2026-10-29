// Provider registry: the one place that decides which dictionary service is used.
//
// To add another provider, write it (see ./provider.js for the contract), add it here and set
// DICTIONARY_PROVIDER=<its name> in the environment. The service, routes and client stay unchanged.
import { createDictionaryApiProvider } from './dictionaryapi.js';

const PROVIDERS = {
  'dictionaryapi.dev': (options) => createDictionaryApiProvider(options),
};

export const providerNames = () => Object.keys(PROVIDERS);

export function createProvider(config) {
  const name = config.dictionary.provider;
  const factory = PROVIDERS[name];
  if (!factory) throw new Error(`Unknown dictionary provider "${name}". Known providers: ${providerNames().join(', ')}.`);
  return factory({
    baseUrl: config.dictionary.baseUrl,
    timeoutMs: config.dictionary.timeoutMs,
  });
}
