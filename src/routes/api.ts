import { Router, Request, Response } from 'express';
import YouTube from 'youtube-sr';

const router = Router();

// ─── YouTube Search ─────────────────────────────────────────
router.get('/youtube/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const results = await YouTube.search(query, { limit: 10, type: 'video' });

    const songs = results.map(video => ({
      title: video.title || 'Unknown',
      artist: video.channel?.name || 'Unknown',
      sourceId: video.id || '',
      source: 'youtube' as const,
      duration: Math.floor((video.duration || 0) / 1000),
      coverUrl: video.thumbnail?.url || '',
    }));

    res.json({ results: songs });
  } catch (err: any) {
    console.error('[YouTube Search Error]', err.message);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ─── YouTube Playlist ───────────────────────────────────────
router.get('/youtube/playlist', async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) return res.status(400).json({ error: 'Playlist URL required' });

    const playlist = await YouTube.getPlaylist(url, { limit: 100 });

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const songs = (playlist.videos || []).map(video => ({
      title: video.title || 'Unknown',
      artist: video.channel?.name || 'Unknown',
      sourceId: video.id || '',
      source: 'youtube' as const,
      duration: Math.floor((video.duration || 0) / 1000),
      coverUrl: video.thumbnail?.url || '',
      startTime: 0,
      endTime: Math.min(30, Math.floor((video.duration || 30000) / 1000)),
    }));

    res.json({
      name: playlist.title || 'Unknown Playlist',
      songCount: songs.length,
      songs,
    });
  } catch (err: any) {
    console.error('[YouTube Playlist Error]', err.message);
    res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});

// ─── Spotify Search (via public API) ────────────────────────
// Uses Spotify's public client credentials flow
let spotifyToken: string | null = null;
let spotifyTokenExpiry = 0;

async function getSpotifyToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (spotifyToken && Date.now() < spotifyTokenExpiry) return spotifyToken;

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });

    const data = await response.json() as any;
    spotifyToken = data.access_token;
    spotifyTokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
    return spotifyToken;
  } catch (err) {
    console.error('[Spotify Auth Error]', err);
    return null;
  }
}

async function spotifyFetch(endpoint: string): Promise<any> {
  const token = await getSpotifyToken();
  if (!token) throw new Error('Spotify not configured');

  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });

  if (!response.ok) throw new Error(`Spotify API error: ${response.status}`);
  return response.json();
}

router.get('/spotify/search', async (req: Request, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query) return res.status(400).json({ error: 'Query required' });

    const data = await spotifyFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=10`);

    const songs = data.tracks.items.map((track: any) => ({
      title: track.name,
      artist: track.artists.map((a: any) => a.name).join(', '),
      album: track.album.name,
      sourceId: track.id,
      source: 'spotify' as const,
      duration: Math.floor(track.duration_ms / 1000),
      coverUrl: track.album.images[0]?.url || '',
      previewUrl: track.preview_url,
    }));

    res.json({ results: songs });
  } catch (err: any) {
    console.error('[Spotify Search Error]', err.message);
    res.status(500).json({ error: 'Spotify search failed. Is Spotify configured?' });
  }
});

router.get('/spotify/playlist', async (req: Request, res: Response) => {
  try {
    const id = req.query.id as string;
    if (!id) return res.status(400).json({ error: 'Playlist ID required' });

    // Extract ID from URL if full URL is passed
    const playlistId = id.includes('playlist/') ? id.split('playlist/')[1].split('?')[0] : id;

    const data = await spotifyFetch(`/playlists/${playlistId}?fields=name,images,tracks.items(track(name,id,duration_ms,artists(name),album(name,images),preview_url)),tracks.total`);

    const songs = data.tracks.items
      .filter((item: any) => item.track)
      .map((item: any) => ({
        title: item.track.name,
        artist: item.track.artists.map((a: any) => a.name).join(', '),
        album: item.track.album?.name,
        sourceId: item.track.id,
        source: 'spotify' as const,
        duration: Math.floor(item.track.duration_ms / 1000),
        coverUrl: item.track.album?.images[0]?.url || '',
        previewUrl: item.track.preview_url,
        startTime: 0,
        endTime: Math.min(30, Math.floor(item.track.duration_ms / 1000)),
      }));

    res.json({
      name: data.name,
      coverUrl: data.images?.[0]?.url,
      songCount: songs.length,
      songs,
    });
  } catch (err: any) {
    console.error('[Spotify Playlist Error]', err.message);
    res.status(500).json({ error: 'Failed to fetch Spotify playlist' });
  }
});

// ─── Health check ───────────────────────────────────────────
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    spotify: !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
    uptime: process.uptime(),
  });
});

export default router;
