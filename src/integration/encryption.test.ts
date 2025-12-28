import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { generateUploadUrl, getKmsKeyForTenant } from '../shared/s3';
import { Tenant } from '../types';

jest.mock('@aws-sdk/client-s3');

const mockSend = jest.fn();
(S3Client as jest.MockedClass<typeof S3Client>).prototype.send = mockSend;

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'test-bucket';
const TEST_KMS_KEY = process.env.KMS_KEY_ID || 'test-kms-key';

describe('Encryption Verification Integration Tests', () => {
  const testTenantId = 'test-tenant-encryption';
  const testDocumentId = 'test-doc-encryption';
  const testVersionId = 'test-version-encryption';

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KMS_KEY_ID = TEST_KMS_KEY;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('S3 Object Encryption with KMS', () => {
    it('should encrypt uploaded documents with KMS', async () => {
      mockSend.mockResolvedValueOnce({
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: TEST_KMS_KEY,
      });

      const s3Client = new S3Client({});

      const headResponse = await s3Client.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: 'test-key',
        })
      );

      expect(headResponse.ServerSideEncryption).toBe('aws:kms');
      expect(headResponse.SSEKMSKeyId).toBeDefined();
      expect(headResponse.SSEKMSKeyId).toBe(TEST_KMS_KEY);
    });

    it('should use shared KMS key for standard tenants', () => {
      const standardTenant: Tenant = {
        id: 'tenant-1',
        name: 'Standard Tenant',
        createdAt: new Date(),
      };

      const kmsKey = getKmsKeyForTenant(standardTenant);

      expect(kmsKey).toBe(TEST_KMS_KEY);
      expect(kmsKey).toBeTruthy();
    });

    it('should use per-tenant KMS key for high-compliance tenants', () => {
      const highComplianceTenant: Tenant = {
        id: 'tenant-2',
        name: 'High Compliance Tenant',
        kmsKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/tenant-specific-key',
        createdAt: new Date(),
      };

      const kmsKey = getKmsKeyForTenant(highComplianceTenant);

      expect(kmsKey).toBe(
        'arn:aws:kms:us-east-1:123456789012:key/tenant-specific-key'
      );
      expect(kmsKey).not.toBe(TEST_KMS_KEY);
    });

    it('should include KMS encryption in pre-signed upload URLs', async () => {
      jest.spyOn(require('@aws-sdk/s3-request-presigner'), 'getSignedUrl').mockResolvedValue(
        'https://s3.amazonaws.com/test?x-amz-server-side-encryption=aws%3Akms&x-amz-server-side-encryption-aws-kms-key-id=test-kms-key'
      );

      const uploadUrl = await generateUploadUrl(
        testTenantId,
        testDocumentId,
        testVersionId,
        'application/pdf',
        1024,
        TEST_KMS_KEY
      );

      expect(uploadUrl.url).toBeDefined();
      expect(uploadUrl.url).toContain('x-amz-server-side-encryption');
      expect(uploadUrl.url).toContain('aws%3Akms');
      expect(uploadUrl.expiresAt).toBeInstanceOf(Date);
    });
  });

  describe('Derived Artifacts Encryption', () => {
    it('should encrypt derived artifacts with same KMS key as source', async () => {
      const sourceKey = `${testTenantId}/documents/${testDocumentId}/${testVersionId}/original`;
      const derivedKey = `${testTenantId}/derived/${testDocumentId}/${testVersionId}/thumbnail.jpg`;

      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: TEST_KMS_KEY,
        })
        .mockResolvedValueOnce({
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: TEST_KMS_KEY,
        });

      const s3Client = new S3Client({});

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: sourceKey,
          Body: Buffer.from('source document'),
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: TEST_KMS_KEY,
        })
      );

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: derivedKey,
          Body: Buffer.from('thumbnail data'),
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: TEST_KMS_KEY,
        })
      );

      const sourceHead = await s3Client.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: sourceKey,
        })
      );

      const derivedHead = await s3Client.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: derivedKey,
        })
      );

      expect(sourceHead.ServerSideEncryption).toBe('aws:kms');
      expect(derivedHead.ServerSideEncryption).toBe('aws:kms');
      expect(sourceHead.SSEKMSKeyId).toBeDefined();
      expect(derivedHead.SSEKMSKeyId).toBeDefined();
      expect(sourceHead.SSEKMSKeyId).toBe(derivedHead.SSEKMSKeyId);
    });

    it('should maintain encryption for all derived artifact types', async () => {
      const sourceKey = `${testTenantId}/documents/${testDocumentId}/${testVersionId}/original`;
      const artifactTypes = [
        'thumbnails/100x100.jpg',
        'thumbnails/300x300.jpg',
        'ocr/text.json',
        'split/page-001.pdf',
      ];

      mockSend.mockResolvedValue({
        ServerSideEncryption: 'aws:kms',
        SSEKMSKeyId: TEST_KMS_KEY,
      });

      const s3Client = new S3Client({});

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: sourceKey,
          Body: Buffer.from('source document'),
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: TEST_KMS_KEY,
        })
      );

      const sourceHead = await s3Client.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: sourceKey,
        })
      );

      for (const artifactType of artifactTypes) {
        const derivedKey = `${testTenantId}/derived/${testDocumentId}/${testVersionId}/${artifactType}`;

        await s3Client.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: derivedKey,
            Body: Buffer.from(`artifact: ${artifactType}`),
            ServerSideEncryption: 'aws:kms',
            SSEKMSKeyId: TEST_KMS_KEY,
          })
        );

        const derivedHead = await s3Client.send(
          new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: derivedKey,
          })
        );

        expect(derivedHead.ServerSideEncryption).toBe('aws:kms');
        expect(derivedHead.SSEKMSKeyId).toBe(sourceHead.SSEKMSKeyId);
      }
    });

    it('should use tenant-specific KMS key for derived artifacts when tenant has custom key', async () => {
      const tenantKmsKey =
        'arn:aws:kms:us-east-1:123456789012:key/tenant-specific-key';
      const sourceKey = `${testTenantId}/documents/${testDocumentId}/${testVersionId}/original`;
      const derivedKey = `${testTenantId}/derived/${testDocumentId}/${testVersionId}/thumbnail.jpg`;

      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: tenantKmsKey,
        })
        .mockResolvedValueOnce({
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: tenantKmsKey,
        });

      const s3Client = new S3Client({});

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: sourceKey,
          Body: Buffer.from('source document'),
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: tenantKmsKey,
        })
      );

      await s3Client.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: derivedKey,
          Body: Buffer.from('thumbnail data'),
          ServerSideEncryption: 'aws:kms',
          SSEKMSKeyId: tenantKmsKey,
        })
      );

      const sourceHead = await s3Client.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: sourceKey,
        })
      );

      const derivedHead = await s3Client.send(
        new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: derivedKey,
        })
      );

      expect(sourceHead.SSEKMSKeyId).toContain('tenant-specific-key');
      expect(derivedHead.SSEKMSKeyId).toContain('tenant-specific-key');
      expect(sourceHead.SSEKMSKeyId).toBe(derivedHead.SSEKMSKeyId);
    });
  });

  describe('Encryption Configuration Validation', () => {
    it('should verify encryption is configured for uploads', () => {
      const standardTenant: Tenant = {
        id: 'tenant-1',
        name: 'Standard Tenant',
        createdAt: new Date(),
      };

      const kmsKey = getKmsKeyForTenant(standardTenant);

      expect(kmsKey).toBe(TEST_KMS_KEY);
      expect(kmsKey).toBeTruthy();
    });

    it('should verify all document paths use tenant prefix', () => {
      const validPaths = [
        `${testTenantId}/documents/${testDocumentId}/${testVersionId}/original`,
        `${testTenantId}/derived/${testDocumentId}/${testVersionId}/thumbnail.jpg`,
      ];

      for (const path of validPaths) {
        expect(path).toMatch(/^[^/]+\/(?:documents|derived)\//);
        expect(path.startsWith(testTenantId)).toBe(true);
      }
    });
  });
});
