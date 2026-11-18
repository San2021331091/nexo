import { parseFreeProviders, watchRegion } from './tmdb.service';

const body = {
  id: 550,
  results: {
    US: {
      link: 'https://www.themoviedb.org/movie/550-fight-club/watch?locale=US',
      flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/netflix.jpg', display_priority: 1 }],
      rent: [{ provider_id: 2, provider_name: 'Apple TV', logo_path: '/apple.jpg', display_priority: 2 }],
      ads: [
        { provider_id: 300, provider_name: 'Pluto TV', logo_path: '/pluto.jpg', display_priority: 9 },
        { provider_id: 73, provider_name: 'Tubi TV', logo_path: '/tubi.jpg', display_priority: 3 },
      ],
      free: [{ provider_id: 538, provider_name: 'Plex', logo_path: '/plex.jpg', display_priority: 5 }],
    },
    GB: { link: 'https://www.themoviedb.org/movie/550/watch?locale=GB', flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
  },
};

describe('parseFreeProviders', () => {
  it('keeps only free and ad supported services, free first, each by display priority', () => {
    const result = parseFreeProviders(body, 'US');
    expect(result.providers.map((provider) => [provider.name, provider.kind])).toEqual([['Plex', 'free'], ['Tubi TV', 'ads'], ['Pluto TV', 'ads']]);
    expect(result.providers[0].logoUrl).toBe('https://image.tmdb.org/t/p/w92/plex.jpg');
    expect(result.link).toBe('https://www.themoviedb.org/movie/550-fight-club/watch?locale=US');
  });

  it('returns no providers and no link when the country has only paid options', () => {
    expect(parseFreeProviders(body, 'GB')).toEqual({ region: 'GB', link: null, providers: [] });
    expect(parseFreeProviders(body, 'FR')).toEqual({ region: 'FR', link: null, providers: [] });
    expect(parseFreeProviders(null, 'US')).toEqual({ region: 'US', link: null, providers: [] });
  });

  it('drops links off themoviedb.org, malformed rows and duplicates', () => {
    const result = parseFreeProviders({ results: { US: { link: 'https://evil.example/watch', free: [{ provider_id: 'x', provider_name: 'Bad' }, { provider_id: 73, provider_name: 'Tubi TV' }], ads: [{ provider_id: 73, provider_name: 'Tubi TV' }] } } }, 'US');
    expect(result.link).toBeNull();
    expect(result.providers).toEqual([{ id: 73, name: 'Tubi TV', logoUrl: null, kind: 'free' }]);
  });
});

describe('watchRegion', () => {
  it('accepts two letter country codes and falls back to US', () => {
    expect(watchRegion('gb')).toBe('GB');
    expect(watchRegion(undefined)).toBe('US');
    expect(watchRegion('USA')).toBe('US');
  });
});
