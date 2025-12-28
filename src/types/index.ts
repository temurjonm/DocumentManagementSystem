export type DocumentStatus =
  | 'UPLOADING'
  | 'UPLOADED'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED'
  | 'DELETED'
  | 'DELETING';

export type JobType = 'OCR' | 'THUMBNAIL' | 'PDF_SPLIT' | 'MALWARE_SCAN';

export type JobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export type AuditAction =
  | 'UPLOAD'
  | 'DOWNLOAD'
  | 'DELETE'
  | 'PROCESS_START'
  | 'PROCESS_COMPLETE'
  | 'PROCESS_FAILED'
  | 'LEGAL_HOLD_SET'
  | 'LEGAL_HOLD_REMOVED'
  | 'PERMANENT_DELETE';

export interface Tenant {
  id: string;
  name: string;
  kmsKeyArn?: string;
  createdAt: Date;
}

export interface Document {
  id: string;
  tenantId: string;
  name: string;
  ownerId: string;
  status: DocumentStatus;
  legalHold: boolean;
  deletedAt?: Date;
  retentionDays: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  s3Key: string;
  s3Bucket: string;
  sha256: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: Date;
}

export interface ProcessingJob {
  id: string;
  documentId: string;
  versionId: string;
  jobType: JobType;
  status: JobStatus;
  attempts: number;
  errorMessage?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

export interface ProcessingRules {
  id: string;
  tenantId: string;
  mimeTypePattern: string;
  rules: {
    ocr?: boolean;
    thumbnail?: { sizes: number[] };
    pdfSplit?: boolean;
    malwareScan?: boolean;
  };
  createdAt: Date;
}

export interface AuditLog {
  id: string;
  tenantId: string;
  userId?: string;
  action: AuditAction;
  documentId?: string;
  ipAddress?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export interface UploadUrl {
  url: string;
  expiresAt: Date;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  email: string;
  scopes: string[];
}
