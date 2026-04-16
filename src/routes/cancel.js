const express = require("express");
const { promises: fs } = require("fs");
const path = require("path");
const { promisify } = require("util");
const router = express.Router();
const logger = require("../utils/logger");
const config = require("../config");
const { getJob, updateProgress, getQueue } = require("../services/jobManager");

router.post("/cancel/:id", async (req, res) => {
  const glob = require("glob");
  const asyncGlob = promisify(glob);
  const job = getJob(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Processing ID not found" });
  }

  const queue = getQueue();
  const position = queue.size + 1;

  if (job.status === "initializing") {
    updateProgress(req.params.id, 0, "canceled");
    return res.status(200).json({
      message: "Cancelled during initialization",
      video_id: job.video_id,
      queue_position: position,
    });
  } else if (job.child) {
    job.child.kill("SIGKILL");
    const tempPattern = path.join(config.TEMP_DIR, `*${job.video_id}*`);
    const files = await asyncGlob(tempPattern);
    await Promise.all(files.map((f) => fs.unlink(f).catch(() => {})));
    updateProgress(req.params.id, 100, "canceled");
    res.status(200).json({
      message: "Process canceled successfully",
      video_id: job.video_id,
      video_title: job.video_title,
      queue_position: position > 1 ? `Was #${position} in queue` : null,
      cleaned_files: files.length,
    });
  } else if (job.abortController) {
    job.abortController.abort();
    updateProgress(req.params.id, 100, "canceled");
    res.status(200).json({
      message: "Transcript process canceled successfully",
      video_id: job.video_id,
      video_title: job.video_title,
      queue_position: position > 1 ? `Was #${position} in queue` : null,
    });
  } else {
    res
      .status(400)
      .json({ error: "Process cannot be canceled or is already complete." });
  }
});

module.exports = router;
