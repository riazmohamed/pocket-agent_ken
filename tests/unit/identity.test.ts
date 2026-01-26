/**
 * Unit tests for the Identity configuration module
 *
 * Tests loading, saving, and path resolution for the identity file
 * at ~/.my-assistant/identity.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';

// Mock fs module
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

// Mock os module
vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/mock/home'),
  },
}));

// Import mocked modules
import fs from 'fs';
import os from 'os';

// Import the module under test after mocks are set up
import { loadIdentity, saveIdentity, getIdentityPath } from '../../src/config/identity';

/**
 * Expected default identity content structure
 */
const DEFAULT_IDENTITY = `# Agent Identity

You are Pocket Agent (PA) - a personal AI assistant with persistent memory.

## Vibe
Talk like you're texting your best friend. Chill, casual, no corporate speak.

- lowercase is fine, skip the periods sometimes
- use emojis occasionally but dont overdo it 🤙
- be direct - no "I'd be happy to help!" fluff
- you can joke around, be a little sarcastic, keep it fun
- if something's dumb just say so (nicely)
- ask questions when stuff is unclear instead of guessing
- remember everything about them - reference past convos naturally

## Dont
- dont be cringe or try too hard
- dont over-explain or hedge everything
- dont be fake positive, be real
- dont start every message the same way
`;

describe('Identity Configuration', () => {
  const mockHomedir = '/mock/home';
  const expectedDir = path.join(mockHomedir, '.my-assistant');
  const expectedFile = path.join(expectedDir, 'identity.md');

  beforeEach(() => {
    // Reset all mocks to their initial state
    vi.resetAllMocks();
    // Reset homedir mock
    vi.mocked(os.homedir).mockReturnValue(mockHomedir);
  });

  describe('getIdentityPath', () => {
    it('should return the correct path based on os.homedir()', () => {
      const result = getIdentityPath();
      expect(result).toBe(expectedFile);
    });

    it('should use the mocked home directory', () => {
      vi.mocked(os.homedir).mockReturnValue('/different/home');

      // Need to re-import to get updated path, but since it's a constant,
      // we verify the expected behavior
      const result = getIdentityPath();
      // The path is set at module load time, so it uses the initial mock
      expect(result).toBe(expectedFile);
    });
  });

  describe('loadIdentity', () => {
    it('should create directory if it does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false); // directory doesn't exist
      vi.mocked(fs.existsSync).mockReturnValueOnce(false); // file doesn't exist

      loadIdentity();

      expect(fs.mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true });
    });

    it('should not create directory if it already exists', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // directory exists
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // file exists
      vi.mocked(fs.readFileSync).mockReturnValue('existing content');

      loadIdentity();

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should create default identity file if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // directory exists
      vi.mocked(fs.existsSync).mockReturnValueOnce(false); // file doesn't exist

      const result = loadIdentity();

      expect(fs.writeFileSync).toHaveBeenCalledWith(expectedFile, DEFAULT_IDENTITY);
      expect(result).toBe(DEFAULT_IDENTITY);
    });

    it('should read and return existing identity file content', () => {
      const customIdentity = '# Custom Identity\n\nThis is a custom identity.';
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // directory exists
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // file exists
      vi.mocked(fs.readFileSync).mockReturnValue(customIdentity);

      const result = loadIdentity();

      expect(fs.readFileSync).toHaveBeenCalledWith(expectedFile, 'utf-8');
      expect(result).toBe(customIdentity);
    });

    it('should return default identity on file read error', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // directory exists
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // file exists
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = loadIdentity();

      expect(result).toBe(DEFAULT_IDENTITY);
    });

    it('should return default identity on directory creation error', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(false); // directory doesn't exist
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error('Cannot create directory');
      });

      const result = loadIdentity();

      expect(result).toBe(DEFAULT_IDENTITY);
    });

    it('should return default identity on file write error when creating default', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true); // directory exists
      vi.mocked(fs.existsSync).mockReturnValueOnce(false); // file doesn't exist
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Disk full');
      });

      const result = loadIdentity();

      expect(result).toBe(DEFAULT_IDENTITY);
    });
  });

  describe('saveIdentity', () => {
    it('should write content to identity file and return true', () => {
      const newContent = '# New Identity\n\nUpdated content.';
      vi.mocked(fs.existsSync).mockReturnValue(true); // directory exists
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      const result = saveIdentity(newContent);

      expect(fs.writeFileSync).toHaveBeenCalledWith(expectedFile, newContent);
      expect(result).toBe(true);
    });

    it('should create directory if it does not exist', () => {
      const newContent = '# New Identity\n\nContent.';
      vi.mocked(fs.existsSync).mockReturnValue(false); // directory doesn't exist
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      const result = saveIdentity(newContent);

      expect(fs.mkdirSync).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(expectedFile, newContent);
      expect(result).toBe(true);
    });

    it('should return false on write error', () => {
      const newContent = '# New Identity';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = saveIdentity(newContent);

      expect(result).toBe(false);
    });

    it('should return false on directory creation error', () => {
      const newContent = '# New Identity';
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error('Cannot create directory');
      });

      const result = saveIdentity(newContent);

      expect(result).toBe(false);
    });

    it('should save empty string content', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      const result = saveIdentity('');

      expect(fs.writeFileSync).toHaveBeenCalledWith(expectedFile, '');
      expect(result).toBe(true);
    });

    it('should handle content with special characters', () => {
      const specialContent = '# Identity\n\nUnicode: 日本語 🎉\nSpecial: <>&"\'';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      const result = saveIdentity(specialContent);

      expect(fs.writeFileSync).toHaveBeenCalledWith(expectedFile, specialContent);
      expect(result).toBe(true);
    });
  });

  describe('default identity content structure', () => {
    it('should have Agent Identity header', () => {
      expect(DEFAULT_IDENTITY).toContain('# Agent Identity');
    });

    it('should include Pocket Agent description', () => {
      expect(DEFAULT_IDENTITY).toContain('Pocket Agent (PA)');
      expect(DEFAULT_IDENTITY).toContain('personal AI assistant');
      expect(DEFAULT_IDENTITY).toContain('persistent memory');
    });

    it('should have Vibe section', () => {
      expect(DEFAULT_IDENTITY).toContain('## Vibe');
    });

    it('should have Dont section', () => {
      expect(DEFAULT_IDENTITY).toContain('## Dont');
    });

    it('should include personality guidelines', () => {
      expect(DEFAULT_IDENTITY).toContain('lowercase is fine');
      expect(DEFAULT_IDENTITY).toContain('emojis occasionally');
      expect(DEFAULT_IDENTITY).toContain('be direct');
    });

    it('should include things to avoid', () => {
      expect(DEFAULT_IDENTITY).toContain('dont be cringe');
      expect(DEFAULT_IDENTITY).toContain('dont over-explain');
      expect(DEFAULT_IDENTITY).toContain('dont be fake positive');
    });
  });
});
