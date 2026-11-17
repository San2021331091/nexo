import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ChannelRepository } from './channel.repository';
import { YouTubeFeedService } from '../sports/youtube-feed.service';
import { ChannelHealthService } from './channel-health.service';

class ChannelQuery { @IsOptional() @IsString() q?: string; @IsOptional() @IsString() category?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page = 1; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) limit = 48; }
@ApiTags('channels')
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelRepository, private readonly youtube: YouTubeFeedService, private readonly health: ChannelHealthService) {}
  @Get() @ApiOperation({ summary: 'Browse existing channels' }) async list(@Query() query: ChannelQuery) { const items = await this.health.applyFresh(await this.channels.list(query.limit, query.q, query.category, (query.page - 1) * query.limit)); return { data: items, meta: { count: items.length, page: query.page, limit: query.limit, hasMore: items.length === query.limit } }; }
  @Get('categories') async categories() { return { data: await this.channels.categories() }; }
  @Get(':slug/youtube-live') @ApiOperation({ summary: "The channel's YouTube live stream, used when its own stream fails" }) async youtubeLive(@Param('slug') slug: string) { const channel = await this.channels.bySlug(slug); return { data: { playbackUrl: channel ? await this.youtube.liveVideoUrl(channel.youtubeUrl, channel.name, channel.category) : null } }; }
  @Get(':slug') async bySlug(@Param('slug') slug: string) { const channel = await this.channels.bySlug(slug); return { data: channel ? (await this.health.applyFresh([channel]))[0] : null }; }
}
