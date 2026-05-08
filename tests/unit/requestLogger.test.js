const { classifyError } = require("../../src/services/requestLogger");

describe("requestLogger", () => {
  describe("classifyError", () => {
    test("should classify private video errors", () => {
      expect(classifyError("This is a private video")).toBe("VIDEO_PRIVATE");
      expect(classifyError("Video unavailable")).toBe("VIDEO_UNAVAILABLE");
    });
    
    test("should classify rate limit errors", () => {
      expect(classifyError("Error 429: Too many requests")).toBe("RATE_LIMITED");
      expect(classifyError("toomanyrequesterror")).toBe("RATE_LIMITED");
    });

    test("should classify AI empty responses", () => {
      expect(classifyError("AI model returned empty content")).toBe("AI_EMPTY_RESPONSE");
    });

    test("should classify cancelation and timeouts", () => {
      expect(classifyError("The request was aborted")).toBe("CANCELED");
      expect(classifyError("Connection timed out")).toBe("TIMEOUT");
    });

    test("should classify unknown errors as UNKNOWN", () => {
      expect(classifyError("Something weird happened")).toBe("UNKNOWN");
      expect(classifyError(null)).toBe("UNKNOWN");
      expect(classifyError(undefined)).toBe("UNKNOWN");
    });
  });
});
