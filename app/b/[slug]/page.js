import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { getPublicSalon } from '@/lib/salon';
import { upcomingDates } from '@/lib/time';
import BookingFlow from './BookingFlow';

export const metadata = { title: 'Book an appointment · Sanwaro' };

export default function BookingPage({ params }) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
      <Suspense fallback={<p className="hint">Loading…</p>}>
        <Salon params={params} />
      </Suspense>
    </main>
  );
}

async function Salon({ params }) {
  const { slug } = await params;
  await connection();   // "today" and free slots are per request
  const salon = await getPublicSalon(slug);
  if (!salon) notFound();

  return (
    <>
      <header className="mb-6">
        <h1 className="h1">{salon.name}</h1>
        {salon.address && <p className="hint mt-1">{salon.address}</p>}
      </header>
      {salon.services.length && salon.staff.length ? (
        <BookingFlow
          salon={salon}
          dates={upcomingDates(salon.timezone, Math.min(salon.max_days_ahead, 30))}
          siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        />
      ) : (
        <p className="card">Online booking isn’t open yet. Please call the salon.</p>
      )}
    </>
  );
}
