import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT || '';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const INDEX_NAME = 'dms-documents';

let client: Client | null = null;

export function getOpenSearchClient(): Client {
  if (!client) {
    if (!OPENSEARCH_ENDPOINT) {
      throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
    }

    client = new Client({
      ...AwsSigv4Signer({
        region: AWS_REGION,
        service: 'es',
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        },
      }),
      node: OPENSEARCH_ENDPOINT,
    });
  }

  return client;
}

export interface DocumentIndexData {
  document_id: string;
  tenant_id: string;
  name: string;
  owner_id: string;
  mime_type: string;
  status: string;
  extracted_text?: string;
  created_at: string;
  updated_at: string;
  size_bytes: number;
  version_number: number;
  tags?: string[];
  page_count?: number;
}

export async function indexDocument(data: DocumentIndexData): Promise<void> {
  const client = getOpenSearchClient();

  await client.index({
    index: INDEX_NAME,
    id: data.document_id,
    body: data,
    refresh: false,
  });
}

export async function searchDocuments(
  tenantId: string,
  query: string,
  limit: number = 20,
  offset: number = 0
): Promise<{ results: DocumentIndexData[]; total: number }> {
  const client = getOpenSearchClient();

  const response = await client.search({
    index: INDEX_NAME,
    body: {
      query: {
        bool: {
          must: [
            { term: { tenant_id: tenantId } },
            {
              multi_match: {
                query,
                fields: ['name^2', 'extracted_text'],
              },
            },
          ],
          filter: [
            { term: { status: 'READY' } },
          ],
          must_not: [
            { term: { status: 'DELETED' } },
            { term: { status: 'DELETING' } },
          ],
        },
      },
      sort: [{ _score: { order: 'desc' } }, { created_at: { order: 'desc' } }],
      size: limit,
      from: offset,
    },
  });

  const hits = response.body.hits.hits;
  const total =
    typeof response.body.hits.total === 'number'
      ? response.body.hits.total
      : response.body.hits.total?.value || 0;

  return {
    results: hits.map((hit: any) => hit._source),
    total,
  };
}

export async function deleteDocument(documentId: string): Promise<void> {
  const client = getOpenSearchClient();

  await client.delete({
    index: INDEX_NAME,
    id: documentId,
    refresh: false,
  });
}

export { INDEX_NAME };
