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
import { EventsModule } from './events/events.module';
import { FakeProvider } from './payments/fake.provider';
import { ProviderRegistry } from './payments/provider.registry';
import { PaymentsService } from './payments/payments.service';
import { PaymentsController } from './payments/payments.controller';
import { CommerceService } from './commerce/commerce.service';
import { CommerceController } from './commerce/commerce.controller';
import { RefundsService } from './commerce/refunds.service';
import { EntitlementsConsumer } from './entitlements/entitlements.consumer';
import { EntitlementsService } from './entitlements/entitlements.service';
import { EntitlementsController } from './entitlements/entitlements.controller';
import { ReadingService } from './reading/reading.service';
import { ReadingController } from './reading/reading.controller';
import { RoyaltyConsumer } from './royalty/royalty.consumer';
import { LocalStorageService, StorageService } from './storage/storage.service';

@Controller('health')
class HealthController {
  constructor(private db: DbService) {}
  @Get() async health() { await this.db.query('SELECT 1'); return { status: 'ok' }; }
}

@Module({
  imports: [DbModule, EventsModule, IdentityModule],
  controllers: [HealthController, PublisherController, AdminController, CatalogController, UploadController, CommerceController, PaymentsController, EntitlementsController, ReadingController],
  providers: [PublisherService, AdminService, CatalogService, UploadService, FakeProvider, ProviderRegistry, PaymentsService, CommerceService, RefundsService,
    EntitlementsConsumer, EntitlementsService, RoyaltyConsumer, ReadingService, { provide: StorageService, useClass: LocalStorageService }],
})
export class AppModule {}
