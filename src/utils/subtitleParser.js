const logger = require("./logger");

/**
 * Auto-detect the video's original language if none is provided
 */
function getDefaultLanguage(info) {
  const subtitles = info.subtitles || {};
  const captions = info.automatic_captions || {};
  
  if (info.language && (subtitles[info.language] || captions[info.language])) {
    return info.language;
  }
  
  const allLangs = [...Object.keys(subtitles), ...Object.keys(captions)];
  
  // Try to find the "-orig" track which represents the spoken language
  const origTrack = allLangs.find(l => l.endsWith("-orig"));
  if (origTrack) return origTrack;
  
  // Pick the first available track, usually English if no orig is found
  if (allLangs.length > 0) return allLangs[0];
  
  return "en";
}

/**
 * Get all available language variants for a given language code
 * @param {object} info - Video info from yt-dlp
 * @param {string} lang - Requested language code (e.g. "tr" or explicitly empty)
 * @returns {string[]} - All matching variants, ordered by priority
 */
function getLanguageVariants(info, lang) {
  const safeLang = lang || getDefaultLanguage(info);
  
  const captions = info.automatic_captions || {};
  const subtitles = info.subtitles || {};
  const allLangs = [
    ...new Set([...Object.keys(captions), ...Object.keys(subtitles)]),
  ];

  const baseLang = safeLang.split("-")[0];
  const variants = [];

  // 1. Exact match
  if (allLangs.includes(safeLang)) variants.push(safeLang);

  // 2. "-orig" variant (YouTube uses this for original-language auto-captions)
  const origVariant = baseLang + "-orig";
  if (allLangs.includes(origVariant) && !variants.includes(origVariant)) {
    variants.push(origVariant);
  }

  // 3. Base language (if different from exact)
  if (baseLang !== lang && allLangs.includes(baseLang) && !variants.includes(baseLang)) {
    variants.push(baseLang);
  }

  // 4. Other variants (e.g. en-US, en-GB)
  for (const l of allLangs) {
    if (l.startsWith(baseLang + "-") && !variants.includes(l)) {
      variants.push(l);
    }
  }

  return variants;
}

/**
 * Find available language tracks with fallback support
 * @param {object} info - Video info from yt-dlp
 * @param {string} lang - Requested language code
 * @returns {{ tracks: Array, usedLang: string|null }}
 */
function findLanguageTracks(info, lang) {
  const safeLang = lang || getDefaultLanguage(info);
  const captions = info.automatic_captions || {};
  const subtitles = info.subtitles || {};

  // Get all language variants in priority order
  const variants = getLanguageVariants(info, safeLang);

  for (const variant of variants) {
    // Check both captions and subtitles, filter to non-empty arrays
    const captionTracks = captions[variant] || [];
    const subtitleTracks = subtitles[variant] || [];
    const tracks = captionTracks.length > 0 ? captionTracks : subtitleTracks;

    if (tracks.length > 0) {
      if (variant !== safeLang) {
        logger.info("Language variant resolved", {
          requested: safeLang,
          resolved: variant,
          trackCount: tracks.length,
        });
      }
      return { tracks, usedLang: variant };
    }
  }

  return { tracks: [], usedLang: null };
}

/**
 * Parse transcript content from various formats (XML/TTML, WebVTT, plain text)
 * @param {string} transcriptContent - Raw transcript content
 * @returns {string[]} - Array of cleaned subtitle lines
 */
function parseTranscriptFormat(transcriptContent) {
  let subtitleLines = [];

  if (transcriptContent.includes("<text")) {
    // TTML/XML format
    const lines =
      transcriptContent.match(/<text[^>]*>([^<]+)<\/text>/g) || [];
    subtitleLines = lines.map((line) => {
      return line.replace(/<text[^>]*>/, "").replace(/<\/text>/, "");
    });
  } else if (transcriptContent.includes("WEBVTT")) {
    // WebVTT format
    subtitleLines = transcriptContent
      .split("\n")
      .filter(
        (line) =>
          line.trim() &&
          !line.startsWith("WEBVTT") &&
          !line.startsWith("NOTE") &&
          !line.includes("-->"),
      )
      .map((line) => line.trim());
  } else if (
    typeof transcriptContent === "string" &&
    transcriptContent.length > 0
  ) {
    // Plain text format (from Whisper or youtube-transcript-plus)
    subtitleLines = transcriptContent
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    logger.info("Processing plain text transcript", {
      totalLength: transcriptContent.length,
      sentences: subtitleLines.length,
    });
  } else {
    throw new Error("Unsupported transcript format");
  }

  return subtitleLines;
}

/**
 * Clean parsed subtitle lines (remove HTML tags, annotations, etc.)
 * @param {string[]} subtitleLines - Raw parsed lines
 * @returns {string[]} - Cleaned lines
 */
function cleanSubtitleLines(subtitleLines) {
  return subtitleLines
    .map((line) =>
      line
        .replace(/\r/g, "")
        .replace(/<[^>]+>/g, "") // Remove HTML-like tags
        .replace(/\{[^\}]+\}/g, "") // Remove curly brace annotations
        .replace(/^\s*-\s*/gm, "") // Remove leading dashes
        .trim(),
    )
    .filter((line) => line); // Remove empty lines
}

module.exports = {
  getDefaultLanguage,
  getLanguageVariants,
  findLanguageTracks,
  parseTranscriptFormat,
  cleanSubtitleLines,
};
