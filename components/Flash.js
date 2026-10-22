import { Suspense } from 'react';

// Banner driven by ?error=… / ?ok=… (set by done() in lib/actions.js).
// Reading the URL is request-time data, so it gets its own <Suspense>.
export default function Flash({ searchParams }) {
  return <Suspense><Banner searchParams={searchParams} /></Suspense>;
}

async function Banner({ searchParams }) {
  const { error, ok } = await searchParams;
  if (error) {
    return (
      <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </p>
    );
  }
  if (ok) {
    return (
      <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        {ok}
      </p>
    );
  }
  return null;
}
