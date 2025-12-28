'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Header } from '@/components/Header'
import { apiRequest, downloadDocument } from '@/lib/api'

interface Document {
  id: string
  name: string
  status: string
  createdAt: string
  sizeBytes?: number
}

export default function DocumentsPage() {
  const [search, setSearch] = useState('')
  
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['documents'],
    queryFn: () => apiRequest('/documents?limit=50'),
    refetchInterval: 10000,
  })

  const { data: searchResults } = useQuery({
    queryKey: ['search', search],
    queryFn: () => apiRequest(`/documents/search?q=${encodeURIComponent(search)}&limit=20`),
    enabled: search.length > 2,
  })

  const documents = search.length > 2 ? searchResults?.results : data?.documents

  async function handleDelete(id: string) {
    if (!confirm('Delete this document?')) return
    
    try {
      await apiRequest(`/documents/${id}`, { method: 'DELETE' })
      refetch()
    } catch (error) {
      alert('Delete failed: ' + (error as Error).message)
    }
  }

  async function handleDownload(id: string) {
    try {
      await downloadDocument(id)
    } catch (error) {
      alert('Download failed: ' + (error as Error).message)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Documents</h1>
          <input
            type="search"
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg w-64"
          />
        </div>

        {isLoading ? (
          <div className="text-center py-12">Loading...</div>
        ) : documents?.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No documents found</div>
        ) : (
          <div className="grid gap-4">
            {documents?.map((doc: Document) => (
              <div key={doc.id} className="bg-white p-6 rounded-lg shadow-sm flex items-center justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-lg">{doc.name}</h3>
                  <div className="flex gap-4 mt-2 text-sm text-gray-600">
                    <span className={getStatusColor(doc.status)}>{doc.status}</span>
                    <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                    {doc.sizeBytes && (
                      <span>{(doc.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                    )}
                  </div>
                </div>
                
                <div className="flex gap-2">
                  {doc.status === 'READY' && (
                    <button
                      onClick={() => handleDownload(doc.id)}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
                    >
                      Download
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function getStatusColor(status: string) {
  const colors: Record<string, string> = {
    UPLOADING: 'text-blue-500',
    UPLOADED: 'text-blue-600',
    PROCESSING: 'text-yellow-500',
    READY: 'text-green-500',
    FAILED: 'text-red-500',
    DELETED: 'text-gray-500',
  }
  return colors[status] || 'text-gray-500'
}
