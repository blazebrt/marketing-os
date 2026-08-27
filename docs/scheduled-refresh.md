# Nightly performance refresh — Vercel setup

The app pulls yesterday's Google Ads spend once a day and matches leads to the
campaigns that produced them. Nothing is ever written back to Google; this only
reads reports.

Until the steps below are done, the Performance page will stay empty.

## 1. Add the secret that protects the job

The refresh runs at a web address. Without a secret, anyone who guessed the
address could trigger it. Create one long random value and add it to Vercel.

Generate a secret (any long random string works):

```bash
openssl rand -base64 32
```

In Vercel: **Project → Settings → Environment Variables → Add**

| Name | Value | Environments |
| --- | --- | --- |
| `CRON_SECRET` | the value you just generated | Production |

If `CRON_SECRET` is not set, the route refuses every request. It never runs
unprotected.

## 2. Add the Google Ads reporting settings

The same OAuth connection you already use is reused, so there is no second
login. These tell it which advertising account to read.

| Name | Value | Notes |
| --- | --- | --- |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | your developer token | you already have this |
| `GOOGLE_CLIENT_ID` | your OAuth client id | already used for connecting |
| `GOOGLE_CLIENT_SECRET` | your OAuth client secret | already used for connecting |
| `GOOGLE_ADS_CUSTOMER_ID` | the account to report on, digits only | e.g. `1600269431` |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | your manager account, digits only | e.g. `5956452500` |

`GOOGLE_ADS_CUSTOMER_ID` is optional if the account id was captured when you
connected Google; setting it explicitly is safer.

## 3. The schedule is already in the project

`vercel.json` at the top level of the project sets it:

```json
{
  "crons": [
    { "path": "/api/cron/refresh-metrics", "schedule": "30 2 * * *" }
  ]
}
```

`30 2 * * *` means 02:30 UTC every day, which is 08:00 in India. That is after
Google has finished settling the previous day's figures.

Vercel picks this up on the next deployment. To confirm it registered, open
**Project → Settings → Cron Jobs** in Vercel — the job appears there with its
next run time.

> Cron jobs need a Vercel Pro plan. On the Hobby plan the schedule is ignored;
> you can still trigger the refresh by hand using the command in the next
> section, or point any external scheduler at the same address.

## 4. Check that it works

Run it once by hand. Replace the address with your own and the secret with the
one you set:

```bash
curl -i -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://your-app.vercel.app/api/cron/refresh-metrics
```

A healthy response looks like:

```json
{
  "ok": true,
  "date": "2026-08-26",
  "accounts": 1,
  "metric_rows": 3,
  "campaigns_linked": 1,
  "leads_attributed": 4,
  "leads_untraceable": 2,
  "failures": []
}
```

What the numbers mean:

- **metric_rows** — campaigns that had figures for that day
- **campaigns_linked** — Google campaigns matched to campaigns created in this app
- **leads_attributed** — leads traced back to the campaign that produced them
- **leads_untraceable** — leads whose click could not be placed (see the note below)
- **failures** — empty when every account succeeded

Without the secret you get `401 unauthorized`, which is the correct response.

## Re-running a specific day

Safe to repeat as often as you like — re-running replaces that day's figures
rather than adding to them.

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://your-app.vercel.app/api/cron/refresh-metrics?date=2026-08-20"
```

## Why some leads cannot be traced

The ads this app publishes do not tag their links with the campaign they came
from. The only remaining link is Google's click id, which the job looks up in
Google's click report. That works only when:

- your website's tracking script captured the click id and sent it with the lead, and
- the click happened within roughly the last 90 days, which is as far back as
  Google's click report goes.

Leads that fail either test appear on the Performance page under **Could not be
traced to a campaign**. They are counted in your totals but cannot be credited
to a specific campaign.

The permanent fix is to have the app tag every ad link with its campaign id
when it publishes to Google. That requires writing to Google Ads, so it is
deliberately not part of this read-only work.
