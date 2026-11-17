import 'reflect-metadata';
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { validatePlaybackUrl } from '../src/modules/playback/url-validator';

type EpisodeSeed = { episodeNumber: number; title: string; synopsis?: string; durationMinutes?: number; playbackUrl?: string; playbackKind?: 'hls'|'dash'|'youtube'|'iframe'|'unavailable' };
type SeasonSeed = { seasonNumber: number; title?: string; episodes?: EpisodeSeed[] };
type MovieSeed = { title: string; slug: string; synopsis?: string; posterUrl?: string; backdropUrl?: string; releaseYear?: number; genres?: string[]; language?: string; durationMinutes?: number; playbackUrl?: string; playbackKind?: 'hls'|'dash'|'youtube'|'iframe'|'unavailable'; isPublished?: boolean };
type SeriesSeed = Omit<MovieSeed, 'durationMinutes'|'playbackUrl'|'playbackKind'> & { seasons?: SeasonSeed[] };
type SeedData = { movies?: MovieSeed[]; series?: SeriesSeed[] };

function image(value: string | undefined) {
  if (!value) return null;
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Seed artwork URLs must use HTTPS.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Seed artwork URLs must use HTTPS.');
  return parsed.toString();
}

function playback(value: string | undefined) {
  if (!value) return null;
  const safe = validatePlaybackUrl(value);
  if (!safe) throw new Error('Seed playback URLs must use HTTPS and a configured broadcaster or official YouTube hostname.');
  return safe;
}
function kind(url: string | null, explicit?: string) {
  if (!url) return 'unavailable';
  if (explicit) return explicit;
  return ['youtube.com','www.youtube.com','youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'].includes(new URL(url).hostname.toLowerCase()) ? 'youtube' : 'hls';
}

async function seed() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in apps/api/.env before seeding.');
  const data = JSON.parse(await readFile(resolve(process.cwd(), '../../db/seed/catalog.json'), 'utf8')) as SeedData;
  const movies = data.movies ?? [];
  const series = data.series ?? [];
  if (movies.length === 0 && series.length === 0) { console.log('No operator supplied catalog records; nothing was inserted.'); return; }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    const schema = await client.query<{ exists: string | null }>("SELECT to_regclass(current_schema() || '.movies')::text AS exists");
    if (!schema.rows[0]?.exists) throw new Error('Catalog tables are missing; run npm run db:migrate first.');
    await client.query('BEGIN');
    try {
      for (const item of movies) {
        if (!item.title.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) throw new Error('Each movie needs a title and a lowercase URL slug.');
        const url = playback(item.playbackUrl);
        await client.query(`INSERT INTO movies(title,slug,synopsis,poster_url,backdrop_url,release_year,genres,language,duration_minutes,playback_url,playback_kind,is_published)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(slug) DO NOTHING`,
        [item.title.trim(),item.slug,item.synopsis?.trim()??'',image(item.posterUrl),image(item.backdropUrl),item.releaseYear??null,item.genres??[],item.language?.trim()??'',item.durationMinutes??null,url,kind(url,item.playbackKind),item.isPublished??false]);
      }
      for (const item of series) {
        if (!item.title.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.slug)) throw new Error('Each series needs a title and a lowercase URL slug.');
        await client.query(`INSERT INTO series(title,slug,synopsis,poster_url,backdrop_url,release_year,genres,language,is_published)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(slug) DO NOTHING`,
        [item.title.trim(),item.slug,item.synopsis?.trim()??'',image(item.posterUrl),image(item.backdropUrl),item.releaseYear??null,item.genres??[],item.language?.trim()??'',item.isPublished??false]);
        const parent = await client.query<{ id: string }>('SELECT id FROM series WHERE slug=$1',[item.slug]);
        for (const season of item.seasons ?? []) {
          const storedSeason = await client.query<{ id: string }>('INSERT INTO seasons(series_id,season_number,title) VALUES($1,$2,$3) ON CONFLICT(series_id,season_number) DO UPDATE SET title=EXCLUDED.title RETURNING id',[parent.rows[0].id,season.seasonNumber,season.title?.trim()??'']);
          for (const episode of season.episodes ?? []) {
            const url = playback(episode.playbackUrl);
            await client.query(`INSERT INTO episodes(season_id,episode_number,title,synopsis,duration_minutes,playback_url,playback_kind)
              VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(season_id,episode_number) DO NOTHING`,
            [storedSeason.rows[0].id,episode.episodeNumber,episode.title.trim(),episode.synopsis?.trim()??'',episode.durationMinutes??null,url,kind(url,episode.playbackKind)]);
          }
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    console.log(`Seed complete: ${movies.length} movies, ${series.length} series from the operator supplied catalog file.`);
  } finally { client.release(); await pool.end(); }
}

void seed().catch((error) => { console.error(error instanceof Error ? error.message : 'Seed failed.'); process.exitCode = 1; });
