import { describe, it, expect, beforeEach, vi } from 'vitest';

// Create a mock for the OpenAI embeddings.create method
const mockCreate = vi.fn();

// Mock OpenAI as a class constructor
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      embeddings = {
        create: mockCreate,
      };
constructor(_options: { apiKey: string }) {
        // Constructor accepts options but doesn't need to do anything
      }
    },
  };
});

// Import after mocking
import {
  initEmbeddings,
  hasEmbeddings,
  embed,
  embedBatch,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
  EMBEDDING_DIMENSIONS,
} from '../../src/memory/embeddings';

describe('Embeddings Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initEmbeddings', () => {
    it('should initialize OpenAI client', () => {
      initEmbeddings('test-api-key');
      expect(hasEmbeddings()).toBe(true);
    });

    it('should set hasEmbeddings to true after initialization', () => {
      initEmbeddings('test-api-key');
      expect(hasEmbeddings()).toBe(true);
    });
  });

  describe('hasEmbeddings', () => {
    it('should return true when client is initialized', () => {
      initEmbeddings('test-api-key');
      expect(hasEmbeddings()).toBe(true);
    });
  });

  describe('embed', () => {
    const mockEmbedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);

    beforeEach(() => {
      initEmbeddings('test-api-key');
      mockCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding }],
      });
    });

    it('should generate embedding for text', async () => {
      const result = await embed('test text');
      expect(result).toEqual(mockEmbedding);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: 'test text',
        dimensions: EMBEDDING_DIMENSIONS,
      });
    });

    it('should handle empty string input', async () => {
      const result = await embed('');
      expect(result).toEqual(mockEmbedding);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: '',
        dimensions: EMBEDDING_DIMENSIONS,
      });
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

      await expect(embed('test text')).rejects.toThrow('API rate limit exceeded');
    });

    it('should handle long text input', async () => {
      const longText = 'a'.repeat(10000);
      const result = await embed(longText);
      expect(result).toEqual(mockEmbedding);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: longText,
        dimensions: EMBEDDING_DIMENSIONS,
      });
    });
  });

  describe('embedBatch', () => {
    const mockEmbedding1 = Array(EMBEDDING_DIMENSIONS).fill(0.1);
    const mockEmbedding2 = Array(EMBEDDING_DIMENSIONS).fill(0.2);

    beforeEach(() => {
      initEmbeddings('test-api-key');
    });

    it('should generate embeddings for multiple texts', async () => {
      mockCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding1 }, { embedding: mockEmbedding2 }],
      });

      const result = await embedBatch(['text 1', 'text 2']);
      expect(result).toEqual([mockEmbedding1, mockEmbedding2]);
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'text-embedding-3-small',
        input: ['text 1', 'text 2'],
        dimensions: EMBEDDING_DIMENSIONS,
      });
    });

    it('should return empty array for empty input', async () => {
      const result = await embedBatch([]);
      expect(result).toEqual([]);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('should handle single text in batch', async () => {
      mockCreate.mockResolvedValue({
        data: [{ embedding: mockEmbedding1 }],
      });

      const result = await embedBatch(['single text']);
      expect(result).toEqual([mockEmbedding1]);
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValue(new Error('API error'));

      await expect(embedBatch(['text'])).rejects.toThrow('API error');
    });

    it('should handle many texts in batch', async () => {
      const manyTexts = Array(100)
        .fill(0)
        .map((_, i) => `text ${i}`);
      const manyEmbeddings = manyTexts.map(() => mockEmbedding1);

      mockCreate.mockResolvedValue({
        data: manyEmbeddings.map(embedding => ({ embedding })),
      });

      const result = await embedBatch(manyTexts);
      expect(result.length).toBe(100);
    });
  });

  describe('cosineSimilarity', () => {
    it('should calculate similarity of identical vectors as 1', () => {
      const vector = [1, 2, 3, 4, 5];
      const similarity = cosineSimilarity(vector, vector);
      expect(similarity).toBeCloseTo(1, 10);
    });

    it('should calculate similarity of orthogonal vectors as 0', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(0, 10);
    });

    it('should calculate similarity of opposite vectors as -1', () => {
      const a = [1, 2, 3];
      const b = [-1, -2, -3];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(-1, 10);
    });

    it('should calculate partial similarity correctly', () => {
      const a = [1, 0];
      const b = [1, 1];
      const similarity = cosineSimilarity(a, b);
      // cos(45 degrees) = sqrt(2)/2 approximately 0.7071
      expect(similarity).toBeCloseTo(Math.sqrt(2) / 2, 5);
    });

    it('should throw error for vectors of different lengths', () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      expect(() => cosineSimilarity(a, b)).toThrow('Vectors must have same length');
    });

    it('should return 0 for zero vectors', () => {
      const a = [0, 0, 0];
      const b = [1, 2, 3];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBe(0);
    });

    it('should return 0 when both vectors are zero', () => {
      const a = [0, 0, 0];
      const b = [0, 0, 0];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBe(0);
    });

    it('should handle high-dimensional vectors', () => {
      const a = Array(EMBEDDING_DIMENSIONS).fill(0.1);
      const b = Array(EMBEDDING_DIMENSIONS).fill(0.1);
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(1, 10);
    });

    it('should be commutative', () => {
      const a = [1, 2, 3, 4];
      const b = [5, 6, 7, 8];
      expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
    });

    it('should handle negative values', () => {
      const a = [-1, -2, -3];
      const b = [-1, -2, -3];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(1, 10);
    });

    it('should handle mixed positive and negative values', () => {
      const a = [1, -1, 1, -1];
      const b = [-1, 1, -1, 1];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(-1, 10);
    });

    it('should handle very small values', () => {
      const a = [0.0001, 0.0002, 0.0003];
      const b = [0.0001, 0.0002, 0.0003];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(1, 5);
    });

    it('should handle single element vectors', () => {
      const a = [5];
      const b = [3];
      const similarity = cosineSimilarity(a, b);
      expect(similarity).toBeCloseTo(1, 10);
    });
  });

  describe('serializeEmbedding', () => {
    it('should serialize embedding to Buffer', () => {
      const embedding = [0.1, 0.2, 0.3];
      const buffer = serializeEmbedding(embedding);

      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBe(embedding.length * 4);
    });

    it('should store values as little-endian floats', () => {
      const embedding = [1.5];
      const buffer = serializeEmbedding(embedding);

      expect(buffer.readFloatLE(0)).toBeCloseTo(1.5, 5);
    });

    it('should handle empty embedding', () => {
      const embedding: number[] = [];
      const buffer = serializeEmbedding(embedding);

      expect(buffer.length).toBe(0);
    });

    it('should handle large embeddings', () => {
      const embedding = Array(EMBEDDING_DIMENSIONS)
        .fill(0)
        .map((_, i) => i * 0.001);
      const buffer = serializeEmbedding(embedding);

      expect(buffer.length).toBe(EMBEDDING_DIMENSIONS * 4);
    });

    it('should handle negative values', () => {
      const embedding = [-0.5, -1.0, -2.5];
      const buffer = serializeEmbedding(embedding);

      expect(buffer.readFloatLE(0)).toBeCloseTo(-0.5, 5);
      expect(buffer.readFloatLE(4)).toBeCloseTo(-1.0, 5);
      expect(buffer.readFloatLE(8)).toBeCloseTo(-2.5, 5);
    });

    it('should handle zero values', () => {
      const embedding = [0, 0, 0];
      const buffer = serializeEmbedding(embedding);

      expect(buffer.readFloatLE(0)).toBe(0);
      expect(buffer.readFloatLE(4)).toBe(0);
      expect(buffer.readFloatLE(8)).toBe(0);
    });
  });

  describe('deserializeEmbedding', () => {
    it('should deserialize Buffer to embedding', () => {
      const original = [0.1, 0.2, 0.3];
      const buffer = serializeEmbedding(original);
      const result = deserializeEmbedding(buffer);

      expect(result.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(result[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('should handle empty buffer', () => {
      const buffer = Buffer.alloc(0);
      const result = deserializeEmbedding(buffer);

      expect(result).toEqual([]);
    });

    it('should correctly roundtrip embeddings', () => {
      const original = Array(EMBEDDING_DIMENSIONS)
        .fill(0)
        .map(() => Math.random() * 2 - 1);
      const buffer = serializeEmbedding(original);
      const result = deserializeEmbedding(buffer);

      expect(result.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(result[i]).toBeCloseTo(original[i], 5);
      }
    });

    it('should handle buffer with single float', () => {
      const buffer = Buffer.alloc(4);
      buffer.writeFloatLE(3.14159, 0);
      const result = deserializeEmbedding(buffer);

      expect(result.length).toBe(1);
      expect(result[0]).toBeCloseTo(3.14159, 4);
    });
  });

  describe('serialization roundtrip', () => {
    it('should preserve cosine similarity after serialization', () => {
      const a = [0.1, 0.5, -0.3, 0.8];
      const b = [0.2, 0.4, -0.1, 0.9];

      const originalSimilarity = cosineSimilarity(a, b);

      const aBuffer = serializeEmbedding(a);
      const bBuffer = serializeEmbedding(b);
      const aDeserialized = deserializeEmbedding(aBuffer);
      const bDeserialized = deserializeEmbedding(bBuffer);

      const roundtripSimilarity = cosineSimilarity(aDeserialized, bDeserialized);

      expect(roundtripSimilarity).toBeCloseTo(originalSimilarity, 5);
    });

    it('should preserve values for full-dimension embeddings', () => {
      const original = Array(EMBEDDING_DIMENSIONS)
        .fill(0)
        .map((_, i) => Math.sin(i / 100));

      const buffer = serializeEmbedding(original);
      const restored = deserializeEmbedding(buffer);

      expect(restored.length).toBe(original.length);
      for (let i = 0; i < original.length; i++) {
        expect(restored[i]).toBeCloseTo(original[i], 5);
      }
    });
  });

  describe('EMBEDDING_DIMENSIONS', () => {
    it('should be 1536 for text-embedding-3-small', () => {
      expect(EMBEDDING_DIMENSIONS).toBe(1536);
    });
  });
});
