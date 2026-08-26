const fs = require('fs');
const path = require('path');

const write = (p, content) => {
  const full = path.join(process.cwd(), p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content.trim() + '\n', 'utf-8');
};

write('src/app/campaigns/new/page.tsx', `
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
    destination: '',
    creative_id: 'auto-select'
  });

  const update = (key: string, val: any) => setForm(prev => ({ ...prev, [key]: val }));

  const submit = async () => {
    try {
      setLoading(true);
      setError('');
      const payload = {
        ...form,
        budget_amount: Number(form.budget_amount),
        duration_days: Number(form.duration_days)
      };
      const id = await saveDraftCampaign(payload);
      router.push(\`/campaigns/\${id}\`);
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
          <div className="bg-black h-full transition-all duration-300" style={{ width: \`\${(step / 6) * 100}%\` }}></div>
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
          <div className="space-y-4">
            {['Website', 'WhatsApp', 'Phone', 'Website + WhatsApp'].map(s => (
              <button key={s} onClick={() => { update('destination', s); setStep(6); }} 
                      className="w-full text-left p-4 border rounded hover:border-black transition">
                {s}
              </button>
            ))}
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
            <div className="flex justify-between">
              <span className="text-gray-500">Destination</span>
              <span className="font-medium">{form.destination}</span>
            </div>
          </div>
          <button onClick={submit} disabled={loading} className="w-full bg-black text-white p-3 rounded mt-6">
            {loading ? 'Creating...' : 'Create Draft & Proceed to Review'}
          </button>
        </div>
      )}
    </div>
  );
}
`);
console.log('Wizard UI generated.');
