const express = require("express");
const { v4: uuidv4 } = require("uuid");
const router = express.Router();
const logger = require("../utils/logger");
const { getVideoTranscript } = require("../services/transcript");
const {
  callAIModel,
  getSinglePassPrompt,
  getCleanupPrompt,
  getFinalCleanupPrompt,
} = require("../services/ai");
const {
  parseTranscriptFormat,
  cleanSubtitleLines,
} = require("../utils/subtitleParser");
const { createJob, getQueue, updateProgress } = require("../services/jobManager");

router.get("/transcript", async (req, res) => {
  const { url, lang } = req.query;
  const skipAI = req.query.skipAI === "true";
  const useDeepSeek = req.query.useDeepSeek !== "false";
  // quality: "fast" (skip AI), "standard" (1 pass, default), "thorough" (2 passes, legacy)
  const quality = req.query.quality || "standard";

  if (!url) {
    return res.status(400).send("Missing url parameter");
  }

  const videoUrl = Array.isArray(url) ? url[0] : url;

  if (typeof videoUrl !== "string") {
    return res.status(400).send("url parameter must be a string");
  }

  const processingId = uuidv4();
  const abortController = new AbortController();
  const job = createJob(processingId, "transcript", {
    abortController: abortController,
  });

  const processingQueue = getQueue();

  processingQueue.add(async () => {
    try {
      updateProgress(processingId, 10, "Getting video information...");

      const { transcript: transcriptContent, info, usedLang } = await getVideoTranscript(
        videoUrl,
        lang,
        abortController.signal,
      );

      updateProgress(processingId, 30, "Fetching raw transcript is complete");

      // Parse and clean transcript
      const subtitleLines = parseTranscriptFormat(transcriptContent);
      const cleanedLines = cleanSubtitleLines(subtitleLines);

      // Determine if translation is needed (if requested lang differs dynamically from extracted usedLang)
      let targetLang = null;
      if (lang && usedLang) {
        const reqBase = lang.split("-")[0];
        const usedBase = usedLang.split("-")[0];
        if (reqBase !== usedBase) {
          targetLang = lang;
        }
      }

      let finalTranscript;
      let aiNotes = null;
      let processorUsed = useDeepSeek ? "deepseek" : "qwen";
      const shouldUseAI = !skipAI && quality !== "fast";

      if (shouldUseAI) {
        try {
          updateProgress(processingId, 40, "Processing transcript with AI ...");
          const rawText = cleanedLines.join(" ");

          if (quality === "thorough") {
            // ─── Two-pass mode (legacy behavior) ───
            logger.ai("Using thorough (2-pass) transcript processing");

            const firstMessages = [
              { role: "system", content: getCleanupPrompt(targetLang) },
              { role: "user", content: rawText },
            ];

            const firstResponse = await callAIModel(
              firstMessages,
              useDeepSeek,
              abortController.signal,
            );
            updateProgress(processingId, 60, "First AI pass complete, running cleanup...");

            if (firstResponse.modelUsed === "qwen") {
              processorUsed = "qwen";
            }

            const cleanupMessages = [
              { role: "system", content: getFinalCleanupPrompt(targetLang) },
              { role: "user", content: firstResponse.choices[0].message.content },
            ];

            const finalResponse = await callAIModel(
              cleanupMessages,
              useDeepSeek,
              abortController.signal,
            );

            let transcriptText = finalResponse.choices[0].message.content.trim();
            if (transcriptText.includes("NOTE:")) {
              const [main, ...notes] = transcriptText.split(/\n?NOTE:/);
              transcriptText = main.trim();
              aiNotes = notes.join("NOTE:").trim();
            }
            finalTranscript = transcriptText;

          } else {
            // ─── Single-pass mode (default, 50% faster) ───
            logger.ai("Using standard (single-pass) transcript processing");

            const messages = [
              { role: "system", content: getSinglePassPrompt(targetLang) },
              { role: "user", content: rawText },
            ];

            const response = await callAIModel(
              messages,
              useDeepSeek,
              abortController.signal,
            );

            if (response.modelUsed === "qwen") {
              processorUsed = "qwen";
            }

            let transcriptText = response.choices[0].message.content.trim();
            if (transcriptText.includes("NOTE:")) {
              const [main, ...notes] = transcriptText.split(/\n?NOTE:/);
              transcriptText = main.trim();
              aiNotes = notes.join("NOTE:").trim();
            }
            finalTranscript = transcriptText;
          }

          updateProgress(processingId, 85, "AI processing complete");
        } catch (error) {
          if (error.name === "AbortError") {
            throw error;
          }
          logger.error("AI transcript processing failed", {
            processingId,
            error: error.message,
          });
          finalTranscript = cleanedLines.join(" ");
        }
      } else {
        // Skip AI processing — return cleaned text
        finalTranscript = cleanedLines.join(" ");
      }

      updateProgress(processingId, 90, "Finalizing transcript...");
      const isProcessed =
        shouldUseAI && finalTranscript && finalTranscript.trim().length > 0;

      updateProgress(processingId, 100, "completed");
      const lastRequested = new Date().toISOString();
      const requestedLang = req.query.lang || info.language || "tr";

      logger.job(processingId, "Transcript processing completed", {
        videoId: info.id,
        title: info.title,
        quality,
      });

      job.result = {
        success: true,
        title: info.title,
        language: targetLang || usedLang,
        transcript: finalTranscript,
        ai_notes: aiNotes,
        isProcessed: isProcessed,
        processor: isProcessed ? processorUsed : "None",
        quality: quality,
        video_id: info.id,
        channel_id: info.channel_id,
        channel_name: info.channel || info.uploader,
        post_date: info.upload_date ? new Date(
          `${info.upload_date.substring(0, 4)}-${info.upload_date.substring(
            4,
            6,
          )}-${info.upload_date.substring(6, 8)}`,
        ).toISOString() : null,
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

  res.status(202).json({
    processingId,
    message:
      "Processing started. Use /progress and /result endpoints to track and retrieve results.",
    progressEndpoint: `/progress/${processingId}`,
    resultEndpoint: `/result/${processingId}`,
  });
});

module.exports = router;
