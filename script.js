async function getRSS() {
    const input = document.getElementById('input').value.trim();
    const resultDiv = document.getElementById('result');
    const loadingDiv = document.getElementById('loading');
    const outputInput = document.getElementById('rssOutput');
    const mainBtn = document.getElementById('mainBtn');
    const loadingText = document.getElementById('loadingText');
    
    if (!input) {
        alert('Please paste a YouTube URL');
        return;
    }
    
    // Hide result and show loading
    resultDiv.classList.add('hidden');
    loadingDiv.classList.remove('hidden');
    mainBtn.disabled = true;
    loadingText.textContent = 'Analyzing URL...';
    
    try {
        const result = await parseYouTubeUrl(input);
        
        if (result.type === 'channel') {
            const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${result.id}`;
            showResult(rssUrl);
        } else if (result.type === 'playlist') {
            const rssUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${result.id}`;
            showResult(rssUrl);
        } else {
            throw new Error('Could not determine RSS feed type');
        }
        
    } catch (error) {
        hideLoading();
        alert('Error: ' + error.message);
    }
}

async function parseYouTubeUrl(input) {
    const loadingText = document.getElementById('loadingText');
    
    // Direct channel ID
    if (input.match(/^UC[a-zA-Z0-9_-]{22}$/)) {
        return { type: 'channel', id: input };
    }
    
    // Direct playlist ID
    if (input.match(/^PL[a-zA-Z0-9_-]+$/)) {
        return { type: 'playlist', id: input };
    }
    
    // Channel URL with ID
    let match = input.match(/youtube\.com\/channel\/([a-zA-Z0-9_-]{24})/);
    if (match) {
        return { type: 'channel', id: match[1] };
    }
    
    // Playlist URL
    match = input.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) {
        return { type: 'playlist', id: match[1] };
    }
    
    // Handle URLs - any format with @handle
    match = input.match(/youtube\.com\/@([a-zA-Z0-9_.-]+)(?:\/\w+)?/);
    if (match) {
        loadingText.textContent = 'Getting channel ID from handle...';
        const channelId = await getChannelIdFromHandle(match[1]);
        return { type: 'channel', id: channelId };
    }
    
    // Custom channel URLs (/c/)
    match = input.match(/youtube\.com\/c\/([a-zA-Z0-9_-]+)/);
    if (match) {
        loadingText.textContent = 'Getting channel ID from custom URL...';
        const channelId = await getChannelIdFromHandle(match[1]);
        return { type: 'channel', id: channelId };
    }
    
    // User URLs (/user/)
    match = input.match(/youtube\.com\/user\/([a-zA-Z0-9_-]+)/);
    if (match) {
        loadingText.textContent = 'Getting channel ID from username...';
        const channelId = await getChannelIdFromHandle(match[1]);
        return { type: 'channel', id: channelId };
    }
    
    // Just a handle starting with @
    if (input.startsWith('@')) {
        loadingText.textContent = 'Getting channel ID from handle...';
        const channelId = await getChannelIdFromHandle(input.substring(1));
        return { type: 'channel', id: channelId };
    }
    
    // Video URL - try to extract channel from the page
    match = input.match(/youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/);
    if (match) {
        loadingText.textContent = 'Getting channel from video...';
        const channelId = await getChannelIdFromVideo(match[1]);
        return { type: 'channel', id: channelId };
    }
    
    // Fallback - treat as handle or username
    loadingText.textContent = 'Trying to find channel...';
    const channelId = await getChannelIdFromHandle(input);
    return { type: 'channel', id: channelId };
}

async function getChannelIdFromVideo(videoId) {
    try {
        const proxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];
        
        for (let proxy of proxies) {
            try {
                const response = await fetch(proxy + encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`));
                if (response.ok) {
                    const html = await response.text();
                    const match = html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/);
                    if (match) {
                        return match[1];
                    }
                }
            } catch (e) {
                continue;
            }
        }
    } catch (e) {
        // Continue
    }
    
    throw new Error('Could not extract channel from video');
}

async function getChannelIdFromHandle(handle) {
    const loadingText = document.getElementById('loadingText');
    
    // Remove @ if present
    if (handle.startsWith('@')) {
        handle = handle.substring(1);
    }
    
    loadingText.textContent = 'Extracting channel ID...';
    
    try {
        const channelUrl = `https://www.youtube.com/@${handle}`;
        
        // Try multiple CORS proxy services
        const proxies = [
            'https://api.allorigins.win/raw?url=',
            'https://corsproxy.io/?'
        ];
        
        for (let proxy of proxies) {
            try {
                const response = await fetch(proxy + encodeURIComponent(channelUrl), {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                if (response.ok) {
                    const html = await response.text();
                    
                    // Look for channel ID in various places
                    const patterns = [
                        /"channelId":"(UC[a-zA-Z0-9_-]{22})"/,
                        /<meta itemprop="channelId" content="(UC[a-zA-Z0-9_-]{22})">/,
                        /"externalId":"(UC[a-zA-Z0-9_-]{22})"/,
                        /channel\/(UC[a-zA-Z0-9_-]{22})/
                    ];
                    
                    for (let pattern of patterns) {
                        const match = html.match(pattern);
                        if (match) {
                            return match[1];
                        }
                    }
                }
            } catch (e) {
                continue; // Try next proxy
            }
        }
    } catch (e) {
        // Continue to fallback methods
    }
    
    throw new Error(`Could not find channel ID for ${handle}`);
}

function showResult(rssUrl) {
    const resultDiv = document.getElementById('result');
    const loadingDiv = document.getElementById('loading');
    const outputInput = document.getElementById('rssOutput');
    const mainBtn = document.getElementById('mainBtn');
    
    outputInput.value = rssUrl;
    loadingDiv.classList.add('hidden');
    resultDiv.classList.remove('hidden');
    mainBtn.disabled = false;
    resultDiv.scrollIntoView({ behavior: 'smooth' });
}

function hideLoading() {
    const loadingDiv = document.getElementById('loading');
    const mainBtn = document.getElementById('mainBtn');
    
    loadingDiv.classList.add('hidden');
    mainBtn.disabled = false;
}

function copyURL() {
    const output = document.getElementById('rssOutput');
    output.select();
    output.setSelectionRange(0, 99999);
    
    navigator.clipboard.writeText(output.value).then(() => {
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    }).catch(() => {
        // Fallback for older browsers
        document.execCommand('copy');
        const btn = event.target;
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    });
}

function tryExample(input) {
    document.getElementById('input').value = input;
    getRSS();
}

// Enter key support
document.getElementById('input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        getRSS();
    }
});