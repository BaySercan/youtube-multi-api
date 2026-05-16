# YouTube Multi API Documentation

> **Version:** 2.2.0  
> **Base URL:** `https://youtube-multi-api.p.rapidapi.com`

A powerful REST API for downloading YouTube videos as MP3/MP4 files and extracting AI-cleaned video transcripts.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
  - [Health Check](#get-ping)
  - [Video Information](#get-info)
  - [Download MP3](#get-mp3)
  - [Download MP4](#get-mp4)
  - [Get Transcript](#get-transcript)
  - [Check Progress](#get-progressid)
  - [Get Result](#get-resultid)
  - [Cancel Process](#post-cancelid)
  - [Token Exchange](#post-authexchange-token)
- [Error Handling](#error-handling)
- [Rate Limiting](#rate-limiting)
- [Code Examples](#code-examples)

---

## Quick Start

1. **Subscribe** to the API on RapidAPI
2. **Get your API key** from the RapidAPI dashboard
3. **Make your first request:**

```bash
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ' \
  --header 'x-rapidapi-host: your-api-host.rapidapi.com' \
  --header 'x-rapidapi-key: YOUR_RAPIDAPI_KEY'
```

---

## Authentication

### RapidAPI Authentication

All requests must include the following headers:

| Header            | Description                       |
| ----------------- | --------------------------------- |
| `x-rapidapi-key`  | Your RapidAPI subscription key    |
| `x-rapidapi-host` | The API host provided by RapidAPI |

### JWT Authentication (Alternative)

For direct API access without RapidAPI:

```
Authorization: Bearer <your_jwt_token>
```

#### Token Exchange (for Supabase users)

Exchange a Supabase access token for an API JWT:

```bash
curl --request POST \
  --url 'https://youtube-multi-api.p.rapidapi.com/auth/exchange-token' \
  --header 'Content-Type: application/json' \
  --data '{"supabaseAccessToken": "your_supabase_token"}'
```

---

## Endpoints

### GET /ping

Health check endpoint. **No authentication required.**

#### Response

```json
{
  "status": "OK",
  "version": "2.2.0",
  "uptime": "5h 12m 30s",
  "memory": {
    "rss": "55.20 MB",
    "heapTotal": "38.50 MB",
    "heapUsed": "28.10 MB"
  },
  "queues": {
    "mp3": { "size": 0, "pending": 0 },
    "mp4": { "size": 0, "pending": 0 },
    "transcript": { "size": 0, "pending": 0 }
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### GET /info

Retrieve metadata about a YouTube video. Video metadata is cached for 10 minutes to improve speed.

#### Query Parameters

| Parameter | Type   | Required | Default | Description                                                  |
| --------- | ------ | -------- | ------- | ------------------------------------------------------------ |
| `url`     | string | ✅ Yes   | -       | YouTube video URL                                            |
| `type`    | string | No       | `sum`   | Response type: `sum` (summary) or `full` (complete metadata) |

#### Response (type=sum)

```json
{
  "video_id": "dQw4w9WgXcQ",
  "title": "Rick Astley - Never Gonna Give You Up",
  "channel_name": "Rick Astley",
  "channel_id": "UCuAXFkgsw1L7xaCfnd5JJOw",
  "channel_url": "https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
  "channel_follower_count": 4500000,
  "description": "The official video for...",
  "duration": 212,
  "duration_string": "3:32",
  "view_count": 1500000000,
  "like_count": 15000000,
  "comment_count": 2500000,
  "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
  "post_date": "2009-10-25T00:00:00.000Z",
  "upload_date_raw": "20091025",
  "language": "en",
  "categories": ["Music"],
  "tags": ["rick astley", "never gonna give you up"],
  "availability": null,
  "playable_in_embed": true,
  "was_live": false,
  "automatic_captions": {"en": [...], "es": [...]},
  "last_requested": "2024-01-15T10:30:00.000Z",
  "info_type": "sum"
}
```

#### Example

```bash
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&type=sum' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST'
```

---

### GET /mp3

Download YouTube video as MP3 audio file.

#### Query Parameters

| Parameter | Type   | Required | Description       |
| --------- | ------ | -------- | ----------------- |
| `url`     | string | ✅ Yes   | YouTube video URL |

#### Response Headers

| Header                | Description                         |
| --------------------- | ----------------------------------- |
| `X-Processing-Id`     | Unique ID for tracking/cancellation |
| `X-Video-Id`          | YouTube video ID                    |
| `X-Video-Title`       | Video title                         |
| `Content-Disposition` | Download filename                   |
| `Content-Type`        | `audio/mpeg`                        |

#### Response

Returns MP3 audio stream directly. Requests are internally managed in a queue to prevent timeouts.

#### Example

```bash
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/mp3?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST' \
  --output song.mp3
```

---

### GET /mp4

Download YouTube video as MP4 video file.

#### Query Parameters

| Parameter | Type   | Required | Description       |
| --------- | ------ | -------- | ----------------- |
| `url`     | string | ✅ Yes   | YouTube video URL |

#### Response Headers

| Header                | Description                         |
| --------------------- | ----------------------------------- |
| `X-Processing-Id`     | Unique ID for tracking/cancellation |
| `X-Video-Id`          | YouTube video ID                    |
| `X-Video-Title`       | Video title                         |
| `Content-Disposition` | Download filename                   |
| `Content-Type`        | `video/mp4`                         |

#### Response

Returns MP4 video stream directly.

#### Example

```bash
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/mp4?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST' \
  --output video.mp4
```

---

### GET /transcript

Extract and optionally AI-clean YouTube video transcript.

> ⚡ **Asynchronous Endpoint**: Returns immediately with a processing ID. Poll `/progress/:id` and `/result/:id` to get results.

#### Query Parameters

| Parameter     | Type    | Required | Default    | Description                                                                 |
| ------------- | ------- | -------- | ---------- | --------------------------------------------------------------------------- |
| `url`         | string  | ✅ Yes   | -             | YouTube video URL                                                           |
| `lang`        | string  | No       | `Auto-detect` | Requested language code (e.g. `es`). System will auto-translate using AI if natively unavailable. |
| `quality`     | string  | No       | `standard`    | AI cleaning level (`fast`-no AI, `standard` -1 pass AI, `thorough`- 2 pass) |
| `useDeepSeek` | boolean | No       | `true`        | Use DeepSeek AI model (otherwise uses Qwen)                                 |

#### Response (202 Accepted)

```json
{
  "processingId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "message": "Processing started. Use /progress and /result endpoints to track and retrieve results.",
  "progressEndpoint": "/progress/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "resultEndpoint": "/result/a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

#### Example

```bash
# Step 1: Initiate transcript processing
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/transcript?url=https://www.youtube.com/watch?v=VIDEO_ID&lang=en&quality=standard' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST'

# Step 2: Poll progress (see /progress/:id)
# Step 3: Get result (see /result/:id)
```

---

### GET /progress/:id

Check the progress of an asynchronous operation.

#### Path Parameters

| Parameter | Type   | Required | Description                        |
| --------- | ------ | -------- | ---------------------------------- |
| `id`      | string | ✅ Yes   | Processing ID from initial request |

#### Response

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "Processing transcript with AI ...",
  "progress": 40,
  "video_id": "dQw4w9WgXcQ",
  "video_title": "Rick Astley - Never Gonna Give You Up",
  "createdAt": 1705312200000,
  "lastUpdated": 1705312205000
}
```

#### Status Values

| Status       | Description                 |
| ------------ | --------------------------- |
| `queued`     | Waiting in processing queue |
| `processing` | Currently being processed   |
| `completed`  | Successfully completed      |
| `failed`     | Processing failed           |
| `canceled`   | Canceled by user            |

---

### GET /result/:id

Retrieve the result of a completed asynchronous operation.

#### Path Parameters

| Parameter | Type   | Required | Description                        |
| --------- | ------ | -------- | ---------------------------------- |
| `id`      | string | ✅ Yes   | Processing ID from initial request |

#### Response (200 OK - Completed)

```json
{
  "success": true,
  "title": "Video Title",
  "language": "en",
  "quality": "standard",
  "transcript": "The cleaned and formatted transcript text...",
  "isProcessed": true,
  "processor": "deepseek",
  "video_id": "dQw4w9WgXcQ",
  "channel_id": "UCuAXFkgsw1L7xaCfnd5JJOw",
  "channel_name": "Channel Name",
  "post_date": "2024-01-15T00:00:00.000Z",
  "last_requested": "2024-01-15T10:30:00.000Z"
}
```

#### Response (202 Accepted - Still Processing)

```json
{
  "message": "Processing not complete",
  "status": "Processing transcript with AI ...",
  "progress": 75
}
```

---

### POST /cancel/:id

Cancel a running process.

#### Path Parameters

| Parameter | Type   | Required | Description             |
| --------- | ------ | -------- | ----------------------- |
| `id`      | string | ✅ Yes   | Processing ID to cancel |

#### Response (200 OK)

```json
{
  "message": "Process canceled successfully",
  "video_id": "dQw4w9WgXcQ",
  "video_title": "Video Title",
  "queue_position": "Was #3 in queue",
  "cleaned_files": 2
}
```

#### Example

```bash
curl --request POST \
  --url 'https://youtube-multi-api.p.rapidapi.com/cancel/a1b2c3d4-e5f6-7890-abcd-ef1234567890' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST'
```

---

### POST /auth/exchange-token

Exchange a Supabase access token for an API JWT token.

> ⚠️ **Note**: This endpoint is for direct API integration, not RapidAPI usage.

#### Request Body

```json
{
  "supabaseAccessToken": "your_supabase_access_token"
}
```

#### Response

```json
{
  "apiToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

---

## Error Handling

### Error Response Format

For standard API errors:

```json
{
  "error": "Error message describing what went wrong"
}
```

For video-level failures (private, unavailable, live events, etc.):

```json
{
  "success": false,
  "error": "VIDEO_UNAVAILABLE: Private video."
}
```

### HTTP Status Codes

| Code  | Description                                                                         |
| ----- | ----------------------------------------------------------------------------------- |
| `200` | Success **or** video-level failure (check `success` field in response body)         |
| `202` | Accepted (asynchronous processing started)                                          |
| `400` | Bad Request — invalid or missing parameters (e.g. no `url` provided)               |
| `401` | Unauthorized — invalid or missing authentication                                    |
| `404` | Not Found — resource or processing ID not found                                     |
| `500` | Internal Server Error                                                               |

> ⚠️ **Important:** The `/transcript` endpoint returns **HTTP 200** even when a video cannot be processed (private, removed, upcoming live event, members-only, age-restricted). Always check the `success` field in the response body — `true` means processing started, `false` means the video is inherently unavailable.

### Common Errors

| Error                           | HTTP | Cause                                   | Solution                                                            |
| ------------------------------- | ---- | --------------------------------------- | ------------------------------------------------------------------- |
| `Missing url parameter`         | 400  | URL not provided                        | Include `url` query parameter                                       |
| `Processing ID not found`       | 404  | Invalid or expired ID                   | Use a valid processing ID                                           |
| `VIDEO_UNAVAILABLE: Private...` | 200  | Video is private or members-only        | Use a publicly accessible video                                     |
| `VIDEO_UNAVAILABLE: Video...`   | 200  | Video removed or region-blocked         | Use a different video                                               |
| `VIDEO_UNAVAILABLE: live event` | 200  | Scheduled live stream not yet started   | Wait for the live event to start and the VOD to be available        |
| `NO_CAPTIONS_AVAILABLE`         | 200  | Video has no captions at all            | See [Transcript Troubleshooting](#transcript-troubleshooting) below |
| `LANGUAGE_NOT_AVAILABLE`        | 200  | Requested language not available        | Use one of the available languages listed in the error message      |
| `Process cannot be canceled`    | 400  | Already completed                       | No action needed                                                    |

### Transcript Troubleshooting

When requesting a transcript, you may encounter these specific error types:

#### `NO_CAPTIONS_AVAILABLE`

This error indicates that the video has **absolutely no captions or subtitles** available - neither manual nor auto-generated. Common causes:

1. **Creator disabled auto-captions**: Video creators can turn off automatic caption generation in YouTube Studio
2. **Language not supported**: YouTube's speech recognition may not support the video's spoken language
3. **Poor audio quality**: Background music, multiple speakers, or low-quality audio can prevent auto-captioning
4. **Recently uploaded**: Auto-generated captions can take several hours to appear after upload
5. **Private/unlisted restrictions**: Some video settings may prevent caption extraction

> 💡 **Whisper STT Fallback**: When YouTube captions are unavailable, the API automatically attempts to transcribe the video using OpenAI's Whisper speech-to-text model (if `OPENAI_API_KEY` is configured). This incurs a cost of approximately **$0.006 per minute** of audio.
>
> **Whisper Features:**
>
> - Automatically splits long videos (>25MB audio) into 10-minute chunks
> - Processes chunks sequentially and combines transcriptions
> - Handles partial failures (if some chunks fail, successful ones are still combined)
> - Requires `ffmpeg` and `ffprobe` for audio processing

**What to try:**

- Wait and retry later if the video was recently uploaded
- Check if the video has captions when viewing directly on YouTube
- Ensure `OPENAI_API_KEY` is configured for Whisper fallback
- For long videos without captions, expect longer processing times due to chunked transcription

#### `LANGUAGE_NOT_AVAILABLE`

This error means captions exist, but not for your requested language. The error message will include a list of available languages.

**What to try:**

- Use one of the available languages listed in the error message
- If `en` is unavailable, try `en-US`, `en-GB`, or other variants
- The API automatically tries language fallbacks (e.g., `en` if `en-US` is unavailable)

---

## Rate Limiting

The API implements the following rate limits:

| Metric              | Limit      |
| ------------------- | ---------- |
| Concurrent requests | 4          |
| Requests per second | 5          |
| Request timeout     | 30 minutes |

> 💡 **Tip**: For high-volume usage, use the asynchronous endpoints (`/transcript`) and poll for results.

---

## Code Examples

### JavaScript (Node.js)

```javascript
const axios = require("axios");

const API_KEY = "YOUR_RAPIDAPI_KEY";
const API_HOST = "your-api-host.rapidapi.com";

// Get video info
async function getVideoInfo(videoUrl) {
  const response = await axios.get(
    "https://youtube-multi-api.p.rapidapi.com/info",
    {
      params: { url: videoUrl },
      headers: {
        "x-rapidapi-key": API_KEY,
        "x-rapidapi-host": API_HOST,
      },
    }
  );
  return response.data;
}

// Get transcript with polling
async function getTranscript(videoUrl, lang = "en") {
  // Start processing
  const startResponse = await axios.get(
    "https://youtube-multi-api.p.rapidapi.com/transcript",
    {
      params: { url: videoUrl, lang, quality: "standard" },
      headers: {
        "x-rapidapi-key": API_KEY,
        "x-rapidapi-host": API_HOST,
      },
    }
  );

  const { processingId } = startResponse.data;

  // Poll for completion
  while (true) {
    const progressResponse = await axios.get(
      `https://youtube-multi-api.p.rapidapi.com/progress/${processingId}`,
      { headers: { "x-rapidapi-key": API_KEY, "x-rapidapi-host": API_HOST } }
    );

    if (progressResponse.data.status === "completed") {
      const resultResponse = await axios.get(
        `https://youtube-multi-api.p.rapidapi.com/result/${processingId}`,
        { headers: { "x-rapidapi-key": API_KEY, "x-rapidapi-host": API_HOST } }
      );
      return resultResponse.data;
    }

    if (progressResponse.data.status === "failed") {
      throw new Error("Transcript processing failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
```

### Python

```python
import requests
import time

API_KEY = 'YOUR_RAPIDAPI_KEY'
API_HOST = 'your-api-host.rapidapi.com'
BASE_URL = 'https://youtube-multi-api.p.rapidapi.com'

headers = {
    'x-rapidapi-key': API_KEY,
    'x-rapidapi-host': API_HOST
}

def get_video_info(video_url):
    response = requests.get(
        f'{BASE_URL}/info',
        params={'url': video_url},
        headers=headers
    )
    return response.json()

def get_transcript(video_url, lang='en'):
    # Start processing
    response = requests.get(
        f'{BASE_URL}/transcript',
        params={'url': video_url, 'lang': lang, 'quality': 'standard'},
        headers=headers
    )
    processing_id = response.json()['processingId']

    # Poll for completion
    while True:
        progress = requests.get(
            f'{BASE_URL}/progress/{processing_id}',
            headers=headers
        ).json()

        if progress['status'] == 'completed':
            result = requests.get(
                f'{BASE_URL}/result/{processing_id}',
                headers=headers
            ).json()
            return result

        if progress['status'] == 'failed':
            raise Exception('Transcript processing failed')

        time.sleep(2)

# Usage
info = get_video_info('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
print(f"Title: {info['title']}")

transcript = get_transcript('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'en')
print(f"Transcript: {transcript['transcript'][:200]}...")
```

### cURL

```bash
# Get video info
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/info?url=https://www.youtube.com/watch?v=VIDEO_ID' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST'

# Download MP3
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/mp3?url=https://www.youtube.com/watch?v=VIDEO_ID' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST' \
  --output audio.mp3

# Start transcript processing
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/transcript?url=https://www.youtube.com/watch?v=VIDEO_ID&lang=en&quality=standard' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST'

# Check progress
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/progress/PROCESSING_ID' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST'

# Get result
curl --request GET \
  --url 'https://youtube-multi-api.p.rapidapi.com/result/PROCESSING_ID' \
  --header 'x-rapidapi-key: YOUR_KEY' \
  --header 'x-rapidapi-host: YOUR_HOST'
```

---

## Important Notes

- **Persistent Cloud Storage**: Background jobs and progress data are persistently stored via Supabase postgres. Long-running jobs will securely recover and resume upon server resets. Result outputs continue to be discarded after some time.
- **Streaming**: MP3/MP4 files are streamed directly through a task queue without server storage to accommodate higher traffic concurrent downloads.
- **Video Availability**: Private, removed, upcoming live-event, members-only, and age-restricted videos **cannot be transcribed**. The API returns HTTP 200 with `{ "success": false, "error": "VIDEO_UNAVAILABLE: ..." }` immediately for these — no processing is queued. Check the `success` field before polling `/progress` or `/result`.
- **No Retries on Permanent Errors**: When a video is provably inaccessible (private, removed, etc.) the API does not retry internally. The response is immediate, keeping latency low for these cases.
- **Caption Fallback**: The API attempts multiple methods to fetch captions, including direct yt-dlp extraction.
- **Whisper STT Fallback**: When YouTube captions are unavailable and `OPENAI_API_KEY` is configured, the API uses OpenAI Whisper for speech-to-text transcription (~$0.006/min). Long videos are automatically chunked into 10-minute segments.
- **Language Fallback**: The API automatically tries language variants (`-orig` auto-captions, `en` → `en-US` → `en-GB`) when the exact requested language isn't present initially.
- **Temp File Cleanup**: The server implements multiple safeguards to ensure temporary files are cleaned up:
  1. **Startup Cleanup**: Clears any leftover temp files and stale jobs from previous runs when the server starts
  2. **Graceful Shutdown**: Handles SIGTERM/SIGINT signals to clean up in-flight jobs and temp files
  3. **Periodic Cleanup**: A cron job runs every 6 hours through Supabase to delete stale API jobs

---

## Support

For API support:

- **GitHub Issues**: [github.com/BaySercan/youtube-multi-api/issues](https://github.com/BaySercan/youtube-multi-api/issues)

---

_© 2024 YouTube Multi API. All rights reserved._
