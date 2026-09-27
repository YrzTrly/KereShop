'use client';

import { useEffect } from 'react';

function isDbError(err) {
  return /MONGODB_URI|mongodb|database/i.test(err?.message || '');
}

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const body = isDbError(error) ? (
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
    </div>
  ) : (
    <div className="max-w-md w-full bg-[#151a24] border border-[#2a3242] rounded-2xl p-8 space-y-4 text-center">
      <div className="text-4xl">⚠️</div>
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="text-sm text-[#9aa4b2]">
        {error?.message || 'An unexpected error occurred while loading this page.'}
      </p>
    </div>
  );

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
          rel="stylesheet"
        />
        <style>{'body{margin:0;font-family:"DM Sans",system-ui,sans-serif}'}</style>
      </head>
      <body className="bg-[#0d1017] text-[#f4f5f7]">
        <main className="min-h-screen flex items-center justify-center p-6">{body}</main>
        <div className="fixed bottom-6 right-6">
          <button
            onClick={reset}
            className="bg-[#F5B301] text-[#172033] font-bold rounded-lg px-4 py-2 text-sm hover:brightness-105 transition"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}