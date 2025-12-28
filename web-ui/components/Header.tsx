'use client'

import { signOut, useSession } from 'next-auth/react'
import Link from 'next/link'

export function Header() {
  const { data: session } = useSession()

  return (
    <header className="bg-white shadow">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
        <Link href="/documents" className="text-xl font-bold text-gray-900">
          DMS
        </Link>
        
        <nav className="flex items-center gap-6">
          <Link href="/documents" className="text-gray-700 hover:text-gray-900">
            Documents
          </Link>
          <Link href="/upload" className="text-gray-700 hover:text-gray-900">
            Upload
          </Link>
          
          {session && (
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="text-gray-700 hover:text-gray-900"
            >
              Sign out
            </button>
          )}
        </nav>
      </div>
    </header>
  )
}
