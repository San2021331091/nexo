import { Body, Controller, Get, HttpException, HttpStatus, Ip, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { AssistantService } from './assistant.service';

class ChatTurnBody { @IsIn(['user', 'assistant']) role!: 'user' | 'assistant'; @IsString() @MinLength(1) @MaxLength(4000) content!: string; }
class ChatBody {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ChatTurnBody) messages!: ChatTurnBody[];
  @IsOptional() @IsString() @MaxLength(2) region?: string;
  /** Facts remembered from earlier chats; the app keeps them on the device. */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(200, { each: true }) memory?: string[];
}

const WINDOW_MS = 5 * 60_000;
const LIMIT = 20;

/** At most LIMIT requests per address per window, so the model key cannot be drained. Exported for tests. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly limit = LIMIT, private readonly windowMs = WINDOW_MS) {}
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) for (const [entry, times] of this.hits) if (!times.some((time) => now - time < this.windowMs)) this.hits.delete(entry);
    return true;
  }
}

@ApiTags('assistant')
@Controller('assistant')
export class AssistantController {
  private readonly limiter = new RateLimiter();
  constructor(private readonly assistant: AssistantService) {}

  @Get('status') status() { return { data: this.assistant.status() }; }

  @Post('chat') async chat(@Body() body: ChatBody, @Ip() ip: string) {
    if (body.messages[body.messages.length - 1].role !== 'user') throw new HttpException('The last message must be from the user.', HttpStatus.BAD_REQUEST);
    if (!this.limiter.allow(ip || 'unknown')) throw new HttpException('Too many questions. Please wait a few minutes.', HttpStatus.TOO_MANY_REQUESTS);
    return { data: await this.assistant.chat(body.messages, body.region, body.memory ?? []) };
  }
}
