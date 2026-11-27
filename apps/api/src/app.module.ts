import { Controller, Get, Module } from '@nestjs/common';
import { DbModule } from './common/db.module';
import { DbService } from './common/db.service';
import { IdentityModule } from './identity/identity.module';

@Controller('health')
class HealthController {
  constructor(private db: DbService) {}
  @Get() async health() { await this.db.query('SELECT 1'); return { status: 'ok' }; }
}

@Module({ imports: [DbModule, IdentityModule], controllers: [HealthController] })
export class AppModule {}
