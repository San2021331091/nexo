import { parseLivePage, parseLiveSearch, parseYouTubeFeed, parseYouTubeLink, sameBroadcaster } from './youtube-feed.service';

describe('parseLivePage', () => {
  const page = (live: boolean) => `<link rel="canonical" href="https://www.youtube.com/watch?v=T9BfcJiy1L4"><meta name="title" content="LIVE | Spain v England &amp; more">${live ? '"isLiveNow":true' : '"isLiveNow":false'}`;
  it('returns the broadcast when the channel is live now', () => expect(parseLivePage(page(true))).toEqual({ videoId: 'T9BfcJiy1L4', title: 'LIVE | Spain v England & more' }));
  it('returns null for a past or upcoming stream', () => expect(parseLivePage(page(false))).toBeNull());
  it('returns null for a channel page without a video', () => expect(parseLivePage('<link rel="canonical" href="https://www.youtube.com/channel/UCx">"isLiveNow":true')).toBeNull());
});

describe('sameBroadcaster', () => {
  it('matches names that differ only in case and noise words', () => {
    expect(sameBroadcaster('Somoy TV', 'SOMOY TV')).toBe(true);
    expect(sameBroadcaster('Jamuna TV HD', 'Jamuna TV')).toBe(true);
    expect(sameBroadcaster('Channel 24', 'Channel 24')).toBe(true);
    expect(sameBroadcaster('NDTV English', 'NDTV')).toBe(true);
  });
  it('rejects other broadcasters, including ones that share a word', () => {
    expect(sameBroadcaster('DD Sports', 'Prasar Bharati Sports')).toBe(false);
    expect(sameBroadcaster('Teletrak', 'Teletrece')).toBe(false);
    expect(sameBroadcaster('Somoy TV', 'SOMOY TV Bulletin')).toBe(false);
    expect(sameBroadcaster('ATN Bangla', 'ATN News')).toBe(false);
    expect(sameBroadcaster('iNEWS', 'inews telugu')).toBe(false);
    expect(sameBroadcaster('Red TV', 'RED TV')).toBe(false);
  });
  it('treats Television like TV', () => {
    expect(sameBroadcaster('Independent TV', 'Independent Television')).toBe(true);
  });
});

describe('parseLiveSearch', () => {
  const page = (renderers: object[]) => `<script>var ytInitialData = ${JSON.stringify({ contents: renderers.map((videoRenderer) => ({ videoRenderer })) })};</script>`;
  it('lists live videos with their channel and verified badge', () => {
    const html = page([
      { videoId: 'jmsrDY7XsNo', ownerText: { runs: [{ text: 'SOMOY TV' }] }, badges: [{ metadataBadgeRenderer: { label: 'LIVE' } }], ownerBadges: [{ metadataBadgeRenderer: { style: 'BADGE_STYLE_TYPE_VERIFIED' } }] },
      { videoId: 'notlive0001', ownerText: { runs: [{ text: 'Someone' }] } },
    ]);
    expect(parseLiveSearch(html)).toEqual([{ videoId: 'jmsrDY7XsNo', channelTitle: 'SOMOY TV', verified: true }]);
  });
  it('returns nothing for an unexpected page', () => expect(parseLiveSearch('<html></html>')).toEqual([]));
});

describe('parseYouTubeLink', () => {
  it('reads direct video links', () => {
    for (const link of ['https://www.youtube.com/watch?v=abc123DEF45', 'https://youtu.be/abc123DEF45', 'https://www.youtube.com/live/abc123DEF45']) expect(parseYouTubeLink(link)).toEqual({ video: 'abc123DEF45' });
  });
  it('reads channel links', () => {
    expect(parseYouTubeLink('https://www.youtube.com/@JamunaTVbd')).toEqual({ channel: '@JamunaTVbd' });
    expect(parseYouTubeLink('https://www.youtube.com/channel/UC0000000000000000000000/live')).toEqual({ channel: 'channel/UC0000000000000000000000' });
  });
  it('rejects blanks, other hosts and insecure links', () => {
    for (const link of ['', '""', null, 'https://example.com/@name', 'http://www.youtube.com/@name', 'https://www.youtube.com/@a/../../x']) expect(parseYouTubeLink(link)).toBeNull();
  });
});

const xml = `<?xml version="1.0"?><feed><title>Match &amp; Highlights</title>
<entry><id>yt:video:abc123DEF45</id><yt:videoId>abc123DEF45</yt:videoId><title>Final: A v B | &quot;Highlights&quot;</title><link rel="alternate" href="https://www.youtube.com/watch?v=abc123DEF45"/><published>2026-11-10T12:00:00+00:00</published></entry>
<entry><yt:videoId>short000001</yt:videoId><title>Clip</title><link rel="alternate" href="https://www.youtube.com/shorts/short000001"/><published>2026-11-11T12:00:00+00:00</published></entry>
<entry><yt:videoId>bad id</yt:videoId><title>Broken</title></entry></feed>`;

describe('parseYouTubeFeed', () => {
  const feed = parseYouTubeFeed('UC0000000000000000000000', xml);
  it('reads the channel title', () => expect(feed.title).toBe('Match & Highlights'));
  it('keeps full videos apart from shorts and skips malformed ids', () => expect(feed.items.map((item) => item.id)).toEqual(['yt-abc123DEF45']));
  it('collects shorts with a vertical thumbnail and a shorts URL', () => {
    expect(feed.shorts).toEqual([expect.objectContaining({ id: 'yt-short-short000001', type: 'short', posterUrl: 'https://i.ytimg.com/vi/short000001/oar2.jpg', playbackUrl: 'https://www.youtube.com/shorts/short000001', playbackKind: 'youtube' })]);
  });
  it('builds an official YouTube watch URL and thumbnail', () => {
    expect(feed.items[0]).toMatchObject({ name: 'Final: A v B | "Highlights"', playbackKind: 'youtube', playbackUrl: 'https://www.youtube.com/watch?v=abc123DEF45', backdropUrl: 'https://i.ytimg.com/vi/abc123DEF45/hqdefault.jpg', year: 2026, type: 'video' });
  });
});
