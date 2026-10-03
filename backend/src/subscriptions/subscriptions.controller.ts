import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ListSubscriptionsDto } from './dto/list-subscriptions.dto';
import { UnsubscribeDto } from './dto/unsubscribe.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.create(request.user.userId, body.url);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListSubscriptionsDto,
  ) {
    return this.subscriptionsService.list(
      request.user.userId,
      query.page,
      query.limit,
    );
  }

  @Patch(':publicId/pause')
  @UseGuards(JwtAuthGuard)
  pause(
    @Req() request: AuthenticatedRequest,
    @Param('publicId') publicId: string,
  ) {
    return this.subscriptionsService.pause(request.user.userId, publicId);
  }

  @Patch(':publicId/resume')
  @UseGuards(JwtAuthGuard)
  resume(
    @Req() request: AuthenticatedRequest,
    @Param('publicId') publicId: string,
  ) {
    return this.subscriptionsService.resume(request.user.userId, publicId);
  }

  @Delete(':publicId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Req() request: AuthenticatedRequest,
    @Param('publicId') publicId: string,
  ): Promise<void> {
    return this.subscriptionsService.remove(request.user.userId, publicId);
  }

  @Get('unsubscribe')
  @Header('Content-Type', 'text/html; charset=utf-8')
  async unsubscribe(@Query() query: UnsubscribeDto): Promise<string> {
    await this.subscriptionsService.unsubscribe(query.token);
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Subscription cancelled</title><main><h1>Subscription cancelled</h1><p>You will no longer receive notifications for this feed.</p></main></html>';
  }
}