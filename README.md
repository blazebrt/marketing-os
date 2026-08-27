# Lakmé Marketing OS

Private internal marketing system for Lakmé Salon Rajajipuram.

## V1 goal
Make Meta lead generation simple for a non-technical salon owner:

- Create a campaign from service + offer + budget + duration
- Use an existing creative or prepare one for approval
- Choose Website, Meta Instant Form, or WhatsApp as the lead destination
- Capture and manage leads
- Track lead outcome through booking, visit, and revenue
- Keep the public salon website separate from the marketing system

The production application is intended to run at `marketing.lakmesalonrajajipuram.com`.

## Architecture

This application is intentionally separate from the public website repository `blazebrt/project-monolith`.

Initial stack target:
- Next.js
- TypeScript
- Supabase/Postgres
- Meta Marketing API integration behind server-side routes
- OpenAI only where AI generation/analysis is explicitly needed

## Performance reporting

Google Ads spend is pulled once a day and matched to leads. Setup steps for the
scheduled refresh are in [docs/scheduled-refresh.md](docs/scheduled-refresh.md).
