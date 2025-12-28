# Document Management System - UI Integration Guide

## Overview

This guide provides information for frontend developers building web applications that integrate with the Document Management System (DMS) API. The DMS is designed to support web UIs similar to OneDrive or Google Drive, with secure document upload, management, and download capabilities.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication Flow](#authentication-flow)
3. [Document Upload Flow](#document-upload-flow)
4. [Document Download Flow](#document-download-flow)
5. [Document Management](#document-management)
6. [Search Integration](#search-integration)
7. [Real-time Updates](#real-time-updates)
8. [Error Handling](#error-handling)
9. [Security Considerations](#security-considerations)
10. [Example Implementation](#example-implementation)

## Architecture Overview

### Frontend Stack Recommendation

**Recommended Stack:**
- **Framework**: Next.js 14+ (React with App Router)
- **Styling**: Tailwind CSS
- **State Management**: React Query (TanStack Query) for server state
- **File Upload**: Native File API with progress tracking
- **Authentication**: NextAuth.js with Cognito provider
- **Deployment**: Vercel or CloudFront + S3

**Why Next.js?**
- Server-side rendering for better SEO and initial load
- API routes for backend-for-frontend (BFF) pattern
- Built-in optimization for images and assets
- Excellent TypeScript support
- Easy deployment to Vercel or AWS

### Client-Server Interaction

```
┌─────────────────┐
│   Next.js UI    │
│  (CloudFront)   │
└────────┬────────┘
         │
         ├─────────────────┐
         │                 │
         ▼                 ▼
┌─────────────────┐  ┌──────────────┐
│   API Gateway   │  │   S3 Bucket  │
│   (REST API)    │  │  (Direct)    │
└─────────────────┘  └──────────────┘
         │
         ▼
┌─────────────────┐
│  Backend APIs   │
│   (Lambda)      │
└─────────────────┘
```

**Key Principle**: Files never go through the backend. The UI uploads/downloads directly to/from S3 using pre-signed URLs.

## Authentication Flow

### 1. User Login

```typescript
// Using NextAuth.js with Cognito
import NextAuth from "next-auth"
import CognitoProvider from "next-auth/providers/cognito"

export const authOptions = {
  providers: [
    CognitoProvider({
      clientId: process.env.COGNITO_CLIENT_ID,
      clientSecret: process.env.COGNITO_CLIENT_SECRET,
      issuer: process.env.COGNITO_ISSUER,
    })
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token
        token.idToken = account.id_token
      }
      return token
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken
      session.idToken = token.idToken
      return session
    }
  }
}

export default NextAuth(authOptions)
```

### 2. API Request Authentication

All API requests must include the JWT token in the Authorization header:

```typescript
// lib/api-client.ts
import { getSession } from "next-auth/react"

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const session = await getSession()
  
  if (!session?.idToken) {
    throw new Error("Not authenticated")
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${endpoint}`, {
    ...options,
    headers: {
      ...options.headers,
      'Authorization': `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error.message)
  }

  return response.json()
}
```

## Document Upload Flow

### Step-by-Step Process

1. **User selects file** in the UI
2. **UI requests pre-signed URL** from backend API
3. **Backend validates permissions** and returns pre-signed URL
4. **UI uploads directly to S3** using the pre-signed URL
5. **S3 triggers processing** via EventBridge
6. **UI polls for status** or receives real-time updates

### Implementation Example

```typescript
// components/FileUpload.tsx
import { useState } from 'react'
import { apiRequest } from '@/lib/api-client'

export function FileUpload() {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  async function handleFileUpload(file: File) {
    setUploading(true)
    setProgress(0)

    try {
      // Step 1: Request pre-signed URL from backend
      const { documentId, uploadUrl, expiresAt } = await apiRequest(
        '/documents/init-upload',
        {
          method: 'POST',
          body: JSON.stringify({
            fileName: file.name,
            mimeType: file.type,
            size: file.size,
          }),
        }
      )

      // Step 2: Upload directly to S3
      const xhr = new XMLHttpRequest()

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          setProgress((e.loaded / e.total) * 100)
        }
      })

      xhr.addEventListener('load', () => {
        if (xhr.status === 200) {
          console.log('Upload complete:', documentId)
          // Poll for processing status or navigate to document
          pollDocumentStatus(documentId)
        } else {
          throw new Error('Upload failed')
        }
      })

      xhr.addEventListener('error', () => {
        throw new Error('Upload failed')
      })

      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.send(file)

    } catch (error) {
      console.error('Upload error:', error)
      alert('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  async function pollDocumentStatus(documentId: string) {
    const maxAttempts = 60 // 5 minutes with 5-second intervals
    let attempts = 0

    const interval = setInterval(async () => {
      attempts++

      try {
        const document = await apiRequest(`/documents/${documentId}`)

        if (document.status === 'READY') {
          clearInterval(interval)
          console.log('Document ready:', document)
          // Navigate to document or show success message
        } else if (document.status === 'FAILED') {
          clearInterval(interval)
          console.error('Processing failed')
          // Show error message
        } else if (attempts >= maxAttempts) {
          clearInterval(interval)
          console.warn('Polling timeout')
          // Show timeout message
        }
      } catch (error) {
        clearInterval(interval)
        console.error('Status check failed:', error)
      }
    }, 5000)
  }

  return (
    <div>
      <input
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFileUpload(file)
        }}
        disabled={uploading}
      />
      {uploading && (
        <div>
          <progress value={progress} max={100} />
          <span>{Math.round(progress)}%</span>
        </div>
      )}
    </div>
  )
}
```

### Drag-and-Drop Upload

```typescript
// components/DropZone.tsx
import { useCallback } from 'react'
import { useDropzone } from 'react-dropzone'

export function DropZone({ onFilesSelected }: { onFilesSelected: (files: File[]) => void }) {
  const onDrop = useCallback((acceptedFiles: File[]) => {
    onFilesSelected(acceptedFiles)
  }, [onFilesSelected])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'image/*': ['.png', '.jpg', '.jpeg'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxSize: 524288000, // 500MB
  })

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-12 text-center cursor-pointer
        transition-colors duration-200
        ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
      `}
    >
      <input {...getInputProps()} />
      {isDragActive ? (
        <p>Drop files here...</p>
      ) : (
        <div>
          <p>Drag and drop files here, or click to select</p>
          <p className="text-sm text-gray-500 mt-2">
            Supported: PDF, Images, Word, Excel (max 500MB)
          </p>
        </div>
      )}
    </div>
  )
}
```

## Document Download Flow

### Implementation

```typescript
// lib/download.ts
import { apiRequest } from './api-client'

export async function downloadDocument(documentId: string, fileName: string) {
  try {
    // Step 1: Get pre-signed download URL
    const { downloadUrl } = await apiRequest(`/documents/${documentId}/download`)

    // Step 2: Download from S3
    const response = await fetch(downloadUrl)
    const blob = await response.blob()

    // Step 3: Trigger browser download
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    window.URL.revokeObjectURL(url)
    document.body.removeChild(a)
  } catch (error) {
    console.error('Download failed:', error)
    throw error
  }
}
```

### Download Button Component

```typescript
// components/DownloadButton.tsx
import { useState } from 'react'
import { downloadDocument } from '@/lib/download'

export function DownloadButton({ documentId, fileName }: { documentId: string; fileName: string }) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadDocument(documentId, fileName)
    } catch (error) {
      alert('Download failed. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={downloading}
      className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
    >
      {downloading ? 'Downloading...' : 'Download'}
    </button>
  )
}
```

## Document Management

### Document List with React Query

```typescript
// hooks/useDocuments.ts
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api-client'

export function useDocuments(filters?: {
  status?: string
  owner?: string
  fromDate?: string
  toDate?: string
  limit?: number
  offset?: number
}) {
  return useQuery({
    queryKey: ['documents', filters],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.status) params.append('status', filters.status)
      if (filters?.owner) params.append('owner', filters.owner)
      if (filters?.fromDate) params.append('fromDate', filters.fromDate)
      if (filters?.toDate) params.append('toDate', filters.toDate)
      if (filters?.limit) params.append('limit', filters.limit.toString())
      if (filters?.offset) params.append('offset', filters.offset.toString())

      return apiRequest(`/documents?${params.toString()}`)
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  })
}
```

### Document List Component

```typescript
// components/DocumentList.tsx
import { useDocuments } from '@/hooks/useDocuments'
import { DownloadButton } from './DownloadButton'

export function DocumentList() {
  const { data, isLoading, error } = useDocuments({ limit: 20 })

  if (isLoading) return <div>Loading...</div>
  if (error) return <div>Error loading documents</div>

  return (
    <div className="space-y-4">
      {data?.documents.map((doc) => (
        <div key={doc.id} className="border rounded-lg p-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{doc.name}</h3>
            <p className="text-sm text-gray-500">
              Status: <span className={getStatusColor(doc.status)}>{doc.status}</span>
            </p>
            <p className="text-sm text-gray-500">
              Uploaded: {new Date(doc.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-2">
            {doc.status === 'READY' && (
              <DownloadButton documentId={doc.id} fileName={doc.name} />
            )}
            <button
              onClick={() => handleDelete(doc.id)}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function getStatusColor(status: string) {
  const colors = {
    UPLOADING: 'text-blue-500',
    UPLOADED: 'text-blue-600',
    PROCESSING: 'text-yellow-500',
    READY: 'text-green-500',
    FAILED: 'text-red-500',
    DELETED: 'text-gray-500',
  }
  return colors[status] || 'text-gray-500'
}
```

## Search Integration

### Search Hook

```typescript
// hooks/useSearch.ts
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api-client'

export function useSearch(query: string, limit = 20) {
  return useQuery({
    queryKey: ['search', query, limit],
    queryFn: async () => {
      if (!query) return { results: [], total: 0 }
      
      const params = new URLSearchParams({ q: query, limit: limit.toString() })
      return apiRequest(`/documents/search?${params.toString()}`)
    },
    enabled: query.length > 0,
  })
}
```

### Search Component

```typescript
// components/Search.tsx
import { useState } from 'react'
import { useSearch } from '@/hooks/useSearch'
import { useDebounce } from '@/hooks/useDebounce'

export function Search() {
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)
  const { data, isLoading } = useSearch(debouncedQuery)

  return (
    <div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search documents..."
        className="w-full px-4 py-2 border rounded-lg"
      />
      
      {isLoading && <div>Searching...</div>}
      
      {data?.results && (
        <div className="mt-4 space-y-2">
          {data.results.map((result) => (
            <div key={result.id} className="border rounded p-4">
              <h3 className="font-semibold">{result.name}</h3>
              {result.excerpt && (
                <p className="text-sm text-gray-600 mt-1">{result.excerpt}</p>
              )}
              <p className="text-xs text-gray-500 mt-2">
                Relevance: {(result.relevanceScore * 100).toFixed(0)}%
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

## Real-time Updates

### WebSocket Alternative: Polling with React Query

Since the backend uses EventBridge and doesn't expose WebSockets, use React Query's automatic refetching:

```typescript
// hooks/useDocumentStatus.ts
import { useQuery } from '@tanstack/react-query'
import { apiRequest } from '@/lib/api-client'

export function useDocumentStatus(documentId: string) {
  return useQuery({
    queryKey: ['document', documentId],
    queryFn: () => apiRequest(`/documents/${documentId}`),
    refetchInterval: (data) => {
      // Stop polling when document is ready or failed
      if (data?.status === 'READY' || data?.status === 'FAILED') {
        return false
      }
      // Poll every 5 seconds while processing
      return 5000
    },
  })
}
```

### Status Badge Component

```typescript
// components/StatusBadge.tsx
export function StatusBadge({ status }: { status: string }) {
  const config = {
    UPLOADING: { color: 'bg-blue-100 text-blue-800', icon: '⬆️' },
    UPLOADED: { color: 'bg-blue-200 text-blue-900', icon: '✓' },
    PROCESSING: { color: 'bg-yellow-100 text-yellow-800', icon: '⚙️' },
    READY: { color: 'bg-green-100 text-green-800', icon: '✓' },
    FAILED: { color: 'bg-red-100 text-red-800', icon: '✗' },
    DELETED: { color: 'bg-gray-100 text-gray-800', icon: '🗑️' },
  }

  const { color, icon } = config[status] || config.UPLOADING

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      <span className="mr-1">{icon}</span>
      {status}
    </span>
  )
}
```

## Error Handling

### Global Error Handler

```typescript
// lib/error-handler.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public requestId?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function handleApiError(error: any) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'UNAUTHORIZED':
        // Redirect to login
        window.location.href = '/login'
        break
      case 'FORBIDDEN':
        alert('You do not have permission to perform this action')
        break
      case 'NOT_FOUND':
        alert('Document not found')
        break
      case 'PAYLOAD_TOO_LARGE':
        alert('File is too large. Maximum size is 500MB')
        break
      default:
        alert(`Error: ${error.message}`)
    }
  } else {
    alert('An unexpected error occurred. Please try again.')
  }
}
```

### Error Boundary Component

```typescript
// components/ErrorBoundary.tsx
import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center">
          <h2 className="text-2xl font-bold text-red-600 mb-4">Something went wrong</h2>
          <p className="text-gray-600 mb-4">{this.state.error?.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
```

## Security Considerations

### 1. Content Security Policy

```typescript
// next.config.js
const nextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https:",
              "connect-src 'self' https://api.dms.example.com https://*.s3.amazonaws.com",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ]
  },
}
```

### 2. Input Validation

```typescript
// lib/validation.ts
export function validateFile(file: File): { valid: boolean; error?: string } {
  const maxSize = 524288000 // 500MB
  const allowedTypes = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]

  if (file.size > maxSize) {
    return { valid: false, error: 'File size exceeds 500MB limit' }
  }

  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'File type not supported' }
  }

  return { valid: true }
}
```

### 3. XSS Prevention

Always sanitize user input and use React's built-in XSS protection:

```typescript
// components/DocumentName.tsx
import DOMPurify from 'isomorphic-dompurify'

export function DocumentName({ name }: { name: string }) {
  // React automatically escapes text content, but for HTML:
  const sanitized = DOMPurify.sanitize(name)
  
  return <span>{name}</span> // Safe by default in React
}
```

## Example Implementation

### Complete Upload Page

```typescript
// app/upload/page.tsx
'use client'

import { useState } from 'react'
import { DropZone } from '@/components/DropZone'
import { FileUpload } from '@/components/FileUpload'
import { validateFile } from '@/lib/validation'

export default function UploadPage() {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)

  function handleFilesSelected(selectedFiles: File[]) {
    const validFiles = selectedFiles.filter((file) => {
      const validation = validateFile(file)
      if (!validation.valid) {
        alert(`${file.name}: ${validation.error}`)
        return false
      }
      return true
    })

    setFiles((prev) => [...prev, ...validFiles])
  }

  async function handleUploadAll() {
    setUploading(true)
    try {
      await Promise.all(files.map((file) => uploadFile(file)))
      alert('All files uploaded successfully!')
      setFiles([])
    } catch (error) {
      alert('Some uploads failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Upload Documents</h1>
      
      <DropZone onFilesSelected={handleFilesSelected} />
      
      {files.length > 0 && (
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Selected Files ({files.length})</h2>
          <ul className="space-y-2">
            {files.map((file, index) => (
              <li key={index} className="flex items-center justify-between border rounded p-3">
                <span>{file.name}</span>
                <span className="text-sm text-gray-500">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              </li>
            ))}
          </ul>
          
          <button
            onClick={handleUploadAll}
            disabled={uploading}
            className="mt-4 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload All'}
          </button>
        </div>
      )}
    </div>
  )
}
```

## Performance Optimization

### 1. Code Splitting

```typescript
// app/documents/page.tsx
import dynamic from 'next/dynamic'

const DocumentList = dynamic(() => import('@/components/DocumentList'), {
  loading: () => <div>Loading documents...</div>,
  ssr: false,
})

export default function DocumentsPage() {
  return <DocumentList />
}
```

### 2. Image Optimization

```typescript
// components/ThumbnailPreview.tsx
import Image from 'next/image'

export function ThumbnailPreview({ documentId, alt }: { documentId: string; alt: string }) {
  return (
    <Image
      src={`/api/thumbnails/${documentId}`}
      alt={alt}
      width={100}
      height={100}
      className="rounded"
      loading="lazy"
    />
  )
}
```

### 3. Caching Strategy

```typescript
// lib/api-client.ts
const cache = new Map()

export async function cachedApiRequest(endpoint: string, ttl = 60000) {
  const cached = cache.get(endpoint)
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data
  }

  const data = await apiRequest(endpoint)
  cache.set(endpoint, { data, timestamp: Date.now() })
  return data
}
```

## Testing

### Unit Tests

```typescript
// __tests__/upload.test.ts
import { validateFile } from '@/lib/validation'

describe('File Validation', () => {
  it('should accept valid PDF files', () => {
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
    const result = validateFile(file)
    expect(result.valid).toBe(true)
  })

  it('should reject files over 500MB', () => {
    const file = new File(['x'.repeat(524288001)], 'large.pdf', { type: 'application/pdf' })
    const result = validateFile(file)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('500MB')
  })
})
```

### Integration Tests

```typescript
// __tests__/upload-flow.test.ts
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileUpload } from '@/components/FileUpload'

describe('Upload Flow', () => {
  it('should upload file successfully', async () => {
    render(<FileUpload />)
    
    const file = new File(['content'], 'test.pdf', { type: 'application/pdf' })
    const input = screen.getByLabelText(/upload/i)
    
    await userEvent.upload(input, file)
    
    await waitFor(() => {
      expect(screen.getByText(/upload complete/i)).toBeInTheDocument()
    })
  })
})
```

## Deployment

### Environment Variables

```bash
# .env.local
NEXT_PUBLIC_API_URL=https://api.dms.example.com/api/v1
NEXT_PUBLIC_COGNITO_DOMAIN=https://auth.dms.example.com
COGNITO_CLIENT_ID=your_client_id
COGNITO_CLIENT_SECRET=your_client_secret
COGNITO_ISSUER=https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ABC123
NEXTAUTH_URL=https://app.dms.example.com
NEXTAUTH_SECRET=your_nextauth_secret
```

### Build and Deploy

```bash
# Build for production
npm run build

# Deploy to Vercel
vercel --prod

# Or deploy to AWS (CloudFront + S3)
npm run build
aws s3 sync out/ s3://dms-frontend-prod/
aws cloudfront create-invalidation --distribution-id E123456 --paths "/*"
```

## Support

For API documentation, see [API Specification](./api-spec.yaml)

For backend deployment, see [Deployment Guide](./deployment-guide.md)

For operations, see [Operational Runbook](./operational-runbook.md)
