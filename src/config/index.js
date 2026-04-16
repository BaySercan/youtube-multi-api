require("dotenv").config();
const path = require("path");

module.exports = {
  // Server
  PORT: process.env.PORT || 3500,
  NODE_ENV: process.env.NODE_ENV || "development",

  // User agent for yt-dlp requests
  USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",

  // Temp directory
  TEMP_DIR: path.join(__dirname, "..", "..", "temp"),

  // Cookies
  USE_COOKIES: process.env.USE_COOKIES !== "false",
  COOKIES_PATH: path.resolve(__dirname, "..", "..", "cookies.txt"),
  COOKIES_CACHE_TTL: 5 * 60 * 1000, // 5 minutes

  // Cleanup intervals
  CLEANUP_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes
  MAX_TEMP_FILE_AGE_MS: 30 * 60 * 1000, // 30 minutes

  // Processing queue
  QUEUE_CONCURRENCY: 4,
  QUEUE_INTERVAL_CAP: 5,
  QUEUE_INTERVAL: 1000, // 1 second
  QUEUE_TIMEOUT: 30 * 60 * 1000, // 30 minutes

  // Whisper / Audio
  WHISPER_MAX_FILE_SIZE: 25 * 1024 * 1024, // 25MB
  WHISPER_CHUNK_DURATION_SECONDS: 600, // 10 minutes

  // AI / OpenRouter
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  AI_MODEL_1: process.env.AI_MODEL_1,
  AI_MODEL_2: process.env.AI_MODEL_2,

  // OpenAI (Whisper)
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,

  // JWT
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "1h",
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  KEYS_DIR: path.join(__dirname, "..", "..", "keys"),

  // Supabase
  SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY,
};
