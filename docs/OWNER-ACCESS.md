# MPG Reputation — Owner Product Access & Operational Guide

| Metadata | Value |
|---|---|
| Document | Owner Product Access and Operational Walkthrough |
| Status | ACTIVE |
| Milestone | V0.2 — Controlled Staging & Founder Product Experience |
| Authority | MPG-DEC-045 |
| Classification | Public Safe — No Secrets |

This document provides exact, actionable instructions for the MPG Founder to inspect, operate, and validate MPG Reputation through the graphical interface without requiring code inspection or direct database queries.

---

## 1. Local Environment Access

### Prerequisites

- Node.js v20+ and pnpm v10+ installed
- Docker Desktop running (for local Supabase PostgreSQL and Auth)
- Git repository clone at `E:\MPG-Reputation`

### Local Service Startup

To run the complete local environment, open two or three terminal tabs in `E:\MPG-Reputation`:

#### Terminal 1: Supabase Database & Auth Engine
```bash
# Start local Supabase containers (PostgreSQL, GoTrue Auth, Storage, Studio)
npx supabase start

# To reset database to clean migration baseline if desired:
# npx supabase db reset
```

#### Terminal 2: Next.js Web Application
```bash
# Start Next.js development server
pnpm dev
```

#### Terminal 3: Inngest Background Workflow Server (Optional for Real-time Dev UI)
```bash
# Start Inngest local dev server connected to the Next.js endpoint
pnpm inngest:dev
```
*Note: The Next.js application runs scheduled outbox recovery and workflow dispatch automatically, but running `pnpm inngest:dev` allows inspecting event runs, step trees, and sleeps in real-time.*

### Local Service URLs

| Service | URL | Purpose |
|---|---|---|
| **MPG Reputation Web App** | `http://localhost:3000` | Primary founder application interface |
| **Login & Account Creation** | `http://localhost:3000/login` | Authentication & synthetic account access |
| **Supabase Studio (Developer)** | `http://127.0.0.1:54333` | Local database, table inspector, and auth user view |
| **Inngest Dev UI** | `http://127.0.0.1:8288` | Workflow step execution, sleep states, and event timeline |
| **Local Inbucket Email Catcher** | `http://127.0.0.1:54334` | Captured local emails (if SMTP routing is active) |

### Local Shutdown

```bash
# Stop Next.js and Inngest: Ctrl+C in their respective terminal windows

# Stop local Supabase containers:
npx supabase stop
```

---

## 2. Founder Guided Product Walkthrough

Follow these steps to exercise the complete synthetic customer journey through the user interface:

### Step 1: Open the Application
Navigate to `http://localhost:3000` in your web browser. Click **"Get Started"** or **"Sign In"**.

### Step 2: Create Synthetic Account / Sign In
- If first time: On `http://localhost:3000/login`, enter an email (e.g. `founder@northstardental.test`) and password, then click **"Create Development Account"**.
- If account exists: Enter credentials and click **"Sign In"**.

### Step 3: Complete Business Onboarding
If this is a fresh account without an organization, you are redirected to `/onboarding`:
- **Organization Name**: `Northstar Dental`
- **Primary Location Name**: `Main Clinic`
- **Address (optional)**: `100 Market St, Suite 400`
- Click **"Continue to Review Setup"**.

### Step 4: Configure Review Destination
You are taken to `/app/settings/review-destination`:
- Select location: `Main Clinic`
- **Destination Provider**: Google
- **Google Review URL**: Enter a valid synthetic Google URL, e.g.:
  `https://g.page/r/synthetic-test-link/review`
  *(Or `https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4`)*
- Click **"Save & Confirm Destination"**.
- Confirm status displays **CONFIRMED** with a green badge.

### Step 5: Open Dashboard
Click **"Dashboard"** in the top navigation bar (`/app/dashboard`):
- Verify the **System Status Banner** displays **READY FOR SYNTHETIC TEST** (or **RUNNING**).
- Confirm "Needs Attention" card indicates no critical configuration blockers.
- Observe baseline metrics: `0 Completed Customers`, `0 Requests Sent`, `0 Review Links Clicked`.

