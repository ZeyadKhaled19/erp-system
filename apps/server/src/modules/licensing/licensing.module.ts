import { type DynamicModule, Module } from '@nestjs/common';
import { LicenseController, VendorController } from './licensing.controller';
import { LicensingService } from './licensing.service';

@Module({})
export class LicensingModule {
  /** The vendor endpoints exist only on the vendor site (Vercel), exactly like before NestJS */
  static register(opts: { vendor?: boolean }): DynamicModule {
    return {
      module: LicensingModule,
      controllers: opts.vendor ? [LicenseController, VendorController] : [LicenseController],
      providers: [LicensingService],
      exports: [LicensingService],
    };
  }
}
