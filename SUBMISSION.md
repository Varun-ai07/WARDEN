# WARDEN — Agentic Commerce Hackathon Submission

## Tagline
AI agent that enforces your spending policy across all subscriptions.

## Problem
The average household has 12+ active subscriptions and wastes $2,400/year on forgotten or unused services. Current solutions (Rocket Money, Trim) show you what you're paying for but don't take action. Users need an agent that not only discovers subscriptions but enforces spending rules automatically.

## What WARDEN Does
WARDEN is a policy engine for recurring commitments. You write spending rules in plain English, and an AI agent analyzes your subscriptions, recommends actions (renew, downgrade, cancel), and completes transactions through Prava — all with your approval at every step.

### Core Flow
1. **Define Policy** — "Never spend more than $60/month. Cancel anything unused for 30 days."
2. **Agent Analyzes** — AI evaluates each subscription against your rules
3. **Review Recommendations** — See clear actions with reasoning
4. **Approve & Execute** — One-click approval, Prava handles the payment
5. **Evidence Ledger** — Hash-chained audit trail of every action

## Prava Integration
We use Prava SDK/API for the core commercial action: completing subscription payments.

### How It Works
1. Agent creates a Prava session with merchant details and amount
2. User approves via Prava's secure iframe (passkey authentication)
3. Prava tokenizes the card and issues a merchant-scoped credential
4. Agent uses the credential to complete the checkout
5. Transaction is verified and recorded in the evidence ledger

### Why Prava
Prava enables the trust layer between AI agents and payment execution. Instead of agents handling raw card data, they handle permissions to spend — approved by the user and enforced at the card network level. This is essential for agentic commerce.

## Technology
- **Backend:** Express.js, SQLite, TypeScript
- **Frontend:** React, Vite, Tailwind CSS
- **AI:** OpenAI GPT-4.1 for policy reasoning
- **Payments:** Prava SDK/API (sandbox)
- **Architecture:** Hash-chained ledger, SSE real-time updates, keyboard shortcuts

## What Existed Before
This project was built from scratch during the hackathon. No pre-existing code.

## What Worked
- Prava sandbox session creation and card tokenization
- Real-time SSE event streaming
- Policy compilation from natural language
- Terminal transaction states (COMPLETED/AVOIDED)

## What Didn't Work
- Initial Prava flow returned RECONCILING instead of terminal states
- merchant checkout adapter needed real token flow
- Status labels were unclear ("PLAN ACTIVATED" vs "TRANSACTION COMPLETED")

## What We Learned
- Agentic commerce requires clear transaction completion proof
- Users need to understand what the agent is doing at every step
- Policy engines are a novel approach to subscription management
- Prava's passkey flow provides the right trust boundary for AI payments

## Team
Built during Agentic Commerce Hackathon, August 1-2, 2026.
