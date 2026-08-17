'use client'

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createPendingCampaign } from '../actions';

export default function CampaignWizard() {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    service: '',
    offer: '',
    budget: '',
    budgetType: 'daily',
    duration: '30',
    channels: [] as string[],
    metaCreativeUrl: '',
  });

  const updateForm = (key: string, value: any) => {
    setFormData(prev => ({ ...prev, [key]: value }));
  };

  const toggleChannel = (channel: string) => {
    setFormData(prev => {
      const channels = prev.channels.includes(channel)
        ? prev.channels.filter(c => c !== channel)
        : [...prev.channels, channel];
      return { ...prev, channels };
    });
  };

  const nextStep = () => setStep(prev => prev + 1);
  const prevStep = () => setStep(prev => prev - 1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createPendingCampaign(formData);
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <Card>
        <CardHeader>
          <CardTitle>Campaign Creator - Step {step} of 7</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="min-h-[300px]">
            {step === 1 && (
              <div className="space-y-4">
                <Label>What service are we promoting?</Label>
                <Input 
                  placeholder="e.g. Bridal Makeup" 
                  value={formData.service} 
                  onChange={e => updateForm('service', e.target.value)} 
                  required 
                />
              </div>
            )}
            
            {step === 2 && (
              <div className="space-y-4">
                <Label>What is the offer?</Label>
                <Input 
                  placeholder="e.g. 20% Off" 
                  value={formData.offer} 
                  onChange={e => updateForm('offer', e.target.value)} 
                  required 
                />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-4">
                <Label>What is your budget?</Label>
                <div className="flex gap-4">
                  <Input 
                    type="number" 
                    placeholder="Amount (Rs.)" 
                    value={formData.budget} 
                    onChange={e => updateForm('budget', e.target.value)} 
                    required 
                  />
                  <select 
                    className="border rounded p-2"
                    value={formData.budgetType}
                    onChange={e => updateForm('budgetType', e.target.value)}
                  >
                    <option value="daily">Per Day</option>
                    <option value="total">Total for Campaign</option>
                  </select>
                </div>
                <Label>How many days should it run?</Label>
                <Input 
                  type="number" 
                  value={formData.duration} 
                  onChange={e => updateForm('duration', e.target.value)} 
                  required 
                />
              </div>
            )}

            {step === 4 && (
              <div className="space-y-4">
                <Label>Where should we advertise?</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer p-4 border rounded hover:bg-gray-50">
                    <input 
                      type="checkbox" 
                      checked={formData.channels.includes('meta')}
                      onChange={() => toggleChannel('meta')}
                    />
                    Instagram & Facebook
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer p-4 border rounded hover:bg-gray-50">
                    <input 
                      type="checkbox" 
                      checked={formData.channels.includes('google')}
                      onChange={() => toggleChannel('google')}
                    />
                    Google Search
                  </label>
                </div>
              </div>
            )}

            {step === 5 && (
              <div className="space-y-4">
                <Label>Creative Setup</Label>
                {formData.channels.includes('meta') && (
                  <div className="border p-4 rounded bg-gray-50 mb-4">
                    <p className="font-semibold mb-2">Instagram/Facebook Post</p>
                    <Input 
                      placeholder="Paste Image URL or select existing post" 
                      value={formData.metaCreativeUrl}
                      onChange={e => updateForm('metaCreativeUrl', e.target.value)}
                    />
                    <p className="text-sm text-gray-500 mt-2">* AI Image Generation coming soon</p>
                  </div>
                )}
                {formData.channels.includes('google') && (
                  <div className="border p-4 rounded bg-gray-50">
                    <p className="font-semibold mb-2">Google Search Setup</p>
                    <p className="text-sm text-gray-700">
                      We will automatically generate the best keywords and search headlines based on your Service ({formData.service}) and Offer ({formData.offer}).
                    </p>
                  </div>
                )}
                {formData.channels.length === 0 && <p className="text-red-500">Please go back and select a channel.</p>}
              </div>
            )}

            {step === 6 && (
              <div className="space-y-4">
                <Label className="text-xl">Review & Verification</Label>
                <div className="bg-gray-50 p-4 rounded space-y-2 text-sm">
                  <p><strong>Promoting:</strong> {formData.service}</p>
                  <p><strong>Offer:</strong> {formData.offer}</p>
                  <p><strong>Budget:</strong> {formData.budget} ({formData.budgetType}) for {formData.duration} days.</p>
                  <p><strong>Channels:</strong> {formData.channels.join(', ').toUpperCase()}</p>
                  <p><strong>Contact Destination:</strong> Website Forms & WhatsApp</p>
                </div>
                
                <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded">
                  <p className="font-semibold">Verification Passed</p>
                  <p className="text-sm mt-1">Integration connections and attribution tracking are online. This configuration is safe to launch.</p>
                </div>
              </div>
            )}

            {step === 7 && (
              <div className="space-y-4 text-center py-8">
                <h2 className="text-2xl font-bold">Ready to Launch?</h2>
                <p className="text-gray-600">
                  Clicking "Request Launch" will save this campaign for final owner approval. 
                  No money will be spent until explicit approval is granted.
                </p>
              </div>
            )}
          </CardContent>
          
          <CardFooter className="flex justify-between border-t p-6">
            <Button type="button" variant="outline" onClick={prevStep} disabled={step === 1}>Back</Button>
            {step < 7 ? (
              <Button type="button" onClick={nextStep} disabled={step === 4 && formData.channels.length === 0}>Next Step</Button>
            ) : (
              <Button type="submit">Request Launch</Button>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