### Step 6: Submit a Synthetic Job Completion (Quick Complete)
Click **"+ Quick Complete"** in the navigation bar or top right of the dashboard (`/app/quick-complete`):
- **Location**: `Main Clinic`
- **First Name**: `Jane`
- **Last Name**: `Doe`
- **Email Address**: `jane.doe@example.test`
- **Channel Permission**: Check **"Email review requests permitted by customer"** (mandatory for eligibility).
- Click **"Record Job Completion & Send Request"**.
- Verify the green success notification appears:
  `"Customer completion recorded. Event dispatched for review solicitation."`

### Step 7: Inspect Workflow & Development Email Representation
Return to the **Dashboard** (`/app/dashboard`):
- Under **Recent Review Solicitations**, you will see the new row for `Jane Doe`.
- Status will transition: `SCHEDULED` (during cooldown delay) → `SENT`.
- Inspect the **Email Preview**:
  - **Recipient**: `jane.doe@example.test`
  - **Subject**: `How was your experience with Northstar Dental?`
  - **Tone**: Strictly neutral solicitation ("If you'd like to share your experience, we'd appreciate your honest feedback").
  - **Provider**: `ConsoleEmailProvider` (safe internal preview).

### Step 8: Test the Tracked Review Link
In the **Recent Review Solicitations** table on the dashboard:
- Locate the **"Test Link ↗"** action next to Jane Doe's request.
- Click the link (or open `http://localhost:3000/r/[token]` in a new tab).
- Observe an immediate **HTTP 302 redirect** directly to the configured Google destination URL (`https://g.page/r/synthetic-test-link/review`).

### Step 9: Verify Truthful Dashboard State Update
Return to the **Dashboard** (`/app/dashboard`):
- Refresh or view the metrics:
  - **Completed Customers**: `1`
  - **Requests Sent**: `1`
  - **Review Links Clicked**: `1`
- Under Recent Solicitations, Jane Doe's request status has updated to **`CLICKED`** with a timestamp.
- Confirm: **A click is truthfully recorded as a link click, NEVER fabricated as a review received or star rating.**

---

## 3. Troubleshooting Guide

| Issue | Likely Cause | Resolution |
|---|---|---|
| **Cannot reach `localhost:3000`** | Next.js server not running | In terminal, run `pnpm dev` in `E:\MPG-Reputation`. |
| **Database error / connection refused** | Supabase containers stopped or Docker not running | Ensure Docker Desktop is running, then execute `npx supabase start`. |
| **Login fails: "Invalid login credentials"** | User not created yet | Click "Create Development Account" first on `/login`. |
| **Redirected back to `/onboarding`** | User has no organization | Complete the onboarding form to create an organization and owner membership. |
| **Quick Complete shows "Review Destination Missing"** | Location lacks confirmed URL | Go to `/app/settings/review-destination` and enter a valid Google review link. |
| **Workflow stuck in `SCHEDULED`** | Delay timer active or Inngest not polling | The default cooldown delay is 2 seconds in development. Refresh the dashboard. If using Inngest CLI, verify `pnpm inngest:dev` is running. |
| **Tracked link returns 404** | Invalid token or mismatched hash | Use the exact "Test Link" from the dashboard solicitations table. |
| **Port conflict (e.g. 54332 or 3000 in use)** | Another process holding port | Free the port or check running containers via `docker ps`. |

---

## 4. Controlled Staging Environment

| Component | Target Provider | Configuration Status |
|---|---|---|
| **Web Frontend** | Vercel (Next.js App Router) | **TBD** (Awaiting Owner Authorization / Account Linking) |
| **Database & Auth** | Supabase Cloud (Dedicated Staging Project) | **TBD** (Awaiting Owner Project Creation) |
| **Workflow Engine** | Inngest Cloud (Staging Environment) | **TBD** (Awaiting Owner Integration) |
| **Staging URL** | `https://staging-mpg-reputation.vercel.app` (or custom subdomain) | **TBD** |
| **Live Email** | `ENABLE_LIVE_EMAIL=false` / `ConsoleEmailProvider` | **FROZEN** (Live sending prohibited in V0.2) |
| **Customer Data** | Synthetic Test Data Only | **MANDATORY** |

*Staging deployment steps and configuration details will be updated once hosted platform accounts are linked by the owner.*
