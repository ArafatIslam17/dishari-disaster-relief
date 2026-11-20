import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  checkChar,
  coverageLabel,
  formatShortCode,
  generateDevicePrefix,
  generateShortCode,
  isUuid,
  isValidShortCode,
  jaroWinkler,
  maskPhone,
  nameSimilarity,
  normaliseName,
  normalisePhone,
  normaliseShortCode,
  scoreHouseholds,
  servedPercent,
  uuidv7,
  uuidv7Time,
  type ScoringHousehold,
} from '../src/index.js';

describe('uuidv7', () => {
  it('produces valid, time-ordered, unique ids', () => {
    const ids = Array.from({ length: 2000 }, () => uuidv7());
    expect(ids.every(isUuid)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(Math.abs(uuidv7Time(ids[0] as string) - Date.now())).toBeLessThan(5000);
  });
  it('stays monotonic when the clock goes backwards', () => {
    const a = uuidv7(2_000_000_000_000);
    const b = uuidv7(1_999_999_999_000);
    expect(b > a).toBe(true);
  });
});

describe('phone (A2, NFR06)', () => {
  it.each([
    ['01712345678', '01712345678'],
    ['+8801712345678', '01712345678'],
    ['8801712345678', '01712345678'],
    ['017-1234 5678', '01712345678'],
    ['০১৭১২৩৪৫৬৭৮', '01712345678'],
    ['1712345678', '01712345678'],
  ])('normalises %s', (input, out) => expect(normalisePhone(input)).toBe(out));
  it.each(['01212345678', '0171234567', 'abc', '', '+1 555 0100'])('rejects %s', (input) =>
    expect(normalisePhone(input)).toBeNull(),
  );
  it('masks all but prefix and last two digits', () => {
    expect(maskPhone('01712345678')).toBe('017******78');
  });
});

describe('short codes (C6)', () => {
  it('generates valid codes with the device prefix', () => {
    const prefix = generateDevicePrefix();
    for (let i = 0; i < 500; i++) {
      const code = generateShortCode(prefix);
      expect(code).toHaveLength(9);
      expect(code.startsWith(prefix)).toBe(true);
      expect(isValidShortCode(code)).toBe(true);
    }
  });
  it('detects every single-character substitution', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 8 }), fc.integer({ min: 1, max: 31 }), (pos, delta) => {
        const code = generateShortCode('K7M');
        const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
        const idx = alphabet.indexOf(code[pos] as string);
        const mutated = code.slice(0, pos) + alphabet[(idx + delta) % 32] + code.slice(pos + 1);
        return !isValidShortCode(mutated);
      }),
      { numRuns: 2000 },
    );
  });
  it('detects adjacent transpositions, except the 0<->Z pair Luhn mod N cannot see', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 7 }), (pos) => {
        const code = generateShortCode('K7M');
        if (code[pos] === code[pos + 1]) return true;
        const pair = [code[pos], code[pos + 1]].sort().join('');
        if (pair === '0Z') return true; // the documented blind spot (like 09<->90 in decimal Luhn)
        const swapped = code.slice(0, pos) + code[pos + 1] + code[pos] + code.slice(pos + 2);
        return !isValidShortCode(swapped);
      }),
      { numRuns: 2000 },
    );
  });
  it('accepts look-alike input and separators', () => {
    const body = 'K7M4QX9T';
    const code = body + checkChar(body);
    expect(normaliseShortCode(formatShortCode(code).toLowerCase())).toBe(code);
    expect(isValidShortCode(code.replace('1', 'I'))).toBe(isValidShortCode(code));
  });
  it('rejects wrong length and invalid characters', () => {
    expect(isValidShortCode('K7M4QX9')).toBe(false);
    expect(isValidShortCode('K7M4QX9TU')).toBe(false);
  });
});

describe('names and Jaro-Winkler', () => {
  it('normalises honorific variants', () => {
    expect(normaliseName('Mohammad  Abdur-Rahim')).toBe('md abdul rahim');
    expect(normaliseName('Md. Abdul Rahim')).toBe('md abdul rahim');
  });
  it('matches reference Jaro-Winkler values', () => {
    expect(jaroWinkler('martha', 'marhta')).toBeCloseTo(0.961, 3);
    expect(jaroWinkler('dwayne', 'duane')).toBeCloseTo(0.84, 2);
    expect(jaroWinkler('abc', 'xyz')).toBe(0);
  });
  it('is symmetric and bounded', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 20 }), (a, b) => {
        const x = jaroWinkler(a, b);
        const y = jaroWinkler(b, a);
        return Math.abs(x - y) < 1e-9 && x >= 0 && x <= 1;
      }),
    );
  });
  it('handles reordered tokens', () => {
    expect(nameSimilarity('Rahim Uddin', 'Uddin Rahim')).toBe(1);
  });
});

describe('duplicate scoring (FR18, C12)', () => {
  const base: ScoringHousehold = {
    headName: 'Abdul Karim',
    phone: '01712345678',
    memberCount: 5,
    unionKey: 'u1',
    wardKey: 'w1',
  };
  it('labels an exact match likely', () => {
    expect(scoreHouseholds(base, { ...base }).label).toBe('likely');
  });
  it('labels a typo with a different ward possible or likely, never null', () => {
    const r = scoreHouseholds(base, { ...base, headName: 'Abdul Karym', wardKey: 'w2', memberCount: 6 });
    expect(r.label).not.toBeNull();
  });
  it('does not flag different people in the same ward', () => {
    const r = scoreHouseholds(base, { ...base, headName: 'Shahana Begum', phone: '01898765432', memberCount: 2 });
    expect(r.label).toBeNull();
  });
  it('treats a missing phone as uncertainty: an otherwise identical record is only "possible"', () => {
    const r = scoreHouseholds(base, { ...base, phone: null });
    expect(r.signals.phone).toBeNull();
    expect(r.label).toBe('possible');
  });
  it('ignores honorific prefixes when comparing names', () => {
    expect(nameSimilarity('Md Abdul Karim', 'Mohammad Abdul Karim')).toBe(1);
    expect(nameSimilarity('Md Anwar Hossain', 'Md Abdul Karim')).toBeLessThan(0.7);
  });
  it('uses the phone HMAC when raw numbers are unavailable', () => {
    const a = { ...base, phone: null, phoneHmac: 'h1' };
    expect(scoreHouseholds(a, { ...a }).signals.phone).toBe(1);
    expect(scoreHouseholds(a, { ...a, phoneHmac: 'h2' }).signals.phone).toBe(0);
  });
  it('is symmetric', () => {
    const b = { ...base, headName: 'Abul Karim', memberCount: 4 };
    expect(scoreHouseholds(base, b).score).toBe(scoreHouseholds(b, base).score);
  });
});

describe('coverage labels (C11)', () => {
  it('never shows a zero-household area as served', () => {
    expect(coverageLabel(0, 0)).toBe('no_records');
    expect(coverageLabel(0, 3)).toBe('no_records');
    expect(servedPercent(0, 0)).toBeNull();
  });
  it('classifies thresholds', () => {
    expect(coverageLabel(10, 0)).toBe('not_served');
    expect(coverageLabel(10, 1)).toBe('partly_served');
    expect(coverageLabel(10, 9)).toBe('partly_served');
    expect(coverageLabel(10, 10)).toBe('fully_served');
    expect(servedPercent(1000, 999)).toBe(99);
  });
});
