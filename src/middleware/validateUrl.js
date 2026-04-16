const logger = require("../utils/logger");

// YouTube URL patterns
const YOUTUBE_URL_PATTERNS = [
  /^https?:\/\/(www\.)?youtube\.com\/watch\?/,
  /^https?:\/\/(www\.)?youtube\.com\/shorts\//,
  /^https?:\/\/youtu\.be\//,
  /^https?:\/\/(www\.)?youtube\.com\/live\//,
  /^https?:\/\/m\.youtube\.com\/watch\?/,
];

/**
 * Middleware to validate that the url query parameter is a valid YouTube URL
 * Apply to routes that pass URLs to yt-dlp
 */
function validateUrl(req, res, next) {
  const { url } = req.query;

  if (!url) {
    // Let individual route handlers deal with missing url
    return next();
  }

  const videoUrl = Array.isArray(url) ? url[0] : url;

  if (typeof videoUrl !== "string") {
    return res.status(400).json({ error: "url parameter must be a string" });
  }

  const isValidYouTubeUrl = YOUTUBE_URL_PATTERNS.some((pattern) =>
    pattern.test(videoUrl),
  );

  if (!isValidYouTubeUrl) {
    logger.warn("Rejected non-YouTube URL", {
      url: videoUrl.substring(0, 200),
      ip: req.ip,
      path: req.path,
    });
    return res.status(400).json({
      error: "Invalid URL. Only YouTube URLs are accepted.",
      hint: "Supported formats: youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., youtube.com/live/...",
    });
  }

  next();
}

module.exports = validateUrl;
