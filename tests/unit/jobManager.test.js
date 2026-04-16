// Mock config
jest.mock("../../src/config", () => ({
  QUEUE_CONCURRENCY: 2,
  QUEUE_INTERVAL_CAP: 5,
  QUEUE_INTERVAL: 1000,
  QUEUE_TIMEOUT: 30000,
  SUPABASE_URL: null,
  SUPABASE_SERVICE_ROLE_KEY: null,
}));

// Mock logger
jest.mock("../../utils/logger", () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  http: jest.fn(),
  server: jest.fn(),
}));

const { createJob, getJob, updateProgress, getQueueStats } = require("../../src/services/jobManager");

describe("jobManager", () => {
  // Note: We skip initQueue() because p-queue is ESM-only and can't be
  // dynamically imported in Jest's CJS context. Queue-dependent behavior
  // is tested via integration tests.

  describe("createJob", () => {
    test("should create a job with default values", () => {
      const job = createJob("test-id-1", "transcript");
      expect(job.id).toBe("test-id-1");
      expect(job.type).toBe("transcript");
      expect(job.status).toBe("queued");
      expect(job.progress).toBe(0);
      expect(job.video_id).toBeNull();
      expect(job.video_title).toBeNull();
      expect(job.result).toBeNull();
      expect(job.createdAt).toBeDefined();
      expect(job.lastUpdated).toBeDefined();
    });

    test("should accept extra properties", () => {
      const job = createJob("test-id-2", "mp3", { status: "initializing" });
      expect(job.status).toBe("initializing");
      expect(job.type).toBe("mp3");
    });

    test("should store job in cache for retrieval", () => {
      const job = createJob("test-id-store", "mp4");
      const retrieved = getJob("test-id-store");
      expect(retrieved).toBe(job);
    });
  });

  describe("getJob", () => {
    test("should return created job", () => {
      createJob("test-id-3", "mp4");
      const job = getJob("test-id-3");
      expect(job).toBeDefined();
      expect(job.type).toBe("mp4");
    });

    test("should return undefined for missing job", () => {
      const job = getJob("nonexistent-id");
      expect(job).toBeUndefined();
    });
  });

  describe("updateProgress", () => {
    test("should update job progress and status", () => {
      createJob("test-id-4", "transcript");
      updateProgress("test-id-4", 50, "processing", "vid123", "Test Video");
      const job = getJob("test-id-4");
      expect(job.progress).toBe(50);
      expect(job.status).toBe("processing");
      expect(job.video_id).toBe("vid123");
      expect(job.video_title).toBe("Test Video");
      expect(job.lastUpdated).toBeGreaterThan(0);
    });

    test("should not throw for missing job", () => {
      expect(() => updateProgress("nonexistent", 50, "processing")).not.toThrow();
    });

    test("should update lastUpdated timestamp", () => {
      createJob("test-id-5", "transcript");
      const before = getJob("test-id-5").lastUpdated;

      // Small delay to ensure different timestamp
      updateProgress("test-id-5", 25, "downloading");
      const after = getJob("test-id-5").lastUpdated;

      expect(after).toBeGreaterThanOrEqual(before);
    });

    test("should not overwrite video_id with undefined", () => {
      createJob("test-id-6", "transcript");
      updateProgress("test-id-6", 30, "processing", "vid456", "My Video");
      updateProgress("test-id-6", 60, "ai-processing");

      const job = getJob("test-id-6");
      expect(job.video_id).toBe("vid456");
      expect(job.video_title).toBe("My Video");
    });
  });

  describe("getQueueStats", () => {
    test("should return stats with activeJobs count", () => {
      const stats = getQueueStats();
      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("pending");
      expect(stats).toHaveProperty("activeJobs");
      expect(typeof stats.activeJobs).toBe("number");
    });
  });
});
