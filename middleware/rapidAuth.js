const logger = require("../utils/logger");

const rapidAuth = (req, res, next) => {
  // Get RapidAPI key from either header format
  const rapidApiKey =
    req.headers["x-rapidapi-key"] || req.headers["x-rapidapi-proxy-secret"];

  // Debug-level details for troubleshooting
  logger.authDebug("RapidAPI auth check", {
    method: req.method,
    path: req.path,
    keyPresent: !!rapidApiKey,
    envSecretPresent: !!process.env.RAPIDAPI_SECRET,
  });

  // Check if RapidAPI key is present
  if (!rapidApiKey) {
    logger.authWarn("Missing RapidAPI key", { path: req.path, ip: req.ip });
    return res.status(401).json({
      error: "Missing RapidAPI authentication header",
    });
  }

  // Verify RapidAPI key against your secret
  if (rapidApiKey !== process.env.RAPIDAPI_SECRET) {
    logger.authWarn("Invalid RapidAPI key", {
      path: req.path,
      ip: req.ip,
      keyLength: rapidApiKey.length,
      expectedLength: process.env.RAPIDAPI_SECRET?.length || 0,
    });
    return res.status(401).json({
      error: "Invalid RapidAPI credentials",
    });
  }

  // If authentication successful
  logger.auth("RapidAPI authenticated", { path: req.path });
  next();
};

module.exports = rapidAuth;
