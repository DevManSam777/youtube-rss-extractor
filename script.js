// ---------------------------------------------------------------------------
// Fetching pages through CORS proxies
// ---------------------------------------------------------------------------

const PROXY_TIMEOUT = 8000;

async function fetchWithTimeout(url, ms = PROXY_TIMEOUT, headers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        return await fetch(url, headers ? { signal: controller.signal, headers } : { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// allorigins' /get endpoint sometimes returns the page as a data: URI
function decodeContents(contents) {
    if (typeof contents !== 'string' || !contents) throw new Error('empty response');
    if (!contents.startsWith('data:')) return contents;
    const comma = contents.indexOf(',');
    const body = contents.substring(comma + 1);
    if (contents.substring(5, comma).includes('base64')) {
        return new TextDecoder().decode(Uint8Array.from(atob(body), c => c.charCodeAt(0)));
    }
    return decodeURIComponent(body);
}

// Each proxy resolves with the page's HTML, or throws
const PROXIES = [
    {
        name: 'allorigins',
        get: async (url) => {
            const r = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        }
    },
    {
        // Reader service: asked for raw HTML so the page's own tags are intact
        name: 'jina-html',
        get: async (url) => {
            const r = await fetchWithTimeout(`https://r.jina.ai/${url}`, 12000, { 'X-Return-Format': 'html' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        }
    },
    {
        // Same service, default markdown output (no custom header, so no CORS preflight)
        name: 'jina',
        get: async (url) => {
            const r = await fetchWithTimeout(`https://r.jina.ai/${url}`, 12000);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        }
    },
    {
        name: 'thingproxy',
        get: async (url) => {
            const r = await fetchWithTimeout(`https://thingproxy.freeboard.io/fetch/${url}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        }
    },
    {
        name: 'yacdn',
        get: async (url) => {
            const r = await fetchWithTimeout(`https://yacdn.org/proxy/${url}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.text();
        }
    },
    {
        name: 'allorigins-json',
        get: async (url) => {
            const r = await fetchWithTimeout(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return decodeContents((await r.json()).contents);
        }
    }
];

// Asks every route at once; the first one that yields a channel ID wins
async function findChannelId(pageUrl, extract, label) {
    const errors = [];
    const attempts = PROXIES.map(async (proxy) => {
        try {
            const html = await proxy.get(pageUrl);
            const id = extract(html);
            if (!id) throw new Error('page loaded but no channel ID found');
            return id;
        } catch (e) {
            const reason = e.name === 'AbortError' ? 'timed out' : (e.message || 'blocked or unreachable');
            errors.push(`${proxy.name}: ${reason}`);
            throw e;
        }
    });
    try {
        return await Promise.any(attempts);
    } catch (e) {
        console.warn(`Channel lookup failed for ${label} (${pageUrl})\n  ` + errors.join('\n  '));
        throw new Error(`Could not find a channel ID for ${label}. ${errors.join('; ')}`);
    }
}

// ---------------------------------------------------------------------------
// Lookup via the YouTube operational API (a key-free mirror of Google's Data API).
// Resolves handles / usernames / videos to a channel ID without scraping pages.
// ---------------------------------------------------------------------------

const OPERATIONAL_API = 'https://yt.lemnoslife.com/noKey';

async function operationalApiGet(path) {
    const r = await fetchWithTimeout(`${OPERATIONAL_API}/${path}`, 10000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

function checkId(id) {
    if (!/^UC[a-zA-Z0-9_-]{22}$/.test(id || '')) throw new Error('no channel returned');
    return id;
}

async function idFromHandleApi(handle) {
    const j = await operationalApiGet(`channels?part=id&forHandle=${encodeURIComponent('@' + handle.replace(/^@/, ''))}`);
    return checkId(j.items && j.items[0] && j.items[0].id);
}

async function idFromUsernameApi(name) {
    const j = await operationalApiGet(`channels?part=id&forUsername=${encodeURIComponent(name)}`);
    return checkId(j.items && j.items[0] && j.items[0].id);
}

async function idFromVideoApi(videoId) {
    const j = await operationalApiGet(`videos?part=snippet&id=${encodeURIComponent(videoId)}`);
    return checkId(j.items && j.items[0] && j.items[0].snippet && j.items[0].snippet.channelId);
}

// First success wins; if everything fails, the error lists every reason
async function anyOf(attempts, label) {
    const errors = [];
    const wrapped = attempts.map(async ([name, fn]) => {
        try {
            return await fn();
        } catch (e) {
            errors.push(`${name}: ${e.name === 'AbortError' ? 'timed out' : (e.message || 'blocked or unreachable')}`);
            throw e;
        }
    });
    try {
        return await Promise.any(wrapped);
    } catch (e) {
        console.warn(`Channel lookup failed for ${label}\n  ` + errors.join('\n  '));
        throw new Error(`Could not find a channel ID for ${label}. ${errors.join('; ')}`);
    }
}

// ---------------------------------------------------------------------------
// Pulling the channel ID out of HTML
// ---------------------------------------------------------------------------

const CHANNEL_ID = '(UC[a-zA-Z0-9_-]{22})';

// Channel pages: check the page's own <link>/<meta> tags first (precise), loose JSON last
function extractFromChannelPage(html) {
    const tags = html.match(/<(?:link|meta)\b[^>]*>/gi) || [];
    const find = (test, re) => {
        for (const tag of tags) {
            if (test(tag)) {
                const m = tag.match(re);
                if (m) return m[1];
            }
        }
        return null;
    };

    return (
        // <link rel="alternate" type="application/rss+xml" href=".../videos.xml?channel_id=UC...">
        find(t => /application\/rss\+xml/i.test(t), new RegExp(`channel_id=${CHANNEL_ID}`)) ||
        find(t => /rel=["']canonical["']/i.test(t), new RegExp(`/channel/${CHANNEL_ID}`)) ||
        find(t => /property=["']og:url["']/i.test(t), new RegExp(`/channel/${CHANNEL_ID}`)) ||
        find(t => /itemprop=["']channelId["']/i.test(t), new RegExp(`content=["']${CHANNEL_ID}`)) ||
        (html.match(new RegExp(`feeds/videos\\.xml\\?channel_id=${CHANNEL_ID}`)) || [])[1] ||
        (html.match(new RegExp(`"externalId":"${CHANNEL_ID}"`)) || [])[1] ||
        (html.match(new RegExp(`"webChannelUrl":"https:\\\\?/\\\\?/www\\.youtube\\.com\\\\?/channel\\\\?/${CHANNEL_ID}"`)) || [])[1] ||
        (html.match(new RegExp(`"channelId":"${CHANNEL_ID}"`)) || [])[1] ||
        null
    );
}

// Video pages: the channel that owns THIS video
function extractFromVideoPage(html) {
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
        if (/itemprop=["']channelId["']/i.test(tag)) {
            const m = tag.match(new RegExp(`content=["']${CHANNEL_ID}`));
            if (m) return m[1];
        }
    }
    return (
        (html.match(new RegExp(`"externalChannelId":"${CHANNEL_ID}"`)) || [])[1] ||
        (html.match(new RegExp(`"channelId":"${CHANNEL_ID}"`)) || [])[1] ||
        null
    );
}

// ---------------------------------------------------------------------------
// Turning user input into a channel / playlist ID
// ---------------------------------------------------------------------------

function setLoadingText(text) {
    const el = document.getElementById('loadingText');
    if (el) el.textContent = text;
}

// kind: 'handle' -> /@name, 'c' -> /c/name, 'user' -> /user/name
async function getChannelIdFromName(name, kind = 'handle') {
    name = name.replace(/^@/, '');
    const path = { handle: '@', c: 'c/', user: 'user/' }[kind] || '@';
    const label = kind === 'handle' ? `@${name}` : `${kind}/${name}`;
    setLoadingText('Extracting channel ID...');

    const attempts = [];
    if (kind === 'handle') attempts.push(['yt-api', () => idFromHandleApi(name)]);
    if (kind === 'user') attempts.push(['yt-api', () => idFromUsernameApi(name)]);
    attempts.push(['page-scrape', () => findChannelId(
        `https://www.youtube.com/${path}${encodeURIComponent(name)}`, extractFromChannelPage, label)]);
    return anyOf(attempts, label);
}

async function getChannelIdFromVideo(videoId) {
    setLoadingText('Getting channel from video...');
    return anyOf([
        ['yt-api', () => idFromVideoApi(videoId)],
        ['page-scrape', () => findChannelId(
            `https://www.youtube.com/watch?v=${videoId}`, extractFromVideoPage, `video ${videoId}`)]
    ], `video ${videoId}`);
}

async function parseYouTubeUrl(input) {
    // Direct channel ID
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(input)) return { type: 'channel', id: input };

    // Direct playlist ID (PL = playlist, UU = channel uploads, OL/FL = other lists)
    if (/^(PL|UU|OL|FL)[a-zA-Z0-9_-]{10,}$/.test(input)) return { type: 'playlist', id: input };

    // Channel URL with ID
    let match = input.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/);
    if (match) return { type: 'channel', id: match[1] };

    // Playlist URL
    match = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return { type: 'playlist', id: match[1] };

    // @handle in a URL (with or without /videos, /podcasts, etc.)
    match = input.match(/youtube\.com\/@([^/?#\s]+)/);
    if (match) return { type: 'channel', id: await getChannelIdFromName(decodeURIComponent(match[1]), 'handle') };

    // Custom channel URL: /c/name
    match = input.match(/youtube\.com\/c\/([^/?#\s]+)/);
    if (match) return { type: 'channel', id: await getChannelIdFromName(decodeURIComponent(match[1]), 'c') };

    // Legacy user URL: /user/name
    match = input.match(/youtube\.com\/user\/([^/?#\s]+)/);
    if (match) return { type: 'channel', id: await getChannelIdFromName(decodeURIComponent(match[1]), 'user') };

    // Just a handle
    if (input.startsWith('@')) {
        return { type: 'channel', id: await getChannelIdFromName(input, 'handle') };
    }

    // Video URLs: watch?v=, youtu.be/, /shorts/, /live/, /embed/
    match = input.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
    if (match) return { type: 'channel', id: await getChannelIdFromVideo(match[1]) };

    // Fallback: treat the input as a handle
    setLoadingText('Trying to find channel...');
    return { type: 'channel', id: await getChannelIdFromName(input, 'handle') };
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

async function getRSS() {
    const input = document.getElementById('input').value.trim();
    const resultDiv = document.getElementById('result');
    const loadingDiv = document.getElementById('loading');
    const mainBtn = document.getElementById('mainBtn');

    if (!input) {
        alert('Please paste a YouTube URL');
        return;
    }

    resultDiv.classList.add('hidden');
    loadingDiv.classList.remove('hidden');
    mainBtn.disabled = true;
    setLoadingText('Analyzing URL...');

    try {
        const result = await parseYouTubeUrl(input);
        const param = result.type === 'playlist' ? 'playlist_id' : 'channel_id';
        showResult(`https://www.youtube.com/feeds/videos.xml?${param}=${result.id}`);
    } catch (error) {
        hideLoading();
        alert('Error: ' + error.message);
    }
}

function showResult(rssUrl) {
    const resultDiv = document.getElementById('result');
    document.getElementById('rssOutput').value = rssUrl;
    document.getElementById('loading').classList.add('hidden');
    resultDiv.classList.remove('hidden');
    document.getElementById('mainBtn').disabled = false;
    resultDiv.scrollIntoView({ behavior: 'smooth' });
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('mainBtn').disabled = false;
}

function copyURL(btn) {
    btn = btn || (window.event && window.event.target);
    const output = document.getElementById('rssOutput');
    output.select();
    output.setSelectionRange(0, 99999);

    const done = () => {
        if (!btn) return;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = originalText; }, 2000);
    };

    navigator.clipboard.writeText(output.value).then(done).catch(() => {
        document.execCommand('copy'); // older browsers
        done();
    });
}

function tryExample(input) {
    document.getElementById('input').value = input;
    getRSS();
}

document.getElementById('input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') getRSS();
});