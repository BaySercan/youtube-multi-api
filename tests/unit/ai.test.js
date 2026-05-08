const { getSinglePassPrompt, getCleanupPrompt, getFinalCleanupPrompt } = require("../../src/services/ai");

describe("ai service", () => {
  describe("prompt generation", () => {
    test("getSinglePassPrompt should handle translation requests", () => {
      const prompt = getSinglePassPrompt("es");
      expect(prompt).toContain("ISO 639-1 language code: \"es\"");
      expect(prompt).toContain("TRANSLATE");
    });

    test("getSinglePassPrompt should handle original language requests", () => {
      const prompt = getSinglePassPrompt(null);
      expect(prompt).toContain("Detect the language of the text automatically");
      expect(prompt).not.toContain("TRANSLATE");
    });

    test("getCleanupPrompt should handle translation requests", () => {
      const prompt = getCleanupPrompt("fr");
      expect(prompt).toContain("ISO 639-1 \"fr\"");
    });

    test("getFinalCleanupPrompt should handle original language requests", () => {
      const prompt = getFinalCleanupPrompt(null);
      expect(prompt).toContain("Detect the language of the text");
    });
  });
});
