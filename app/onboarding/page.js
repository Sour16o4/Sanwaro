import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import Flash from '@/components/Flash';
import { requireUser } from '@/lib/auth';
import { done, firstIssue } from '@/lib/actions';

export const metadata = { title: 'Create your salon · Sanwaro' };

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const Salon = z.object({
  name: z.string().trim().min(2, 'Salon name is too short.').max(80),
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/, 'Booking link: 3–40 letters, numbers or dashes.'),
});

async function createSalon(formData) {
  'use server';
  const { supabase } = await requireUser();
  const name = String(formData.get('name') ?? '');
  const parsed = Salon.safeParse({ name, slug: slugify(String(formData.get('slug') || name)) });
  if (!parsed.success) done('/onboarding', firstIssue(parsed));

  const { error } = await supabase.rpc('create_business', { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error?.code === '23505') done('/onboarding', 'That booking link is taken. Try another.');
  if (error) done('/onboarding', error);
  revalidatePath('/', 'layout');   // the cached /dashboard still says "no salon yet"
  redirect('/dashboard');
}

export default function OnboardingPage({ searchParams }) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 py-12">
      <h1 className="h1">Create your salon</h1>
      <p className="hint mt-1">Next you’ll add services, staff and opening hours. It takes about 5 minutes.</p>

      <div className="mt-8">
        <Flash searchParams={searchParams} />
      </div>

      <form action={createSalon} className="card space-y-4">
        <label className="label">
          Salon name
          <input className="input" name="name" placeholder="Glow Salon" required maxLength={80} />
        </label>
        <label className="label">
          Booking link
          <div className="mt-1 flex items-center rounded-lg border border-line bg-white text-sm">
            <span className="pl-3 text-muted">sanwaro/b/</span>
            <input className="w-full rounded-r-lg px-1 py-2 outline-none" name="slug" placeholder="glow-salon" maxLength={40} />
          </div>
          <span className="hint">Leave empty to use the salon name.</span>
        </label>
        <button className="btn">Create salon</button>
      </form>
    </main>
  );
}
