const { promises: fs } = require("fs");
const config = require("./config");
const logger = require("./utils/logger");
const { cleanupTempDirectory, cleanupStaleTempFiles } = require("./utils/cleanup");
const { ensureYtDlpBinary } = require("./services/ytdlp");
const { initQueue, runJobCleanup, _processingCache } = require("./services/jobManager");
const app = require("./app");

async function startServer() {
  // Ensure temp directory exists
  await fs.mkdir(config.TEMP_DIR, { recursive: true }).catch((err) =>
    logger.error("Failed to create temp directory", { error: err.message }),
  );

  // Download yt-dlp binary if needed
  await ensureYtDlpBinary();

  // Initialize processing queue
  await initQueue();

  // Startup cleanup — clear leftover temp files from previous runs
  await cleanupTempDirectory("startup").catch(() => {});

  // Periodic cleanup — every 15 minutes, clean files older than 30 minutes
  const cleanupInterval = setInterval(() => {
    cleanupStaleTempFiles(config.MAX_TEMP_FILE_AGE_MS).catch(() => {});
  }, config.CLEANUP_INTERVAL_MS);

  // Periodic Supabase job cleanup — every 6 hours, delete old terminal jobs
  const jobCleanupInterval = setInterval(() => {
    runJobCleanup().catch(() => {});
  }, 6 * 60 * 60 * 1000);

  // Graceful shutdown
  let isShuttingDown = false;

  async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`⚠️ Received ${signal}, starting graceful shutdown...`);

    clearInterval(cleanupInterval);
    clearInterval(jobCleanupInterval);

    // Kill in-flight child processes
    let killedProcesses = 0;
    for (const [id, job] of _processingCache.entries()) {
      if (job.child && !job.child.killed) {
        job.child.kill("SIGKILL");
        killedProcesses++;
        logger.info(`⚠️ Killed in-flight process for job ${id}`);
      }
      if (job.abortController) {
        job.abortController.abort();
      }
    }

    await cleanupTempDirectory("shutdown");

    logger.info(`✅ Graceful shutdown complete`, {
      killedProcesses,
      signal,
    });

    process.exit(0);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  process.on("uncaughtException", async (err) => {
    logger.error("💥 Uncaught Exception", {
      error: err.message,
      stack: err.stack,
    });
    await cleanupTempDirectory("uncaughtException").catch(() => {});
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("💥 Unhandled Rejection", { reason: String(reason) });
  });

  // Start listening
  const PORT = config.PORT;
  app.listen(PORT, "0.0.0.0", () => {
    logger.server("Server started", {
      port: PORT,
      env: config.NODE_ENV,
    });
  });
}

startServer().catch((err) => {
  logger.error("Failed to initialize server", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});
