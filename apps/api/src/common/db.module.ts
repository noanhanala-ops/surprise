import { Global, Module } from '@nestjs/common';
import { DbService } from './db.service';
import { AuditService } from './audit.service';
@Global() @Module({ providers: [DbService, AuditService], exports: [DbService, AuditService] })
export class DbModule {}
