const { spawn } = require("child_process");
const { promises: fs, createReadStream } = require("fs");
const path = require("path");
const OpenAI = require("openai");
const logger = require("../utils/logger");
const config = require("../config");
const { appendCookieArgs, getYtDlpWrap } = require("./ytdlp");

// Initialize OpenAI client for Whisper API
const openai = config.OPENAI_API_KEY
  ? new OpenAI({ apiKey: config.OPENAI_API_KEY })
  : null;

/**
 * Check if Whisper is available (OpenAI API key configured)
 */
function isWhisperAvailable() {
  return !!openai;
}

/**
 * Get audio duration in seconds using ffprobe
 */
async function getAudioDuration(audioPath) {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]);

    let output = "";
    ffprobe.stdout.on("data", (data) => {
      output += data.toString();
    });
    ffprobe.stderr.on("data", (data) => {
      logger.debug("ffprobe stderr", { data: data.toString() });
    });

    ffprobe.on("close", (code) => {
      if (code === 0 && output.trim()) {
        resolve(parseFloat(output.trim()));
      } else {
        reject(new Error(`ffprobe failed with code ${code}`));
      }
    });

    ffprobe.on("error", reject);
  });
}

/**
 * Split audio file into chunks for Whisper processing
 */
async function splitAudioIntoChunks(
  audioPath,
  chunkDuration = config.WHISPER_CHUNK_DURATION_SECONDS,
) {
  const duration = await getAudioDuration(audioPath);
  const numChunks = Math.ceil(duration / chunkDuration);

  logger.info("Splitting audio into chunks for Whisper", {
    totalDuration: `${(duration / 60).toFixed(1)} minutes`,
    chunkDuration: `${chunkDuration / 60} minutes`,
    numChunks,
    audioPath,
  });

  const chunkPaths = [];
  const basePath = audioPath.replace(".mp3", "");

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const chunkPath = `${basePath}_chunk_${i}.mp3`;

    await new Promise((resolve, reject) => {
      const ffmpeg = spawn("ffmpeg", [
        "-i",
        audioPath,
        "-ss",
        startTime.toString(),
        "-t",
        chunkDuration.toString(),
        "-c",
        "copy",
        "-y",
        chunkPath,
      ]);

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          logger.debug("Audio chunk created", {
            chunk: i + 1,
            of: numChunks,
            startTime: `${(startTime / 60).toFixed(1)} min`,
            path: chunkPath,
          });
          resolve();
        } else {
          reject(new Error(`ffmpeg chunking failed with code ${code}`));
        }
      });

      ffmpeg.on("error", reject);
    });

    chunkPaths.push(chunkPath);
  }

  logger.info("Audio chunking completed", {
    chunks: chunkPaths.length,
    originalFile: audioPath,
  });

  return chunkPaths;
}

/**
 * Extract audio from a YouTube video for Whisper transcription
 */
async function extractAudioForWhisper(url, signal) {
  const uniqueId = `whisper_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}`;
  const audioPath = path.join(config.TEMP_DIR, `${uniqueId}.mp3`);

  const args = [
    "--extract-audio",
    "--audio-format",
    "mp3",
    "--postprocessor-args",
    "ffmpeg:-ac 1 -ar 16000 -b:a 64k",
    "--no-warnings",
    "--no-check-certificates",
    "--user-agent",
    config.USER_AGENT,
    "-o",
    audioPath,
    url,
  ];

  await appendCookieArgs(args);

  try {
    logger.info("🎤 Whisper: Starting audio extraction", {
      url,
      outputPath: audioPath,
    });

    const ytDlpWrap = getYtDlpWrap();
    const extractStart = Date.now();
    await ytDlpWrap.execPromise(args, { signal });
    const extractDuration = ((Date.now() - extractStart) / 1000).toFixed(1);

    await fs.access(audioPath);
    const stats = await fs.stat(audioPath);

    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    logger.info("🎤 Whisper: Audio extraction completed", {
      path: audioPath,
      sizeMB: fileSizeMB,
      extractionTime: `${extractDuration}s`,
    });

    if (stats.size > config.WHISPER_MAX_FILE_SIZE) {
      logger.warn(
        "🎤 Whisper: Audio file exceeds 25MB limit, will use chunking",
        { sizeMB: fileSizeMB, limit: "25MB" },
      );

      try {
        const duration = await getAudioDuration(audioPath);
        const estimatedChunks = Math.ceil(
          duration / config.WHISPER_CHUNK_DURATION_SECONDS,
        );

        logger.info("🎤 Whisper: Preparing chunked transcription", {
          audioDuration: `${(duration / 60).toFixed(1)} minutes`,
          estimatedChunks,
          chunkSize: `${config.WHISPER_CHUNK_DURATION_SECONDS / 60} minutes each`,
        });

        const chunkPaths = await splitAudioIntoChunks(
          audioPath,
          config.WHISPER_CHUNK_DURATION_SECONDS,
        );

        return {
          type: "chunked",
          originalPath: audioPath,
          chunks: chunkPaths,
          totalDuration: duration,
        };
      } catch (chunkError) {
        logger.error("🎤 Whisper: Failed to chunk audio file", {
          error: chunkError.message,
          sizeMB: fileSizeMB,
        });
        await fs.unlink(audioPath).catch(() => {});
        return null;
      }
    }

    return { type: "single", path: audioPath };
  } catch (error) {
    if (error.name === "AbortError") {
      logger.debug("🎤 Whisper: Audio extraction aborted by timeout/client");
      throw error;
    }
    logger.error("🎤 Whisper: Audio extraction failed", {
      error: error.message,
      url,
    });
    return null;
  }
}

