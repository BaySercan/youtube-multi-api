const { promises: fs } = require("fs");
const path = require("path");
const YTDlpWrap = require("yt-dlp-wrap").default;
const axios = require("axios");
const logger = require("../utils/logger");
const config = require("../config");

let ytDlpWrap;

// Cookies validation cache
let cachedCookiesValid = null;
let cookiesLastChecked = 0;

/**
 * Ensure yt-dlp binary is available (download if needed)
 */
async function ensureYtDlpBinary() {
  try {
    const binDir = path.join(__dirname, "..", "..", "bin");
    const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    const localBinaryPath = path.join(binDir, binaryName);

    try {
      // Try local binary first (we have update permissions here)
      await fs.access(localBinaryPath);
      ytDlpWrap = new YTDlpWrap(localBinaryPath);
    } catch {
      // Fallback to system binary if local doesn't exist yet
      ytDlpWrap = new YTDlpWrap();
    }

    const currentVersion = await ytDlpWrap.getVersion();
    logger.ytdlp(`yt-dlp binary found (version ${currentVersion})`);

    // Auto-update step
    try {
      logger.ytdlp("Checking for yt-dlp updates (-U)...");
      const updateResult = await ytDlpWrap.execPromise(["-U"]);
      if (updateResult.includes("up to date") || updateResult.includes("is up-to-date")) {
        logger.ytdlp("yt-dlp is already up to date.");
      } else {
        logger.ytdlp("yt-dlp updated successfully", { 
          output: updateResult.split("\n")[0] // Just log the first line of output 
        });
      }
    } catch (updateError) {
      if (updateError.message.includes("You do not have permission") || updateError.message.includes("Read-only file system")) {
        logger.warn("Skipping auto-update: No write permissions to update system yt-dlp binary.");
      } else {
        logger.warn("Auto-update check failed (network/permissions). Using existing binary.", {
          error: updateError.message.split("\n")[0]
        });
      }
    }
  } catch (error) {
    logger.ytdlp("yt-dlp binary not found or invalid, downloading the latest release from GitHub...");
    const binDir = path.join(__dirname, "..", "..", "bin");
    await fs.mkdir(binDir, { recursive: true });
    const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    const binaryPath = path.join(binDir, binaryName);
    
    await YTDlpWrap.downloadFromGithub(binaryPath);
    ytDlpWrap = new YTDlpWrap(binaryPath);
    const newVersion = await ytDlpWrap.getVersion();
    logger.ytdlp("Fresh binary downloaded and ready", { path: binaryPath, version: newVersion });
  }
}

/**
 * Get the yt-dlp wrapper instance
 */
function getYtDlpWrap() {
  if (!ytDlpWrap) {
    throw new Error("yt-dlp not initialized. Call ensureYtDlpBinary() first.");
  }
  return ytDlpWrap;
}

/**
 * Validate cookies file (raw, uncached — used by /validate-cookies endpoint)
 */
async function validateCookiesFile() {
  if (!config.USE_COOKIES) {
    logger.debug("Cookies disabled via USE_COOKIES=false");
    return false;
  }

  try {
    await fs.access(config.COOKIES_PATH);
    const stats = await fs.stat(config.COOKIES_PATH);
    const content = await fs.readFile(config.COOKIES_PATH, "utf8");

    if (!content.includes("# Netscape HTTP Cookie File")) {
      logger.warn("Cookies file format issue", { reason: "Not in Netscape format" });
    }
    if (stats.size < 100) {
      logger.warn("Cookies file too small", { size: stats.size });
    }

    const hasYoutubeCookies =
      content.includes("youtube.com") || content.includes(".youtube.com");
    if (!hasYoutubeCookies) {
      logger.warn("Cookies file missing YouTube domain");
    }

    const hasAuthCookies =
      content.includes("LOGIN_INFO") ||
      content.includes("SID") ||
      content.includes("HSID") ||
      content.includes("SSID");
    if (!hasAuthCookies) {
      logger.warn("Cookies file missing auth cookies");
    }

    return hasYoutubeCookies && hasAuthCookies;
  } catch (error) {
    logger.error("Cookies file inaccessible", { error: error.message });
    return false;
  }
}

/**
 * Cached cookies validation (5-minute TTL)
 */
async function areCookiesValid() {
  if (
    cachedCookiesValid !== null &&
    Date.now() - cookiesLastChecked < config.COOKIES_CACHE_TTL
  ) {
    return cachedCookiesValid;
  }
  cachedCookiesValid = await validateCookiesFile();
  cookiesLastChecked = Date.now();
  return cachedCookiesValid;
}

/**
 * Build common yt-dlp args with cookies if available
 */
async function appendCookieArgs(args) {
  const hasValidCookies = await areCookiesValid();
  if (hasValidCookies) {
    args.push("--cookies", config.COOKIES_PATH);
    logger.ytdlp("Using cookies for authentication");
  }
  return hasValidCookies;
}

/**
 * Sanitize ugly yt-dlp shell execution errors into readable messages
 */
