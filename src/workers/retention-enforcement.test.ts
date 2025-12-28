import { handler } from './retention-enforcement';
import { ScheduledEvent } from 'aws-lambda';
import * as db from '../shared/db';

jest.mock('../shared/db');

const mockQuery = db.query as jest.MockedFunction<typeof db.query>;

describe('Retention Enforcement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createMockEvent = (): ScheduledEvent => ({
    version: '0',
    id: 'event-id',
    'detail-type': 'Scheduled Event',
    source: 'aws.events',
    account: '123456789012',
    time: '2024-01-01T00:00:00Z',
    region: 'us-east-1',
    resources: ['arn:aws:events:us-east-1:123456789012:rule/retention-check'],
    detail: {},
  });

  it('should mark expired documents for deletion', async () => {
    const expiredDocs = [
      {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'expired1.pdf',
        deletedAt: new Date('2023-01-01'),
        retentionDays: 30,
      },
      {
        id: 'doc-2',
        tenantId: 'tenant-1',
        name: 'expired2.pdf',
        deletedAt: new Date('2023-01-15'),
        retentionDays: 30,
      },
    ];

    mockQuery
      .mockResolvedValueOnce(expiredDocs)
      .mockResolvedValue([]);

    const event = createMockEvent();
    await handler(event);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, tenant_id'),
      ['DELETED']
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE documents'),
      ['DELETING', 'doc-1']
    );

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE documents'),
      ['DELETING', 'doc-2']
    );
  });

  it('should handle no expired documents', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const event = createMockEvent();
    await handler(event);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SELECT id, tenant_id'),
      ['DELETED']
    );
  });

  it('should continue processing if one document fails', async () => {
    const expiredDocs = [
      {
        id: 'doc-1',
        tenantId: 'tenant-1',
        name: 'expired1.pdf',
        deletedAt: new Date('2023-01-01'),
        retentionDays: 30,
      },
      {
        id: 'doc-2',
        tenantId: 'tenant-1',
        name: 'expired2.pdf',
        deletedAt: new Date('2023-01-15'),
        retentionDays: 30,
      },
    ];

    mockQuery
      .mockResolvedValueOnce(expiredDocs)
      .mockRejectedValueOnce(new Error('Database error'))
      .mockResolvedValueOnce([]);

    const event = createMockEvent();
    await handler(event);

    expect(mockQuery).toHaveBeenCalledTimes(3);
  });

  it('should not mark documents with legal hold', async () => {
    mockQuery.mockResolvedValueOnce([]);

    const event = createMockEvent();
    await handler(event);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('legal_hold = false'),
      ['DELETED']
    );
  });
});
