import { type DynamicModule, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { AppOptions } from './app';
import { makeTokens } from './auth';
import { AccessGuard } from './core/access';
import { APP_OPTIONS, DB, JWT } from './core/tokens';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { BackupsModule } from './modules/backups/backups.module';
import { HealthModule } from './modules/health/health.module';
import { LicensingModule } from './modules/licensing/licensing.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SyncModule } from './modules/sync/sync.module';

/**
 * Shared infrastructure for every module: the database handle, the app options (deployment mode,
 * backup folder, license gate) and the session token signer. Nothing business-specific lives here.
 */
@Global()
@Module({})
class CoreModule {
  static register(opts: AppOptions): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: DB, useValue: opts.db },
        { provide: APP_OPTIONS, useValue: opts },
        { provide: JWT, useValue: makeTokens(opts.jwtSecret) },
        // every route needs a valid session unless marked @Public()
        { provide: APP_GUARD, useClass: AccessGuard },
      ],
      exports: [DB, APP_OPTIONS, JWT],
    };
  }
}

@Module({})
export class AppModule {
  static register(opts: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.register(opts),
        // the license lock is a Fastify onRequest hook (see app.ts), so it runs before routing and auth
        LicensingModule.register({ vendor: opts.vendor }),
        HealthModule,
        AuthModule,
        SyncModule,
        ReportsModule,
        AdminModule,
        BackupsModule,
      ],
    };
  }
}
