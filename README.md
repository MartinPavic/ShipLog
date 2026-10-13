# ShipLog

**Stop writing weekly updates. Generate them from your GitHub commits.**

ShipLog is a Next.js SaaS starter that turns your GitHub activity into clean, professional progress reports using AI.

Perfect for indie hackers, solo founders, and small teams who hate writing status updates.

## Features

- GitHub integration (Personal Access Token)
- AI-powered ship logs (OpenAI, Anthropic, or Grok)
- Free plan: 5 generations / month
- Pro plan: unlimited generations + full history (€9/mo)
- Clean dashboard + settings
- Stripe subscriptions
- Clerk authentication

## Tech Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Clerk (auth)
- Stripe (subscriptions)
- GitHub API + AI providers

## Quick Start

### 1. Clone & install

```bash
git clone <your-repo-url>
cd shiplog
npm install