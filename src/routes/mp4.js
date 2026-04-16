const express = require("express");
const { spawn } = require("child_process");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const logger = require("../utils/logger");
const config = require("../config");
const { getVideoInfo, getYtDlpWrap, areCookiesValid, sanitizeHeaderValue } = require("../services/ytdlp");
const { createJob, getQueue, updateProgress } = require("../services/jobManager");

router.get("/mp4", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url parameter");
  const videoUrl = Array.isArray(url) ? url[0] : url;

  const processingId = uuidv4();
  const job = createJob(processingId, "mp4", { status: "initializing" });

  const processingQueue = getQueue();

  // Queue the download to prevent unbounded concurrent yt-dlp processes
  processingQueue.add(async () => {
    try {
      updateProgress(processingId, 10, "processing");
      const info = await getVideoInfo(videoUrl);
      updateProgress(processingId, 20, "validating", info.id, info.title);

      const fileName = `${info.title.replace(/[^\w\s.-]/gi, "")}.mp4`;
      res.setHeader(
        "Access-Control-Expose-Headers",
        "X-Processing-Id, X-Video-Id, X-Video-Title, Content-Disposition, Content-Type",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("X-Processing-Id", processingId);
      res.setHeader("X-Video-Id", info.id);
      res.setHeader("X-Video-Title", sanitizeHeaderValue(info.title));
      res.flushHeaders();

      job.video_id = info.id;
      job.video_title = info.title;
      job.lastUpdated = Date.now();

      updateProgress(processingId, 30, "downloading", info.id, info.title);

      const args = [
        "--format",
        "mp4",
        "--no-check-certificates",
        "--no-warnings",
        "--user-agent",
        config.USER_AGENT,
        "-o",
        "-",
        videoUrl,
      ];

      const hasValidCookies = await areCookiesValid();
      if (hasValidCookies) {
        args.push("--cookies", config.COOKIES_PATH);
      }

      const ytDlpWrap = getYtDlpWrap();

      return new Promise((resolve, reject) => {
        const child = spawn(ytDlpWrap.binaryPath, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });

        job.child = child;

        child.stdout.pipe(res);
        child.stderr.on("data", (data) =>
          logger.ytdlp("stderr output", { data: data.toString() }),
        );

        child.on("error", (err) => {
          logger.error("MP4 streaming error", { processingId, error: err.message });
          updateProgress(processingId, 100, "failed");
          if (!res.headersSent) res.status(500).send("Error streaming video");
          reject(err);
        });

        child.on("close", (code) => {
          if (code === 0) {
            updateProgress(processingId, 100, "completed");
          } else if (code === null) {
            updateProgress(processingId, 100, "canceled");
          } else {
            updateProgress(processingId, 100, "failed");
          }
          resolve();
        });
      });
    } catch (error) {
      logger.error("MP4 download error", { processingId, error: error.message });
      if (!res.headersSent) res.status(400).send("Error downloading video");
    }
  });
});

module.exports = router;
