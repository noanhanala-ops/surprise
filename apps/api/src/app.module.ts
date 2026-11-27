import { Controller, Get, Module } from '@nestjs/common';
import { DbModule } from './common/db.module';
import { DbService } from './common/db.service';
import { IdentityModule } from './identity/identity.module';
import { PublisherController } from './publisher/publisher.controller';
import { PublisherService } from './publisher/publisher.service';
import { AdminController } from './admin/admin.controller';
import { AdminService } from './admin/admin.service';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { UploadController } from './content/upload.controller';
import { UploadService } from './content/upload.service';
import { LocalStorageService, StorageService } from './storage/storage.service';

@Controller('health')
class HealthController {
  constructor(private db: DbService) {}
  @Get() async health() { await this.db.query('SELECT 1'); return { status: 'ok' }; }
}

@Module({
  imports: [DbModule, IdentityModule],
  controllers: [HealthController, PublisherController, AdminController, CatalogController, UploadController],
  providers: [PublisherService, AdminService, CatalogService, UploadService, { provide: StorageService, useClass: LocalStorageService }],
})
export class AppModule {}
