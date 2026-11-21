import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Public } from '../../core/access';
import { changeSchema, loginSchema } from './auth.schemas';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body({ schema: loginSchema }) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body);
  }

  @Get('me')
  me(@Req() req: FastifyRequest) {
    return { user: req.user };
  }

  @Post('change-password')
  @HttpCode(200)
  changePassword(@Req() req: FastifyRequest, @Body({ schema: changeSchema }) body: z.infer<typeof changeSchema>) {
    return this.auth.changePassword(req.user!.id, req.deviceId ?? '', body);
  }
}
