const { createClient } = require("@supabase/supabase-js");
const logger = require("../utils/logger");
const config = require("../config");

// Will be initialized by initQueue()
let processingQueue = null;

// In-memory hot cache for active jobs (write-through to Supabase)
const processingCache = new Map();

// Supabase client for job persistence
let supabase = null;

function getSupabase() {
  if (!supabase && config.SUPABASE_URL && config.SUPABASE_SERVICE_ROLE_KEY) {
    supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY);
  }
  return supabase;
}

/**
 * Initialize the processing queue (must be called at startup)
 */
async function initQueue() {
  const { default: PQueue } = await import("p-queue");
  processingQueue = new PQueue({
    concurrency: config.QUEUE_CONCURRENCY,
    intervalCap: config.QUEUE_INTERVAL_CAP,
    interval: config.QUEUE_INTERVAL,
    timeout: config.QUEUE_TIMEOUT,
    throwOnTimeout: true,
  });
  logger.server("Processing queue initialized", {
    concurrency: config.QUEUE_CONCURRENCY,
    intervalCap: config.QUEUE_INTERVAL_CAP,
  });

  // Clean up stale Supabase jobs on startup (mark old non-terminal jobs as failed)
  await cleanupStaleJobs().catch((err) =>
    logger.warn("Failed to cleanup stale jobs on startup", { error: err.message }),
  );

  return processingQueue;
}

/**
 * Get the processing queue instance
 */
function getQueue() {
  if (!processingQueue) {
    throw new Error("Processing queue not initialized. Call initQueue() first.");
  }
  return processingQueue;
}

/**
 * Persist a job to Supabase (non-blocking, fire-and-forget)
 */
async function persistJob(job) {
  const db = getSupabase();
  if (!db) return;

  try {
    const { error } = await db.from("api_jobs").upsert({
      id: job.id,
      type: job.type,
      status: job.status || "queued",
      progress: job.progress || 0,
      video_id: job.video_id || null,
      video_title: job.video_title || null,
      result: job.result || null,
    }, { onConflict: "id" });

    if (error) {
      logger.warn("Failed to persist job to Supabase", {
        jobId: job.id,
        error: error.message,
      });
    }
  } catch (err) {
    logger.warn("Supabase persist error", { jobId: job.id, error: err.message });
  }
}

/**
 * Create a new processing job
 * @param {string} id - Job ID (UUID)
 * @param {string} type - Job type ('transcript', 'mp3', 'mp4')
 * @param {object} extra - Additional job properties
 * @returns {object} - The created job
 */
function createJob(id, type, extra = {}) {
  const job = {
    id,
    type,
    status: "queued",
    progress: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    video_id: null,
    video_title: null,
    result: null,
    ...extra,
  };
  processingCache.set(id, job);

  // Persist to Supabase (non-blocking)
  persistJob(job).catch(() => {});

  return job;
}

/**
 * Get a job by ID (checks memory first, then Supabase)
 * @param {string} id - Job ID
 * @returns {object|undefined}
 */
async function getJobAsync(id) {
  // Check in-memory cache first
  const cached = processingCache.get(id);
  if (cached) return cached;

  // Fall back to Supabase
  const db = getSupabase();
  if (!db) return undefined;

  try {
    const { data, error } = await db
      .from("api_jobs")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return undefined;

    // Reconstruct job object for compatibility
    return {
      id: data.id,
      type: data.type,
      status: data.status,
      progress: data.progress,
      video_id: data.video_id,
      video_title: data.video_title,
      result: data.result,
      createdAt: new Date(data.created_at).getTime(),
      lastUpdated: new Date(data.updated_at).getTime(),
    };
  } catch (err) {
    logger.warn("Supabase getJob error", { jobId: id, error: err.message });
    return undefined;
  }
}

/**
 * Get a job by ID (synchronous, memory-only — for hot-path usage)
 * @param {string} id - Job ID
 * @returns {object|undefined}
 */
function getJob(id) {
  return processingCache.get(id);
}

/**
 * Update job progress/status
 */
function updateProgress(processingId, progress, status, videoId, videoTitle) {
  if (processingCache.has(processingId)) {
    const job = processingCache.get(processingId);
    if (job) {
      job.progress = progress;
      job.status = status;
      job.lastUpdated = Date.now();
      if (videoId) job.video_id = videoId;
      if (videoTitle) job.video_title = videoTitle;

      // Persist to Supabase (non-blocking)
      persistJob(job).catch(() => {});

      // Schedule in-memory cache cleanup for terminal states
      if (
        status === "completed" ||
        status === "failed" ||
        status === "canceled"
      ) {
        setTimeout(() => processingCache.delete(processingId), 3600000); // 1 hour
      }
    }
  }
}

/**
 * Get queue stats
 */
function getQueueStats() {
  return {
    size: processingQueue ? processingQueue.size : 0,
    pending: processingQueue ? processingQueue.pending : 0,
    activeJobs: processingCache.size,
  };
}

/**
 * Cleanup stale jobs in Supabase (mark old non-terminal as failed)
 */
async function cleanupStaleJobs() {
  const db = getSupabase();
  if (!db) return;

  const { error, count } = await db
    .from("api_jobs")
    .update({ status: "failed", progress: 100, result: { success: false, error: "Server restarted while job was in progress" } })
    .not("status", "in", '("completed","failed","canceled")')
    .lt("created_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
    .select("id", { count: "exact" });

  if (!error && count > 0) {
    logger.info(`Cleaned up ${count} stale jobs in Supabase`);
  }
}

/**
 * Run the 24-hour cleanup (called from periodic interval)
 */
async function runJobCleanup() {
  const db = getSupabase();
  if (!db) return;

  try {
    const { data, error } = await db.rpc("cleanup_old_api_jobs");
    if (!error && data > 0) {
      logger.info(`Job cleanup: deleted ${data} old jobs from Supabase`);
    }
  } catch (err) {
    logger.warn("Job cleanup failed", { error: err.message });
  }
}

module.exports = {
  initQueue,
  getQueue,
  createJob,
  getJob,
  getJobAsync,
  updateProgress,
  getQueueStats,
  runJobCleanup,
  // Expose cache for shutdown handler
  _processingCache: processingCache,
};
