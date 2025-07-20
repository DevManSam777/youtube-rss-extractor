# YouTube RSS Extractor

![image of youtube rss extractor](youtube-rss-extractor.png)

A simple web tool that converts any YouTube URL into an RSS feed. Paste any YouTube channel, playlist, or video URL and get the corresponding RSS feed automatically.

## Features

- **Universal URL Support**: Works with channel URLs, @handles, playlist URLs, and video URLs
- **Automatic Conversion**: Converts @handles to channel IDs using web scraping
- **No API Keys Required**: Client-side only, no backend or authentication needed
- **RSS Feed Generation**: Creates proper RSS feed URLs for channels and playlists
- **Copy to Clipboard**: One-click copying of generated RSS URLs
- **Mobile Responsive**: Works on all devices

## Supported URL Formats

- Channel handles: `@mkbhd`, `@veritasium`
- Channel URLs: `youtube.com/@channel/podcasts`, `youtube.com/c/channelname`
- Channel IDs: `UCBJycsmduvYEL83R_U4JriQ`
- Playlist URLs: `youtube.com/playlist?list=PLxxxxx`
- Video URLs: `youtube.com/watch?v=xxxxxx` (extracts channel)

## How It Works

1. **URL Analysis**: Parses the input to determine if it's a channel, playlist, or video URL
2. **Handle Resolution**: For @handles, scrapes the YouTube page to extract the channel ID
3. **RSS Generation**: Creates the appropriate RSS feed URL using YouTube's feed endpoints
4. **CORS Handling**: Uses proxy services to bypass browser CORS restrictions


### Channel ID Extraction

For @handles and custom URLs, the tool uses web scraping to find the channel ID:

```javascript
// Uses CORS proxies to fetch YouTube pages
const proxies = [
  "https://api.allorigins.win/raw?url=",
  "https://corsproxy.io/?",
];

// Searches HTML for channel ID patterns
const patterns = [
  /"channelId":"(UC[a-zA-Z0-9_-]{22})"/,
  /<meta itemprop="channelId" content="(UC[a-zA-Z0-9_-]{22})">/,
];
```

### RSS Feed Endpoints

- **Channels**: `https://www.youtube.com/feeds/videos.xml?channel_id=UC...`
- **Playlists**: `https://www.youtube.com/feeds/videos.xml?playlist_id=PL...`

## Usage

1. Open the web application
2. Paste any YouTube URL into the input field
3. Click "Get RSS Feed"
4. Copy the generated RSS feed URL
5. Add the RSS URL to your feed reader

**_Want to make a scrolling ticker for your frontend project?_**

- https://github.com/DevManSam777/rss-ticker

## License

![LICENSE](LICENSE)
