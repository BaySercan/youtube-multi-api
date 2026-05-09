const axios = require("axios");
const logger = require("../utils/logger");
const { findLanguageTracks, getDefaultLanguage } = require("../utils/subtitleParser");
const { getVideoInfo, fetchAutoSubsWithYtDlp } = require("./ytdlp");
const { isWhisperAvailable, extractAudioForWhisper, transcribeWithWhisper } = require("./whisper");

// youtube-transcript-plus is ESM, dynamically imported
let fetchYTTranscript = null;

// ─── 429 Circuit Breaker ───
// When YouTube rate-limits us, remember it and skip all YouTube caption
// requests for a cooldown period instead of hammering them with more requests.
let youtubeRateLimitedUntil = 0;
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

function isYouTubeRateLimited() {
  return Date.now() < youtubeRateLimitedUntil;
}

function triggerRateLimitCooldown(source) {
  youtubeRateLimitedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  logger.warn("⚡ 429 Circuit Breaker ACTIVATED — skipping YouTube caption requests", {
    source,
    cooldownMinutes: RATE_LIMIT_COOLDOWN_MS / 60000,
    resumesAt: new Date(youtubeRateLimitedUntil).toISOString(),
  });
}

function is429Error(error) {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  const name = (error.constructor?.name || "").toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("too many request") ||
    name.includes("toomanyrequesterror")
  );
}

/**
 * Get video transcript with multi-layer fallback:
 * 1. YouTube captions (from video info)
 * 2. youtube-transcript-plus
 * 3. yt-dlp --write-auto-subs
 * 4. OpenAI Whisper STT (if configured)
 *
 * If YouTube returns 429 at any layer, the circuit breaker activates
 * and all remaining YouTube-based fallbacks are skipped immediately.
 */
