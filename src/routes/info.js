const express = require("express");
const router = express.Router();
const path = require("path");
const { promises: fs } = require("fs");
const logger = require("../utils/logger");
const { getVideoInfo, validateCookiesFile } = require("../services/ytdlp");

router.get("/info", async (req, res) => {
  const { url, type = "sum" } = req.query;
  if (!url) return res.status(400).send("Missing url parameter");

  try {
    const info = await getVideoInfo(Array.isArray(url) ? url[0] : url);
    const lastRequested = new Date().toISOString();

    if (type === "full") {
      const fullInfo = {
        ...info,
        last_requested: lastRequested,
        info_type: "full",
      };
      res.send(fullInfo);
    } else {
      const summaryInfo = {
        availability: info.availability,
        automatic_captions: info.automatic_captions,
        categories: info.categories,
        channel_name: info.channel,
        channel_follower_count: info.channel_follower_count,
        channel_id: info.channel_id,
        channel_url: info.channel_url,
        comment_count: info.comment_count,
        description: info.description,
        display_id: info.display_id,
        duration: info.duration,
        duration_string: info.duration_string,
        filesize_approx: info.filesize_approx,
        fulltitle: info.fulltitle,
        language: info.language,
        license: info.license,
        like_count: info.like_count,
        original_url: info.original_url,
        playable_in_embed: info.playable_in_embed,
        tags: info.tags,
        thumbnail: info.thumbnail,
        timestamp: info.timestamp,
        title: info.title,
        post_date: new Date(
          `${info.upload_date.substring(0, 4)}-${info.upload_date.substring(
            4,
            6,
          )}-${info.upload_date.substring(6, 8)}`,
        ).toISOString(),
        upload_date_raw: info.upload_date,
        uploader: info.uploader,
        uploader_id: info.uploader_id,
        uploader_url: info.uploader_url,
        view_count: info.view_count,
        video_id: info.id,
        was_live: info.was_live,
        last_requested: lastRequested,
        info_type: "sum",
      };
      res.send(summaryInfo);
    }
  } catch (error) {
    logger.error("Info endpoint error", { url, error: error.message });
    res.status(400).send("Invalid url or error fetching video info");
  }
});

router.get("/validate-cookies", async (req, res) => {
  try {
    const cookiesPath = require("../config").COOKIES_PATH;
    const exists = await fs
      .access(cookiesPath)
      .then(() => true)
      .catch(() => false);
    if (!exists)
      return res
        .status(404)
        .json({ valid: false, message: "cookies.txt not found" });
    const content = await fs.readFile(cookiesPath, "utf8");
    const youtubeCookies = content.includes(".youtube.com");
    const authCookies =
      content.includes("LOGIN_INFO") && content.includes("SID");
    const isValid = youtubeCookies && authCookies;
    res.json({
      valid: isValid,
      message: isValid
        ? "Valid cookies found"
        : "Missing required YouTube cookies",
    });
  } catch (error) {
    res.status(500).json({ valid: false, error: error.message });
  }
});

module.exports = router;
