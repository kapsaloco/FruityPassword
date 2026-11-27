export const PASSWORD_CLASSES = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!"#$%&\'()*+,-./:;<=>?@[\\]^_\x60{|}~',
} as const;

export const AMBIGUOUS_CHARACTERS = '0O1Il|';

export type CharacterClass = keyof typeof PASSWORD_CLASSES;
export type Separator = '-' | ' ';
type RandomFill = (buffer: Uint32Array<ArrayBuffer>) => void;

export class GenerationError extends Error {}
export class RandomnessError extends GenerationError {}

export function createRandomIndex(fill: RandomFill = buffer => globalThis.crypto.getRandomValues(buffer)) {
  const range = 2 ** 32;
  const buffer = new Uint32Array(1);

  return (size: number): number => {
    if (!Number.isSafeInteger(size) || size < 1 || size > range) {
      throw new RangeError('Invalid random range.');
    }

    const limit = range - (range % size);
    do {
      try {
        fill(buffer);
      } catch {
        throw new RandomnessError('Secure randomness is unavailable. Generation has been disabled.');
      }
    } while (buffer[0] >= limit);
    return buffer[0] % size;
  };
}

export function validateLength(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new GenerationError(label + ' must be a whole number from ' + min + ' to ' + max + '.');
  }
}

export function passwordAlphabets(enabled: readonly CharacterClass[], excludeAmbiguous: boolean) {
  const alphabets = [...new Set(enabled)].map(name => {
    const characters = [...new Set(PASSWORD_CLASSES[name])];
    return characters.filter(character => !excludeAmbiguous || !AMBIGUOUS_CHARACTERS.includes(character)).join('');
  });
  if (!alphabets.length) throw new GenerationError('Select at least one character class.');

  const alphabet = alphabets.join('');
  if (alphabets.some(group => !group) || new Set(alphabet).size !== alphabet.length) {
    throw new GenerationError('The selected character classes are unavailable.');
  }
  return alphabets;
}

export function generatePassword(length: number, alphabets: readonly string[], randomIndex = createRandomIndex()) {
  validateLength(length, 8, 128, 'Length');
  if (alphabets.length === 0 || length < alphabets.length) {
    throw new GenerationError('Select valid character classes for this length.');
  }

  const samples = alphabets.flatMap((group, index) =>
    [...group].map(character => ({ character, mask: 1 << index })),
  );
  const required = (1 << alphabets.length) - 1;

  for (let attempt = 0; attempt < 1000; attempt++) {
    let value = '';
    let seen = 0;
    for (let position = 0; position < length; position++) {
      const sample = samples[randomIndex(samples.length)];
      value += sample.character;
      seen |= sample.mask;
    }
    if (seen === required) return value;
  }

  throw new GenerationError('Could not generate a password. Try again.');
}

export function passwordEntropy(length: number, alphabets: readonly string[]) {
  const total = alphabets.reduce((size, group) => size + group.length, 0);
  let valid = 0n;

  // Inclusion-exclusion counts exactly the strings containing every enabled class.
  for (let omitted = 0; omitted < 1 << alphabets.length; omitted++) {
    let size = total;
    let sign = 1n;
    alphabets.forEach((group, index) => {
      if (omitted & (1 << index)) {
        size -= group.length;
        sign = -sign;
      }
    });
    valid += sign * BigInt(size) ** BigInt(length);
  }

  // Even the largest supported password space is below Number.MAX_VALUE.
  return Math.log2(Number(valid));
}

export function parseWordList(source: string) {
  const words = new Set<string>();
  const keys = new Set<string>();
  for (const row of source.trim().split(/\r?\n/)) {
    const match = /^([1-6]{5})\t([a-z]+(?:-[a-z]+)*)$/.exec(row);
    if (!match || keys.has(match[1]) || words.has(match[2])) {
      throw new GenerationError('The bundled word list could not be verified.');
    }
    keys.add(match[1]);
    words.add(match[2]);
  }

  // A word containing a hyphen must be distinguishable from two adjacent words.
  const ambiguous = [...words].some(word => {
    for (let boundary = word.indexOf('-'); boundary !== -1; boundary = word.indexOf('-', boundary + 1)) {
      if (words.has(word.slice(0, boundary))) return true;
    }
    return false;
  });
  if (words.size !== 7776 || ambiguous) {
    throw new GenerationError('The bundled word list could not be verified.');
  }
  return [...words];
}

export function generatePassphrase(count: number, separator: Separator, words: readonly string[], randomIndex = createRandomIndex()) {
  validateLength(count, 4, 10, 'Word count');
  if (words.length < 7776 || (separator !== '-' && separator !== ' ')) {
    throw new GenerationError('Passphrase settings or the bundled word list are unavailable.');
  }
  return Array.from({ length: count }, () => words[randomIndex(words.length)]).join(separator);
}
