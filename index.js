require("dotenv").config();
const { spawn } = require("child_process");
const express = require("express");
const cors = require("cors");
const { promises: fs, createReadStream } = require("fs");
const path = require("path");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const authRouter = require("./middleware/authRouter");
const requestIdMiddleware = require("./middleware/requestId");
const { createClient } = require("@supabase/supabase-js");
const logger = require("./utils/logger");
const OpenAI = require("openai");
const {
  fetchTranscript: fetchYTTranscript,
} = require("youtube-transcript-plus");

const YTDlpWrap = require("yt-dlp-wrap").default;
const { v4: uuidv4 } = require("uuid");

// Initialize OpenAI client for Whisper API
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Sanitize HTTP header values by removing non-ASCII characters
function sanitizeHeaderValue(value) {
  return value.replace(/[^\x20-\x7E]/g, "");
}
// Initialize yt-dlp-wrap
let ytDlpWrap;

// Function to ensure yt-dlp binary is available
async function ensureYtDlpBinary() {
  try {
    // First try to initialize without path
    ytDlpWrap = new YTDlpWrap();
    // Test if binary exists
    await ytDlpWrap.getVersion();
    logger.ytdlp("Using system yt-dlp binary");
  } catch (error) {
    logger.ytdlp("Binary not found, downloading...");
    // Download binary to bin directory
    const binDir = path.join(__dirname, "bin");
    await fs.mkdir(binDir, { recursive: true });
    // Add .exe extension for Windows
    const binaryName = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
    const binaryPath = path.join(binDir, binaryName);
    await YTDlpWrap.downloadFromGithub(binaryPath);
    ytDlpWrap = new YTDlpWrap(binaryPath);
    logger.ytdlp("Downloaded binary", { path: binaryPath });
  }
}

// Wrap initialization in async function (PQueue)
async function initializeServer() {
  await ensureYtDlpBinary();

  // Dynamically import p-queue and initialize processingQueue
  const { default: PQueue } = await import("p-queue");
  processingQueue = new PQueue({
    concurrency: 4, // Max 4 concurrent requests
    intervalCap: 5, // Max 5 requests per interval
    interval: 1 * 1000, // Per 1 second
    // Add a timeout if downloads get stuck for too long
    timeout: 30 * 60 * 1000, // 30 minutes (adjust based on expected download times)
    throwOnTimeout: true, // Whether to throw an error if a task times out
  });
  logger.server("Processing queue initialized", {
    concurrency: 4,
    intervalCap: 5,
  });

  // Server listening logic
  const PORT = process.env.PORT || 3500;
  app.listen(PORT, "0.0.0.0", () => {
    logger.server("Server started", {
      port: PORT,
      env: process.env.NODE_ENV || "development",
    });
  });
}

