import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChannelsController } from './channels/channels.controller';
import { CatalogController } from './catalog.controller';
import { AdminController } from './admin/admin.controller';
import { CatalogService } from './catalog.service';
import { PostgresService } from './database/postgres.service';
import { ChannelRepository } from './channels/channel.repository';
import { AdminGuard } from './admin/admin.guard';
import { ContentRepository } from './catalog/content.repository';
import { PlaybackProviders } from './playback/playback-providers';
import { TmdbService } from './tmdb/tmdb.service';
import { YouTubeFeedService } from './sports/youtube-feed.service';
import { ChannelHealthService } from './channels/channel-health.service';

@Module({ imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', 'apps/api/.env', '../api/.env'] })], controllers: [ChannelsController, CatalogController, AdminController], providers: [PostgresService, ChannelRepository, ContentRepository, PlaybackProviders, TmdbService, YouTubeFeedService, ChannelHealthService, CatalogService, AdminGuard] })
export class AppModule {}
