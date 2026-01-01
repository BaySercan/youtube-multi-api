const jwtAuth = require("./jwtAuth");
const rapidAuth = require("./rapidAuth");
const logger = require("../utils/logger");

const authRouter = (req, res, next) => {
  // Log incoming auth request at debug level
  logger.authDebug("Auth request received", {
    method: req.method,
    path: req.path,
    ip: req.ip,
    hasRapidKey: !!req.headers["x-rapidapi-key"],
    hasProxySecret: !!req.headers["x-rapidapi-proxy-secret"],
    hasJwt: !!req.headers["authorization"],
  });

  // List of paths that don't require authentication
  const publicPaths = ["/ping", "/test-token", "/auth/exchange-token"];

  // Skip authentication for public paths
  if (publicPaths.includes(req.path)) {
    logger.auth("Public path accessed", { path: req.path });
    return next();
  }

  // Get authentication headers
  const rapidApiKey =
    req.headers["x-rapidapi-key"] || req.headers["x-rapidapi-proxy-secret"];
  const hasJwtToken = !!req.headers["authorization"];

  // Prevent mixed authentication
  if (rapidApiKey && hasJwtToken) {
    logger.authWarn("Mixed authentication attempt", {
      path: req.path,
      ip: req.ip,
    });
    return res.status(400).json({
      error:
        "Mixed authentication not allowed. Use either RapidAPI key or JWT token, not both.",
    });
  }

  if (rapidApiKey) {
    logger.authDebug("Processing RapidAPI authentication");
    return rapidAuth(req, res, next);
  } else if (hasJwtToken) {
    logger.authDebug("Processing JWT authentication");
    return jwtAuth(req, res, next);
  } else {
    logger.authWarn("No authentication provided", {
      path: req.path,
      ip: req.ip,
    });
    return res.status(401).json({
      error:
        "Authentication required. Please provide either RapidAPI key or JWT token.",
    });
  }
};

module.exports = authRouter;
