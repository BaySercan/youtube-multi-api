const { parseTranscriptFormat, cleanSubtitleLines, findLanguageTracks, getLanguageVariants } = require("../../src/utils/subtitleParser");

describe("subtitleParser", () => {
  describe("parseTranscriptFormat", () => {
    test("should parse TTML/XML format", () => {
      const input = '<text start="0" dur="5">Hello world</text><text start="5" dur="3">Second line</text>';
      const result = parseTranscriptFormat(input);
      expect(result).toEqual(["Hello world", "Second line"]);
    });

    test("should parse WebVTT format", () => {
      const input = `WEBVTT

00:00:00.000 --> 00:00:05.000
Hello world

00:00:05.000 --> 00:00:08.000
Second line`;
      const result = parseTranscriptFormat(input);
      expect(result).toEqual(["Hello world", "Second line"]);
    });

    test("should parse plain text format", () => {
      const input = "Hello world. This is a test. Another sentence here.";
      const result = parseTranscriptFormat(input);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toBe("Hello world.");
    });

    test("should throw for empty content", () => {
      expect(() => parseTranscriptFormat("")).toThrow("Unsupported transcript format");
    });
  });

  describe("cleanSubtitleLines", () => {
    test("should remove HTML tags", () => {
      const input = ["<b>Bold text</b>", "<i>Italic</i>"];
      const result = cleanSubtitleLines(input);
      expect(result).toEqual(["Bold text", "Italic"]);
    });

    test("should remove curly brace annotations", () => {
      const input = ["Hello {annotation} world"];
      const result = cleanSubtitleLines(input);
      expect(result).toEqual(["Hello  world"]);
    });

    test("should remove leading dashes", () => {
      const input = ["- Speaker one", "- Speaker two"];
      const result = cleanSubtitleLines(input);
      expect(result).toEqual(["Speaker one", "Speaker two"]);
    });

    test("should filter empty lines", () => {
      const input = ["Hello", "", "  ", "World"];
      const result = cleanSubtitleLines(input);
      expect(result).toEqual(["Hello", "World"]);
    });
  });

  describe("getLanguageVariants", () => {
    const mockInfo = {
      automatic_captions: {
        "en": [],
        "en-orig": [],
        "en-US": [],
        "tr": [],
        "tr-orig": [],
      },
      subtitles: {}
    };

    test("should prioritize exact, -orig, base, then other variants", () => {
      const variants = getLanguageVariants(mockInfo, "en");
      expect(variants).toEqual(["en", "en-orig", "en-US"]);
    });

    test("should generate base and -orig even if exact is not present initially (but they exist in source)", () => {
      // e.g. requested 'tr' but only 'tr-orig' exists in captions
      const info = { automatic_captions: { "tr-orig": [] }, subtitles: {} };
      const variants = getLanguageVariants(info, "tr");
      expect(variants).toEqual(["tr-orig"]); // 'tr' is not in allLangs, but 'tr-orig' is picked up by step 2 or 4
    });
  });

  describe("findLanguageTracks", () => {
    const mockInfo = {
      automatic_captions: {
        "en": [{ ext: "vtt", url: "http://example.com/en.vtt" }],
        "tr": [{ ext: "vtt", url: "http://example.com/tr.vtt" }],
        "en-US": [{ ext: "vtt", url: "http://example.com/en-US.vtt" }],
      },
      subtitles: {},
    };

    test("should find exact language match", () => {
      const { tracks, usedLang } = findLanguageTracks(mockInfo, "en");
      expect(tracks.length).toBe(1);
      expect(usedLang).toBe("en");
    });

    test("should fall back to base language", () => {
      const info = {
        automatic_captions: {
          "en": [{ ext: "vtt", url: "http://example.com/en.vtt" }],
        },
        subtitles: {},
      };
      const { tracks, usedLang } = findLanguageTracks(info, "en-GB");
      expect(tracks.length).toBe(1);
      expect(usedLang).toBe("en");
    });

    test("should return empty for missing language", () => {
      const { tracks, usedLang } = findLanguageTracks(mockInfo, "fr");
      expect(tracks.length).toBe(0);
      expect(usedLang).toBeNull();
    });

    test("should try variants when base not found", () => {
      const info = {
        automatic_captions: {
          "en-US": [{ ext: "vtt", url: "http://example.com/en-US.vtt" }],
        },
        subtitles: {},
      };
      const { tracks, usedLang } = findLanguageTracks(info, "en");
      expect(tracks.length).toBe(1);
      expect(usedLang).toBe("en-US");
    });

    test("should handle empty tracking arrays and fall back to -orig", () => {
      const info = {
        automatic_captions: {
          "tr": [], // Empty array (truthy but no tracks)
          "tr-orig": [{ ext: "vtt", url: "http://example.com/tr-orig.vtt" }]
        },
        subtitles: {}
      };
      const { tracks, usedLang } = findLanguageTracks(info, "tr");
      expect(tracks.length).toBe(1);
      expect(usedLang).toBe("tr-orig");
    });
  });
});
