import { Body, Controller, Get, Patch, Param, Post, Delete, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { ChannelRepository, MAX_CHANNELS } from '../channels/channel.repository';
import { PlaybackProviders } from '../playback/playback-providers';
import { TmdbService } from '../tmdb/tmdb.service';
import { YouTubeFeedService } from '../sports/youtube-feed.service';
import { PostgresService } from '../database/postgres.service';
import { AdminGuard } from './admin.guard';
import { ChannelHealthService } from '../channels/channel-health.service';
import { validatePlaybackUrl } from '../playback/url-validator';
import { EmbedAvailabilityService } from '../playback/embed-availability.service';
import { randomUUID } from 'node:crypto';

class ActiveBody { @IsBoolean() active!: boolean; }
class CategoryBody { @IsOptional() @IsString() @MaxLength(160) name?: string; @IsOptional() @IsString() @MaxLength(2048) imageUrl?: string; }
class ChannelBody { @IsOptional() @IsString() @MaxLength(160) name?: string; @IsOptional() @IsString() @MaxLength(160) category?: string; @IsOptional() @IsString() @MaxLength(2000) description?: string; @IsOptional() @IsString() @MaxLength(2048) logoUrl?: string; @IsOptional() @IsString() @MaxLength(2048) playbackUrl?: string; @IsOptional() @IsString() @MaxLength(2048) fbUrl?: string; @IsOptional() @IsString() @MaxLength(2048) twUrl?: string; @IsOptional() @IsString() @MaxLength(2048) youtubeUrl?: string; @IsOptional() @IsString() @MaxLength(2048) website?: string; }
class MovieBody { @IsOptional() @IsString() @MaxLength(180) title?: string; @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(180) slug?: string; @IsOptional() @IsString() @MaxLength(5000) synopsis?: string; @IsOptional() @IsString() @MaxLength(2048) posterUrl?: string; @IsOptional() @IsString() @MaxLength(2048) backdropUrl?: string; @IsOptional() @IsInt() @Min(1888) @Max(2200) releaseYear?: number; @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[]; @IsOptional() @IsString() @MaxLength(80) language?: string; @IsOptional() @IsInt() @Min(1) @Max(1000) durationMinutes?: number; @IsOptional() @IsString() @MaxLength(2048) playbackUrl?: string; @IsOptional() @IsIn(['unavailable','hls','dash','youtube','iframe']) playbackKind?: string; @IsOptional() @IsBoolean() isPublished?: boolean; }
class SeriesBody { @IsOptional() @IsString() @MaxLength(180) title?: string; @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(180) slug?: string; @IsOptional() @IsString() @MaxLength(5000) synopsis?: string; @IsOptional() @IsString() @MaxLength(2048) posterUrl?: string; @IsOptional() @IsString() @MaxLength(2048) backdropUrl?: string; @IsOptional() @IsInt() @Min(1888) @Max(2200) releaseYear?: number; @IsOptional() @IsArray() @IsString({ each: true }) genres?: string[]; @IsOptional() @IsString() @MaxLength(80) language?: string; @IsOptional() @IsBoolean() isPublished?: boolean; }
class SeasonBody { @IsOptional() @IsInt() @Min(1) @Max(200) seasonNumber?: number; @IsOptional() @IsString() @MaxLength(180) title?: string; }
class EpisodeBody { @IsOptional() @IsInt() @Min(1) @Max(500) episodeNumber?: number; @IsOptional() @IsString() @MaxLength(180) title?: string; @IsOptional() @IsString() @MaxLength(5000) synopsis?: string; @IsOptional() @IsInt() @Min(1) @Max(1000) durationMinutes?: number; @IsOptional() @IsString() @MaxLength(2048) playbackUrl?: string; @IsOptional() @IsIn(['unavailable','hls','dash','youtube','iframe']) playbackKind?: string; }
class CollectionBody { @IsOptional() @IsString() @MaxLength(180) title?: string; @IsOptional() @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(180) slug?: string; @IsOptional() @IsString() @MaxLength(2000) description?: string; @IsOptional() @IsInt() @Min(0) @Max(10000) sortOrder?: number; @IsOptional() @IsBoolean() isFeatured?: boolean; @IsOptional() @IsBoolean() isPublished?: boolean; }
class CollectionItemBody { @IsIn(['channel','movie','series']) contentType!: 'channel'|'movie'|'series'; @IsString() @MaxLength(180) contentId!: string; @IsOptional() @IsInt() @Min(0) @Max(10000) position?: number; }
const isYouTube = (url: string) => ['youtube.com','www.youtube.com','youtu.be','youtube-nocookie.com','www.youtube-nocookie.com'].includes(new URL(url).hostname.toLowerCase());
@ApiTags('admin')
@Controller('admin')
@UseGuards(AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly channels: ChannelRepository, private readonly db: PostgresService, private readonly providers: PlaybackProviders, private readonly tmdb: TmdbService, private readonly sports: YouTubeFeedService, private readonly health: ChannelHealthService, private readonly availability: EmbedAvailabilityService) {}
  private providerSummary() { const status = this.providers.status(); const enabled = [this.tmdb.configured ? 'TMDB' : '', status.superembed ? 'Superembed' : '',this.sports.channelIds.length ? 'YouTube sports' : ''].filter(Boolean); return enabled.length ? enabled.join(' · ') : 'Manual sources only'; }
  @Get('session') session(): { data: { authenticated: true } } { return { data: { authenticated: true } }; }
  @Get('overview') async overview(): Promise<{ data: { channels: number; movies: number; series: number; providerStatus: string } }> { const [channels,movies,series]=await Promise.all([this.channels.count(),this.db.query<{count:string}>('SELECT COUNT(*)::text AS count FROM movies'),this.db.query<{count:string}>('SELECT COUNT(*)::text AS count FROM series')]); return { data: { channels, movies:Number(movies.rows[0]?.count??0), series:Number(series.rows[0]?.count??0), providerStatus: this.providerSummary() } }; }
  @Get('collections') async listCollections(): Promise<{data:Record<string,unknown>[]}> { const result=await this.db.query<Record<string,unknown>>(`SELECT c.*,COALESCE(json_agg(json_build_object('content_type',ci.content_type,'content_id',ci.content_id,'position',ci.position) ORDER BY ci.position) FILTER (WHERE ci.content_id IS NOT NULL),'[]'::json) AS items FROM collections c LEFT JOIN collection_items ci ON ci.collection_id=c.id GROUP BY c.id ORDER BY c.sort_order,c.title LIMIT 100`);return {data:result.rows}; }
  @Post('collections') async createCollection(@Body() body:CollectionBody) { if(!body.title?.trim()||!body.slug)throw new BadRequestException('Collection title and slug are required.');const result=await this.db.query('INSERT INTO collections(title,slug,description,sort_order,is_featured,is_published) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[body.title.trim(),body.slug,body.description?.trim()??'',body.sortOrder??0,body.isFeatured??false,body.isPublished??false]);return {data:result.rows[0]}; }
  @Patch('collections/:id') async updateCollection(@Param('id') id:string,@Body() body:CollectionBody) { const fields=new Map<string,unknown>();if(body.title!==undefined)fields.set('title',body.title.trim());if(body.slug!==undefined)fields.set('slug',body.slug);if(body.description!==undefined)fields.set('description',body.description.trim());if(body.sortOrder!==undefined)fields.set('sort_order',body.sortOrder);if(body.isFeatured!==undefined)fields.set('is_featured',body.isFeatured);if(body.isPublished!==undefined)fields.set('is_published',body.isPublished);if(!fields.size)throw new BadRequestException('No collection fields were provided.');const values=[...fields.values(),id];const set=[...fields.keys()].map((key,index)=>`"${key}"=$${index+1}`).join(',');const result=await this.db.query(`UPDATE collections SET ${set} WHERE id=$${values.length} RETURNING *`,values);if(!result.rowCount)throw new BadRequestException('Collection not found.');return {data:result.rows[0]}; }
  @Delete('collections/:id') async deleteCollection(@Param('id') id:string) { await this.db.query('DELETE FROM collections WHERE id=$1',[id]);return {data:{id,deleted:true}}; }
  @Post('collections/:id/items') async addCollectionItem(@Param('id') id:string,@Body() body:CollectionItemBody) { let exists=false;if(body.contentType==='channel')exists=(await this.channels.list(MAX_CHANNELS)).some((channel)=>channel.id===body.contentId);else{const table=body.contentType==='movie'?'movies':'series';const result=await this.db.query(`SELECT 1 FROM "${table}" WHERE id::text=$1`,[body.contentId]);exists=Boolean(result.rowCount);}if(!exists)throw new BadRequestException('Choose an existing catalog item.');const result=await this.db.query('INSERT INTO collection_items(collection_id,content_type,content_id,position) VALUES($1,$2,$3,$4) ON CONFLICT(collection_id,content_type,content_id) DO UPDATE SET position=EXCLUDED.position RETURNING *',[id,body.contentType,body.contentId,body.position??0]);return {data:result.rows[0]}; }
  @Delete('collections/:id/items/:type/:contentId') async removeCollectionItem(@Param('id') id:string,@Param('type') type:string,@Param('contentId') contentId:string) { await this.db.query('DELETE FROM collection_items WHERE collection_id=$1 AND content_type=$2 AND content_id=$3',[id,type,contentId]);return {data:{id,contentType:type,contentId,deleted:true}}; }
  @Get('channel-health') async channelHealth() { await this.health.sync(); return { data: { ...this.health.summary(), channels: this.health.details() } }; }
  /** Starts a pass in the background, or with budgetSeconds (10-800) runs a time-boxed pass and waits for it (the Vercel cron does this). */
  @Post('channel-health/run') async runChannelHealth(@Query('budgetSeconds') budgetSeconds?: string) {
    if (budgetSeconds === undefined) { void this.health.run(); return { data: { started: true } }; }
    const seconds = Number(budgetSeconds);
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 800) throw new BadRequestException('budgetSeconds must be between 10 and 800.');
    await this.health.run({ budgetMs: seconds * 1000 });
    return { data: this.health.summary() };
  }
  @Get('channels') async listChannels(): Promise<{ data: import('../channels/channel.types').Channel[] }> { return { data: await this.channels.list(MAX_CHANNELS) }; }
  @Get('categories') async listCategories(): Promise<{ data: Array<{ id: string; name: string; imageUrl: string | null }> }> { return { data: await this.channels.categories() }; }
  @Get('movies') async listMovies(): Promise<{data: Record<string,unknown>[]}> { const result=await this.db.query<Record<string,unknown>>('SELECT * FROM movies ORDER BY created_at DESC LIMIT 100'); return {data:result.rows}; }
  @Post('movies') async createMovie(@Body() body:MovieBody):Promise<{data:unknown}> { const fields=await this.movieFields(body); if(!body.title?.trim()||!body.slug) throw new BadRequestException('Movie title and slug are required.'); fields.set('title',body.title.trim());fields.set('slug',body.slug);const result=await this.insertContent('movies',fields);return {data:result}; }
  @Patch('movies/:id') async updateMovie(@Param('id') id:string,@Body() body:MovieBody):Promise<{data:unknown}> { const fields=await this.movieFields(body);return {data:await this.updateContent('movies',id,fields)}; }
  @Delete('movies/:id') async deleteMovie(@Param('id') id:string){await this.db.query('DELETE FROM collection_items WHERE content_type=$1 AND content_id=$2',['movie',id]);await this.db.query('DELETE FROM movies WHERE id=$1',[id]);return {data:{id,deleted:true}};}
  @Get('series') async listSeries():Promise<{data:Record<string,unknown>[]}> { const result=await this.db.query<Record<string,unknown>>('SELECT * FROM series ORDER BY created_at DESC LIMIT 100');return {data:result.rows}; }
  @Post('series') async createSeries(@Body() body:SeriesBody):Promise<{data:unknown}> {const fields=await this.seriesFields(body);if(!body.title?.trim()||!body.slug)throw new BadRequestException('Series title and slug are required.');fields.set('title',body.title.trim());fields.set('slug',body.slug);return {data:await this.insertContent('series',fields)};}
  @Get('series/:id/seasons') async listSeasons(@Param('id') id:string):Promise<{data:Record<string,unknown>[]}> {const result=await this.db.query<Record<string,unknown>>('SELECT se.*,COALESCE(json_agg(json_build_object(\'id\',ep.id,\'episode_number\',ep.episode_number,\'title\',ep.title,\'synopsis\',ep.synopsis,\'duration_minutes\',ep.duration_minutes,\'playback_url\',ep.playback_url,\'playback_kind\',ep.playback_kind) ORDER BY ep.episode_number) FILTER (WHERE ep.id IS NOT NULL), \'[]\'::json) AS episodes FROM seasons se LEFT JOIN episodes ep ON ep.season_id=se.id WHERE se.series_id=$1 GROUP BY se.id ORDER BY se.season_number',[id]);return {data:result.rows};}
  @Patch('series/:id') async updateSeries(@Param('id') id:string,@Body() body:SeriesBody):Promise<{data:unknown}> {return {data:await this.updateContent('series',id,await this.seriesFields(body))};}
  @Delete('series/:id') async deleteSeries(@Param('id') id:string){await this.db.query('DELETE FROM collection_items WHERE content_type=$1 AND content_id=$2',['series',id]);await this.db.query('DELETE FROM series WHERE id=$1',[id]);return {data:{id,deleted:true}};}
  @Post('series/:id/seasons') async createSeason(@Param('id') id:string,@Body() body:SeasonBody){if(body.seasonNumber===undefined)throw new BadRequestException('A season number is required.');const result=await this.db.query('INSERT INTO seasons(series_id,season_number,title) VALUES($1,$2,$3) RETURNING *',[id,body.seasonNumber,body.title?.trim()??'']);return {data:result.rows[0]};}
  @Patch('seasons/:id') async updateSeason(@Param('id') id:string,@Body() body:SeasonBody){const fields=new Map<string,unknown>();if(body.seasonNumber!==undefined)fields.set('season_number',body.seasonNumber);if(body.title!==undefined)fields.set('title',body.title.trim());if(!fields.size)throw new BadRequestException('No season fields were provided.');const values=[...fields.values(),id];const set=[...fields.keys()].map((key,index)=>`"${key}"=$${index+1}`).join(',');const result=await this.db.query(`UPDATE seasons SET ${set} WHERE id=$${values.length} RETURNING *`,values);if(!result.rowCount)throw new BadRequestException('Season not found.');return {data:result.rows[0]};}
  @Delete('seasons/:id') async deleteSeason(@Param('id') id:string){await this.db.query('DELETE FROM seasons WHERE id=$1',[id]);return {data:{id,deleted:true}};}
  @Post('seasons/:id/episodes') async createEpisode(@Param('id') id:string,@Body() body:EpisodeBody){if(body.episodeNumber===undefined||!body.title?.trim())throw new BadRequestException('Episode number and title are required.');const url=body.playbackUrl?.trim()?validatePlaybackUrl(body.playbackUrl):null;if(body.playbackUrl?.trim()&&!url)throw new BadRequestException('Playback URL must be a valid HTTPS URL (and match PLAYBACK_ALLOWED_HOSTS when that is set).');const result=await this.db.query('INSERT INTO episodes(season_id,episode_number,title,synopsis,duration_minutes,playback_url,playback_kind) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[id,body.episodeNumber,body.title.trim(),body.synopsis?.trim()??'',body.durationMinutes??null,url,url?(body.playbackKind??(isYouTube(url)?'youtube':'hls')):'unavailable']);return {data:result.rows[0]};}
  @Patch('episodes/:id') async updateEpisode(@Param('id') id:string,@Body() body:EpisodeBody){const fields=new Map<string,unknown>();if(body.episodeNumber!==undefined)fields.set('episode_number',body.episodeNumber);if(body.title!==undefined)fields.set('title',body.title.trim());if(body.synopsis!==undefined)fields.set('synopsis',body.synopsis.trim());if(body.durationMinutes!==undefined)fields.set('duration_minutes',body.durationMinutes);if(body.playbackUrl!==undefined){const url=body.playbackUrl.trim()?validatePlaybackUrl(body.playbackUrl):null;if(body.playbackUrl.trim()&&!url)throw new BadRequestException('Playback URL must be a valid HTTPS URL (and match PLAYBACK_ALLOWED_HOSTS when that is set).');fields.set('playback_url',url);fields.set('playback_kind',url?(body.playbackKind??(isYouTube(url)?'youtube':'hls')):'unavailable');}else if(body.playbackKind!==undefined)fields.set('playback_kind',body.playbackKind);if(!fields.size)throw new BadRequestException('No episode fields were provided.');const values=[...fields.values(),id];const set=[...fields.keys()].map((key,index)=>`"${key}"=$${index+1}`).join(',');const result=await this.db.query(`UPDATE episodes SET ${set} WHERE id=$${values.length} RETURNING *`,values);if(!result.rowCount)throw new BadRequestException('Episode not found.');return {data:result.rows[0]};}
  @Delete('episodes/:id') async deleteEpisode(@Param('id') id:string){await this.db.query('DELETE FROM episodes WHERE id=$1',[id]);return {data:{id,deleted:true}};}
  @Post('categories') async createCategory(@Body() body: CategoryBody): Promise<{ data: Record<string, unknown> }> {
    if (!body.name?.trim() || body.imageUrl === undefined) throw new BadRequestException('Category name and image URL are required by the existing schema.');
    const image = this.safeCategoryImage(body.imageUrl);
    const table = await this.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND lower(table_name)=lower('categorydb') LIMIT 1`);
    if (!table.rows[0]) throw new BadRequestException('Existing categorydb table was not found.');
    const safe = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const result = await this.db.query(`INSERT INTO ${safe(table.rows[0].table_name)} ("id", "category", "cgurl") VALUES ($1,$2,$3) RETURNING "id", "category", "cgurl"`, [randomUUID(), body.name.trim(), image]);
    return { data: result.rows[0] };
  }
  @Patch('categories/:id') async updateCategory(@Param('id') id: string, @Body() body: CategoryBody): Promise<{ data: Record<string, unknown> }> {
    if (body.name !== undefined) throw new BadRequestException('Category names cannot be changed in this panel because channel rows reference category names directly.');
    if (body.imageUrl === undefined) throw new BadRequestException('An image URL is required.');
    const image = this.safeCategoryImage(body.imageUrl);
    const result = await this.db.query(`UPDATE "categorydb" SET "cgurl"=$1 WHERE "id"=$2 RETURNING "id", "category", "cgurl"`, [image, id]);
    if (!result.rowCount) throw new BadRequestException('Category not found.');
    return { data: result.rows[0] };
  }
  @Delete('categories/:id') async deleteCategory(@Param('id') id: string) {
    const categories = await this.channels.categories(); const selected = categories.find((category) => category.id === id);
    if (!selected) throw new BadRequestException('Category not found.');
    const inUse = await this.db.query(`SELECT 1 FROM "channeltb" WHERE "category"=$1 LIMIT 1`, [selected.name]);
    if (inUse.rowCount) throw new BadRequestException('This category is assigned to one or more channels and cannot be deleted.');
    await this.db.query(`DELETE FROM "categorydb" WHERE "id"=$1`, [id]);
    return { data: { id, deleted: true } };
  }
  private safeCategoryImage(value: string) {
    if (!value.trim()) return '';
    let image: URL; try { image = new URL(value); } catch { throw new BadRequestException('Category artwork must use HTTPS.'); }
    if (image.protocol !== 'https:' || image.username || image.password) throw new BadRequestException('Category artwork must use HTTPS.');
    return image.toString();
  }
  @Post('channels') async createChannel(@Body() body: ChannelBody): Promise<{ data: unknown }> { return this.writeChannel(body); }
  @Patch('channels/:id') async updateChannel(@Param('id') id: string, @Body() body: ChannelBody): Promise<{ data: unknown }> { return this.writeChannel(body, id); }
  @Delete('channels/:id') async deleteChannel(@Param('id') id: string) {
    const schema = await this.channels.schema();
    const idColumn = schema.channels.columns.find((column) => ['id', 'channel_id', 'channelid'].includes(column.column_name.toLowerCase()))?.column_name;
    const table = await this.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND lower(table_name)=lower('channeltb') LIMIT 1`);
    if (!idColumn || !table.rows[0]) throw new BadRequestException('The existing channel schema has no recognized primary key.');
    const safe = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const result = await this.db.query(`DELETE FROM ${safe(table.rows[0].table_name)} WHERE ${safe(idColumn)}::text=$1 RETURNING ${safe(idColumn)}`, [id]);
    if (!result.rowCount) throw new BadRequestException('Channel not found.');
    await this.db.query('DELETE FROM collection_items WHERE content_type=$1 AND content_id=$2',['channel',id]);
    return { data: { id, deleted: true } };
  }
  private async writeChannel(body: ChannelBody, id?: string): Promise<{ data: unknown }> {
    const schema = await this.channels.schema();
    const tableResult = await this.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND lower(table_name)=lower('channeltb') LIMIT 1`);
    const table = tableResult.rows[0]?.table_name;
    if (!table) throw new BadRequestException('Existing channeltb table was not found.');
    const columns = schema.channels.columns;
    const find = (names: string[]) => columns.find((column) => names.includes(column.column_name.toLowerCase()))?.column_name;
    const fields = new Map<string, unknown>();
    const nameCol = find(['name', 'cname', 'channel_name', 'channelname', 'title', 'channel_title']);
    const catCol = find(['category_id', 'categoryid', 'category', 'category_name', 'categoryname']);
    const logoCol = find(['logo', 'logo_url', 'logourl', 'imgurl', 'image', 'image_url', 'icon']);
    const sourceCol = find(['stream_url', 'streamurl', 'playback_url', 'playbackurl', 'liveurl', 'url', 'video_url']);
    if (body.name !== undefined) { if (!nameCol) throw new BadRequestException('Channel name column is not recognized.'); fields.set(nameCol, body.name.trim()); }
    const descriptionCol = find(['description', 'synopsis']); if (body.description !== undefined) { if (!descriptionCol) throw new BadRequestException('Channel description column is not recognized.'); fields.set(descriptionCol, body.description.trim()); }
    if (body.category !== undefined) { if (!catCol) throw new BadRequestException('Channel category column is not recognized.'); const category = (await this.channels.categories()).find((item) => item.id === body.category || item.name.toLowerCase() === body.category?.toLowerCase()); if (!category) throw new BadRequestException('Choose a category from the existing categorydb records.'); fields.set(catCol, category.name); }
    if (body.logoUrl !== undefined) { if (!logoCol) throw new BadRequestException('Channel logo column is not recognized.'); if (!body.logoUrl.trim()) fields.set(logoCol, ''); else { let parsed: URL; try { parsed = new URL(body.logoUrl); } catch { throw new BadRequestException('Logo URL must be HTTPS.'); } if (parsed.protocol !== 'https:') throw new BadRequestException('Logo URL must be HTTPS.'); fields.set(logoCol, parsed.toString()); } }
    if (body.playbackUrl !== undefined) { if (!sourceCol) throw new BadRequestException('Playback URL column is not recognized.'); const url = body.playbackUrl.trim() ? validatePlaybackUrl(body.playbackUrl) : ''; if (!url && body.playbackUrl.trim()) throw new BadRequestException('Playback URL must be a valid HTTPS URL (and match PLAYBACK_ALLOWED_HOSTS when that is set).'); fields.set(sourceCol, url); }
    for (const [input, aliases] of [['fbUrl', ['fburl', 'facebook_url']], ['twUrl', ['twurl', 'twitter_url']], ['youtubeUrl', ['youtubeurl', 'youtube_url']], ['website', ['website', 'website_url']]] as const) {
      const value = body[input]; if (value !== undefined) { const column = find([...aliases]); if (!column) throw new BadRequestException(`Channel ${input} column is not recognized.`); if (value.trim() && !value.startsWith('https://')) throw new BadRequestException(`${input} must use HTTPS.`); fields.set(column, value.trim()); }
    }
    if (id) {
      if (!fields.size) throw new BadRequestException('No recognized channel fields were provided.');
      const idCol = find(['id', 'channel_id', 'channelid']); if (!idCol) throw new BadRequestException('Channel primary key is not recognized.');
      const safe = (name: string) => `"${name.replaceAll('"', '""')}"`;
      const values = [...fields.values()]; const assignments = [...fields.keys()].map((key, index) => `${safe(key)}=$${index + 1}`); values.push(id);
      const result = await this.db.query(`UPDATE ${safe(table)} SET ${assignments.join(', ')} WHERE ${safe(idCol)}::text=$${values.length} RETURNING ${safe(idCol)}`, values);
      if (!result.rowCount) throw new BadRequestException('Channel not found.');
      return { data: { id, updated: true } };
    }
    if (!nameCol || !fields.has(nameCol)) throw new BadRequestException('A channel name is required.');
    const idCol = find(['id', 'channel_id', 'channelid']); if (idCol && !fields.has(idCol)) fields.set(idCol, randomUUID());
    const missing = columns.filter((column) => column.is_nullable === 'NO' && !column.column_default && !fields.has(column.column_name) && !['id', 'channel_id', 'channelid'].includes(column.column_name.toLowerCase()));
    if (missing.length) throw new BadRequestException(`The existing table requires additional fields not supported by this panel: ${missing.map((column) => column.column_name).join(', ')}.`);
    const safe = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const names = [...fields.keys()]; const values = [...fields.values()];
    const result = await this.db.query(`INSERT INTO ${safe(table)} (${names.map(safe).join(', ')}) VALUES (${values.map((_, index) => `$${index + 1}`).join(', ')}) RETURNING *`, values);
    return { data: { created: true, channel: result.rows[0] } };
  }
  private async movieFields(body: MovieBody) {
    const fields = new Map<string, unknown>();
    if (body.title !== undefined) fields.set('title', body.title.trim());
    if (body.slug !== undefined) fields.set('slug', body.slug);
    if (body.synopsis !== undefined) fields.set('synopsis', body.synopsis.trim());
    if (body.posterUrl !== undefined) fields.set('poster_url', this.safeCategoryImage(body.posterUrl));
    if (body.backdropUrl !== undefined) fields.set('backdrop_url', this.safeCategoryImage(body.backdropUrl));
    if (body.releaseYear !== undefined) fields.set('release_year', body.releaseYear);
    if (body.genres !== undefined) fields.set('genres', body.genres.map((genre) => genre.trim()).filter(Boolean));
    if (body.language !== undefined) fields.set('language', body.language.trim());
    if (body.durationMinutes !== undefined) fields.set('duration_minutes', body.durationMinutes);
    if (body.playbackUrl !== undefined) { const url=body.playbackUrl.trim()?validatePlaybackUrl(body.playbackUrl):null;if(body.playbackUrl.trim()&&!url)throw new BadRequestException('Playback URL must be a valid HTTPS URL (and match PLAYBACK_ALLOWED_HOSTS when that is set).');fields.set('playback_url',url);fields.set('playback_kind',url?(body.playbackKind??(isYouTube(url)?'youtube':'hls')):'unavailable'); }
    else if(body.playbackKind!==undefined)fields.set('playback_kind',body.playbackKind);
    if (body.isPublished !== undefined) fields.set('is_published', body.isPublished);
    return fields;
  }
  private async seriesFields(body: SeriesBody) {
    const fields = new Map<string, unknown>();
    if (body.title !== undefined) fields.set('title', body.title.trim());
    if (body.slug !== undefined) fields.set('slug', body.slug);
    if (body.synopsis !== undefined) fields.set('synopsis', body.synopsis.trim());
    if (body.posterUrl !== undefined) fields.set('poster_url', this.safeCategoryImage(body.posterUrl));
    if (body.backdropUrl !== undefined) fields.set('backdrop_url', this.safeCategoryImage(body.backdropUrl));
    if (body.releaseYear !== undefined) fields.set('release_year', body.releaseYear);
    if (body.genres !== undefined) fields.set('genres', body.genres.map((genre) => genre.trim()).filter(Boolean));
    if (body.language !== undefined) fields.set('language', body.language.trim());
    if (body.isPublished !== undefined) fields.set('is_published', body.isPublished);
    return fields;
  }
  private async insertContent(table: 'movies' | 'series', fields: Map<string, unknown>) {
    const names=[...fields.keys()];const values=[...fields.values()];
    const result=await this.db.query(`INSERT INTO "${table}" (${names.map((name)=>`"${name}"`).join(',')}) VALUES (${values.map((_,index)=>`$${index+1}`).join(',')}) RETURNING *`,values);
    return result.rows[0];
  }
  private async updateContent(table: 'movies' | 'series', id: string, fields: Map<string, unknown>) {
    fields.set('updated_at',new Date());
    if(!fields.size)throw new BadRequestException('No catalog fields were provided.');
    fields.set('updated_at',new Date());const values=[...fields.values(),id];
    const assignments=[...fields.keys()].map((key,index)=>`"${key}"=$${index+1}`);
    const result=await this.db.query(`UPDATE "${table}" SET ${assignments.join(',')} WHERE id=$${values.length} RETURNING *`,values);
    if(!result.rowCount)throw new BadRequestException('Catalog item not found.');
    return result.rows[0];
  }
  @Patch('channels/:id/active') async setChannelActive(@Param('id') id: string, @Body() body: ActiveBody) {
    const schema = await this.channels.schema();
    const idColumn = schema.channels.columns.find((c) => ['id', 'channel_id', 'channelid'].includes(c.column_name.toLowerCase()))?.column_name;
    const activeColumn = schema.channels.columns.find((c) => ['is_active', 'active', 'enabled', 'status'].includes(c.column_name.toLowerCase()))?.column_name;
    const table = await this.db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND lower(table_name)=lower('channeltb') LIMIT 1`);
    if (!idColumn || !activeColumn || !table.rows[0]) throw new BadRequestException('The existing channel schema has no recognized id and active fields.');
    const safe = (name: string) => `"${name.replaceAll('"', '""')}"`;
    const activeMeta = schema.channels.columns.find((column) => column.column_name === activeColumn);
    const activeValue = activeMeta?.data_type === 'boolean' ? body.active : (body.active ? 'active' : 'inactive');
    const result = await this.db.query(`UPDATE ${safe(table.rows[0].table_name)} SET ${safe(activeColumn)}=$1 WHERE ${safe(idColumn)}::text=$2 RETURNING ${safe(idColumn)}`, [activeValue, id]);
    if (!result.rowCount) throw new BadRequestException('Channel not found.');
    return { data: { id, active: body.active } };
  }
  /** What the embed provider answers to this server for a title it is known to carry. */
  @Get('embed-check') async embedCheck(@Query('kind') kind?: string) { return { data: await this.availability.diagnose(kind === 'tv' ? 'tv' : 'movie') }; }
  @Get('settings') settings() { const status = this.providers.status(); return { data: { database: Boolean(process.env.DATABASE_URL), manualPlayback: true, tmdb: this.tmdb.configured, superembed: status.superembed, superembedHost: status.superembedHost, sportsYouTubeChannels: this.sports.channelIds.length, playbackAllowlist: (process.env.PLAYBACK_ALLOWED_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean).length } }; }
}
