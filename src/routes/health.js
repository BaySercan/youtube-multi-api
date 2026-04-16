const express = require("express");
const router = express.Router();
const { getQueueStats } = require("../services/jobManager");

router.get("/ping", (req, res) => {
  const queueStats = getQueueStats();
  res.status(200).json({
    status: "OK",
    timestamp: new Date().toISOString(),
    version: "2.2.0",
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + "MB",
      heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + "MB",
    },
    queue: queueStats,
  });
});

module.exports = router;
