const axios = require("axios");
const logger = require("../utils/logger");
const config = require("../config");

/**
 * Call an AI model via OpenRouter API
 * @param {Array} messages - Chat messages array
 * @param {boolean} useDeepSeek - Whether to use primary model (true) or fallback (false)
 * @param {AbortSignal} signal - Abort signal for cancellation
 * @returns {object} - OpenRouter API response
 */
async function callAIModel(messages, useDeepSeek = true, signal) {
  const apiKey = config.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "OPENROUTER_API_KEY environment variable is not set or empty",
    );
  }

  const model = useDeepSeek ? config.AI_MODEL_1 : config.AI_MODEL_2;
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
          max_tokens: 16384,
        },
        {
          headers: {
            Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
            "HTTP-Referer":
              "https://github.com/yourusername/youtube-download-api",
            "Content-Type": "application/json",
          },
          signal,
        },
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
          from: config.AI_MODEL_1,
          to: config.AI_MODEL_2,
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

// AI prompt templates

function getTranslationInstruction(targetLang) {
  return targetLang 
    ? `- First detect and understand the original language. Clean up the text.\n- Then TRANSLATE the entirely cleaned text into the ISO 639-1 language code: "${targetLang}".\n- You MUST return the final response entirely in "${targetLang}".`
    : `- Detect the language of the text automatically. Do NOT translate it.`;
}

function getSinglePassPrompt(targetLang = null) {
  return `You are a professional transcript editor. Process the following text in ONE pass following ALL these rules strictly:

LANGUAGE:
${getTranslationInstruction(targetLang)}

DEDUPLICATION:
- Remove ALL repeated sentences or phrases (exact or very similar duplicates).
- Remove "\\n" character combinations and other formatting artifacts.

CORRECTIONS:
- Correct punctuation, spelling, and basic grammar mistakes.
- Convert spoken language to standard written language.

STRICT PRESERVATION RULES:
- DO NOT rewrite, merge, split, summarize, or interpret sentences.
- DO NOT change the structure, order, or meaning of the text (except for translation purposes if requested).
- DO NOT add or remove any information beyond removing repetitions and fixing errors.

OUTPUT:
- RETURN ONLY THE EDITED TRANSCRIPT. No explanations, summaries, or process notes.
- If you absolutely must add a note, place it on a separate line starting with 'NOTE:'.`;
}

function getCleanupPrompt(targetLang = null) {
  return `You are a transcript editor. When processing the following text, you MUST follow these rules:
1. ${targetLang ? `Detect the language, translate it to ISO 639-1 "${targetLang}", and return ONLY the translated "${targetLang}" text` : "Detect the language of the text and do not attempt to translate it"}
2. Remove ALL repeated sentences or phrases (only those that are exact or very similar)
3. Correct punctuation, spelling, and basic grammar mistakes
4. Convert spoken language to standard written language, but DO NOT change the structure or order of sentences
5. DO NOT rewrite, merge, split, summarize, or interpret sentences
6. DO NOT add or remove any information, only remove repetitions and fix writing errors
7. STRICTLY PRESERVE the meaning, tone, and original structure of the sentences
8. Only remove unnecessary repetitions and fix writing errors, NEVER summarize or rephrase the text
9. RETURN ONLY THE EDITED TRANSCRIPT as output. Do NOT add explanations, summaries, process notes, or any other information.
10. If you must add an explanation or process note, start it on a separate line with 'NOTE:'. But if possible, return only the transcript.`;
}

function getFinalCleanupPrompt(targetLang = null) {
  return `You are a text editor. Do a final check of the following text:
1. ${targetLang ? `Ensure the text is fully translated into ISO 639-1 language code: "${targetLang}"` : "Detect the language of the text and do not attempt to translate it"}
2. Find and remove any remaining repeated sentences or phrases (only those that are exact or very similar)
3. DO NOT change the order, structure, or meaning of the sentences
4. Only remove repetitions, do not add or remove any new information. Remove "\\n" character combinations.
5. STRICTLY PRESERVE the main idea, details, and original form of the sentences
6. RETURN ONLY THE TRANSCRIPT as output. Do NOT add explanations, summaries, process notes, or any other information.
7. If you must add an explanation or process note, start it on a separate line with 'NOTE:'. But if possible, return only the transcript.`;
}

module.exports = {
  callAIModel,
  getSinglePassPrompt,
  getCleanupPrompt,
  getFinalCleanupPrompt,
};
