import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { signOut } from '@/app/login/actions';

const NAV_LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/goals', label: 'Set a goal' },
  { href: '/recommendations', label: 'Next steps' },
  { href: '/performance', label: 'Performance' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/leads', label: 'Leads' },
  { href: '/assistant', label: 'Ask' },
  { href: '/salon', label: 'Salon' },
  { href: '/integrations', label: 'Integrations' },
];

export async function Nav() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Signed-out visitors only ever see the login screen, which needs no nav.
  if (!user) return null;

  return (
    <header className="border-b border-border bg-card">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-8 py-3">
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-4 font-heading text-lg">Marketing OS</span>
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
