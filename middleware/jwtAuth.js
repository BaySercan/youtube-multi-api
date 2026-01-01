const jwt = require("jsonwebtoken");
const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

module.exports = (req, res, next) => {
  // Skip authentication for /ping and /test-token endpoints
  if (req.path === "/ping" || req.path === "/test-token") return next();

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
    // Read public key
    const publicKey = fs.readFileSync(
      path.join(__dirname, "../keys/public.key"),
      "utf8"
    );

    // Verify token
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