/**
 * Transcribe a single audio file using OpenAI Whisper API
 */
async function transcribeSingleFile(audioPath, lang = "tr") {
  const transcriptionStart = Date.now();

  const transcription = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: "whisper-1",
    language: lang.split("-")[0],
    response_format: "text",
  });

  const transcriptionTime = ((Date.now() - transcriptionStart) / 1000).toFixed(1);
  return { transcription, transcriptionTime };
}

/**
 * Transcribe audio using OpenAI Whisper API (supports chunked files)
 */
async function transcribeWithWhisper(audioData, lang = "tr") {
  if (!openai) {
    logger.warn("🎤 Whisper: OpenAI client not initialized - OPENAI_API_KEY not set");
    return null;
  }

  const overallStart = Date.now();

  try {
    // Handle single file transcription
    if (audioData.type === "single") {
      logger.info("🎤 Whisper: Starting single-file transcription", {
        audioPath: audioData.path,
        lang,
      });

      const { transcription, transcriptionTime } = await transcribeSingleFile(
        audioData.path,
        lang,
      );

      await fs.unlink(audioData.path).catch(() => {});

      logger.info("🎤 Whisper: Single-file transcription completed", {
        transcriptLength: transcription.length,
        transcriptionTime: `${transcriptionTime}s`,
      });

      return transcription;
    }

    // Handle chunked file transcription
    if (audioData.type === "chunked") {
      const { chunks, originalPath, totalDuration } = audioData;

      logger.info("🎤 Whisper: Starting chunked transcription", {
        totalChunks: chunks.length,
        totalDuration: `${(totalDuration / 60).toFixed(1)} minutes`,
        lang,
      });

      const transcriptions = [];
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < chunks.length; i++) {
        const chunkPath = chunks[i];
        const chunkNumber = i + 1;

        try {
          logger.info(
            `🎤 Whisper: Processing chunk ${chunkNumber}/${chunks.length}`,
            { chunkPath },
          );

          const { transcription, transcriptionTime } =
            await transcribeSingleFile(chunkPath, lang);

          transcriptions.push(transcription);
          successCount++;

          logger.info(
            `🎤 Whisper: Chunk ${chunkNumber}/${chunks.length} completed`,
            {
              chunkTranscriptLength: transcription.length,
              transcriptionTime: `${transcriptionTime}s`,
            },
          );

          await fs.unlink(chunkPath).catch(() => {});
        } catch (chunkError) {
          failCount++;
          logger.error(
            `🎤 Whisper: Chunk ${chunkNumber}/${chunks.length} failed`,
            { error: chunkError.message, chunkPath },
          );

          await fs.unlink(chunkPath).catch(() => {});
          transcriptions.push(`[Chunk ${chunkNumber} transcription failed]`);
        }
      }

      await fs.unlink(originalPath).catch(() => {});

      const overallTime = ((Date.now() - overallStart) / 1000).toFixed(1);
      const combinedTranscript = transcriptions.join(" ");

      logger.info("🎤 Whisper: Chunked transcription completed", {
        totalChunks: chunks.length,
        successfulChunks: successCount,
        failedChunks: failCount,
        combinedTranscriptLength: combinedTranscript.length,
        totalTranscriptionTime: `${overallTime}s`,
      });

      if (successCount === 0) {
        logger.error("🎤 Whisper: All chunks failed to transcribe");
        return null;
      }

      return combinedTranscript;
    }

    logger.error("🎤 Whisper: Unknown audio data type", { audioData });
    return null;
  } catch (error) {
    logger.error("🎤 Whisper: Transcription failed", {
      error: error.message,
      audioDataType: audioData?.type,
    });

    // Clean up any remaining files
    if (audioData?.type === "single" && audioData?.path) {
      await fs.unlink(audioData.path).catch(() => {});
    } else if (audioData?.type === "chunked") {
      await fs.unlink(audioData.originalPath).catch(() => {});
      for (const chunk of audioData.chunks || []) {
        await fs.unlink(chunk).catch(() => {});
      }
    }

    return null;
  }
}

module.exports = {
  isWhisperAvailable,
  extractAudioForWhisper,
  transcribeWithWhisper,
};
