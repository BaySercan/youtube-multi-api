const { v4: uuidv4 } = require("uuid");

/**
 * Request ID middleware
 * Assigns a unique ID to each request for tracing through logs
 */
const requestIdMiddleware = (req, res, next) => {
  // Use existing request ID from headers or generate new one
  req.requestId = req.headers["x-request-id"] || uuidv4();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};

module.exports = requestIdMiddleware;
