const express = require("express");
const router = express.Router();
const logger = require("../utils/logger");
const { getJob, getJobAsync } = require("../services/jobManager");

// Get processing progress
router.get("/progress/:id", async (req, res) => {
  // Try memory first (fast), then Supabase (for crash-recovered jobs)
  const job = getJob(req.params.id) || (await getJobAsync(req.params.id));
  if (!job) {
    return res.status(404).json({ error: "Processing ID not found" });
  }

  const response = {
    id: job.id,
    status: job.status,
    progress: job.progress,
    createdAt: job.createdAt,
    lastUpdated: job.lastUpdated,
  };

  if (job.video_id) response.video_id = job.video_id;
  if (job.video_title) response.video_title = job.video_title;

  res.json(response);
});

// Get processing result
router.get("/result/:id", async (req, res) => {
  const job = getJob(req.params.id) || (await getJobAsync(req.params.id));
  if (!job) {
    return res.status(404).json({ error: "Processing ID not found" });
  }

  const terminalStatuses = ["completed", "failed", "canceled"];
  if (
    job.progress !== 100 ||
    !terminalStatuses.includes(job.status.toLowerCase())
  ) {
    return res.status(202).json({
      message: "Processing not complete",
      status: job.status,
      progress: job.progress,
    });
  }

  logger.debug("Returning result", {
    processingId: job.id,
    status: job.status,
  });
  res.status(200).json(job.result);
});

module.exports = router;
