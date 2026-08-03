import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CircleDot,
  FileCheck2,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Decision, EvidenceRecord, LedgerEvent, PolicyRecord, RunRecord, SavingsSummary, SessionResponse, Subscription } from "@warden/shared";
import { api, NetworkError } from "./api";
import { CommandPalette } from "./CommandPalette";
import { Landing } from "./Landing";
import "./landing.css";

const money = (minor: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
const shortId = (value: string) => `${value.slice(0, 11)}…${value.slice(-4)}`;
const terminalStatuses = new Set(["NO_ACTION_REQUIRED", "RECOMMENDED", "VALIDATION_FAILED", "STALE", "APPROVAL_DECLINED", "EXPIRED", "COMPLETED", "AVOIDED", "FAILED"]);

function actionTypeLabel(action: string, targetPlan: string | null): string {
  if (action === "RENEW") return "RENEW";
  if (action === "SWITCH") return targetPlan ? `SWITCH → ${targetPlan}` : "SWITCH";
  if (action === "DECLINE") return "DECLINE";
  return action;
}

function MerchantIcon({ name }: { name: string }) {
  const logos: Record<string, React.ReactNode> = {
    "Adobe Creative Cloud": <svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M9.4 2H3.6l6 17.1h5.8L9.4 2zm2.2 10.6L10.2 5h.1l4.2 12.1h-2.3l-1-3.1H9.6l-.4 1.4h-1.9L11.6 12.6zM17.1 2h5.8l-6 17.1h-5.7L17.1 2z"/></svg>,
    "Equinox Gym": <svg viewBox="0 0 24 24" width="18" height="18" fill="white"><circle cx="12" cy="12" r="10" fill="#1a1a1a"/><text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="700" fill="white">E</text></svg>,
    "Spotify": <svg viewBox="0 0 24 24" width="18" height="18" fill="#1db954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381C8.64 6.001 15.6 6.24 20.04 8.76c.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.439.36z"/></svg>,
    "Figma": <svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z" fill="#0acf83"/><path d="M12 2h3.5a3.5 3.5 0 0 1 0 7H12V2z" fill="#a259ff"/><path d="M12 12.5a3.5 3.5 0 0 1 3.5-3.5H18v3.5a3.5 3.5 0 0 1-7 0z" fill="#f24e1e"/><path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z" fill="#ff7262"/><path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z" fill="#1abcfe"/></svg>,
    "Notion": <svg viewBox="0 0 24 24" width="18" height="18" fill="white"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L18.2 2.16c-.42-.326-.98-.7-2.055-.607l-12.8.934c-.466.047-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.168V6.354c0-.28-.14-.466-.467-.42l-15.677.935c-.372.047-.56.28-.56.653zm14.337.745c.093.467 0 .934-.466.98l-.7.14v10.264c-.608.327-1.168.515-1.635.515-.748 0-.935-.234-1.498-.934l-4.577-7.186v6.952l1.497.327s0 .935-1.311.935l-3.666.187c-.094-.187 0-.653.327-.746l.98-.233V9.854L7.822 9.66c-.094-.467.14-1.168.793-1.215l3.834-.233 5.282 8.03V9.29l-1.265-.14c-.093-.56.233-.934.606-1.028z"/></svg>,
    "Coursera Plus": <svg viewBox="0 0 24 24" width="18" height="18" fill="#0056d2"><circle cx="12" cy="12" r="10"/><text x="12" y="16" textAnchor="middle" fontSize="12" fontWeight="700" fill="white">C</text></svg>,
  };
  if (logos[name]) return <span className="merchant-icon">{logos[name]}</span>;
  return <span className="merchant-icon" style={{ background: "#888", color: "white", fontSize: "12px", fontWeight: 700 }}>{name.charAt(0)}</span>;
}

function StatusMark({ status, label, action, targetPlan }: { status: string; label?: string; action?: string; targetPlan?: string | null }) {
  const isTerminal = status === "COMPLETED" || status === "AVOIDED";
  const isRecommendation = status === "RECOMMENDED" || status === "NO_ACTION_REQUIRED";

  let tone = "info";
  if (isTerminal && action === "DECLINE") tone = "error";
  else if (isTerminal && action === "SWITCH") tone = "success";
  else if (isTerminal && action === "RENEW") tone = "warning";
  else if (isRecommendation) tone = "info";
  else if (status.includes("APPROVAL") || status === "AUTHORIZED") tone = "warning";
  else if (status === "FAILED" || status === "EXPIRED" || status === "STALE") tone = "error";
  else if (status === "RECONCILING" || status === "UNKNOWN") tone = "unknown";

  const displayLabel = label ?? (action ? actionTypeLabel(action, targetPlan ?? null) : status.replaceAll("_", " "));
  return <span className={`status status--${tone}`}><span className="status__dot" />{displayLabel}</span>;
}

function decisionStatusLabel(decision: Decision, environment: SessionResponse["environment"] | undefined): string {
  if (decision.execution_status === "RECOMMENDED") return "RECOMMENDATION";
  if (decision.execution_status === "NO_ACTION_REQUIRED") return "NO ACTION REQUIRED";
  if (decision.execution_status === "STALE") return "BLOCKED BY PREREQUISITE";
  if (decision.execution_status === "VALIDATION_FAILED") return "VALIDATION FAILED";
  if (decision.execution_status === "APPROVAL_DECLINED") return "APPROVAL DECLINED";
  if (decision.execution_status === "EXPIRED") return "APPROVAL EXPIRED";
  if (decision.execution_status === "FAILED") return "EXECUTION FAILED";
  if (decision.execution_status === "UNKNOWN") return "UNRESOLVED PROVIDER STATE";
  if (decision.execution_status === "RECONCILING") return "RECONCILING PROVIDER RESULT";
  if (decision.execution_status === "COMPLETED") {
    if (decision.evidence_ids.length === 0) return "EVIDENCE PENDING";
    if (decision.outcome_type === "decision_only") return "RECOMMENDATION";
    if (decision.action === "RENEW") return "RENEWED";
    if (decision.action === "SWITCH") return `SWITCHED → ${decision.target_plan_id}`;
    return "TRANSACTION COMPLETED";
  }
  if (decision.execution_status === "AVOIDED") {
    if (decision.evidence_ids.length === 0) return "EVIDENCE PENDING";
    if (decision.outcome_type === "decision_only") return "RECOMMENDATION";
    return "DECLINED · CHARGE PREVENTED";
  }
  return decision.execution_status.replaceAll("_", " ");
}

function RuleLabel({ rule }: { rule: PolicyRecord["compiled_rules"]["rules"][number] }) {
  if (rule.type === "MONTHLY_CAP") return <span>Portfolio cap <strong>{money(rule.amount_minor)}</strong></span>;
  if (rule.type === "MAX_INACTIVE_DAYS") return <span>Inactive threshold <strong>{rule.days} days</strong></span>;
  return <span>Annual threshold <strong>{rule.basis_points / 100}%</strong></span>;
}

function DecisionRail({ decisions, onApprove, onDecline, busy, environment }: { decisions: Decision[]; onApprove: (decision: Decision) => void; onDecline: (decision: Decision) => void; busy: string | null; environment?: SessionResponse["environment"] }) {
  if (decisions.length === 0) return <div className="empty"><CircleDot size={18} /><p>Run the active policy to create a versioned decision plan.</p></div>;
  return <div className="decision-rail">{decisions.map((decision, index) => (
    <article className={`decision decision--${decision.action.toLowerCase()} ${decision.execution_status === "AWAITING_APPROVAL" ? "decision--active" : ""} ${decision.outcome_type === "decision_only" ? "decision--recommendation" : ""}`} key={decision.decision_id}>
      <div className="decision__index">{String(index + 1).padStart(2, "0")}</div>
      <div className="decision__line-thick" aria-hidden="true" />
      <div className="decision__line-thin" aria-hidden="true" />
      <div className="decision__body">
        <div className="decision__head">
          <div><p className="eyebrow">{decision.action}{decision.target_plan_id ? ` → ${decision.target_plan_id}` : ""}</p><h3>{decision.merchant_name}</h3></div>
          <StatusMark status={decision.execution_status} label={decisionStatusLabel(decision, environment)} action={decision.action} targetPlan={decision.target_plan_id} />
        </div>
        <p className="decision__reason">{decision.reasoning}</p>
        <div className="decision__facts">
          <span>Rule <strong>{decision.policy_rule_reference}</strong></span>
          {decision.authorized_amount_minor > 0 && <span>Authorize <strong>{money(decision.authorized_amount_minor, decision.currency)}</strong></span>}
          {decision.recurring_monthly_savings_minor > 0 && <span>Save <strong>{money(decision.recurring_monthly_savings_minor, decision.currency)}/mo</strong> ({Math.round((decision.recurring_monthly_savings_minor / decision.effective_monthly_cost_minor) * 100)}%)</span>}
        </div>
        {decision.outcome_type === "decision_only" && decision.action === "DECLINE" && (
          <div className="decision__auto-decline">
            <Check size={14} />
            <span>Agent automatically declined this charge — no payment required.</span>
          </div>
        )}
        {decision.outcome_type === "decision_only" && decision.action !== "DECLINE" && (
          <p className="decision__recommendation">This is a recommendation only. No payment will be processed.</p>
        )}
        {(decision.execution_status === "COMPLETED" || decision.execution_status === "AVOIDED") && decision.evidence_ids.length > 0 && (
          <div className="decision__transaction-proof">
            <Check size={14} />
            <span>{decision.execution_status === "COMPLETED" ? "Transaction completed successfully" : "Charge prevented successfully"}</span>
          </div>
        )}
        {decision.execution_status === "AWAITING_APPROVAL" && decision.action === "SWITCH" && (
          <div className="decision__actions decision__actions--switch">
            <button className="button button--switch" disabled={busy === decision.decision_id} onClick={() => onApprove(decision)}>
              {busy === decision.decision_id ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}
              Switch to {decision.target_plan_id}
            </button>
            <button className="button button--secondary" onClick={() => onDecline(decision)}>Keep current plan</button>
          </div>
        )}
        {decision.execution_status === "AWAITING_APPROVAL" && decision.action === "RENEW" && (
          <div className="decision__actions">
            <button className="button button--renew" disabled={busy === decision.decision_id} onClick={() => onApprove(decision)}>
              {busy === decision.decision_id ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}
              Approve renewal
            </button>
          </div>
        )}
        {decision.execution_status === "AWAITING_APPROVAL" && decision.action === "DECLINE" && (
          <div className="decision__actions">
            <button className="button button--decline" disabled={busy === decision.decision_id} onClick={() => onApprove(decision)}>
              {busy === decision.decision_id ? <LoaderCircle className="spin" size={16} /> : <X size={16} />}
              Confirm decline
            </button>
          </div>
        )}
        {decision.evidence_ids.length > 0 && <div className="evidence-links">{decision.evidence_ids.map((evidenceId) => <button data-evidence-id={evidenceId} className="evidence-link" key={evidenceId}><FileCheck2 size={14} />{shortId(evidenceId)}</button>)}</div>}
      </div>
    </article>
  ))}</div>;
}

export function App() {
  const [view, setView] = useState<"landing" | "dashboard">("landing");
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [portfolioVersion, setPortfolioVersion] = useState(1);
  const [policy, setPolicy] = useState<PolicyRecord | null>(null);
  const [policyText, setPolicyText] = useState("");
  const [savings, setSavings] = useState<SavingsSummary>({ currency: "USD", recurring_monthly_saved_minor: 0, one_time_avoided_minor: 0 });
  const [run, setRun] = useState<RunRecord | null>(null);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [approval, setApproval] = useState<{
    decision: Decision;
    attemptId: string;
    label: string;
    mode: string;
    providerSessionId: string | null;
    providerSessionToken: string | null;
    iframeUrl: string | null;
    publishableKey: string | null;
  } | null>(null);
  const [evidence, setEvidence] = useState<EvidenceRecord | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "live" | "reconnecting" | "closed">("idle");
  const approvalButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const evidenceCloseRef = useRef<HTMLButtonElement>(null);
  const evidencePreviousFocusRef = useRef<HTMLElement | null>(null);
  const latestRefreshSequenceRef = useRef(0);

  const load = useCallback(async () => {
    try {
      setError(null);
      const sessionData = await api.session();
      setSession(sessionData);
      const [subscriptionsData, policyData, savingsData, latestRun] = await Promise.all([api.subscriptions(), api.policy(), api.savings(), api.latestRun()]);
      setSubscriptions(subscriptionsData.subscriptions);
      setPortfolioVersion(subscriptionsData.portfolio_version);
      setPolicy(policyData);
      setPolicyText(policyData.policy_text);
      setSavings(savingsData);
      setRun(latestRun.run);
      if (latestRun.run) setEvents((await api.events(latestRun.run.run_id)).events);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "WARDEN could not load.");
    } finally {
      setLoading(false);
    }
  }, []);

  const navigateToDashboard = useCallback((policyText?: string) => {
    setView("dashboard");
    if (policyText) setPolicyText(policyText);
    void load();
  }, [load]);

  useEffect(() => {
    if (view === "dashboard") void load();
  }, [view, load]);

  useEffect(() => {
    if (!run) { setConnectionState("idle"); return; }
    if (["COMPLETED", "PARTIALLY_COMPLETED", "FAILED", "CANCELLED", "STALE"].includes(run.run_status)) {
      setConnectionState("closed");
      return;
    }
    setConnectionState("connecting");
    const source = new EventSource(`/api/v1/runs/${run.run_id}/stream`, { withCredentials: true });
    source.addEventListener("run_event", (message) => {
      const event = JSON.parse((message as MessageEvent).data) as LedgerEvent;
      setEvents((current) => current.some((item) => item.event_id === event.event_id) ? current : [...current, event].sort((a, b) => a.sequence - b.sequence));
      const requestedSequence = event.sequence;
      void Promise.all([api.run(run.run_id), api.subscriptions(), api.savings()]).then(([nextRun, nextSubscriptions, nextSavings]) => {
        if (requestedSequence < latestRefreshSequenceRef.current) return;
        latestRefreshSequenceRef.current = requestedSequence;
        setRun(nextRun);
        setSubscriptions(nextSubscriptions.subscriptions);
        setPortfolioVersion(nextSubscriptions.portfolio_version);
        setSavings(nextSavings);
      });
    });
    source.onerror = () => setConnectionState("reconnecting");
    source.onopen = () => setConnectionState("live");
    return () => source.close();
  }, [run?.run_id, run?.run_status]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-evidence-id]");
      if (button?.dataset.evidenceId) {
        evidencePreviousFocusRef.current = button;
        void api.evidence(button.dataset.evidenceId).then(setEvidence).catch((cause) => setError(cause.message));
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    if (!approval) return;
    approvalButtonRef.current?.focus();
    const handleDialogKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") setApproval(null);
      if (event.key !== "Tab") return;
      const panel = document.querySelector<HTMLElement>(".approval-panel");
      const focusable = panel ? [...panel.querySelectorAll<HTMLElement>("button:not([disabled]), [href], textarea, input, select, [tabindex]:not([tabindex='-1'])")] : [];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleDialogKeys);
    return () => {
      document.removeEventListener("keydown", handleDialogKeys);
      previousFocusRef.current?.focus();
    };
  }, [approval]);

  useEffect(() => {
    if (!evidence) return;
    evidenceCloseRef.current?.focus();
    const handleDrawerKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEvidence(null);
      if (event.key !== "Tab") return;
      const drawer = document.querySelector<HTMLElement>(".proof-drawer");
      const focusable = drawer ? [...drawer.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")] : [];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleDrawerKeys);
    return () => {
      document.removeEventListener("keydown", handleDrawerKeys);
      evidencePreviousFocusRef.current?.focus();
    };
  }, [evidence]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      void load();
    };
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [load]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const scrollToLedger = useCallback(() => {
    document.querySelector(".ledger")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const focusPolicyTextarea = useCallback(() => {
    document.querySelector<HTMLTextAreaElement>(".policy-panel textarea")?.focus();
  }, []);

  const currentMonthly = useMemo(() => subscriptions.reduce((sum, item) => sum + item.current_monthly_cost_minor, 0), [subscriptions]);
  const cap = policy?.compiled_rules.rules.find((rule) => rule.type === "MONTHLY_CAP");
  const pendingCount = run?.decisions.filter((decision) => !terminalStatuses.has(decision.execution_status)).length ?? 0;
  const policyDirty = Boolean(policy && policyText !== policy.policy_text);

  async function startRun() {
    if (!policy) return;
    setBusy("run");
    try { const next = await api.createRun(policy.version, portfolioVersion); setRun(next); setEvents((await api.events(next.run_id)).events); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Run failed."); }
    finally { setBusy(null); }
  }

  async function savePolicy() {
    if (!policy) return;
    setBusy("policy");
    try {
      const draft = await api.draftPolicy(policyText, policy.version);
      if (draft.compiled_rules.unsupported_clauses.length) setError(draft.compiled_rules.unsupported_clauses.join(" "));
      else { const active = await api.activatePolicy(draft.policy_id, draft.version); setPolicy(active); setError(null); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Policy update failed."); }
    finally { setBusy(null); }
  }

  async function reviewApproval(decision: Decision) {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    setBusy(decision.decision_id);
    try {
      // Refresh run data first to get current decision IDs (serverless may have lost state)
      const latestRun = await api.latestRun();
      if (latestRun.run) {
        setRun(latestRun.run);
        // Find the matching decision in the refreshed data
        const freshDecision = latestRun.run.decisions.find((d: Decision) => d.subscription_id === decision.subscription_id && d.execution_status === "AWAITING_APPROVAL");
        if (freshDecision) decision = freshDecision;
      }
      const next = await api.approvalSession(decision.decision_id);
      setApproval({
        decision,
        attemptId: next.execution_attempt_id,
        label: next.label || "Approve WARDEN action",
        mode: next.mode || "simulation",
        providerSessionId: next.payload?.provider_session_id ?? null,
        providerSessionToken: next.payload?.provider_session_token ?? null,
        iframeUrl: next.payload?.iframe_url ?? null,
        publishableKey: session?.prava_publishable_key ?? null,
      });
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Approval could not start."); }
    finally { setBusy(null); }
  }

  async function confirmApproval() {
    if (!approval?.providerSessionId) return;
    setBusy(approval.decision.decision_id);
    try {
      if (approval.mode === "simulation") {
        setRun(await api.executeAttempt(approval.decision.decision_id, approval.attemptId));
        setApproval(null);
        return;
      }
      // Provider mode: poll for payment result
      const sessionId = approval.providerSessionId;
      const finalize = async (attempt = 0): Promise<void> => {
        if (attempt > 60) throw new Error("Prava session timed out.");
        const result = await api.pravaPaymentResult(sessionId);
        const txn = result.transactions?.[0];
        if (result.status === "completed" || txn?.status === "completed" || txn?.line_items?.some((item: any) => item.status === "credentials_generated")) {
          setRun(await api.finalizePrava(sessionId));
          setApproval(null);
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
        return finalize(attempt + 1);
      };
      await finalize();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Execution failed."); }
    finally { setBusy(null); }
  }

  async function decline(decision: Decision) {
    try { setRun(await api.decline(decision.decision_id)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Decline failed."); }
  }

  if (view === "landing") return <Landing onGetStarted={navigateToDashboard} />;

  if (loading) return <main className="loading"><LoaderCircle className="spin" /><p>Loading your subscriptions…</p></main>;

  return <div className="app-shell">
    <header className="command-strip">
      <div className="brand"><span className="brand__mark"><img src="/logo.svg" alt="Warden" width="44" height="44" /></span><div><strong>WARDEN</strong><span>Your subscription guardian</span></div></div>
      <div className="command-strip__meta">
        <span className="environment"><CircleDot size={12} />{session?.environment ?? "simulation"}</span>
        <span className="mono">policy v{policy?.version ?? "—"}</span>
        <a href="https://github.com/Varun-ai07/WARDEN" target="_blank" rel="noopener noreferrer" className="github-link" title="View on GitHub"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg></a>
      </div>
    </header>

    {isOffline && <div className="offline-banner" role="status"><AlertTriangle size={17} /><span>You are offline. Changes will sync when reconnected.</span></div>}
    {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /><span>{error}</span><button className="button button--text" onClick={() => void load()}>Retry</button><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={15} /></button></div>}

    <main>
      <section className="summary-band" aria-label="Portfolio summary">
        <div><span>Total monthly cost</span><strong>{money(currentMonthly)}</strong><small>across {subscriptions.length} subscriptions</small></div>
        <div><span>Your spending limit</span><strong>{cap?.type === "MONTHLY_CAP" ? money(cap.amount_minor) : "—"}</strong><small>{currentMonthly > (cap?.type === "MONTHLY_CAP" ? cap.amount_minor : Infinity) ? "Over budget" : "Within budget"}</small></div>
        <div><span>Monthly savings</span><strong className="success-text">{money(savings.recurring_monthly_saved_minor)}</strong><small>{session?.environment === "simulation" ? "simulation only" : "per month, verified"}</small></div>
        <div><span>Charges avoided</span><strong>{money(savings.one_time_avoided_minor)}</strong><small>{session?.environment === "simulation" ? "simulation only" : "one-time savings"}</small></div>
      </section>

      <section className="workspace-grid">
        <div className="policy-panel plane">
          <div className="section-head"><div><p className="eyebrow">{policyDirty ? "Draft policy" : "Your spending rules"}</p><h2>{policyDirty ? "Review before activation" : "How WARDEN decides"}</h2></div><span className="mono">v{policy?.version}</span></div>
          <textarea aria-label="Policy text" value={policyText} onChange={(event) => setPolicyText(event.target.value)} />
          {policyDirty && <p className="draft-notice">Draft changes are not active. Compile and confirm them before running WARDEN.</p>}
          <div className="rules">{policy?.compiled_rules.rules.map((rule) => <div className="rule" key={rule.rule_id}><Check size={14} /><RuleLabel rule={rule} /><code>{rule.rule_id}</code></div>)}</div>
          <div className="policy-actions">
            <button className="button button--secondary" disabled={busy === "policy" || policyText === policy?.policy_text} onClick={savePolicy}>{busy === "policy" ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={15} />}Compile and activate</button>
            <button className="button button--primary" disabled={busy === "run" || pendingCount > 0 || policyDirty} onClick={startRun}>{busy === "run" ? <LoaderCircle className="spin" size={16} /> : <Play size={15} />}Manage My Subscriptions</button>
          </div>
        </div>

        <div className="portfolio-panel plane">
          <div className="section-head"><div><p className="eyebrow">Your subscriptions</p><h2>All recurring charges</h2></div><span>{subscriptions.length} items</span></div>
          <div className="demo-note">Demo data — A production version would auto-discover subscriptions from your email/bank.</div>
          <div className="table-wrap"><table><thead><tr><th>Merchant</th><th>Plan</th><th>Monthly</th><th>Use</th><th>Health</th><th>Capability</th></tr></thead><tbody>{subscriptions.map((item) => <tr key={item.id}><td data-label="Merchant"><div className="merchant-cell"><MerchantIcon name={item.merchant_name} /><div><strong>{item.merchant_name}</strong><small>{item.id}</small></div></div></td><td data-label="Plan" className="mono">{item.plan_id}</td><td data-label="Monthly" className="mono">{money(item.current_monthly_cost_minor, item.currency)}</td><td data-label="Use">{item.last_used_days_ago === null ? "No data" : `${item.last_used_days_ago}d ago`}</td><td data-label="Health"><span className="health"><i style={{ width: `${item.health_score}%` }} />{item.health_score}</span></td><td data-label="Capability"><span className={`capability capability--${item.capability}`}>{item.capability}</span></td></tr>)}</tbody></table></div>
        </div>
      </section>

      <section className="lower-grid">
        <div className="execution plane">
          <div className="section-head"><div><p className="eyebrow">Recommended actions</p><h2>{run ? `Analysis results` : "Run your policy to see recommendations"}</h2></div>{run && <StatusMark status={run.run_status} />}</div>
          <DecisionRail decisions={run?.decisions ?? []} onApprove={reviewApproval} onDecline={decline} busy={busy} environment={session?.environment} />
        </div>

        <div className="ledger plane">
          <div className="section-head"><div><p className="eyebrow">Activity log</p><h2>What WARDEN has done</h2></div><span className={`connection connection--${connectionState}`} aria-live="polite"><Activity size={14} />{connectionState}</span></div>
          {events.length === 0 ? <div className="empty"><Activity size={18} /><p>Events will appear here with stable IDs and sequence numbers.</p></div> : <div className="ledger-list" aria-live="polite">{[...events].reverse().map((event) => <div className="ledger-event" key={event.event_id}><span className="ledger-event__sequence">{String(event.sequence).padStart(3, "0")}</span><div><strong>{event.event_type.replaceAll("_", " ")}</strong><span>{new Date(event.occurred_at).toLocaleTimeString()}</span></div><code>{shortId(event.event_id)}</code></div>)}</div>}
        </div>
      </section>
    </main>

    {approval && <div className="approval-backdrop">
      <div className="approval-panel" role="dialog" aria-modal="true" aria-labelledby="approval-title" aria-describedby="approval-description">
        <div className="approval-panel__flag">{approval.mode === "simulation" ? "SIMULATION ONLY" : "PROVIDER APPROVAL"}</div>
        <button className="approval-panel__close" aria-label="Close approval review" onClick={() => setApproval(null)}><X size={18} /></button>
        <ShieldCheck size={28} />
        <p className="eyebrow">Scoped approval review</p>
        <h2 id="approval-title">{approval.decision.merchant_name}</h2>
        <p id="approval-description">{approval.mode === "simulation" ? "This local adapter simulates the transition. It does not imitate Prava biometric UI or move money." : "Continue through the provider's scoped approval flow for this exact merchant and amount."}</p>
        <dl><div><dt>Action</dt><dd>{approval.decision.action}{approval.decision.target_plan_id ? ` → ${approval.decision.target_plan_id}` : ""}</dd></div><div><dt>Amount</dt><dd>{money(approval.decision.authorized_amount_minor)}</dd></div><div><dt>Prava session</dt><dd>{approval.providerSessionId ? shortId(approval.providerSessionId) : "simulation"}</dd></div></dl>
        {approval.mode === "provider" && approval.iframeUrl && (
          <div className="approval-instructions">
            <p className="approval-note">Click the button below to open the Prava sandbox checkout in a new tab. Enter the test card to complete the transaction.</p>
            <div className="approval-test-card">
              <strong>Test Card:</strong> 4622 9431 2313 7789<br />
              <strong>CVV:</strong> 757 · <strong>Expiry:</strong> 12/27 · <strong>OTP:</strong> 456789
            </div>
            <a href={approval.iframeUrl} target="_blank" rel="noopener noreferrer" className="button button--primary button--wide" style={{ textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              Open Prava Checkout <ArrowRight size={16} />
            </a>
          </div>
        )}
        {approval.mode === "simulation" && (
          <button ref={approvalButtonRef} disabled={busy === approval.decision.decision_id} className="button button--primary button--wide" onClick={confirmApproval}>{busy === approval.decision.decision_id ? <LoaderCircle className="spin" size={16} /> : approval.label}<ArrowRight size={16} /></button>
        )}
      </div>
    </div>}

    {evidence && <div className="proof-backdrop"><aside className="proof-drawer" role="dialog" aria-modal="true" aria-labelledby="proof-title">
      <div className="section-head"><div><p className="eyebrow">{evidence.provider === "fake" ? "Simulation evidence" : "Verified provider evidence"}</p><h2 id="proof-title">{evidence.evidence_type.replaceAll("_", " ")}</h2></div><button ref={evidenceCloseRef} aria-label="Close evidence" onClick={() => setEvidence(null)}><X size={18} /></button></div>

      {evidence.provider_status === "confirmed" && (
        <div className="transaction-proof">
          <Check size={20} />
          <div>
            <strong>Transaction Verified</strong>
            <span>{evidence.recurrence_stopped ? "Charge prevention confirmed" : "Payment completed successfully"}</span>
          </div>
        </div>
      )}

      <dl>
        <div><dt>Evidence ID</dt><dd>{evidence.evidence_id}</dd></div>
        <div><dt>Execution attempt</dt><dd>{evidence.execution_attempt_id}</dd></div>
        <div><dt>Provider</dt><dd>{evidence.provider === "fake" ? "Fake adapter · simulation" : evidence.provider}</dd></div>
        <div><dt>Provider reference</dt><dd>{evidence.provider_reference}</dd></div>
        <div><dt>Merchant</dt><dd>{evidence.merchant_id}</dd></div>
        <div><dt>Authorized amount</dt><dd>{money(evidence.authorized_amount_minor, evidence.currency)}</dd></div>
        <div><dt>Status</dt><dd><span className={`status status--${evidence.provider_status === "confirmed" ? "success" : "error"}`}>{evidence.provider_status}</span></dd></div>
        <div><dt>Recurring stopped</dt><dd>{evidence.recurrence_stopped ? "Yes" : "No"}</dd></div>
        <div><dt>Occurred</dt><dd>{new Date(evidence.occurred_at).toLocaleString()}</dd></div>
        <div><dt>Verified</dt><dd>{new Date(evidence.verified_at).toLocaleString()}</dd></div>
        <div><dt>Payload hash</dt><dd>{evidence.payload_hash}</dd></div>
      </dl>
    </aside></div>}

    <CommandPalette
      open={commandPaletteOpen}
      onClose={() => setCommandPaletteOpen(false)}
      onRunPolicy={startRun}
      onEditPolicy={focusPolicyTextarea}
      onViewLedger={scrollToLedger}
      runBusy={busy === "run"}
      pendingCount={pendingCount}
    />
  </div>;
}