async function getVideoTranscript(url, lang, signal) {
  const info = await getVideoInfo(url, { signal });
  const safeLang = lang || getDefaultLanguage(info);

  // Track whether we should skip YouTube fallbacks
  let skipYouTubeFallbacks = isYouTubeRateLimited();

  if (skipYouTubeFallbacks) {
    logger.warn("⚡ 429 Circuit Breaker active — skipping all YouTube caption methods", {
      videoId: info.id,
      resumesAt: new Date(youtubeRateLimitedUntil).toISOString(),
    });
  }

  // ─── Layer 1: YouTube captions from video info metadata ───
  if (!skipYouTubeFallbacks) {
    const { tracks, usedLang } = findLanguageTracks(info, safeLang);

    if (tracks.length > 0) {
      if (usedLang !== safeLang) {
        logger.info("Language fallback used", {
          requested: safeLang,
          used: usedLang,
        });
      }

      const track =
        tracks.find(
          (t) => t.ext === "ttml" || t.ext === "xml" || t.ext === "srv1",
        ) || tracks[0];

      try {
        const transcriptResponse = await axios.get(track.url, { signal });
        return { transcript: transcriptResponse.data, info, usedLang, source: "captions" };
      } catch (trackError) {
        logger.warn("Failed to fetch track URL, trying fallbacks", {
          videoId: info.id,
          trackUrl: track.url?.substring(0, 100) + "...",
          error: trackError.message,
        });
        if (is429Error(trackError)) {
          triggerRateLimitCooldown("track-url-fetch");
          skipYouTubeFallbacks = true;
        }
      }
    }
  }

  // ─── Layer 2: youtube-transcript-plus ───
  if (!skipYouTubeFallbacks) {
    try {
      logger.info("Trying youtube-transcript-plus fallback", {
        videoId: info.id,
        requestedLang: safeLang,
      });

      if (!fetchYTTranscript) {
        const ytTranscriptModule = await import("youtube-transcript-plus");
        fetchYTTranscript = ytTranscriptModule.fetchTranscript;
      }

      const baseLang = safeLang.split("-")[0];
      const ytTranscript = await fetchYTTranscript(info.id, { lang: baseLang });

      if (ytTranscript && ytTranscript.length > 0) {
        const transcriptText = ytTranscript
          .map((segment) => segment.text)
          .join(" ");
        logger.info(
          "Successfully fetched transcript via youtube-transcript-plus",
          { videoId: info.id, segments: ytTranscript.length },
        );
        return { transcript: transcriptText, info, usedLang: baseLang, source: "youtube-transcript-plus" };
      }
    } catch (ytError) {
      logger.warn("youtube-transcript-plus fallback failed", {
        videoId: info.id,
        error: ytError.message,
        errorType: ytError.constructor.name,
      });
      if (is429Error(ytError)) {
        triggerRateLimitCooldown("youtube-transcript-plus");
        skipYouTubeFallbacks = true;
      }
    }
  }

  // ─── Layer 3: yt-dlp --write-auto-subs ───
  if (!skipYouTubeFallbacks) {
    const { getLanguageVariants } = require("../utils/subtitleParser");
    const langVariants = getLanguageVariants(info, safeLang);
    const baseLang = safeLang.split("-")[0];
    const langsToTry = [...new Set([safeLang, ...langVariants, baseLang])];

    logger.info("Trying yt-dlp auto-subs fallback", {
      videoId: info.id,
      requestedLang: safeLang,
      variants: langsToTry,
    });

    for (const tryLang of langsToTry) {
      try {
        const autoSubsContent = await fetchAutoSubsWithYtDlp(url, tryLang, signal);
        if (autoSubsContent) {
          logger.info("yt-dlp auto-subs succeeded with variant", {
            videoId: info.id,
            requestedLang: safeLang,
            resolvedLang: tryLang,
          });
          return { transcript: autoSubsContent, info, usedLang: tryLang, source: "yt-dlp-auto-subs" };
        }
      } catch (subsError) {
        // If ANY variant returns 429, stop trying the rest — it's server-level
        if (is429Error(subsError)) {
          triggerRateLimitCooldown(`yt-dlp-auto-subs-${tryLang}`);
          skipYouTubeFallbacks = true;
          break;
        }
      }
    }
  }

  // ─── Layer 4: Whisper STT (costs money — only if YouTube is exhausted) ───
  if (isWhisperAvailable()) {
    logger.info(
      "🎤 Whisper: All YouTube caption methods failed, initiating Whisper STT fallback",
      {
        videoId: info.id,
        videoTitle: info.title,
        videoDuration: info.duration
          ? `${(info.duration / 60).toFixed(1)} minutes`
          : "unknown",
        rateLimited: skipYouTubeFallbacks,
      },
    );

    const audioData = await extractAudioForWhisper(url, signal);
    if (audioData) {
      logger.info(
        "🎤 Whisper: Audio extraction successful, starting transcription",
        {
          videoId: info.id,
          audioType: audioData.type,
          chunks: audioData.type === "chunked" ? audioData.chunks.length : 1,
        },
      );

      const originalLang = getDefaultLanguage(info).split("-")[0];
      const whisperTranscript = await transcribeWithWhisper(audioData, originalLang);
      if (whisperTranscript) {
        logger.info("🎤 Whisper: Fallback transcription successful", {
          videoId: info.id,
          transcriptLength: whisperTranscript.length,
          audioType: audioData.type,
          spokenLanguageIdentified: originalLang,
        });
        return { transcript: whisperTranscript, info, usedLang: originalLang, source: "whisper" };
      } else {
        logger.error("🎤 Whisper: Transcription returned null", {
          videoId: info.id,
          audioType: audioData.type,
        });
      }
    } else {
      logger.error(
        "🎤 Whisper: Audio extraction failed, cannot proceed with transcription",
        { videoId: info.id },
      );
    }
  } else {
    logger.warn(
      "🎤 Whisper: Fallback unavailable - OPENAI_API_KEY not configured",
    );
  }

  // All attempts failed
  const availableLangs = [
    ...new Set([
      ...Object.keys(info.automatic_captions || {}),
      ...Object.keys(info.subtitles || {}),
    ]),
  ];

  const hasAnyCaptions = availableLangs.length > 0;
  const whisperNote = isWhisperAvailable()
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
      `LANGUAGE_NOT_AVAILABLE: No subtitles available for language: "${safeLang}". ` +
      `Available languages: [${availableLangs.join(", ")}]. ` +
      `Try requesting one of the available languages instead. ` +
      `Video ID: ${info.id}`;
  }

  throw new Error(errorMessage);
}

module.exports = {
  getVideoTranscript,
};
