'use client';

import { useEffect } from 'react';

function isDbError(err) {
  return /MONGODB_URI|mongodb|database/i.test(err?.message || '');
}

function DbSetupCard({ onRetry }) {
  return (
    <main className="min-h-screen bg-[#0d1017] text-[#f4f5f7] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#151a24] border border-[#2a3242] rounded-2xl p-8 space-y-4">
        <div className="text-4xl">🛍️</div>
        <h1 className="text-xl font-bold">Database not connected</h1>
        <p className="text-sm text-[#9aa4b2]">
          Kere Shop needs a MongoDB connection string to run on Vercel. The in-memory
          demo database only works locally — it can&apos;t run on serverless.
        </p>
        <ol className="list-decimal list-inside text-sm text-[#cdd4de] space-y-2">
          <li>Create a free cluster at <span className="text-[#F5B301]">mongodb.com/atlas</span> (M0 is free).</li>
          <li>Copy its connection string (SRV URI works fine).</li>
          <li>In the Vercel dashboard: project → <b>Settings → Environment Variables</b>.</li>
          <li>
            Add <code className="text-[#F5B301] bg-[#0d1017] px-1 rounded">MONGODB_URI</code> with that string.
          </li>
          <li>Redeploy (Deployments → Redeploy) and reload this page.</li>
        </ol>
        <button
          onClick={onRetry}
          className="w-full bg-[#F5B301] text-[#172033] font-bold rounded-lg py-2.5 text-sm hover:brightness-105 transition"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

export default function ErrorPage({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  if (isDbError(error)) {
    return <DbSetupCard onRetry={reset} />;
  }

  return (
    <main className="min-h-screen bg-[#0d1017] text-[#f4f5f7] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#151a24] border border-[#2a3242] rounded-2xl p-8 space-y-4 text-center">
        <div className="text-4xl">⚠️</div>
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="text-sm text-[#9aa4b2]">
          {error?.message || 'An unexpected error occurred while loading this page.'}
        </p>
        <button
          onClick={reset}
          className="w-full bg-[#F5B301] text-[#172033] font-bold rounded-lg py-2.5 text-sm hover:brightness-105 transition"
        >
          Try again
        </button>
      </div>
    </main>
  );
}