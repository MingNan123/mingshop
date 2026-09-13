import { describe, it, expect } from 'vitest';
import { toFtsQuery, toFuzzyTerms, editDistance } from './search';

describe('toFtsQuery', () => {
  it('prefix-matches each token', () => {
    expect(toFtsQuery('red mug')).toBe('red* mug*');
  });

  it('strips FTS5 special characters that would cause syntax errors', () => {
    expect(toFtsQuery('"tee-shirt!')).toBe('tee* shirt*');
  });

  it('lowercases', () => {
    expect(toFtsQuery('MUG')).toBe('mug*');
  });

  it('returns null for empty or symbol-only input', () => {
    expect(toFtsQuery('   ')).toBeNull();
    expect(toFtsQuery('!!!')).toBeNull();
  });
});

describe('toFuzzyTerms', () => {
  it('keeps Chinese queries and wraps them for substring matching', () => {
    expect(toFuzzyTerms('接口文档')).toEqual(['%接口文档%']);
  });

  it('lets separate terms match across different product fields', () => {
    expect(toFuzzyTerms('API 模板')).toEqual(['%api%', '%模板%']);
  });

  it('escapes LIKE wildcards so user input stays literal', () => {
    expect(toFuzzyTerms('50% a_b')).toEqual(['%50\\%%', '%a\\_b%']);
  });
});

describe('editDistance', () => {
  it('is 0 for identical strings', () => {
    expect(editDistance('mug', 'mug')).toBe(0);
  });

  it('counts single edits (insert/substitute)', () => {
    expect(editDistance('mug', 'moug')).toBe(1);
    expect(editDistance('comfy', 'comfey')).toBe(1);
  });

  it('matches the classic kitten→sitting example', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });

  it('handles empty strings', () => {
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('abc', '')).toBe(3);
  });
});
