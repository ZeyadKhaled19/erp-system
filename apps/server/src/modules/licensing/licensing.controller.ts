import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Perm, Public } from '../../core/access';
import { licenseSchemas, type LicenseSchemas as S } from './licensing.schemas';
import { LicensingService } from './licensing.service';

/**
 * Always mounted. On a plain server they answer "not gated"; the Windows app uses them for
 * status, activation, first-run trial registration and recovery codes.
 * Bodies are validated inside the service after the "is this the Windows app?" check, so a
 * plain server answers 409 before looking at the body (same order as before NestJS).
 */
@Public()
@Controller('api/license')
export class LicenseController {
  constructor(@Inject(LicensingService) private lic: LicensingService) {}

  @Get()
  info() {
    return this.lic.info();
  }

  @Post('activate')
  @HttpCode(200)
  activate(@Body() body: unknown) {
    return this.lic.activate(body);
  }

  @Post('register')
  @HttpCode(200)
  register(@Body() body: unknown) {
    return this.lic.register(body);
  }

  @Post('reset')
  @HttpCode(200)
  reset(@Body() body: unknown) {
    return this.lic.applyReset(body);
  }
}

/** Mounted only on the vendor site (opts.vendor), like before: elsewhere these paths are 404. */
@Controller('api')
export class VendorController {
  constructor(@Inject(LicensingService) private lic: LicensingService) {}

  @Perm('settings.manage')
  @Post('admin/reset-codes')
  @HttpCode(200)
  resetCode(@Req() req: FastifyRequest, @Body() body: unknown) {
    return this.lic.issueResetCode(req.user!.id, body);
  }

  @Public()
  @Post('public/trial-start')
  @HttpCode(200)
  trialStart(@Req() req: FastifyRequest, @Body({ schema: licenseSchemas.trialStart }) b: S['trialStart']) {
    return this.lic.trialStart(req, b);
  }

  @Public()
  @Post('public/trial-signup')
  @HttpCode(200)
  trialSignup(@Req() req: FastifyRequest, @Body({ schema: licenseSchemas.signup }) b: S['signup']) {
    return this.lic.trialSignup(req, b);
  }

  @Public()
  @Get('public/download')
  async download() {
    return { download_url: await this.lic.downloadUrl() };
  }

  @Public()
  @Post('public/ping')
  @HttpCode(200)
  ping(@Req() req: FastifyRequest, @Body({ schema: licenseSchemas.ping }) b: S['ping']) {
    return this.lic.ping(req, b);
  }

  @Public()
  @Get('public/contact')
  async contact() {
    return { contact: await this.lic.vendorContact() };
  }

  @Perm('settings.manage')
  @Post('admin/vendor-contact')
  @HttpCode(200)
  setContact(@Body({ schema: licenseSchemas.contact }) b: S['contact']) {
    return this.lic.setVendorContact(b);
  }

  @Perm('settings.manage')
  @Get('admin/owner-dashboard')
  ownerDashboard() {
    return this.lic.ownerDashboard();
  }

  @Perm('settings.manage')
  @Get('admin/licensing')
  licensing() {
    return this.lic.licensingPage();
  }

  @Perm('settings.manage')
  @Post('admin/trial-signups/:id')
  @HttpCode(200)
  updateSignup(@Param('id') id: string, @Body({ schema: licenseSchemas.signupUpdate }) b: S['signupUpdate']) {
    return this.lic.updateSignup(id, b);
  }

  @Perm('settings.manage')
  @Post('admin/licenses')
  @HttpCode(200)
  issueLicense(@Req() req: FastifyRequest, @Body() body: unknown) {
    return this.lic.issueLicense(req.user!.id, body);
  }
}
