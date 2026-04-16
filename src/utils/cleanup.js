const { promises: fs } = require("fs");
const path = require("path");
const logger = require("./logger");
const config = require("../config");

const tempDir = config.TEMP_DIR;

/**
 * Clean all files in the temp directory
 * @param {string} reason - Reason for cleanup (for logging)
 * @returns {Promise<number>} - Number of files deleted
 */
async function cleanupTempDirectory(reason = "manual") {
  try {
    const files = await fs.readdir(tempDir);
    if (files.length === 0) {
      logger.info(`🧹 Temp cleanup (${reason}): No files to clean`);
      return 0;
    }

    let deletedCount = 0;
    await Promise.all(
      files.map(async (file) => {
        try {
          await fs.unlink(path.join(tempDir, file));
          deletedCount++;
        } catch (err) {
          logger.warn(`🧹 Could not delete temp file: ${file}`, {
            error: err.message,
          });
        }
      }),
    );

    logger.info(
      `🧹 Temp cleanup (${reason}): Deleted ${deletedCount}/${files.length} files`,
    );
    return deletedCount;
  } catch (err) {
    logger.error(`🧹 Temp cleanup (${reason}) failed`, { error: err.message });
    return 0;
  }
}

/**
 * Clean temp files older than specified age
 * @param {number} maxAgeMs - Maximum age in milliseconds
 * @returns {Promise<number>} - Number of files deleted
 */
async function cleanupStaleTempFiles(maxAgeMs = config.MAX_TEMP_FILE_AGE_MS) {
  try {
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    let deletedCount = 0;

    await Promise.all(
      files.map(async (file) => {
        try {
          const filePath = path.join(tempDir, file);
          const stats = await fs.stat(filePath);
          const fileAge = now - stats.mtimeMs;

          if (fileAge > maxAgeMs) {
            await fs.unlink(filePath);
            deletedCount++;
            logger.debug(`🧹 Deleted stale temp file: ${file}`, {
              ageMinutes: Math.round(fileAge / 60000),
            });
          }
        } catch (err) {
          // File might be in use or already deleted
        }
      }),
    );

    if (deletedCount > 0) {
      logger.info(
        `🧹 Periodic cleanup: Deleted ${deletedCount} stale files (older than ${Math.round(
          maxAgeMs / 60000,
        )} min)`,
      );
    }
    return deletedCount;
  } catch (err) {
    logger.error("🧹 Periodic cleanup failed", { error: err.message });
    return 0;
  }
}

module.exports = {
  cleanupTempDirectory,
  cleanupStaleTempFiles,
};
