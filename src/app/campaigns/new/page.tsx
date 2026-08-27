'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveDraftCampaign } from '../actions';

export default function NewCampaignWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [form, setForm] = useState({
    service: '',
    offer: '',
    budget_type: 'daily',
    budget_amount: '',
    duration_days: '30',
    channels: [] as string[],
    destination_type: '' as '' | 'WEBSITE' | 'WHATSAPP' | 'PHONE',
    landing_url: '',
    target_audience: '',
    location: ''
  });

  const update = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  const submit = async () => {
    try {
      setLoading(true);
      setError('');
      const payload: any = {
        service: form.service,
        offer: form.offer,
        budget_type: form.budget_type,
        budget_amount: Number(form.budget_amount),
        duration_days: Number(form.duration_days),
        channels: form.channels,
        destination_type: form.destination_type,
        landing_url: form.destination_type === 'WEBSITE' ? form.landing_url : null,
        target_audience: form.target_audience || null,
        location: form.location || null,
        creative_id: null
      };

      const id = await saveDraftCampaign(payload);
      router.push(`/campaigns/${id}`);
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8 pt-16">
      <div className="mb-8">
        <div className="text-sm text-gray-500 mb-2">Step {step} of 6</div>
        <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
          <div className="bg-black h-full transition-all duration-300" style={{ width: `${(step / 6) * 100}%` }}></div>
        </div>
      </div>

      {error && <div className="p-4 mb-4 bg-red-50 text-red-700 border border-red-200 rounded">{error}</div>}

      {step === 1 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">What are you promoting?</h1>
          <div className="space-y-4">
            {['Bridal Makeup', 'Haircut & Styling', 'Keratin Treatment', 'Facial & Cleanup'].map(s => (
              <button key={s} onClick={() => { update('service', s); setStep(2); }} 
                      className="w-full text-left p-4 border rounded hover:border-black transition">
                {s}
              </button>
            ))}
            <div className="mt-4 pt-4 border-t">
              <label className="text-sm font-medium">Or type your own:</label>
              <div className="flex gap-2 mt-2">
                <input type="text" value={form.service} onChange={e => update('service', e.target.value)} 
                       className="flex-1 border p-2 rounded" placeholder="e.g. Hair Spa" />
                <button onClick={() => form.service && setStep(2)} className="bg-black text-white px-4 rounded">Next</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">What are you offering?</h1>
          <div className="space-y-4">
            {['20% Off', 'Flat ₹500 Off', 'Free Hair Spa with Keratin', 'Bridal Package ₹9,999'].map(s => (
              <button key={s} onClick={() => { update('offer', s); setStep(3); }} 
                      className="w-full text-left p-4 border rounded hover:border-black transition">
                {s}
              </button>
            ))}
            <div className="mt-4 pt-4 border-t">
              <label className="text-sm font-medium">Custom offer:</label>
              <div className="flex gap-2 mt-2">
                <input type="text" value={form.offer} onChange={e => update('offer', e.target.value)} 
                       className="flex-1 border p-2 rounded" placeholder="e.g. 15% Off" />
                <button onClick={() => form.offer && setStep(3)} className="bg-black text-white px-4 rounded">Next</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">How much do you want to spend?</h1>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Budget Type</label>
              <select value={form.budget_type} onChange={e => update('budget_type', e.target.value)} className="w-full border p-2 rounded mt-1">
                <option value="daily">Daily Budget</option>
                <option value="total">Total Campaign Budget</option>
              </select>
            </div>
            <div>
              <label className="text-sm font-medium">Amount (₹)</label>
              <input type="number" value={form.budget_amount} onChange={e => update('budget_amount', e.target.value)} 
                     className="w-full border p-2 rounded mt-1" placeholder="e.g. 1000" />
            </div>
            <div>
              <label className="text-sm font-medium">Duration (Days)</label>
              <input type="number" value={form.duration_days} onChange={e => update('duration_days', e.target.value)} 
                     className="w-full border p-2 rounded mt-1" />
            </div>
            <button onClick={() => form.budget_amount && setStep(4)} className="w-full bg-black text-white p-3 rounded mt-4">Next</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">Where do you want to advertise?</h1>
          <div className="space-y-4">
            {['Google', 'Meta'].map(c => (
              <label key={c} className="flex items-center p-4 border rounded cursor-pointer hover:bg-gray-50">
                <input type="checkbox" className="mr-3" 
                       checked={form.channels.includes(c)}
                       onChange={e => {
                         if (e.target.checked) update('channels', [...form.channels, c]);
                         else update('channels', form.channels.filter(x => x !== c));
                       }} />
                <span className="font-medium">{c} Ads</span>
              </label>
            ))}
            <button onClick={() => form.channels.length > 0 && setStep(5)} 
                    className="w-full bg-black text-white p-3 rounded mt-4 opacity-disabled">Next</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">How should customers contact you?</h1>
          <p className="text-sm text-gray-600 mb-4">Google Ads requires a website landing URL. WhatsApp and Phone campaigns cannot be deployed to Google Ads.</p>
          <div className="space-y-4">
            {([
              ['WEBSITE', 'Website'],
              ['WHATSAPP', 'WhatsApp'],
              ['PHONE', 'Phone'],
            ] as const).map(([type, label]) => (
              <button key={type} onClick={() => { update('destination_type', type); setStep(type === 'WEBSITE' ? 5.5 : 5.7); }}
                      className="w-full text-left p-4 border rounded hover:border-black transition">
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 5.5 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">Landing page URL</h1>
          <p className="text-sm text-gray-600 mb-4">Must be a public HTTPS URL. Private, localhost, and cloud metadata addresses are rejected.</p>
          <input type="url" value={form.landing_url} onChange={e => update('landing_url', e.target.value)}
                 className="w-full border p-2 rounded" placeholder="https://www.example.com" />
          <button onClick={() => form.landing_url.startsWith('https://') && setStep(5.7)}
                  className="w-full bg-black text-white p-3 rounded mt-4">Next</button>
        </div>
      )}

      {step === 5.7 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">Who is this for, and where?</h1>
          <p className="text-sm text-gray-600 mb-4">
            We use this to write the ad copy. The more specific the area, the better the ads read to
            nearby customers. Both are optional, but ads perform better with them.
          </p>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Who is the campaign aimed at?</label>
              <input type="text" value={form.target_audience} maxLength={200}
                     onChange={e => update('target_audience', e.target.value)}
                     className="w-full border p-2 rounded mt-1"
                     placeholder="e.g. Brides-to-be, 22-32, planning a winter wedding" />
              <div className="flex flex-wrap gap-2 mt-2">
                {['Brides-to-be', 'Working professionals', 'College students', 'Mothers with young children'].map(a => (
                  <button key={a} type="button" onClick={() => update('target_audience', a)}
                          className="text-xs border rounded-full px-3 py-1 hover:border-black transition">
                    {a}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Which area should the ads target?</label>
              <input type="text" value={form.location} maxLength={200}
                     onChange={e => update('location', e.target.value)}
                     className="w-full border p-2 rounded mt-1"
                     placeholder="e.g. Rajajipuram, Lucknow" />
            </div>
            <button onClick={() => setStep(6)} className="w-full bg-black text-white p-3 rounded mt-4">
              Next
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="animate-in fade-in slide-in-from-bottom-4">
          <h1 className="text-3xl font-bold mb-6">Review & Create Draft</h1>
          <div className="space-y-4 p-6 bg-gray-50 rounded-lg text-sm">
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Service</span>
              <span className="font-medium">{form.service}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Offer</span>
              <span className="font-medium">{form.offer}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Budget</span>
              <span className="font-medium">₹{form.budget_amount} ({form.budget_type})</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Channels</span>
              <span className="font-medium">{form.channels.join(', ')}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Destination type</span>
              <span className="font-medium">{form.destination_type}</span>
            </div>
            {form.landing_url && (
              <div className="flex justify-between border-b pb-2">
                <span className="text-gray-500">Landing URL</span>
                <span className="font-medium">{form.landing_url}</span>
              </div>
            )}
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Audience</span>
              <span className="font-medium">{form.target_audience || 'Not specified'}</span>
            </div>
            <div className="flex justify-between border-b pb-2">
              <span className="text-gray-500">Area</span>
              <span className="font-medium">{form.location || 'Not specified'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Creative</span>
              <span className="font-medium text-red-600">No creative selected (Required before approval)</span>
            </div>
          </div>
          <button onClick={submit} disabled={loading} className="w-full bg-black text-white p-3 rounded mt-6">
            {loading ? 'Creating...' : 'Create Draft & Proceed to Verification'}
          </button>
        </div>
      )}
    </div>
  );
}