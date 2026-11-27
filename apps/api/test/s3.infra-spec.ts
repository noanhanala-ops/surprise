import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { S3StorageService } from '../src/storage/s3-storage.service';
import { requireInfra } from './infra-env';

describe('S3 real: StorageService adapter', () => {
  let s3: S3StorageService; const bucket = `drp-s3-${Date.now()}`;
  beforeAll(async () => {
    requireInfra(['S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
    await new S3Client({ region: 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: true }).send(new CreateBucketCommand({ Bucket: bucket }));
    s3 = new S3StorageService({ bucket, region: 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: true });
  });
  it('put/get/head/delete preservam os bytes exactos', async () => {
    const data = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));
    expect(await s3.head('a/b.bin')).toBeNull();
    await s3.put('a/b.bin', data, 'application/octet-stream');
    expect(await s3.head('a/b.bin')).toEqual({ size: 4096 }); expect(Buffer.compare(await s3.get('a/b.bin'), data)).toBe(0);
    await s3.delete('a/b.bin'); expect(await s3.head('a/b.bin')).toBeNull();
  });
  it('URL pré-assinada de PUT permite carregar directamente para o bucket', async () => {
    expect(s3.supportsDirectUpload()).toBe(true);
    const body = Buffer.from('conteúdo carregado directamente');
    const url = await s3.signedPutUrl('staging/x', { ttlSeconds: 60, contentType: 'application/epub+zip', size: body.length });
    expect(url).toMatch(/X-Amz-Signature=/);
    const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/epub+zip' }, body }); expect(r.ok).toBe(true);
    expect(Buffer.compare(await s3.get('staging/x'), body)).toBe(0);
  });
  it('get de chave inexistente falha (não devolve vazio)', async () => { await expect(s3.get('nao/existe')).rejects.toBeDefined(); });
});
