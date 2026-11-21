import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { Perm, Public } from '../../core/access';
import { roleHomeSchema, roleSchema, settingsSchema, userSchema } from './admin.schemas';
import { AdminService } from './admin.service';

@Controller('api')
export class AdminController {
  constructor(@Inject(AdminService) private admin: AdminService) {}

  @Public()
  @Get('brand')
  brand() {
    return this.admin.brand();
  }

  @Perm('audit.view')
  @Get('admin/audit')
  audit(@Query('user_id') user_id?: string, @Query('device_id') device_id?: string) {
    return this.admin.audit({ user_id, device_id });
  }

  @Perm('audit.view')
  @Get('admin/devices')
  devices() {
    return this.admin.devices();
  }

  @Perm('users.manage')
  @Post('admin/users')
  @HttpCode(200)
  saveUser(@Req() req: FastifyRequest, @Body({ schema: userSchema }) b: z.infer<typeof userSchema>) {
    return this.admin.saveUser(req.user!, req.deviceId, b);
  }

  @Perm('users.manage')
  @Post('admin/role-home')
  @HttpCode(200)
  roleHome(@Req() req: FastifyRequest, @Body({ schema: roleHomeSchema }) b: z.infer<typeof roleHomeSchema>) {
    return this.admin.setRoleHome(req.user!, req.deviceId, b);
  }

  @Perm('users.manage')
  @Post('admin/roles')
  @HttpCode(200)
  saveRole(@Req() req: FastifyRequest, @Body({ schema: roleSchema }) b: z.infer<typeof roleSchema>) {
    return this.admin.saveRole(req.user!, req.deviceId, b);
  }

  @Perm('settings.manage')
  @Post('admin/settings')
  @HttpCode(200)
  saveSettings(@Req() req: FastifyRequest, @Body({ schema: settingsSchema }) b: Record<string, any>) {
    return this.admin.saveSettings(req.user!, req.deviceId, b);
  }
}
