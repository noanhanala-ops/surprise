import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageService } from './storage.service';

export interface S3Options { bucket: string; region?: string; endpoint?: string; publicEndpoint?: string; forcePathStyle?: boolean }

/** S3 / Cloudflare R2 / MinIO. O bucket tem de ser privado; o acesso é sempre mediado pela API ou por URLs pré-assinadas curtas. */
export class S3StorageService extends StorageService {
  private client: S3Client; private signer: S3Client;
  constructor(private o: S3Options) {
    super();
    const base = { region: o.region ?? 'auto', forcePathStyle: o.forcePathStyle ?? false,
      // R2/MinIO não aceitam os checksums adicionais por defeito das versões recentes do SDK
      requestChecksumCalculation: 'WHEN_REQUIRED' as const, responseChecksumValidation: 'WHEN_REQUIRED' as const };
    this.client = new S3Client({ ...base, endpoint: o.endpoint });
    // O cliente final vê o endpoint público (pode diferir do interno, ex.: em Docker).
    this.signer = new S3Client({ ...base, endpoint: o.publicEndpoint ?? o.endpoint });
  }
  supportsDirectUpload() { return true; }

  async put(key: string, data: Buffer, contentType?: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.o.bucket, Key: key, Body: data, ContentType: contentType }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.o.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.o.bucket, Key: key })); }
  async head(key: string) {
    try { const r = await this.client.send(new HeadObjectCommand({ Bucket: this.o.bucket, Key: key })); return { size: Number(r.ContentLength ?? 0) }; }
    catch (e: any) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null; throw e; }
  }
  /** O tamanho (Content-Length) e o Content-Type ficam assinados: o cliente não pode enviar outra coisa. */
  async signedPutUrl(key: string, o: { ttlSeconds: number; contentType: string; size: number }) {
    return getSignedUrl(this.signer, new PutObjectCommand({ Bucket: this.o.bucket, Key: key, ContentType: o.contentType, ContentLength: o.size }), { expiresIn: o.ttlSeconds });
  }
}
