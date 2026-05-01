import { describe, it, expect } from 'vitest';
import { sanitizeSessionName, SESSION_NAME_MAX } from '../../src/utils/session-name';

describe('sanitizeSessionName', () => {
  describe('basic cases', () => {
    it('passes through a normal name unchanged', () => {
      expect(sanitizeSessionName('My Chat')).toBe('My Chat');
    });

    it('trims surrounding whitespace', () => {
      expect(sanitizeSessionName('  hello  ')).toBe('hello');
    });

    it('collapses internal whitespace runs to a single space', () => {
      expect(sanitizeSessionName('foo    bar\t\tbaz')).toBe('foo bar baz');
    });

    it('preserves single internal spaces', () => {
      expect(sanitizeSessionName('one two three')).toBe('one two three');
    });
  });

  describe('empty / fallback handling', () => {
    it('returns Untitled for empty string', () => {
      expect(sanitizeSessionName('')).toBe('Untitled');
    });

    it('returns Untitled for whitespace-only input', () => {
      expect(sanitizeSessionName('   \t\n  ')).toBe('Untitled');
    });

    it('returns Untitled when only illegal chars are supplied', () => {
      expect(sanitizeSessionName('////')).toBe('Untitled');
      expect(sanitizeSessionName('<>:"|?*')).toBe('Untitled');
    });

    it('returns Untitled for non-string input', () => {
      // @ts-expect-error testing runtime guard
      expect(sanitizeSessionName(null)).toBe('Untitled');
      // @ts-expect-error testing runtime guard
      expect(sanitizeSessionName(undefined)).toBe('Untitled');
      // @ts-expect-error testing runtime guard
      expect(sanitizeSessionName(42)).toBe('Untitled');
    });
  });

  describe('filesystem-illegal characters', () => {
    it('strips path separators', () => {
      expect(sanitizeSessionName('foo/bar')).toBe('foobar');
      expect(sanitizeSessionName('foo\\bar')).toBe('foobar');
    });

    it('strips Windows-illegal chars (<>:"|?*)', () => {
      expect(sanitizeSessionName('a<b>c:d"e|f?g*h')).toBe('abcdefgh');
    });

    it('strips C0 control characters including NUL', () => {
      expect(sanitizeSessionName('foo\u0000bar\u0001\u001Fbaz')).toBe('foobarbaz');
    });

    it('keeps emoji and unicode letters', () => {
      expect(sanitizeSessionName('Café 🐈 Chat')).toBe('Café 🐈 Chat');
    });
  });

  describe('hidden-file / portability guards', () => {
    it('strips leading dots so we never create hidden folders', () => {
      expect(sanitizeSessionName('.hidden')).toBe('hidden');
      expect(sanitizeSessionName('...secret')).toBe('secret');
    });

    it('strips trailing dots (Windows quirk)', () => {
      expect(sanitizeSessionName('foo.')).toBe('foo');
      expect(sanitizeSessionName('foo...')).toBe('foo');
    });

    it('preserves dots in the middle', () => {
      expect(sanitizeSessionName('v1.2.3 release')).toBe('v1.2.3 release');
    });

    it('appends underscore to Windows reserved names', () => {
      expect(sanitizeSessionName('CON')).toBe('CON_');
      expect(sanitizeSessionName('nul')).toBe('nul_');
      expect(sanitizeSessionName('COM1')).toBe('COM1_');
      expect(sanitizeSessionName('LPT9')).toBe('LPT9_');
    });

    it('does not touch reserved-looking names that are not exact matches', () => {
      expect(sanitizeSessionName('CONTROL')).toBe('CONTROL');
      expect(sanitizeSessionName('com10')).toBe('com10');
    });
  });

  describe('length cap', () => {
    it('caps at SESSION_NAME_MAX', () => {
      const long = 'a'.repeat(100);
      const result = sanitizeSessionName(long);
      expect(result.length).toBe(SESSION_NAME_MAX);
    });

    it('SESSION_NAME_MAX is reasonably long (>=40)', () => {
      expect(SESSION_NAME_MAX).toBeGreaterThanOrEqual(40);
    });

    it('caps after stripping illegal chars (so the cap reflects the visible name)', () => {
      // 50 slashes (all stripped) + 10 visible chars => 10 chars out
      const input = '/'.repeat(50) + 'realname12';
      expect(sanitizeSessionName(input)).toBe('realname12');
    });

    it('trims trailing whitespace introduced by the cap', () => {
      const padded = 'word '.repeat(20); // "word word word ..."
      const result = sanitizeSessionName(padded);
      expect(result.length).toBeLessThanOrEqual(SESSION_NAME_MAX);
      expect(result.endsWith(' ')).toBe(false);
    });
  });

  describe('idempotence', () => {
    it('re-sanitising a sanitised name returns the same value', () => {
      const cases = [
        'My Chat',
        '  Foo  ',
        '.hidden',
        'CON',
        'a/b\\c',
        'a'.repeat(100),
        '   ',
        '',
      ];
      for (const c of cases) {
        const once = sanitizeSessionName(c);
        const twice = sanitizeSessionName(once);
        expect(twice).toBe(once);
      }
    });
  });
});