initializeServer().catch((err) => {
  logger.error("Failed to initialize server", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// Helper function to validate cookies file
async function validateCookiesFile() {
  try {
    await fs.access("cookies.txt");
    const stats = await fs.stat("cookies.txt");
    const content = await fs.readFile("cookies.txt", "utf8");
    if (!content.includes("# Netscape HTTP Cookie File")) {
      logger.warn("Cookies file format issue", {
        reason: "Not in Netscape format",
      });
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

const app = express();
app.use(cors());

// Add request ID middleware first
app.use(requestIdMiddleware);

// Add request logging middleware
app.use((req, res, next) => {
  logger.http("Incoming request", {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
  next();
});

// Initialize Supabase client
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
);

// Apply authentication router to all routes
// This will handle both RapidAPI and JWT authentication
app.use(authRouter);

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, "temp");
fs.mkdir(tempDir, { recursive: true }).catch((err) =>
  logger.error("Failed to create temp directory", { error: err.message })
);

// Initialize processing queue and cache (will be initialized in initializeServer)
let processingQueue;
const processingCache = new Map();

// Function to update processing status
function updateProgress(processingId, progress, status, videoId, videoTitle) {
  if (processingCache.has(processingId)) {
    const job = processingCache.get(processingId);
    if (job) {
      // Check if job exists before updating
      job.progress = progress;
      job.status = status;
      job.lastUpdated = Date.now();
      if (videoId) job.video_id = videoId;
      if (videoTitle) job.video_title = videoTitle;

      // Add cache cleanup for completed/failed/canceled jobs
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

// Function to call OpenRouter API
async function callAIModel(messages, useDeepSeek = true, signal) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "OPENROUTER_API_KEY environment variable is not set or empty"
    );
  }
  const model = useDeepSeek ? process.env.AI_MODEL_1 : process.env.AI_MODEL_2;
  const maxRetries = 3;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      if (signal && signal.aborted) {
        throw new Error("The operation was aborted.");
      }
      logger.ai("Calling model", { model, attempt: attempt + 1 });
      const response = await axios.post(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          model: model,
          messages: messages,
          max_tokens: 16384, // Request maximum output tokens to prevent truncation
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "HTTP-Referer":
              "https://github.com/yourusername/youtube-download-api",
            "Content-Type": "application/json",
          },
          signal,
        }
      );
      if (response.data && response.data.choices && response.data.choices[0]) {
        const choice = response.data.choices[0];
        const outputLength = choice.message?.content?.length || 0;
        const finishReason = choice.finish_reason;

        logger.ai("AI response received", {
          model,
          outputLength,
          finishReason,
          truncated: finishReason === "length",
        });

        // Warn if response was truncated due to length
        if (finishReason === "length") {
          logger.warn("AI response was truncated due to token limit", {
            model,
            outputLength,
          });
        }

        return response.data;
      } else {
        throw new Error("Invalid API response format");
      }
    } catch (error) {
      if (error.name === "AbortError") {
        logger.ai("Model call aborted");
        throw error;
      }
      logger.error("AI API error", {
        attempt: attempt + 1,
        error: error.message,
        responseData: error.response?.data,
      });
      attempt++;
      if (attempt === maxRetries - 1 && useDeepSeek) {
        logger.ai("Switching to backup model", {
          from: process.env.AI_MODEL_1,
          to: process.env.AI_MODEL_2,
        });
        return callAIModel(messages, false, signal);
      }
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw new Error("Failed to get response after maximum retries");
}

// Helper function to get video info using yt-dlp-wrap
async function getVideoInfo(url, options = {}, retries = 3) {
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
        USER_AGENT,
        url,
      ];

      const hasValidCookies = await validateCookiesFile();
      if (hasValidCookies) {
        args.push("--cookies", path.resolve(__dirname, "cookies.txt"));
        logger.ytdlp("Using cookies for authentication");
      }

      // The library finds the binary automatically.
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
      logger.error("Video info fetch failed", {
        attempt: i + 1,
        maxRetries: retries,
        error: error.message,
      });
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// Helper function to find available language tracks with fallback support
function findLanguageTracks(info, lang) {
  const captions = info.automatic_captions || {};
  const subtitles = info.subtitles || {};

  // Try exact match first
  let tracks = captions[lang] || subtitles[lang] || [];
  if (tracks.length > 0) return { tracks, usedLang: lang };

  // Extract base language (e.g., "en" from "en-US")
  const baseLang = lang.split("-")[0];

  // Try base language if different from original
  if (baseLang !== lang) {
    tracks = captions[baseLang] || subtitles[baseLang] || [];
    if (tracks.length > 0) return { tracks, usedLang: baseLang };
  }

  // Try language variants (e.g., "en-orig", "en-GB" when "en" or "en-US" requested)
  const availableLangs = [
    ...new Set([...Object.keys(captions), ...Object.keys(subtitles)]),
  ];
  const variants = availableLangs.filter(
    (l) => l.startsWith(baseLang + "-") || l === baseLang + "-orig"
  );

  for (const variant of variants) {
    tracks = captions[variant] || subtitles[variant] || [];
    if (tracks.length > 0) return { tracks, usedLang: variant };
  }

  return { tracks: [], usedLang: null };
}

// Helper function to fetch auto-subs using yt-dlp directly
async function fetchAutoSubsWithYtDlp(url, lang, signal) {
  const uniqueId = `subs_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}`;
  const subtitlePath = path.join(tempDir, uniqueId);

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
    USER_AGENT,
    "-o",
    subtitlePath,
    url,
  ];

  const hasValidCookies = await validateCookiesFile();
  if (hasValidCookies) {
    args.push("--cookies", path.resolve(__dirname, "cookies.txt"));
  }

  try {
    logger.info("Attempting to fetch auto-subs with yt-dlp", { url, lang });
    await ytDlpWrap.execPromise(args, { signal });

    // yt-dlp generates files like: {output}.{lang}.vtt
    // Find any file that starts with our unique ID and ends with subtitle extension
    const files = await fs.readdir(tempDir);
    const subtitleFile = files.find(
      (f) =>
        f.startsWith(uniqueId) &&
        (f.endsWith(".vtt") ||
          f.endsWith(".ttml") ||
          f.endsWith(".srv1") ||
          f.endsWith(".srt"))
    );

    if (subtitleFile) {
      const subtitleContent = await fs.readFile(
        path.join(tempDir, subtitleFile),
        "utf8"
      );
      // Clean up the temp file
      await fs.unlink(path.join(tempDir, subtitleFile)).catch(() => {});
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

// Helper function to extract audio for Whisper transcription
async function extractAudioForWhisper(url, signal) {
  const uniqueId = `whisper_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}`;
  const audioPath = path.join(tempDir, `${uniqueId}.mp3`);

  // Use high compression to keep file under 25MB limit
  // For a 33-min video: 64kbps mono = ~16MB, well under limit
  const args = [
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--postprocessor-args",
    "ffmpeg:-ac 1 -ar 16000 -b:a 64k", // Mono, 16kHz, 64kbps - optimized for speech
    "--no-warnings",
    "--no-check-certificates",
    "--user-agent",
    USER_AGENT,
    "-o",
    audioPath,
    url,
  ];

  const hasValidCookies = await validateCookiesFile();
  if (hasValidCookies) {
    args.push("--cookies", path.resolve(__dirname, "cookies.txt"));
  }

  try {
    logger.info("Extracting audio for Whisper transcription", { url });
    await ytDlpWrap.execPromise(args, { signal });

    // Verify file exists
    await fs.access(audioPath);
    const stats = await fs.stat(audioPath);

    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    logger.info("Audio extracted successfully", {
      path: audioPath,
      size: stats.size,
      sizeMB: fileSizeMB,
    });

    // Whisper API has a 25MB file size limit
    if (stats.size > 25 * 1024 * 1024) {
      logger.error("Audio file still too large after compression", {
        sizeMB: fileSizeMB,
        limit: "25MB",
      });
      await fs.unlink(audioPath).catch(() => {});
      return null;
    }

    return audioPath;
  } catch (error) {
    logger.error("Failed to extract audio for Whisper", {
      error: error.message,
    });
    return null;
  }
}

// Helper function to transcribe audio using OpenAI Whisper API
async function transcribeWithWhisper(audioPath, lang = "tr") {
  if (!openai) {
    logger.warn("OpenAI client not initialized - OPENAI_API_KEY not set");
    return null;
  }

  try {
    logger.info("Transcribing with Whisper API", { audioPath, lang });

    const transcription = await openai.audio.transcriptions.create({
      file: createReadStream(audioPath),
      model: "whisper-1",
      language: lang.split("-")[0], // Whisper uses 2-letter codes
      response_format: "text",
    });

    // Clean up audio file after transcription
    await fs.unlink(audioPath).catch(() => {});

    logger.info("Whisper transcription completed", {
      transcriptLength: transcription.length,
    });

    return transcription;
  } catch (error) {
    logger.error("Whisper transcription failed", { error: error.message });
    // Clean up audio file on error
    await fs.unlink(audioPath).catch(() => {});
    return null;
  }
}

// Helper function to get video transcript
async function getVideoTranscript(url, lang = "tr", signal) {
  const info = await getVideoInfo(url, { signal });

  const { tracks, usedLang } = findLanguageTracks(info, lang);

  // If we found tracks from video info, use them
  if (tracks.length > 0) {
    if (usedLang !== lang) {
      logger.info("Language fallback used", {
        requested: lang,
        used: usedLang,
      });
    }

    const track =
      tracks.find(
        (t) => t.ext === "ttml" || t.ext === "xml" || t.ext === "srv1"
      ) || tracks[0];
    const transcriptResponse = await axios.get(track.url, { signal });
    return transcriptResponse.data;
  }

  // No tracks found in video info, try youtube-transcript-plus (fast, uses YouTube's internal API)
  try {
    logger.info("No captions in video info, trying youtube-transcript-plus", {
      videoId: info.id,
      requestedLang: lang,
    });

    const baseLang = lang.split("-")[0];
    const ytTranscript = await fetchYTTranscript(info.id, { lang: baseLang });

    if (ytTranscript && ytTranscript.length > 0) {
      // Convert to text format
      const transcriptText = ytTranscript
        .map((segment) => segment.text)
        .join(" ");
      logger.info(
        "Successfully fetched transcript via youtube-transcript-plus",
        {
          videoId: info.id,
          segments: ytTranscript.length,
        }
      );
      return transcriptText;
    }
  } catch (ytError) {
    // Log but continue to next fallback
    logger.warn("youtube-transcript-plus fallback failed", {
      videoId: info.id,
      error: ytError.message,
      errorType: ytError.constructor.name,
    });
  }

  // youtube-transcript-plus failed, try yt-dlp --write-auto-subs as second fallback
  logger.info("Trying yt-dlp auto-subs fallback", {
    videoId: info.id,
    requestedLang: lang,
  });

  const autoSubsContent = await fetchAutoSubsWithYtDlp(url, lang, signal);

  if (autoSubsContent) {
    return autoSubsContent;
  }

  // If still no captions, try with base language (e.g., "tr" from "tr-TR")
  const baseLang = lang.split("-")[0];
  if (baseLang !== lang) {
    const baseAutoSubsContent = await fetchAutoSubsWithYtDlp(
      url,
      baseLang,
      signal
    );
    if (baseAutoSubsContent) {
      return baseAutoSubsContent;
    }
  }

  // All YouTube caption methods failed - try Whisper STT as final fallback
  if (openai) {
    logger.info(
      "No YouTube captions available, attempting Whisper STT fallback",
      {
        videoId: info.id,
        requestedLang: lang,
      }
    );

    const audioPath = await extractAudioForWhisper(url, signal);
    if (audioPath) {
      const whisperTranscript = await transcribeWithWhisper(audioPath, lang);
      if (whisperTranscript) {
        logger.info("Successfully transcribed with Whisper fallback", {
          videoId: info.id,
          transcriptLength: whisperTranscript.length,
        });
        return whisperTranscript;
      }
    }
  } else {
    logger.warn("Whisper fallback unavailable - OPENAI_API_KEY not configured");
  }

  // All attempts failed - provide detailed error message
  const availableLangs = [
    ...new Set([
      ...Object.keys(info.automatic_captions || {}),
      ...Object.keys(info.subtitles || {}),
    ]),
  ];

  const hasAnyCaptions = availableLangs.length > 0;
  const whisperNote = openai
    ? "Whisper STT fallback was attempted but failed."
    : "Whisper STT fallback unavailable (OPENAI_API_KEY not configured).";

  let errorMessage;
  if (!hasAnyCaptions) {
    errorMessage =
      `NO_CAPTIONS_AVAILABLE: This video has no captions or subtitles available. ${whisperNote} ` +
      `Possible reasons: (1) The video creator has disabled auto-generated captions, ` +
      `(2) YouTube's speech recognition doesn't support the video's language well, ` +
      `(3) The audio quality is insufficient for auto-captioning, ` +
      `(4) The video was recently uploaded and captions haven't been generated yet. ` +
      `Video ID: ${info.id}, Title: "${info.title}"`;
  } else {
    errorMessage =
      `LANGUAGE_NOT_AVAILABLE: No subtitles available for language: "${lang}". ` +
      `Available languages: [${availableLangs.join(", ")}]. ` +
      `Try requesting one of the available languages instead. ` +
      `Video ID: ${info.id}`;
  }

  throw new Error(errorMessage);
}

// Routes

// Test endpoint to generate JWT token (only in development)
app.get("/test-token", (req, res) => {
  // Debugging: Show actual NODE_ENV value
  const nodeEnv = process.env.NODE_ENV || "undefined";

  if (nodeEnv !== "development") {
    return res
      .status(404)
      .send(
        `Test token endpoint only available in development mode. Current NODE_ENV: ${nodeEnv}`
      );
  }

  try {
    const jwt = require("jsonwebtoken");
    const fs = require("fs");
    const path = require("path");
    const privateKey = fs.readFileSync(
      path.join(__dirname, "keys/private.key"),
      "utf8"
    );

    const token = jwt.sign({ userId: "test-user" }, privateKey, {
      algorithm: "RS256",
      expiresIn: process.env.JWT_EXPIRES_IN || "1h",
    });

    res.json({ token });
  } catch (error) {
    logger.error("Test token generation failed", { error: error.message });
    res.status(500).send("Internal server error");
  }
});

app.get("/ping", (req, res) => {
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    version: "2.1.0",
  });
});
app.get("/validate-cookies", async (req, res) => {
  // This endpoint remains the same
  try {
    const cookiesPath = path.resolve(__dirname, "cookies.txt");
    const exists = await fs
      .access(cookiesPath)
      .then(() => true)
      .catch(() => false);
    if (!exists)
      return res
        .status(404)
        .json({ valid: false, message: "cookies.txt not found" });
    const content = await fs.readFile(cookiesPath, "utf8");
    const youtubeCookies = content.includes(".youtube.com");
    const authCookies =
      content.includes("LOGIN_INFO") && content.includes("SID");
    const isValid = youtubeCookies && authCookies;
    res.json({
      valid: isValid,
      message: isValid
        ? "Valid cookies found"
        : "Missing required YouTube cookies",
    });
  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

app.get("/info", async (req, res) => {
  const { url, type = "sum" } = req.query; // Default type to "sum"
  if (!url) return res.status(400).send("Missing url parameter");

  try {
    const info = await getVideoInfo(Array.isArray(url) ? url[0] : url);
    const lastRequested = new Date().toISOString();

    if (type === "full") {
      // Add last_requested to full info response
      const fullInfo = {
        ...info,
        last_requested: lastRequested,
        info_type: "full", // Indicate this is full info
      };
      res.send(fullInfo);
    } else {
      // Default to summary ("sum")
      const summaryInfo = {
        availability: info.availability,
        automatic_captions: info.automatic_captions,
        categories: info.categories,
        channel_name: info.channel, // Changed from channel
        channel_follower_count: info.channel_follower_count,
        channel_id: info.channel_id,
        channel_url: info.channel_url,
        comment_count: info.comment_count,
        description: info.description,
        display_id: info.display_id,
        duration: info.duration,
        duration_string: info.duration_string,
        filesize_approx: info.filesize_approx,
        fulltitle: info.fulltitle,
        language: info.language,
        license: info.license,
        like_count: info.like_count,
        original_url: info.original_url,
        playable_in_embed: info.playable_in_embed,
        tags: info.tags,
        thumbnail: info.thumbnail,
        timestamp: info.timestamp,
        title: info.title,
        post_date: new Date(
          `${info.upload_date.substring(0, 4)}-${info.upload_date.substring(
            4,
            6
          )}-${info.upload_date.substring(6, 8)}`
        ).toISOString(), // Kept original post_date format
        upload_date_raw: info.upload_date, // Raw upload_date
        uploader: info.uploader,
        uploader_id: info.uploader_id,
        uploader_url: info.uploader_url,
        view_count: info.view_count,
        video_id: info.id, // Changed from id
        was_live: info.was_live,
        last_requested: lastRequested,
        info_type: "sum", // Indicate this is summary info
      };
      res.send(summaryInfo);
    }
  } catch (error) {
    logger.error("Info endpoint error", { url, error: error.message });
    res.status(400).send("Invalid url or error fetching video info");
  }
});

app.get("/mp3", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url parameter");
  const videoUrl = Array.isArray(url) ? url[0] : url;

  // Create processing job immediately
  const processingId = uuidv4();
  const job = {
    id: processingId,
    status: "initializing",
    progress: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    video_id: null,
    video_title: null,
    result: null,
    type: "mp3",
  };
  processingCache.set(processingId, job);

  try {
    updateProgress(processingId, 10, "processing");
    const info = await getVideoInfo(videoUrl);
    updateProgress(processingId, 20, "validating", info.id, info.title);

    const fileName = `${info.title.replace(/[^\w\s.-]/gi, "")}.mp3`;
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Processing-Id, X-Video-Id, X-Video-Title, Content-Disposition, Content-Type"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("X-Processing-Id", processingId);
    res.setHeader("X-Video-Id", info.id);
    res.setHeader("X-Video-Title", sanitizeHeaderValue(info.title));
    res.flushHeaders();

    job.video_id = info.id;
    job.video_title = info.title;
    job.lastUpdated = Date.now();
    processingCache.set(processingId, job);

    const args = [
      "--extract-audio",
      "--audio-format",
      "mp3",
      "--no-check-certificates",
      "--no-warnings",
      "--user-agent",
      USER_AGENT,
      "-o",
      "-", // Output to stdout
      videoUrl,
    ];

    const hasValidCookies = await validateCookiesFile();
    if (hasValidCookies) {
      args.push("--cookies", path.resolve(__dirname, "cookies.txt"));
    }

    updateProgress(processingId, 30, "downloading", info.id, info.title);
    // Use Node.js spawn directly for better stream control
    const child = spawn(ytDlpWrap.binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Store the child process in the job cache
    job.child = child;

    child.stdout.pipe(res);
    child.stderr.on("data", (data) =>
      logger.ytdlp("stderr output", { data: data.toString() })
    );

    child.on("error", (err) => {
      logger.error("MP3 streaming error", { processingId, error: err.message });
      updateProgress(processingId, 100, "failed");
      if (!res.headersSent) res.status(500).send("Error streaming audio");
    });

    child.on("close", (code) => {
      if (code === 0) {
        updateProgress(processingId, 100, "completed");
      } else if (code === null) {
        // SIGKILL returns null
        updateProgress(processingId, 100, "canceled");
      } else {
        updateProgress(processingId, 100, "failed");
      }
    });
  } catch (error) {
    logger.error("MP3 download error", { processingId, error: error.message });
    if (!res.headersSent) res.status(400).send("Error downloading audio");
  }
});

app.get("/mp4", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("Missing url parameter");
  const videoUrl = Array.isArray(url) ? url[0] : url;

  // Create processing job immediately
  const processingId = uuidv4();
  const job = {
    id: processingId,
    status: "initializing",
    progress: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    video_id: null,
    video_title: null,
    result: null,
    type: "mp4",
  };
  processingCache.set(processingId, job);

  try {
    updateProgress(processingId, 10, "processing");
    const info = await getVideoInfo(videoUrl);
    updateProgress(processingId, 20, "validating", info.id, info.title);

    const fileName = `${info.title.replace(/[^\w\s.-]/gi, "")}.mp4`;
    res.setHeader(
      "Access-Control-Expose-Headers",
      "X-Processing-Id, X-Video-Id, X-Video-Title, Content-Disposition, Content-Type"
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
    processingCache.set(processingId, job);
    updateProgress(processingId, 30, "downloading", info.id, info.title);

    const args = [
      "--format",
      "mp4",
      "--no-check-certificates",
      "--no-warnings",
      "--user-agent",
      USER_AGENT,
      "-o",
      "-", // Output to stdout
      videoUrl,
    ];

    const hasValidCookies = await validateCookiesFile();
    if (hasValidCookies) {
      args.push("--cookies", path.resolve(__dirname, "cookies.txt"));
    }

    // Use Node.js spawn directly for better stream control
    const child = spawn(ytDlpWrap.binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Store the child process in the job cache
    job.child = child;

    child.stdout.pipe(res);
    child.stderr.on("data", (data) =>
      logger.ytdlp("stderr output", { data: data.toString() })
    );

    child.on("error", (err) => {
      logger.error("MP4 streaming error", { processingId, error: err.message });
      updateProgress(processingId, 100, "failed");
      if (!res.headersSent) res.status(500).send("Error streaming video");
    });

    child.on("close", (code) => {
      if (code === 0) {
        updateProgress(processingId, 100, "completed");
      } else if (code === null) {
        // SIGKILL returns null
        updateProgress(processingId, 100, "canceled");
      } else {
        updateProgress(processingId, 100, "failed");
      }
    });
  } catch (error) {
    logger.error("MP4 download error", { processingId, error: error.message });
    if (!res.headersSent) res.status(400).send("Error downloading video");
  }
});

app.get("/transcript", async (req, res) => {
  const { url, lang = "tr" } = req.query;
  const skipAI = req.query.skipAI === "true";
  const useDeepSeek = req.query.useDeepSeek !== "false";

  // Validate and normalize URL parameter
  if (!url) {
    return res.status(400).send("Missing url parameter");
  }

  // Handle case where url might be an array (multiple params)
  const videoUrl = Array.isArray(url) ? url[0] : url;

  if (typeof videoUrl !== "string") {
    return res.status(400).send("url parameter must be a string");
  }

  // Create processing job
  const processingId = uuidv4();
  const abortController = new AbortController();
  const job = {
    id: processingId,
    status: "queued",
    progress: 0,
    createdAt: Date.now(),
    lastUpdated: Date.now(),
    result: null,
    abortController: abortController,
  };
  processingCache.set(processingId, job);

  // Add to processing queue
  processingQueue.add(async () => {
    try {
      updateProgress(processingId, 10, "Getting video information...");
      const info = await getVideoInfo(videoUrl, {
        signal: abortController.signal,
      });

      updateProgress(processingId, 20, "Fetching raw transcript...");
      const { lang = info.language } = req.query;
      const transcriptXml = await getVideoTranscript(
        videoUrl,
        lang,
        abortController.signal
      );

      updateProgress(processingId, 30, "Fetching raw transcript is complete");

      // Parse transcript (supports XML and WebVTT formats)
      let subtitleLines = [];
      if (transcriptXml.includes("<text")) {
        // TTML/XML format
        const lines = transcriptXml.match(/<text[^>]*>([^<]+)<\/text>/g) || [];
        subtitleLines = lines.map((line) => {
          return line.replace(/<text[^>]*>/, "").replace(/<\/text>/, "");
        });
      } else if (transcriptXml.includes("WEBVTT")) {
        // WebVTT format
        subtitleLines = transcriptXml
          .split("\n")
          .filter(
            (line) =>
              line.trim() &&
              !line.startsWith("WEBVTT") &&
              !line.startsWith("NOTE") &&
              !line.includes("-->")
          )
          .map((line) => line.trim());
      } else if (
        typeof transcriptXml === "string" &&
        transcriptXml.length > 0
      ) {
        // Plain text format (from Whisper or youtube-transcript-plus)
        // Already clean text, just split into sentences for consistency
        subtitleLines = transcriptXml
          .split(/(?<=[.!?])\s+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        logger.info("Processing plain text transcript", {
          totalLength: transcriptXml.length,
          sentences: subtitleLines.length,
        });
      } else {
        throw new Error("Unsupported transcript format");
      }

      // Basic cleanup of the text
      const cleanedLines = subtitleLines
        .map((line) =>
          line
            .replace(/\r/g, "")
            .replace(/<[^>]+>/g, "") // Remove HTML-like tags
            .replace(/\{[^\}]+\}/g, "") // Remove curly brace annotations
            .replace(/^\s*-\s*/gm, "") // Remove leading dashes
            .trim()
        )
        .filter((line) => line); // Remove empty lines

      let finalTranscript;
      let aiNotes = null;
      let processorUsed = useDeepSeek ? "deepseek" : "qwen";

      if (!skipAI) {
        try {
          updateProgress(processingId, 40, "Processing transcript with AI ...");
          // Process entire text at once
          const rawText = cleanedLines.join(" ");
          const messages = [
            {
              role: "system",
              content: `You are a transcript editor. When processing the following text, you MUST follow these rules:
                        1. Detect the language of the text and do not attempt to translate it
                        2. Remove ALL repeated sentences or phrases (only those that are exact or very similar)
                        3. Correct punctuation, spelling, and basic grammar mistakes
                        4. Convert spoken language to standard written language, but DO NOT change the structure or order of sentences
                        5. DO NOT rewrite, merge, split, summarize, or interpret sentences
                        6. DO NOT add or remove any information, only remove repetitions and fix writing errors
                        7. STRICTLY PRESERVE the meaning, tone, and original structure of the sentences
                        8. Only remove unnecessary repetitions and fix writing errors, NEVER summarize or rephrase the text
                        9. RETURN ONLY THE EDITED TRANSCRIPT as output. Do NOT add explanations, summaries, process notes, or any other information.
                        10. If you must add an explanation or process note, start it on a separate line with 'NOTE:'. But if possible, return only the transcript.`,
            },
            {
              role: "user",
              content: rawText,
            },
          ];

          // First pass - clean up and format
          const firstResponse = await callAIModel(
            messages,
            useDeepSeek,
            abortController.signal
          );
          updateProgress(
            processingId,
            75,
            "Cleaning up transcript with AI ..."
          );

          // Update processor if we switched to backup model
          if (firstResponse.modelUsed === "qwen") {
            processorUsed = "qwen";
          }

          // Second pass - final cleanup for duplicates
          const cleanupMessages = [
            {
              role: "system",
              content: `You are a text editor. Do a final check of the following text:
                        1. Detect the language of the text and do not attempt to translate it
                        2. Find and remove any remaining repeated sentences or phrases (only those that are exact or very similar)
                        3. DO NOT change the order, structure, or meaning of the sentences
                        4. Only remove repetitions, do not add or remove any new information. Remove "\n" character combinations.
                        5. STRICTLY PRESERVE the main idea, details, and original form of the sentences
                        6. RETURN ONLY THE TRANSCRIPT as output. Do NOT add explanations, summaries, process notes, or any other information.
                        7. If you must add an explanation or process note, start it on a separate line with 'NOTE:'. But if possible, return only the transcript.`,
            },
            {
              role: "user",
              content: firstResponse.choices[0].message.content,
            },
          ];

          const finalResponse = await callAIModel(
            cleanupMessages,
            useDeepSeek,
            abortController.signal
          );
          updateProgress(
            processingId,
            80,
            "Finalizing transcript with AI model..."
          );

          // After getting finalResponse, split transcript and notes if needed
          let transcriptText = finalResponse.choices[0].message.content.trim();
          if (transcriptText.includes("NOTE:")) {
            const [main, ...notes] = transcriptText.split(/\n?NOTE:/);
            transcriptText = main.trim();
            aiNotes = notes.join("NOTE:").trim();
          }
          updateProgress(processingId, 85, "AI processing complete");
          finalTranscript = transcriptText;
        } catch (error) {
          if (error.name === "AbortError") {
            throw error; // Re-throw to be caught by the outer catch block
          }
          logger.error("AI transcript processing failed", {
            processingId,
            error: error.message,
          });
          // Fallback to basic cleaned text if AI processing fails
          finalTranscript = cleanedLines.join(" ");
        }
      } else {
        // Skip AI processing and just return the cleaned text
        finalTranscript = cleanedLines.join(" ");
      }

      updateProgress(processingId, 90, "Finalizing transcript...");
      const isProcessed =
        !skipAI && finalTranscript && finalTranscript.trim().length > 0;

      updateProgress(processingId, 100, "completed");
      const lastRequested = new Date().toISOString();
      logger.job(processingId, "Transcript processing completed", {
        videoId: info.id,
        title: info.title,
      });
      job.result = {
        success: true,
        title: info.title,
        language: lang,
        transcript: finalTranscript,
        ai_notes: aiNotes,
        isProcessed: isProcessed,
        processor: isProcessed ? processorUsed : "None",
        video_id: info.id,
        channel_id: info.channel_id,
        channel_name: info.channel,
        post_date: new Date(
          `${info.upload_date.substring(0, 4)}-${info.upload_date.substring(
            4,
            6
          )}-${info.upload_date.substring(6, 8)}`
        ).toISOString(),
        last_requested: lastRequested,
      };
    } catch (error) {
      if (error.name === "AbortError") {
        logger.job(processingId, "Transcript job canceled");
        updateProgress(processingId, 100, "canceled");
      } else {
        logger.jobError(processingId, "Transcript processing failed", error);
        updateProgress(processingId, 100, "failed");
        job.result = {
          success: false,
          error: `Could not fetch transcript: ${error.message}. Video might not have subtitles in the requested language or they are disabled.`,
        };
      }
    }
  });

  // Return processing ID immediately
  res.status(202).json({
    processingId,
    message:
      "Processing started. Use /progress and /result endpoints to track and retrieve results.",
    progressEndpoint: `/progress/${processingId}`,
    resultEndpoint: `/result/${processingId}`,
  });
});

// New endpoint to get processing progress
app.get("/progress/:id", (req, res) => {
  const job = processingCache.get(req.params.id);
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

  // Add video metadata if available
  if (job.video_id) {
    response.video_id = job.video_id;
  }
  if (job.video_title) {
    response.video_title = job.video_title;
  }

  res.json(response);
});

// New endpoint to get processing result
app.get("/result/:id", (req, res) => {
  const job = processingCache.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Processing ID not found" });
  }
  if (job.progress !== 100 || job.status.toLowerCase() !== "completed") {
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

// New endpoint to cancel a running process
app.post("/cancel/:id", async (req, res) => {
  const { promisify } = require("util");
  const asyncGlob = promisify(require("glob").glob);
  const job = processingCache.get(req.params.id);
  if (!job) {
    return res.status(404).json({ error: "Processing ID not found" });
  }

  // Add queue position information
  const position = processingQueue.size + 1;

  if (job.status === "initializing") {
    updateProgress(req.params.id, 0, "canceled");
    return res.status(200).json({
      message: "Cancelled during initialization",
      video_id: job.video_id,
      queue_position: position,
    });
  } else if (job.child) {
    job.child.kill("SIGKILL");
    // Cleanup temp files
    const tempPattern = path.join(tempDir, `*${job.video_id}*`);
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

// Token exchange endpoint
// This endpoint allows users to exchange their Supabase access token for a custom JWT token
// This is useful for authenticating with the YouTube Multi API without exposing Supabase keys
app.post("/auth/exchange-token", express.json(), async (req, res) => {
  const { supabaseAccessToken } = req.body; // Expecting JSON body with supabaseAccessToken
  if (!supabaseAccessToken) {
    return res
      .status(400)
      .json({ error: "Missing supabaseAccessToken in request body" });
  }

  try {
    // Validate token
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(supabaseAccessToken);
    if (error || !user) {
      return res
        .status(401)
        .json({ error: "Invalid or expired Supabase token" });
    }

    // Generate custom JWT
    const keyPath = path.join(__dirname, "keys", "private.key");
    try {
      const privateKey = await fs.readFile(keyPath, "utf8");
      const apiToken = jwt.sign(
        {
          iss: "youtube-multi-api",
          sub: user.id,
          iat: Math.floor(Date.now() / 1000),
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "1h" }
      );

      res.json({
        apiToken, // Custom JWT token
        expiresIn: 3600, // 1 hour in seconds
      });
    } catch (error) {
      logger.error("Private key read failed", {
        keyPath,
        error: error.message,
      });
      res.status(500).json({
        error: `Could not read private key: ${error.message}`,
      });
    }
  } catch (error) {
    logger.error("Token exchange failed", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});
