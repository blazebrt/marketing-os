'use client';

import { useMemo, useState } from 'react';

const services = ['Hair Spa', 'Hair Colour', 'Haircut', 'Facial', 'Bridal', 'Other'];
const destinations = [
  { id: 'lead_form', title: 'Meta Lead Form', description: 'Capture the enquiry inside Instagram/Facebook.' },
  { id: 'whatsapp', title: 'WhatsApp', description: 'Open a WhatsApp conversation with a prefilled offer.' },
  { id: 'website', title: 'Website', description: 'Send people to your existing website and capture the enquiry.' },
] as const;

export default function Dashboard() {
  const [service, setService] = useState('Hair Spa');
  const [offer, setOffer] = useState('₹999');
  const [budget, setBudget] = useState('500');
  const [duration, setDuration] = useState('7');
  const [creativeMode, setCreativeMode] = useState<'existing' | 'generate'>('existing');
  const [destination, setDestination] = useState<(typeof destinations)[number]['id']>('lead_form');
  const [created, setCreated] = useState(false);

  const campaignName = useMemo(() => `${service} — ${offer}`, [service, offer]);
  const parsedBudget = Number(budget) || 0;
  const estimatedSpend = parsedBudget * (Number(duration) || 0);

  return (
    <div className="shell">
      <header className="header">
        <div className="brand">Lakmé Marketing OS</div>
        <div className="header-note">Rajajipuram · Private owner workspace</div>
      </header>

      <main className="main">
        <section className="hero">
          <h1>Get more salon customers without becoming a Meta Ads expert.</h1>
          <p>
            Start with the offer, budget and creative. This V1 keeps the complicated marketing work behind the scenes and keeps you in control before anything spends money.
          </p>
        </section>

        <section className="grid">
          <div className="card">
            <h2>Create a campaign</h2>
            <p>Tell the system what you want more customers for. You do not need to know campaign settings.</p>

            <div className="form">
              <div className="field">
                <label htmlFor="service">Service</label>
                <select id="service" value={service} onChange={(e) => setService(e.target.value)}>
                  {services.map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>

              <div className="row">
                <div className="field">
                  <label htmlFor="offer">Offer</label>
                  <input id="offer" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="₹999" />
                </div>
                <div className="field">
                  <label htmlFor="budget">Daily budget (₹)</label>
                  <input id="budget" inputMode="numeric" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^0-9]/g, ''))} />
                </div>
              </div>

              <div className="field">
                <label htmlFor="duration">Campaign duration (days)</label>
                <input id="duration" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/[^0-9]/g, ''))} />
              </div>

              <div>
                <div className="section-label">Creative</div>
                <div className="choice-grid">
                  <button type="button" className={`choice ${creativeMode === 'existing' ? 'active' : ''}`} onClick={() => setCreativeMode('existing')}>
                    <strong>Use my existing creative</strong>
                    <span>Pick one of your Instagram photos or reels.</span>
                  </button>
                  <button type="button" className={`choice ${creativeMode === 'generate' ? 'active' : ''}`} onClick={() => setCreativeMode('generate')}>
                    <strong>Make a new creative</strong>
                    <span>Prepare an AI concept for your approval before launch.</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="section-label">Where should people contact you?</div>
                <div className="choice-grid">
                  {destinations.map((item) => (
                    <button key={item.id} type="button" className={`choice ${destination === item.id ? 'active' : ''}`} onClick={() => setDestination(item.id)}>
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" className="button accent" onClick={() => setCreated(true)}>
                {created ? 'Campaign draft created' : 'Create campaign draft'}
              </button>
            </div>
          </div>

          <aside className="card side-card">
            <h2>Campaign preview</h2>
            <p>You will always see the plan before the system is allowed to spend money.</p>

            <div className="stack" style={{ marginTop: 20 }}>
              <div className="list-item"><small>CAMPAIGN</small><strong>{campaignName}</strong></div>
              <div className="list-item"><small>CREATIVE</small><strong>{creativeMode === 'existing' ? 'Existing Instagram creative' : 'AI-generated creative'}</strong></div>
              <div className="list-item"><small>LEAD DESTINATION</small><strong>{destinations.find((item) => item.id === destination)?.title}</strong></div>
              <div className="list-item"><small>PLANNED SPEND</small><strong>₹{estimatedSpend.toLocaleString('en-IN')} maximum</strong></div>
              <div className="list-item"><small>STATUS</small><strong><span className="status">Approval required</span></strong></div>
            </div>

            <div className="section-label">Current V1 visibility</div>
            <div className="stat-grid">
              <div className="stat"><b>0</b><span>Leads captured</span></div>
              <div className="stat"><b>0</b><span>Bookings</span></div>
              <div className="stat"><b>₹0</b><span>Customer revenue</span></div>
              <div className="stat"><b>₹0</b><span>Ad spend tracked</span></div>
            </div>

            <div className="footer">Next: connect the lead database and Meta account. No live ad changes are made by this screen yet.</div>
          </aside>
        </section>
      </main>
    </div>
  );
}
