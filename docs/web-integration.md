# Web Integration Guide

How to integrate the DMS API into your web application.

## Quick Start

We recommend Next.js 14+ with TypeScript, but any framework works.

Required:
- JWT authentication with Cognito
- File upload directly to S3 (not through backend)
- API calls with Bearer token

## Authentication

### Setup NextAuth with Cognito

```typescript
// app/api/auth/[...nextauth]/route.ts
import NextAuth from 'next-auth';
import CognitoProvider from 'next-auth/providers/cognito';

const handler = NextAuth({
  providers: [
    CognitoProvider({
      clientId: process.env.COGNITO_CLIENT_ID!,
      clientSecret: process.env.COGNITO_CLIENT_SECRET!,
      issuer: process.env.COGNITO_ISSUER,
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.idToken = account.id_token;
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.idToken = token.idToken;
      session.accessToken = token.accessToken;
      return session;
    },
  },
});

export { handler as GET, handler as POST };
```

### Make authenticated requests

```typescript
// lib/api.ts
import { getSession } from 'next-auth/react';

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const session = await getSession();
  
  if (!session?.idToken) {
    throw new Error('Not authenticated');
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error.message);
  }

  return response.json();
}
```

## Upload Documents

### Upload flow

1. User selects file
2. Request pre-signed URL from API
3. Upload directly to S3
4. Poll for processing status

### Implementation

```typescript
// components/upload.tsx
'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/api';

export function FileUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleUpload(file: File) {
    setUploading(true);
    setProgress(0);

    try {
      // Step 1: Get pre-signed URL
      const { uploadUrl, documentId } = await apiRequest('/documents/init-upload', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        }),
      });

      // Step 2: Upload to S3
      const xhr = new XMLHttpRequest();
      
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setProgress((e.loaded / e.total) * 100);
        }
      });

      await new Promise((resolve, reject) => {
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.onload = () => (xhr.status === 200 ? resolve(xhr) : reject(xhr));
        xhr.onerror = reject;
        xhr.send(file);
      });

      // Step 3: Poll for status
      await pollStatus(documentId);

      alert('Upload successful!');
    } catch (error) {
      alert('Upload failed: ' + error.message);
    } finally {
      setUploading(false);
    }
  }

  async function pollStatus(documentId: string) {
    const maxAttempts = 60;
    let attempts = 0;

    while (attempts < maxAttempts) {
      const doc = await apiRequest(`/documents/${documentId}`);
      
      if (doc.status === 'ready') return;
      if (doc.status === 'failed') throw new Error('Processing failed');
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      attempts++;
    }
    
    throw new Error('Processing timeout');
  }

  return (
    <div>
      <input
        type="file"
        onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        disabled={uploading}
      />
      {uploading && <progress value={progress} max={100} />}
    </div>
  );
}
```

## List Documents

```typescript
// app/documents/page.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';

export default function DocumentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => apiRequest('/documents?limit=50'),
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Documents</h1>
      <table>
        <thead>
          <tr>
            <th>Filename</th>
            <th>Size</th>
            <th>Uploaded</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.documents.map((doc) => (
            <tr key={doc.id}>
              <td>{doc.filename}</td>
              <td>{formatBytes(doc.size)}</td>
              <td>{new Date(doc.uploadedAt).toLocaleDateString()}</td>
              <td>{doc.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
```

## Download Documents

```typescript
async function downloadDocument(documentId: string) {
  // Get pre-signed download URL
  const { downloadUrl } = await apiRequest(`/documents/${documentId}/download`);
  
  // Open in new tab or download
  window.open(downloadUrl, '_blank');
}
```

## Search Documents

```typescript
// components/search.tsx
'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/api';

export function DocumentSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  async function handleSearch() {
    setSearching(true);
    try {
      const data = await apiRequest('/documents/search', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      setResults(data.documents);
    } catch (error) {
      alert('Search failed: ' + error.message);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        placeholder="Search documents..."
      />
      <button onClick={handleSearch} disabled={searching}>
        Search
      </button>

      {results.map((doc) => (
        <div key={doc.id}>
          <h3>{doc.filename}</h3>
          <p>{doc.excerpt}</p>
        </div>
      ))}
    </div>
  );
}
```

## Delete Documents

```typescript
async function deleteDocument(documentId: string) {
  if (!confirm('Delete this document?')) return;

  await apiRequest(`/documents/${documentId}`, {
    method: 'DELETE',
  });

  // Refresh document list
  queryClient.invalidateQueries(['documents']);
}
```

## Error Handling

```typescript
// lib/api.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
  }
}

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const session = await getSession();
  
  if (!session?.idToken) {
    throw new ApiError('Not authenticated', 401, 'UNAUTHORIZED');
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new ApiError(
      error.error.message,
      response.status,
      error.error.code
    );
  }

  return response.json();
}

// Usage with error handling
try {
  await apiRequest('/documents/upload', { ... });
} catch (error) {
  if (error instanceof ApiError) {
    if (error.code === 'QUOTA_EXCEEDED') {
      alert('Storage quota exceeded');
    } else if (error.code === 'INVALID_FILE_TYPE') {
      alert('File type not allowed');
    } else {
      alert(`Error: ${error.message}`);
    }
  }
}
```

## Common Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `UNAUTHORIZED` | Invalid or expired token | Re-authenticate |
| `FORBIDDEN` | No permission | Check user role |
| `NOT_FOUND` | Document doesn't exist | Refresh list |
| `QUOTA_EXCEEDED` | Storage limit reached | Upgrade plan or delete files |
| `INVALID_FILE_TYPE` | File type not allowed | Check allowed types |
| `FILE_TOO_LARGE` | File exceeds size limit | Reduce file size |

## Environment Variables

```bash
# .env.local
NEXT_PUBLIC_API_URL=https://your-api-gateway-url.amazonaws.com
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-secret-here

COGNITO_CLIENT_ID=your-client-id
COGNITO_CLIENT_SECRET=your-client-secret
COGNITO_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxxxx
```

## React Query Setup

```typescript
// app/providers.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      retry: 1,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </SessionProvider>
  );
}
```

## Complete Example

See the `web-ui/` directory for a complete working example with:
- Authentication with Cognito
- Document upload with progress
- Document list with pagination
- Search functionality
- Download and delete actions
- Error handling
- Loading states

## Security Notes

**Never**:
- Send files through your backend (use pre-signed URLs)
- Store JWT tokens in localStorage (use httpOnly cookies)
- Expose API keys in client code
- Skip JWT validation

**Always**:
- Validate file size on client before upload
- Show upload progress to users
- Handle network errors gracefully
- Use HTTPS in production
- Implement CSRF protection

## Testing

```typescript
// Mock API for testing
export function mockApiRequest(endpoint: string, options: RequestInit = {}) {
  if (endpoint === '/documents') {
    return Promise.resolve({
      documents: [
        { id: '1', filename: 'test.pdf', size: 1024, status: 'ready' }
      ]
    });
  }
  return Promise.reject(new Error('Not found'));
}
```

Use mock in tests, real API in production.
