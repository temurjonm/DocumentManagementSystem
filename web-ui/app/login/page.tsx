'use client'

import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

export default function LoginPage() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')

  async function handleCognitoSignIn() {
    await signIn('cognito', { callbackUrl: '/documents' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="text-3xl font-bold text-center">Document Management System</h2>
          <p className="mt-2 text-center text-gray-600">Sign in to continue</p>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            Authentication failed. Please try again.
          </div>
        )}

        <button
          onClick={handleCognitoSignIn}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition"
        >
          Sign in with Cognito
        </button>
        
        <p className="text-xs text-center text-gray-500">
          You will be redirected to AWS Cognito for authentication
        </p>
      </div>
    </div>
  )
}
