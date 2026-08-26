import { v4 as uuidv4 } from 'uuid';
import { GoogleCreativeItem } from './types';

// In V1, this simulates the AI generation process. 
// A real system would call Vertex AI or OpenAI here.
export function generateGoogleCreative(campaignContext: any) {
  // Mock generated output
  const keywordStr = campaignContext?.offer ? `${campaignContext.service} ${campaignContext.offer}` : campaignContext.service;
  
  const keywords: GoogleCreativeItem[] = [
    {
      id: uuidv4(),
      original_value: keywordStr.substring(0, 80),
      current_value: keywordStr.substring(0, 80),
      ai_generated: true,
      owner_approved: false,
      match_type: 'PHRASE'
    }
  ];

  const headlines: GoogleCreativeItem[] = [
    {
      id: uuidv4(),
      original_value: campaignContext.service.substring(0, 30),
      current_value: campaignContext.service.substring(0, 30),
      ai_generated: true,
      owner_approved: false
    }
  ];

  const descriptions: GoogleCreativeItem[] = [
    {
      id: uuidv4(),
      original_value: `Book our ${campaignContext.service.substring(0, 50)} today!`,
      current_value: `Book our ${campaignContext.service.substring(0, 50)} today!`,
      ai_generated: true,
      owner_approved: false
    }
  ];

  return { keywords, headlines, descriptions };
}
