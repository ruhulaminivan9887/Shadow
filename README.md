# ShadowLens — Shadow AI Discovery & Governance

Connects to a company's Google Workspace or Microsoft 365 tenant (real admin OAuth,
real API calls) and discovers every third-party app employees have authorized —
flagging which ones are AI tools, scoring the risk, and generating an AI-written
governance briefing.

## Why this exists
80% of companies report unmonitored AI tool use by employees; only 25% have any
visibility into it (2026 industry data). Average shadow-AI-linked breach cost:
$4.2M. Mid-market governance programs cost $25k-$60k. This tool does the discovery
piece — the first, cheapest step — for a fraction of that.

## Honest limitation
The Google Workspace and Microsoft 365 integrations use each provider's real,
documented admin APIs, but require a genuine company admin to grant consent.
This was built correctly against the official API docs but has NOT been
live-tested against a real tenant — that verification happens on your first
real connection. If something in the OAuth flow needs adjusting once you test
it against an actual Workspace/365 account, that's expected — tell me what
error you see and I'll fix it precisely.

## Setup

### 1. Supabase (accounts + database)
New project -> SQL Editor -> run `supabase-schema.sql` -> Settings -> API -> copy
URL + anon key + service_role key into your `.env` / Render environment.

### 2. Google Workspace OAuth
console.cloud.google.com -> new project -> APIs & Services -> Credentials ->
Create OAuth Client ID (Web application) -> Authorized redirect URI:
`https://yourdomain.com/auth/google/callback`
Copy Client ID + Secret. You'll also need to enable the **Admin SDK API** for
the project (APIs & Services -> Library -> search "Admin SDK API" -> Enable).

### 3. Microsoft 365 OAuth
portal.azure.com -> Azure Active Directory -> App registrations -> New
registration -> Redirect URI: `https://yourdomain.com/auth/microsoft/callback`
-> API permissions -> Add: `Application.Read.All`, `Directory.Read.All`
(Application permissions) -> **Grant admin consent**.
Certificates & secrets -> New client secret -> copy the value immediately
(it's only shown once).

### 4. Anthropic + Stripe
Same pattern as PentScribe/SentraMap.

## Run locally
```
npm install
cp .env.example .env   # fill in what you have
npm start
```

## Deploy
Push to GitHub -> Render -> New Web Service -> connect via GitHub (not the
public URL paste method) -> Build: `npm install` -> Start: `npm start` -> add
all env vars in the dashboard.
