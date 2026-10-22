import Link from 'next/link';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-4 py-16">
      <p className="text-sm font-medium text-brand">Sanwaro · सँवारो</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Online booking for small salons</h1>
      <p className="mt-4 text-lg text-muted">
        Customers pick a free slot and pay a small UPI deposit. Walk-ins join a queue that fits around
        appointments. Double booking is impossible.
      </p>
      <div className="mt-8">
        <Link href="/login" className="btn">Salon owner sign in</Link>
      </div>
    </main>
  );
}
