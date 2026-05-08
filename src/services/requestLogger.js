const logger = require("../utils/logger");
const config = require("../config");

/**
 * Lightweight Supabase request logger.
 * Fires-and-forgets — never blocks the main request pipeline.
 * If Supabase is not configured, silently no-ops.
 */

let supabaseUrl = null;
let supabaseKey = null;
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  supabaseUrl = config.SUPABASE_URL;
  supabaseKey = config.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    logger.info("📊 Request logger initialized (Supabase)");
  }
}

function isEnabled() {
  init();
  return !!(supabaseUrl && supabaseKey);
}

/**
 * Log an API request to Supabase. Fire-and-forget — never throws.
 * @param {object} data - Request log data
 */
async function logRequest(data) {
  if (!isEnabled()) return;

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/api_request_logs`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          processing_id: data.processingId,
          endpoint: data.endpoint || "transcript",
          video_id: data.videoId || null,
          video_title: data.videoTitle || null,
          requested_lang: data.requestedLang || null,
          used_lang: data.usedLang || null,
          status: data.status || "pending",
          success: data.success ?? null,
          error_message: data.errorMessage
            ? data.errorMessage.substring(0, 2000)
            : null,
          error_type: data.errorType || null,
          ai_model: data.aiModel || null,
          ai_processor: data.aiProcessor || null,
          is_processed: data.isProcessed || false,
          transcript_source: data.transcriptSource || null,
          transcript_length: data.transcriptLength || null,
          duration_ms: data.durationMs || null,
          quality: data.quality || null,
          ip_address: data.ip || null,
        }),
        signal: AbortSignal.timeout(5000), // 5s timeout — don't hang
      },
    );

    if (!response.ok) {
      const text = await response.text();
      logger.warn("📊 Request log write failed", {
        status: response.status,
        body: text.substring(0, 200),
      });
    }
  } catch (error) {
    // Silently swallow — logging should never break the API
    logger.debug("📊 Request log error (non-critical)", {
      error: error.message,
    });
  }
}

/**
 * Classify error type from error message for structured logging.
 */
function classifyError(errorMessage) {
  if (!errorMessage) return "UNKNOWN";
  const msg = errorMessage.toLowerCase();
  if (msg.includes("private video")) return "VIDEO_PRIVATE";
  if (msg.includes("video unavailable")) return "VIDEO_UNAVAILABLE";
  if (msg.includes("sign in to confirm")) return "BOT_DETECTION";
  if (msg.includes("429") || msg.includes("too many request") || msg.includes("toomanyrequesterror"))
    return "RATE_LIMITED";
  if (msg.includes("live event")) return "LIVE_EVENT";
  if (msg.includes("no_captions")) return "NO_CAPTIONS";
  if (msg.includes("language_not_available")) return "LANG_UNAVAILABLE";
  if (msg.includes("aborted") || msg.includes("canceled")) return "CANCELED";
  if (msg.includes("timed out") || msg.includes("timeout")) return "TIMEOUT";
  if (msg.includes("empty content")) return "AI_EMPTY_RESPONSE";
  if (msg.includes("ai") || msg.includes("openrouter")) return "AI_FAILURE";
  return "UNKNOWN";
}

module.exports = {
  logRequest,
  classifyError,
  isEnabled,
};
