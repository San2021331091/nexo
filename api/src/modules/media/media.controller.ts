import { Body, Controller, Get, HttpException, HttpStatus, Ip, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RateLimiter } from '../assistant/assistant.controller';
import { ImageShape, MediaService } from './media.service';

class ImageBody { @IsString() @MaxLength(800) prompt!: string; @IsOptional() @IsIn(['poster', 'wide', 'square']) shape?: ImageShape; }
class VideoBody { @IsString() @MaxLength(800) prompt!: string; }

@ApiTags('media')
@Controller('media')
export class MediaController {
  // Generation costs money per request, so each address gets a small allowance.
  private readonly images = new RateLimiter(15, 60 * 60_000);
  private readonly videos = new RateLimiter(3, 60 * 60_000);
  constructor(private readonly media: MediaService) {}

  @Get('status') status() { return { data: this.media.status() }; }

  @Post('images') async image(@Body() body: ImageBody, @Ip() ip: string) {
    if (!this.images.allow(ip || 'unknown')) throw new HttpException('You have made a lot of images. Please wait a while.', HttpStatus.TOO_MANY_REQUESTS);
    return { data: await this.media.image(body.prompt, body.shape ?? 'poster', 25_000) };
  }

  @Post('videos') async video(@Body() body: VideoBody, @Ip() ip: string) {
    if (!this.videos.allow(ip || 'unknown')) throw new HttpException('You have made a lot of videos. Please wait a while.', HttpStatus.TOO_MANY_REQUESTS);
    return { data: await this.media.startVideo(body.prompt) };
  }

  @Get('videos/:id') async videoStatus(@Param('id') id: string) { return { data: await this.media.video(id) }; }
}
