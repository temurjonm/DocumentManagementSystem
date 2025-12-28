import { getSession } from 'next-auth/react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1'

export async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const session = await getSession()
  
  console.log('Session:', session)
  console.log('Access Token:', session?.accessToken)
  
  const bearerToken = session?.accessToken || session?.idToken

  const headers = {
    ...options.headers,
    'Content-Type': 'application/json',
    ...(bearerToken && { 'Authorization': `Bearer ${bearerToken}` }),
  }
  
  console.log('Request headers:', headers)
  
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Request failed' } }))
    throw new Error(error.error?.message || 'Request failed')
  }

  return response.json()
}

export async function uploadFile(file: File) {
  const { documentId, uploadUrl } = await apiRequest('/documents/init-upload', {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
    }),
  })

  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })

  return documentId
}

export async function downloadDocument(documentId: string) {
  const { downloadUrl, fileName } = await apiRequest(`/documents/${documentId}/download`)
  
  const response = await fetch(downloadUrl)
  const blob = await response.blob()
  
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}
