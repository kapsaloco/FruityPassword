import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AMBIGUOUS_CHARACTERS, GenerationError, PASSWORD_CLASSES, RandomnessError,
  createRandomIndex, generatePassphrase, generatePassword,
  parseWordList, passwordAlphabets, passwordEntropy, validateLength,
} from '../src/generator.ts';

const original = readFileSync(new URL('../src/assets/eff_large_wordlist.txt', import.meta.url), 'utf8');
const words = parseWordList(original);
const names = Object.keys(PASSWORD_CLASSES);

test('random index rejects biased tail values and reports unavailable randomness', () => {
  const draws = [0xffffffff, 0xfffffffe];
  const index = createRandomIndex(buffer => { buffer[0] = draws.shift(); });
  assert.equal(index(3), 2);
  assert.equal(draws.length, 0);
  assert.equal(createRandomIndex(buffer => { buffer[0] = 0xffffffff; })(2 ** 32), 0xffffffff);
  for (const size of [NaN, -1, 0, 1.5, 2 ** 32 + 1]) {
    assert.throws(() => index(size), RangeError);
  }
  assert.equal(createRandomIndex(buffer => { buffer[0] = 0xffffffff; })(1), 0);
  assert.throws(() => createRandomIndex(() => { throw new Error('unavailable'); })(3), RandomnessError);
});

test('password candidates are rejected whole and attempts are bounded', () => {
  const draws = [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0];
  assert.equal(generatePassword(8, ['A', '0'], () => draws.shift()), '0A0A0A0A');
  assert.equal(draws.length, 0);
  assert.throws(() => generatePassword(8, ['A', '0'], () => 0), /Try again/);
});

test('all enabled class combinations work at both length boundaries', () => {
  assert.equal(new Set(PASSWORD_CLASSES.symbols).size, 32);
  for (let selection = 1; selection < (1 << names.length); selection++) {
    const classes = names.filter((_, index) => selection & (1 << index));
    for (const excludeAmbiguous of [true, false]) {
      const alphabets = passwordAlphabets(classes, excludeAmbiguous);
      for (const length of [8, 128]) {
        const value = generatePassword(length, alphabets);
        assert.equal(value.length, length);
        assert.ok([...value].every(character => alphabets.some(group => group.includes(character))));
        assert.ok(alphabets.every(group => [...value].some(character => group.includes(character))));
        if (excludeAmbiguous) {
          assert.ok([...value].every(character => !AMBIGUOUS_CHARACTERS.includes(character)));
        }
      }
    }
  }
});

test('invalid settings are rejected and entropy uses only valid outputs', () => {
  const alphabets = passwordAlphabets(names, false);
  for (const invalid of [NaN, 7, 8.25, 129]) {
    assert.throws(() => generatePassword(invalid, alphabets), /Length/);
  }
  assert.throws(() => passwordAlphabets([], false), /character class/);
  assert.equal(passwordEntropy(3, ['ab', 'c']), Math.log2(18));
  assert.equal(passwordEntropy(8, ['ab']), 8);
});

test('length validation accepts the endpoints and reports the relevant setting', () => {
  assert.doesNotThrow(() => validateLength(4, 4, 10, 'Word count'));
  assert.doesNotThrow(() => validateLength(10, 4, 10, 'Word count'));
  assert.throws(() => validateLength(4.5, 4, 10, 'Word count'),
    error => error instanceof GenerationError && error.message === 'Word count must be a whole number from 4 to 10.');
});

test('password alphabets ignore duplicate selections and keep groups disjoint', () => {
  const alphabets = passwordAlphabets(['numbers', 'uppercase', 'numbers'], true);
  assert.deepEqual(alphabets, ['23456789', 'ABCDEFGHJKLMNPQRSTUVWXYZ']);
  assert.throws(() => generatePassword(8, []), GenerationError);
});

test('bundled EFF words match the published list and are unique', () => {
  const normalized = original.replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(normalized).digest('hex'),
    'addd35536511597a02fa0a9ff1e5284677b8883b83e986e43f15a3db996b903e');
  assert.equal(new Set(words).size, 7776);
  assert.throws(() => parseWordList(original + '\n11111\tabacus'), /verified/);
});

test('passphrases accept repeated and hyphenated words with either separator', () => {
  const hyphenated = words.findIndex(word => word.includes('-'));
  const word = words[hyphenated];
  assert.equal(generatePassphrase(4, '-', words, () => hyphenated), [word, word, word, word].join('-'));
  assert.equal(generatePassphrase(10, ' ', words).split(' ').length, 10);
  assert.throws(() => generatePassphrase(3, '-', words), /Word count/);
  assert.throws(() => generatePassphrase(11, '-', words), /Word count/);
  assert.throws(() => generatePassphrase(6, '_', words), /settings/);
  assert.throws(() => generatePassphrase(6, '-', []), /word list/);
});

test('word list validation rejects malformed entries, duplicates, and ambiguous boundaries', () => {
  assert.throws(() => parseWordList(original.replace('11111\tabacus', '71111\tabacus')), GenerationError);
  assert.throws(() => parseWordList(original.replace('11112\tabdomen', '11112\tabacus')), GenerationError);
  assert.throws(() => parseWordList(original.replace('11111\tabacus', '11111\tabdomen-extra')), GenerationError);
  assert.throws(() => parseWordList('11111\tabacus'), GenerationError);
});