function sanitizeYtDlpError(error) {
  if (!error.message) return error;
  
  if (error.name === "AbortError") return error;

  // Extract the specific ERROR or WARNING from yt-dlp text
  const match = error.message.match(/ERROR:\s*\[youtube\][^:]*:(.*?)(?:\n|$)/i) || 
                error.message.match(/ERROR:\s*(.*?)(?:\n|$)/i);
  
  if (match && match[1]) {
    const cleanMsg = match[1].trim()
      .replace(/Sign in if you've been granted access.*/i, "") // Clean up boilerplate
      .replace(/Use --cookies.*/i, "")
      .trim();
    
    // Create new error without the huge shell stack trace
    const cleanError = new Error(`VIDEO_UNAVAILABLE: ${cleanMsg}`);
    cleanError.name = "YtDlpError";
    return cleanError;
  }
  
  return error;
}

/**
 * Detect errors that are permanent/deterministic and should NOT be retried.
 * Private videos, removed videos, upcoming live events — these will never
 * succeed no matter how many times we call yt-dlp.
 */
function isPermanentYtDlpError(error) {
  const msg = (error.message || "").toLowerCase();
  return (
    msg.includes("private video") ||
    msg.includes("video unavailable") ||
    msg.includes("live event will begin") ||
    msg.includes("has been removed by the uploader") ||
    msg.includes("this video is not available") ||
    msg.includes("members-only") ||
    msg.includes("confirm your age") ||
    msg.includes("account associated with this video has been terminated") ||
    msg.includes("this channel does not exist")
  );
}

/**
 * Get video info using yt-dlp (uncached — internal)
 */
async function _getVideoInfoUncached(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (options.signal && options.signal.aborted) {
        throw new Error("The operation was aborted.");
      }
      logger.video(`Fetching video info for: ${url}`);
      const args = [
        "--dump-json",
        "--no-warnings",
        "--no-check-certificates",
        "--user-agent",
        config.USER_AGENT,
        url,
      ];

      await appendCookieArgs(args);

      const stdout = await ytDlpWrap.execPromise(args, {
        signal: options.signal,
      });
      const info = JSON.parse(stdout);
      logger.video("Video info fetched", {
        videoId: info.id,
        title: info.title,
      });
      return info;
    } catch (error) {
      if (error.name === "AbortError") {
        logger.debug("Video info fetch aborted");
        throw error;
      }

      // Permanent errors: no point retrying — throw immediately
      if (isPermanentYtDlpError(error)) {
        logger.error("Video info fetch failed (permanent error, skipping retries)", {
          attempt: i + 1,
          error: error.message,
        });
        throw sanitizeYtDlpError(error);
      }

      logger.error("Video info fetch failed", {
        attempt: i + 1,
        maxRetries: retries,
        error: error.message,
      });
      if (i === retries - 1) {
        throw sanitizeYtDlpError(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// Video info cache (10-minute TTL, max 100 entries)
const VIDEO_INFO_CACHE_TTL = 10 * 60 * 1000;
const VIDEO_INFO_CACHE_MAX = 100;
const videoInfoCache = new Map();

/**
 * Normalize YouTube URL to a consistent cache key
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    // Extract video ID from various YouTube URL formats
    let videoId = parsed.searchParams.get("v");
    if (!videoId && parsed.hostname.includes("youtu.be")) {
      videoId = parsed.pathname.slice(1);
    }
    return videoId || url;
  } catch {
    return url;
  }
}

/**
 * Get video info with caching (10-minute TTL)
 */
async function getVideoInfo(url, options = {}, retries = 3) {
  const cacheKey = normalizeUrl(Array.isArray(url) ? url[0] : url);
  const cached = videoInfoCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < VIDEO_INFO_CACHE_TTL) {
    logger.video("Video info served from cache", { videoId: cached.data.id });
    return cached.data;
  }

  const info = await _getVideoInfoUncached(url, options, retries);

  // Evict oldest if cache is full
  if (videoInfoCache.size >= VIDEO_INFO_CACHE_MAX) {
    const oldestKey = videoInfoCache.keys().next().value;
    videoInfoCache.delete(oldestKey);
  }

  videoInfoCache.set(cacheKey, { data: info, timestamp: Date.now() });
  return info;
}

/**
 * Fetch auto-subs using yt-dlp --write-auto-subs
 */
async function fetchAutoSubsWithYtDlp(url, lang, signal) {
  const uniqueId = `subs_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}`;
  const subtitlePath = path.join(config.TEMP_DIR, uniqueId);

  const args = [
    "--skip-download",
    "--write-auto-subs",
    "--sub-lang",
    lang,
    "--sub-format",
    "ttml/srv1/vtt/best",
    "--convert-subs",
    "vtt",
    "--no-warnings",
    "--no-check-certificates",
    "--user-agent",
    config.USER_AGENT,
    "-o",
    subtitlePath,
    url,
  ];

  await appendCookieArgs(args);

  try {
    logger.info("Attempting to fetch auto-subs with yt-dlp", { url, lang });
    await ytDlpWrap.execPromise(args, { signal });

    const files = await fs.readdir(config.TEMP_DIR);
    const subtitleFile = files.find(
      (f) =>
        f.startsWith(uniqueId) &&
        (f.endsWith(".vtt") ||
          f.endsWith(".ttml") ||
          f.endsWith(".srv1") ||
          f.endsWith(".srt")),
    );

    if (subtitleFile) {
      const subtitleContent = await fs.readFile(
        path.join(config.TEMP_DIR, subtitleFile),
        "utf8",
      );
      await fs.unlink(path.join(config.TEMP_DIR, subtitleFile)).catch(() => {});
      logger.info("Successfully fetched auto-subs with yt-dlp fallback", {
        file: subtitleFile,
      });
      return subtitleContent;
    }

    logger.warn("yt-dlp ran but no subtitle file was generated", {
      uniqueId,
      lang,
    });
    return null;
  } catch (error) {
    logger.warn("yt-dlp auto-subs fallback failed", { error: error.message });
    return null;
  }
}

/**
 * Sanitize HTTP header values by removing non-ASCII characters
 */
function sanitizeHeaderValue(value) {
  return value.replace(/[^\x20-\x7E]/g, "");
}

module.exports = {
  ensureYtDlpBinary,
  getYtDlpWrap,
  getVideoInfo,
  fetchAutoSubsWithYtDlp,
  validateCookiesFile,
  areCookiesValid,
  appendCookieArgs,
  sanitizeHeaderValue,
};
