import { Controller, Get, Param, Query, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CatalogService, HomeTab } from './catalog.service';
import { TmdbList } from './tmdb/tmdb.service';
import { PostgresService } from './database/postgres.service';
class SearchQuery { @IsOptional() @IsString() @MaxLength(100) q = ''; @IsOptional() @IsString() @MaxLength(80) category?: string; @IsOptional() @IsString() @MaxLength(80) genre?: string; @IsOptional() @IsString() @MaxLength(80) language?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1900) @Max(2100) year?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 48; @IsOptional() @IsIn(['trending', 'popular', 'top_rated', 'now_playing', 'upcoming', 'on_the_air']) list?: TmdbList; }
class HomeQuery { @IsOptional() @IsIn(['all', 'live', 'sports', 'movies', 'series', 'dramas']) tab: HomeTab = 'all'; }
@ApiTags('catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService, private readonly db: PostgresService) {}
  @Get('health') health() { return { data: { status: 'ok' } }; }
  @Get('ready') async ready() { try { await this.db.query('SELECT 1'); return { data: { status: 'ready' } }; } catch { throw new ServiceUnavailableException('Catalog database is unavailable.'); } }
  @Get('home') home(@Query() query: HomeQuery) { return this.catalog.home(query.tab); }
  @Get('search') search(@Query() q: SearchQuery) { return this.catalog.search(q.q, q); }
  @Get('movies') movies(@Query() query: SearchQuery) { return this.catalog.movies(query); }
  @Get('movies/:slug') async movie(@Param('slug') slug: string) { return { data: await this.catalog.movieBySlug(slug) }; }
  @Get('series') series(@Query() query: SearchQuery) { return this.catalog.series(query); }
  @Get('series/:slug') async seriesDetails(@Param('slug') slug: string) { return { data: await this.catalog.seriesBySlug(slug) }; }
  @Get('series/:slug/seasons') async seasons(@Param('slug') slug: string) { return { data: await this.catalog.seasons(slug) }; }
  @Get('episodes/:id') async episode(@Param('id') id: string) { return { data: await this.catalog.episode(id) }; }
  @Get('collections') async collections() { return { data: await this.catalog.collections() }; }
}
