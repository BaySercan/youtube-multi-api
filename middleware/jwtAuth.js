const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// Read public key once at startup instead of on every request
let publicKey;
try {
  publicKey = fs.readFileSync(
    path.join(__dirname, "../keys/public.key"),
    "utf8"
  );
} catch (err) {
  logger.error("Failed to load JWT public key at startup", { error: err.message });
}

module.exports = (req, res, next) => {
  // Skip authentication for /ping and /test-token endpoints
  if (req.path === "/ping" || req.path === "/test-token") return next();

  if (!publicKey) {
    logger.error("JWT public key not available");
    return res.status(500).json({ error: "Authentication system unavailable" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logger.authWarn("Missing or invalid authorization header", {
      path: req.path,
      ip: req.ip,
    });
    return res
      .status(401)
      .json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verify token with cached public key
    const decoded = jwt.verify(token, publicKey);
    req.user = decoded;
    logger.auth("JWT authenticated", {
      path: req.path,
      userId: decoded.userId || decoded.sub,
    });
    next();
  } catch (error) {
    logger.authWarn("JWT verification failed", {
      path: req.path,
      error: error.message,
    });
    return res.status(403).json({ error: "Invalid token" });
  }
};
