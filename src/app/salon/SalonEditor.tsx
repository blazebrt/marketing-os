'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Check } from 'lucide-react';
import { ownerMessage } from '@/lib/errorMessages';
import { saveSalonProfile, saveService, deleteService, saveOffer, deleteOffer } from './actions';
import { WEEKDAYS, type SalonProfile, type SalonService, type SalonOffer } from '@/lib/salon/types';

const EMPTY: SalonProfile = {
  salon_name: '', description: '', location: '', service_areas: [],
  website_url: '', booking_url: '', whatsapp_number: '',
  target_customer_types: [], unique_selling_points: [], brand_positioning: '',
  preferred_tone: '', slow_days: [], busy_days: [],
  default_destination_type: 'WEBSITE', currency: 'INR',
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

const input = 'w-full rounded-md border border-border bg-white px-3 py-2 text-sm';

/** Comma-separated text in, clean array out. */
function ListInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <input
      className={input}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean));
      }}
    />
  );
}

export function SalonEditor({
  initialProfile, initialServices, initialOffers,
}: {
  initialProfile: SalonProfile | null;
  initialServices: SalonService[];
  initialOffers: SalonOffer[];
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<SalonProfile>({ ...EMPTY, ...(initialProfile || {}) });
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof SalonProfile>(k: K, v: SalonProfile[K]) =>
    setProfile((p) => ({ ...p, [k]: v }));

  const submitProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setSaved(false);
    startTransition(async () => {
      const result = await saveSalonProfile(profile);
      if (!result.ok) { setError(ownerMessage(result.code)); return; }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 2500);
    });
  };

  const toggleDay = (field: 'slow_days' | 'busy_days', day: string) => {
    const current = profile[field] || [];
    set(field, current.includes(day) ? current.filter((d) => d !== day) : [...current, day]);
  };

  return (
    <div className="space-y-8">
      <form onSubmit={submitProfile} className="rounded-lg border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold">About your salon</h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Marketing OS uses this to write your ads and plan your campaigns. It is never shared
          outside the app, and your phone number and website address are never sent to the AI.
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <Field label="Salon name">
            <input className={input} value={profile.salon_name || ''} onChange={(e) => set('salon_name', e.target.value)} placeholder="Lakmé Salon Rajajipuram" />
          </Field>
          <Field label="Area you are in">
            <input className={input} value={profile.location || ''} onChange={(e) => set('location', e.target.value)} placeholder="Rajajipuram, Lucknow" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Areas you want customers from" hint="Separate with commas">
              <ListInput value={profile.service_areas || []} onChange={(v) => set('service_areas', v)} placeholder="Rajajipuram, Alambagh, Aashiana" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Describe your salon in a sentence or two">
              <textarea className={`${input} min-h-20`} value={profile.description || ''} onChange={(e) => set('description', e.target.value)} placeholder="A family salon in Rajajipuram known for bridal work and keratin treatments." />
            </Field>
          </div>
          <Field label="Who are your customers?" hint="Separate with commas">
            <ListInput value={profile.target_customer_types || []} onChange={(v) => set('target_customer_types', v)} placeholder="Brides-to-be, working professionals" />
          </Field>
          <Field label="What makes you different?" hint="Separate with commas">
            <ListInput value={profile.unique_selling_points || []} onChange={(v) => set('unique_selling_points', v)} placeholder="Certified stylists, 15 years in the area" />
          </Field>
          <Field label="How should your ads sound?">
            <input className={input} value={profile.preferred_tone || ''} onChange={(e) => set('preferred_tone', e.target.value)} placeholder="Warm and professional" />
          </Field>
          <Field label="Where should customers go?">
            <select className={input} value={profile.default_destination_type} onChange={(e) => set('default_destination_type', e.target.value as SalonProfile['default_destination_type'])}>
              <option value="WEBSITE">Website</option>
              <option value="WHATSAPP">WhatsApp</option>
              <option value="PHONE">Phone</option>
            </select>
          </Field>
          <Field label="Website or booking page">
            <input className={input} value={profile.booking_url || ''} onChange={(e) => set('booking_url', e.target.value)} placeholder="https://..." />
          </Field>
          <Field label="WhatsApp number" hint="Never sent to the AI">
            <input className={input} value={profile.whatsapp_number || ''} onChange={(e) => set('whatsapp_number', e.target.value)} placeholder="+91..." />
          </Field>
        </div>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          {(['slow_days', 'busy_days'] as const).map((field) => (
            <div key={field}>
              <p className="text-sm font-medium">{field === 'slow_days' ? 'Your quiet days' : 'Your busiest days'}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {field === 'slow_days'
                  ? 'Marketing OS will suggest filling these rather than adding to a full day.'
                  : 'It will avoid pushing more demand into these.'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((day) => {
                  const on = (profile[field] || []).includes(day);
                  return (
                    <button key={day} type="button" onClick={() => toggleDay(field, day)}
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${on ? 'border-slate-800 bg-slate-800 text-white' : 'border-border hover:bg-muted'}`}>
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button type="submit" disabled={pending} className="rounded-md bg-black px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">
            {pending ? 'Saving…' : 'Save salon details'}
          </button>
          {saved && <span className="flex items-center gap-1 text-sm text-green-700"><Check className="h-4 w-4" /> Saved</span>}
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
      </form>

      <ServiceList services={initialServices} />
      <OfferList offers={initialOffers} services={initialServices} />
    </div>
  );
}

function ServiceList({ services }: { services: SalonService[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ name: '', price: '', category: '', margin_tier: '' });
  const [error, setError] = useState<string | null>(null);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveService({
        name: draft.name,
        category: draft.category || null,
        price: draft.price ? Number(draft.price) : null,
        margin_tier: draft.margin_tier || null,
        is_active: true,
      });
      if (!result.ok) { setError(ownerMessage(result.code)); return; }
      setDraft({ name: '', price: '', category: '', margin_tier: '' });
      router.refresh();
    });
  };

  return (
    <section className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">What you offer</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Add your services once. Marketing OS uses them to decide what to promote, so you never
        retype them into a campaign.
      </p>

      {services.length > 0 && (
        <ul className="mt-5 divide-y rounded-md border">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div>
                <span className="font-medium">{s.name}</span>
                {s.category && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{s.category}</span>}
                {s.margin_tier && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{s.margin_tier} margin</span>}
              </div>
              <div className="flex items-center gap-4">
                <span className="tabular-nums text-sm">{s.price !== null ? `₹${s.price}` : 'No price'}</span>
                <button type="button" disabled={pending} aria-label={`Remove ${s.name}`}
                  onClick={() => startTransition(async () => { await deleteService(s.id); router.refresh(); })}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
        <input className={`${input} w-48`} placeholder="Service, e.g. Hair Spa" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className={`${input} w-28`} type="number" placeholder="Price ₹" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        <input className={`${input} w-36`} placeholder="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
        <select className={`${input} w-36`} value={draft.margin_tier} onChange={(e) => setDraft({ ...draft, margin_tier: e.target.value })}>
          <option value="">Margin?</option>
          <option value="HIGH">High margin</option>
          <option value="MEDIUM">Medium margin</option>
          <option value="LOW">Low margin</option>
        </select>
        <button type="submit" disabled={pending || draft.name.trim().length < 2}
          className="flex items-center gap-1.5 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add
        </button>
        {error && <span className="text-sm text-red-700">{error}</span>}
      </form>
    </section>
  );
}

function OfferList({ offers, services }: { offers: SalonOffer[]; services: SalonService[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({ name: '', price: '', service_id: '' });
  const [error, setError] = useState<string | null>(null);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveOffer({
        name: draft.name,
        price: draft.price ? Number(draft.price) : null,
        service_id: draft.service_id || null,
        is_active: true,
      });
      if (!result.ok) { setError(ownerMessage(result.code)); return; }
      setDraft({ name: '', price: '', service_id: '' });
      router.refresh();
    });
  };

  return (
    <section className="rounded-lg border bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Your offers</h2>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Deals you are happy to advertise, like “First visit Hair Spa ₹999”.
      </p>

      {offers.length > 0 && (
        <ul className="mt-5 divide-y rounded-md border">
          {offers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="font-medium">{o.name}</span>
              <div className="flex items-center gap-4">
                <span className="tabular-nums text-sm">{o.price !== null ? `₹${o.price}` : ''}</span>
                <button type="button" disabled={pending} aria-label={`Remove ${o.name}`}
                  onClick={() => startTransition(async () => { await deleteOffer(o.id); router.refresh(); })}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="mt-4 flex flex-wrap items-end gap-2">
        <input className={`${input} w-64`} placeholder="Offer, e.g. First visit Hair Spa ₹999" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <input className={`${input} w-28`} type="number" placeholder="Price ₹" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
        <select className={`${input} w-44`} value={draft.service_id} onChange={(e) => setDraft({ ...draft, service_id: e.target.value })}>
          <option value="">Any service</option>
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button type="submit" disabled={pending || draft.name.trim().length < 2}
          className="flex items-center gap-1.5 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          <Plus className="h-4 w-4" /> Add
        </button>
        {error && <span className="text-sm text-red-700">{error}</span>}
      </form>
    </section>
  );
}
