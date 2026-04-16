const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const logger = require("./utils/logger");

// Middleware
const authRouter = require("../middleware/authRouter");
const requestIdMiddleware = require("../middleware/requestId");
const validateUrl = require("./middleware/validateUrl");

// Routes
const healthRoutes = require("./routes/health");
const infoRoutes = require("./routes/info");
const mp3Routes = require("./routes/mp3");
const mp4Routes = require("./routes/mp4");
const transcriptRoutes = require("./routes/transcript");
const progressRoutes = require("./routes/progress");
const cancelRoutes = require("./routes/cancel");
const authRoutes = require("./routes/auth");

const app = express();

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled because we serve API responses, not HTML
  crossOriginEmbedderPolicy: false,
}));

app.use(cors());

// Request ID middleware
app.use(requestIdMiddleware);

// Request logging middleware
app.use((req, res, next) => {
  logger.http("Incoming request", {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
  next();
});

// Authentication (applies to all routes — public paths are handled inside authRouter)
app.use(authRouter);

// URL validation for routes that accept YouTube URLs
app.use("/info", validateUrl);
app.use("/mp3", validateUrl);
app.use("/mp4", validateUrl);
app.use("/transcript", validateUrl);

// Mount routes
app.use(healthRoutes);
app.use(infoRoutes);
app.use(mp3Routes);
app.use(mp4Routes);
app.use(transcriptRoutes);
app.use(progressRoutes);
app.use(cancelRoutes);
app.use(authRoutes);

// Global error handler — prevents stack traces from leaking to clients
app.use((err, req, res, _next) => {
  logger.error("Unhandled route error", {
    requestId: req.requestId,
    error: err.message,
    stack: err.stack,
    path: req.path,
  });

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  });
});

module.exports = app;
