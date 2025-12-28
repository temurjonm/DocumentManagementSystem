'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Header } from '@/components/Header'
import { uploadFile } from '@/lib/api'

export default function UploadPage() {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<Record<string, number>>({})

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const droppedFiles = Array.from(e.dataTransfer.files)
    setFiles(prev => [...prev, ...droppedFiles])
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)])
    }
  }

  async function handleUpload() {
    setUploading(true)
    
    try {
      for (const file of files) {
        setProgress(prev => ({ ...prev, [file.name]: 0 }))
        await uploadFile(file)
        setProgress(prev => ({ ...prev, [file.name]: 100 }))
      }
      
      router.push('/documents')
    } catch (error) {
      alert('Upload failed: ' + (error as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-8">Upload Documents</h1>
        
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-gray-400 transition"
        >
          <input
            type="file"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            id="file-input"
          />
          <label htmlFor="file-input" className="cursor-pointer">
            <div className="text-gray-600">
              <p className="text-lg mb-2">Drop files here or click to select</p>
              <p className="text-sm">Supported: PDF, Images, Word, Excel (max 500MB)</p>
            </div>
          </label>
        </div>

        {files.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xl font-semibold mb-4">Selected Files ({files.length})</h2>
            <div className="space-y-2">
              {files.map((file, i) => (
                <div key={i} className="flex items-center justify-between bg-white p-4 rounded-lg shadow-sm">
                  <span className="truncate">{file.name}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                    {progress[file.name] !== undefined && (
                      <span className="text-sm text-green-600">{progress[file.name]}%</span>
                    )}
                    <button
                      onClick={() => setFiles(files.filter((_, idx) => idx !== i))}
                      className="text-red-600 hover:text-red-700"
                      disabled={uploading}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="mt-6 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg disabled:opacity-50 transition"
            >
              {uploading ? 'Uploading...' : 'Upload All'}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
