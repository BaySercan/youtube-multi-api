# YouTube Multi API

REST API to download YouTube videos as MP3/MP4 files and get video transcripts. Built with Node.js, Express, and yt-dlp.

## Features
- Download YouTube videos as MP3 or MP4 files
- Get video metadata (title, thumbnail, channel info)
- Generate transcripts with AI-powered cleanup
- Automatic cleanup of temporary files

## Installation
1. Clone the repository
2. Install dependencies: `npm install`
3. Create `.env` file with your OpenRouter API key:
```
OPENROUTER_API_KEY=your_api_key_here
```
4. Start the server: `npm start`

## API Endpoints

### GET /info
Get video metadata

**Query Parameters:**
- `url` (required) - YouTube video URL

**Response:**
```json
{
  "title": "Video title",
  "thumbnail": "Video thumbnail URL",
  "video_id": "YouTube video ID",
  "channel_id": "YouTube channel ID",
  "channel_name": "Channel name",
  "post_date": "Upload date (YYYYMMDD)"
}
```

### GET /mp3
Download video as MP3 file

**Query Parameters:**
- `url` (required) - YouTube video URL

**Response:** MP3 file download

### GET /mp4
Download video as MP4 file

**Query Parameters:**
- `url` (required) - YouTube video URL

**Response:** MP4 file download

### GET /transcript
Get video transcript

**Query Parameters:**
- `url` (required) - YouTube video URL
- `lang` (optional) - Language code (default: 'tr')
- `skipAI` (optional) - Skip AI processing (default: false)
- `useDeepSeek` (optional) - Use DeepSeek model (default: true)

**Response:**
```json
{
  "success": true,
  "title": "Video title",
  "language": "tr",
  "transcript": "Cleaned transcript text",
  "ai_notes": "Optional AI processing notes",
  "isProcessed": true,
  "processor": "deepseek",
  "video_id": "YouTube video ID",
  "channel_id": "YouTube channel ID",
  "channel_name": "Channel name",
  "post_date": "Upload date (YYYYMMDD)"
}
```

## Example Usage
```bash
# Get video info
curl "http://localhost:3500/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Download MP3
curl -O "http://localhost:3500/mp3?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Get transcript
curl "http://localhost:3500/transcript?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## Dependencies
- express
- cors
- youtube-dl-exec
- dotenv
- node-fetch
- axios
