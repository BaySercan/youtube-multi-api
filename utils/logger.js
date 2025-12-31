const winston = require("winston");
require("winston-daily-rotate-file");
const path = require("path");

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  debug: "blue",
};

winston.addColors(colors);

// Determine log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || "development";
  return env === "development" ? "debug" : "info";
};

// Custom format for console output (development)
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, requestId, ...meta }) => {
    const reqId = requestId ? `[${requestId}]` : "";
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level} ${reqId} ${message}${metaStr}`;
  })
);

// JSON format for production/file logging
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Define transports
const transports = [
  // Console transport - always enabled
  new winston.transports.Console({
    format: process.env.NODE_ENV === "production" ? jsonFormat : consoleFormat,
  }),
];

// Add file transports only if LOG_TO_FILE is enabled
if (process.env.LOG_TO_FILE === "true") {
  const logsDir = path.join(process.cwd(), "logs");

  // Daily rotating error log
  transports.push(
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      level: "error",
      maxSize: "20m",
      maxFiles: "14d",
      format: jsonFormat,
    })
  );

  // Daily rotating combined log
  transports.push(
    new winston.transports.DailyRotateFile({
      filename: path.join(logsDir, "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      maxSize: "20m",
      maxFiles: "7d",
      format: jsonFormat,
    })
  );
}

// Create the logger instance
const logger = winston.createLogger({
  level: level(),
  levels,
  transports,
});

// Helper methods for structured logging
logger.request = (req, message, meta = {}) => {
  logger.http(message, {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    ...meta,
  });
};

logger.job = (processingId, message, meta = {}) => {
  logger.info(message, {
    processingId,
    ...meta,
  });
};

logger.jobError = (processingId, message, error, meta = {}) => {
  logger.error(message, {
    processingId,
    error: error.message,
    stack: error.stack,
    ...meta,
  });
};

logger.ai = (message, meta = {}) => {
  logger.info(`[AI] ${message}`, meta);
};

logger.ytdlp = (message, meta = {}) => {
  logger.debug(`[yt-dlp] ${message}`, meta);
};

module.exports = logger;
