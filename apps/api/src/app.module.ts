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
import { EventBus } from './events/event-bus';
import { FakeProvider } from './payments/fake.provider';
import { ProviderRegistry } from './payments/provider.registry';
import { PaymentsService } from './payments/payments.service';
import { DevController } from './payments/dev.controller';
import { PaymentsController } from './payments/payments.controller';
import { CommerceService } from './commerce/commerce.service';
import { CommerceController } from './commerce/commerce.controller';
import { RefundsService } from './commerce/refunds.service';
import { EntitlementsConsumer } from './entitlements/entitlements.consumer';
import { EntitlementsService } from './entitlements/entitlements.service';
import { EntitlementsController } from './entitlements/entitlements.controller';
import { ReadingService } from './reading/reading.service';
import { ReadingController } from './reading/reading.controller';
import { ReaderController } from './reader/reader.controller';
import { ReaderService } from './reader/reader.service';
import { RoyaltyConsumer } from './royalty/royalty.consumer';
import { LocalStorageService, StorageService } from './storage/storage.service';
import { S3StorageService } from './storage/s3-storage.service';

/** S3_BUCKET definido ⇒ S3/R2/MinIO; senão disco local (dev). */
const storageProvider = { provide: StorageService, useFactory: (): StorageService => process.env.S3_BUCKET
  ? new S3StorageService({ bucket: process.env.S3_BUCKET, region: process.env.S3_REGION, endpoint: process.env.S3_ENDPOINT, publicEndpoint: process.env.S3_PUBLIC_ENDPOINT, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true' })
  : new LocalStorageService() };

@Controller('health')
class HealthController {
  constructor(private db: DbService, private bus: EventBus) {}
  @Get() async health() { await this.db.query('SELECT 1'); return { status: 'ok', broker: this.bus.isReady() }; }
}

@Module({
  imports: [DbModule, EventsModule, IdentityModule],
  controllers: [HealthController, PublisherController, AdminController, CatalogController, UploadController, CommerceController, PaymentsController, EntitlementsController, ReadingController, ReaderController, DevController],
  providers: [PublisherService, AdminService, CatalogService, UploadService, FakeProvider, ProviderRegistry, PaymentsService, CommerceService, RefundsService,
    EntitlementsConsumer, EntitlementsService, RoyaltyConsumer, ReadingService, ReaderService, storageProvider],
})
export class AppModule {}
