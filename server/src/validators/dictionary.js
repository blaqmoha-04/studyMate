import { z } from 'zod';
import { pagination } from './common.js';

const text = (max) => z.string().trim().max(max);

export const dictionaryLookupQuery = z.object({
  word: text(100).min(1, 'Word is required'),
});

export const dictionaryAudioQuery = z.object({
  url: z.string().url('Invalid audio URL').max(2000),
});

export const vocabularyQuery = z.object({
  ...pagination,
  q: text(100).optional(),
});

export const vocabularySaveBody = z.object({
  word: text(100).min(1, 'Word is required'),
  phonetic: text(100).default(''),
  partOfSpeech: text(100).default(''),
  meanings: z.array(z.any()).default([]),
  audioUrl: z.string().url().max(2000).nullable().optional(),
}).strict();

export const recentQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
