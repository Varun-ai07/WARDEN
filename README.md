# WARDEN

WARDEN is an evidence-first policy engine for recurring commitments. It compiles a user-confirmed natural-language policy, plans actions against a versioned portfolio snapshot, and executes only narrowly scoped, explicitly approved effects.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Dashboard │  │ Approval │  │ Command  │  │ Evidence      │  │
│  │          │  │ Panel    │  │ Palette  │  │ Drawer        │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (Express API)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Service  │  │ Reasoner │  │ Provider │  │ Logger        │  │
│  │ Layer    │  │ (LLM)    │  │ (Prava)  │  │ (Structured)  │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Persistence (SQLite)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Runs     │  │ Decisions│  │ Evidence │  │ Ledger        │  │
│  │          │  │          │  │          │  │ (Hash-chain)  │  │
│  └──────────┘  └──────────┘  └──────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Flows

1. **Policy Compilation**: Natural language → structured rules (MONTHLY_CAP, MAX_INACTIVE_DAYS, MIN_ANNUAL_SAVINGS_BPS)
2. **Decision Planning**: Policy + Portfolio → candidate actions (RENEW, SWITCH, DECLINE)
3. **Execution**: Approved decisions → Prava session → merchant checkout → evidence
4. **Verification**: Hash-chained ledger events with correlation IDs

## Quick Start

### Prerequisites

- Node.js 24+
- npm

### Setup

```bash
# Clone and install
git clone <repo-url> Warden
cd Warden
npm install

# Configure environment
cp .env.example .env
# Edit .env with your API keys (see Configuration below)

# Start development
npm run dev
```

Open `http://localhost:5173` in your browser.

### Configuration

#### Minimal (Simulation Mode)

```bash
# No API keys needed - uses fake providers
REASONER_MODE=fake
PAYMENT_PROVIDER_MODE=fake
```

#### With OpenAI Reasoning

```bash
REASONER_MODE=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1
```

#### With Prava Sandbox

```bash
PAYMENT_PROVIDER_MODE=prava
PRAVA_API_KEY=sk_test_...
PRAVA_BASE_URL=https://sandbox.api.prava.space
PRAVA_PUBLISHABLE_KEY=pk_test_...
```

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` / `Ctrl+K` | Open command palette |
| `⌘R` / `Ctrl+R` | Run policy |
| `⌘E` / `Ctrl+E` | Edit policy |
| `⌘L` / `Ctrl+L` | View ledger |
| `Escape` | Close modals |

## Project Structure

```text
warden/
├── apps/
│   ├── api/                    # Express REST API
│   │   └── src/
│   │       ├── app.ts          # Route definitions
│   │       ├── service.ts      # Business logic, state machine
│   │       ├── reasoner.ts     # LLM reasoning (OpenAI/OpenRouter)
│   │       ├── prava-provider.ts  # Prava payment integration
│   │       ├── merchant-checkout.ts  # Merchant checkout adapters
│   │       ├── logger.ts       # Structured logging
│   │       └── db.ts           # SQLite persistence
│   └── web/                    # React/Vite frontend
│       └── src/
│           ├── App.tsx         # Main dashboard
│           ├── CommandPalette.tsx  # ⌘K command palette
│           ├── api.ts          # API client
│           └── prava/          # Prava SDK components
├── packages/
│   └── shared/                 # Shared types and schemas
├── artifacts/                  # Screenshots
└── .env.example               # Environment template
```

## Features

### Core

- **Policy Engine**: Natural language → deterministic rules
- **Decision Planning**: Portfolio-aware action recommendations
- **Execution**: Scoped approval with Prava integration
- **Evidence**: Hash-chained, verifiable audit trail

### Dashboard

- **Real-time Updates**: SSE-powered live event streaming
- **Command Palette**: ⌘K for quick actions
- **Keyboard Navigation**: Full keyboard support
- **Responsive Design**: Works on desktop and mobile

### Backend

- **Structured Logging**: Correlation IDs, request tracking
- **Error Handling**: Network errors, retry logic
- **Idempotency**: Safe repeated requests
- **Rate Limiting**: 180 requests/minute

## Verification

```bash
# Run all checks (type-check + tests + build)
npm run check

# Individual commands
npm run typecheck    # Type checking
npm test            # API tests (17 tests)
npm run build       # Production build
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/session` | Get session info |
| GET | `/api/v1/subscriptions` | List subscriptions |
| GET | `/api/v1/policies/current` | Get active policy |
| PUT | `/api/v1/policies/current` | Update policy |
| POST | `/api/v1/runs` | Create new run |
| GET | `/api/v1/runs/latest` | Get latest run |
| GET | `/api/v1/runs/:id/events` | Get run events |
| GET | `/api/v1/runs/:id/stream` | SSE event stream |
| POST | `/api/v1/decisions/:id/approval-session` | Start approval |
| POST | `/api/v1/decisions/:id/attempts` | Execute attempt |
| POST | `/api/v1/decisions/:id/cancel` | Decline decision |

## Current Limits

- Manually triggered runs; no background scheduler
- Synthetic single-user demo session
- One currency per portfolio (USD)
- One backend process and SQLite database
- Live Prava sandbox requires credentials
- Live OpenRouter behavior is model/endpoint-dependent

## Screenshots

Visual smoke outputs in `artifacts/`:

- `warden-dashboard-final.png`
- `warden-dashboard-mobile-final.png`
- `warden-evidence-flow-final.png`

## License

Private - Synthesis Hackathon 2026
