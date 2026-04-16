const validateUrl = require("../../src/middleware/validateUrl");

// Mock logger to prevent output during tests
jest.mock("../../utils/logger", () => ({
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  http: jest.fn(),
}));

describe("validateUrl middleware", () => {
  let req, res, next;

  beforeEach(() => {
    req = { query: {}, ip: "127.0.0.1", path: "/test" };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  test("should pass through if no url param", () => {
    validateUrl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should accept youtube.com/watch URLs", () => {
    req.query.url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    validateUrl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should accept youtu.be short URLs", () => {
    req.query.url = "https://youtu.be/dQw4w9WgXcQ";
    validateUrl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should accept youtube.com/shorts URLs", () => {
    req.query.url = "https://www.youtube.com/shorts/abc123";
    validateUrl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should accept youtube.com/live URLs", () => {
    req.query.url = "https://www.youtube.com/live/abc123";
    validateUrl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should accept mobile youtube URLs", () => {
    req.query.url = "https://m.youtube.com/watch?v=dQw4w9WgXcQ";
    validateUrl(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test("should reject non-YouTube URLs", () => {
    req.query.url = "https://www.vimeo.com/video/12345";
    validateUrl(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject random strings", () => {
    req.query.url = "not-a-url";
    validateUrl(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should reject non-string url", () => {
    req.query.url = 12345;
    validateUrl(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("should handle array url (take first)", () => {
    req.query.url = ["https://www.youtube.com/watch?v=test", "second"];
    validateUrl(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
