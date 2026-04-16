const express = require("express");
const { promises: fs } = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");
const router = express.Router();
const logger = require("../utils/logger");
const config = require("../config");

// Initialize Supabase client
const supabaseAdmin = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
);

// Test endpoint to generate JWT token (only in development)
router.get("/test-token", (req, res) => {
  const nodeEnv = config.NODE_ENV;

  if (nodeEnv !== "development") {
    return res
      .status(404)
      .send(
        `Test token endpoint only available in development mode. Current NODE_ENV: ${nodeEnv}`,
      );
  }

  try {
    const privateKey = require("fs").readFileSync(
      path.join(config.KEYS_DIR, "private.key"),
      "utf8",
    );

    const token = jwt.sign({ userId: "test-user" }, privateKey, {
      algorithm: "RS256",
      expiresIn: config.JWT_EXPIRES_IN,
    });

    res.json({ token });
  } catch (error) {
    logger.error("Test token generation failed", { error: error.message });
    res.status(500).send("Internal server error");
  }
});

// Token exchange: Supabase access token → custom JWT
router.post("/auth/exchange-token", express.json(), async (req, res) => {
  const { supabaseAccessToken } = req.body;
  if (!supabaseAccessToken) {
    return res
      .status(400)
      .json({ error: "Missing supabaseAccessToken in request body" });
  }

  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(supabaseAccessToken);
    if (error || !user) {
      return res
        .status(401)
        .json({ error: "Invalid or expired Supabase token" });
    }

    const keyPath = path.join(config.KEYS_DIR, "private.key");
    try {
      const privateKey = await fs.readFile(keyPath, "utf8");
      const apiToken = jwt.sign(
        {
          iss: "youtube-multi-api",
          sub: user.id,
          iat: Math.floor(Date.now() / 1000),
        },
        privateKey,
        { algorithm: "RS256", expiresIn: "1h" },
      );

      res.json({
        apiToken,
        expiresIn: 3600,
      });
    } catch (error) {
      logger.error("Private key read failed", {
        keyPath,
        error: error.message,
      });
      res.status(500).json({
        error: `Could not read private key: ${error.message}`,
      });
    }
  } catch (error) {
    logger.error("Token exchange failed", { error: error.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
