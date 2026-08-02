import { ArrowRight, Check, Shield, Zap, Eye, Lock, BarChart3, Clock, CreditCard, TrendingDown, X, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  onGetStarted: (policy?: string) => void;
}

const DEFAULT_POLICY = "Never let total subscriptions exceed $150/month. Cancel or downgrade anything unused 30+ days. Always take annual billing if it saves more than 15%.";

export function Landing({ onGetStarted }: Props) {
  const [visibleSections, setVisibleSections] = useState<Set<string>>(new Set());
  const [navVisible, setNavVisible] = useState(true);
  const [scrolled, setScrolled] = useState(false);
  const [showPolicyInput, setShowPolicyInput] = useState(false);
  const [policyText, setPolicyText] = useState(DEFAULT_POLICY);
  const [isStarting, setIsStarting] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisibleSections((prev) => new Set([...prev, entry.target.id]));
          }
        });
      },
      { threshold: 0.1 }
    );

    document.querySelectorAll("[data-animate]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      setScrolled(currentY > 50);
      if (currentY < 100) {
        setNavVisible(true);
      } else if (currentY < lastScrollY.current) {
        setNavVisible(true);
      } else if (currentY > lastScrollY.current + 10) {
        setNavVisible(false);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isVisible = useCallback((id: string) => visibleSections.has(id), [visibleSections]);

  const handleGetStarted = useCallback(() => {
    setShowPolicyInput(true);
  }, []);

  const handleStartWithPolicy = useCallback(() => {
    setIsStarting(true);
    setTimeout(() => {
      onGetStarted(policyText || DEFAULT_POLICY);
    }, 800);
  }, [onGetStarted, policyText]);

  return (
    <div className="landing">
      {/* Navbar */}
      <nav className={`landing__nav ${scrolled ? "landing__nav--scrolled" : ""} ${navVisible ? "" : "landing__nav--hidden"}`}>
        <div className="landing__nav-inner">
          <div className="landing__nav-brand">
            <img src="/logo.svg" alt="Warden" width="36" height="36" />
            <strong>WARDEN</strong>
          </div>
          <div className="landing__nav-links">
            <a href="#problem">Problem</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#guide">Guide</a>
          </div>
          <button className="button button--primary button--sm" onClick={handleGetStarted}>
            Get Started <ArrowRight size={14} />
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="landing__hero">
        <div className="landing__hero-content">
          <div className="landing__badge">Policy Engine for Recurring Payments</div>
          <h1 className="landing__title">
            Stop paying for<br />
            <span className="landing__title-accent">subscriptions you forgot about.</span>
          </h1>
          <p className="landing__subtitle">
            WARDEN monitors your recurring commitments, enforces your spending rules,
            and executes changes automatically — with your approval at every step.
          </p>
          <div className="landing__cta-group">
            <button className="button button--primary button--lg" onClick={handleGetStarted}>
              Get Started <ArrowRight size={18} />
            </button>
            <a href="#how-it-works" className="button button--secondary button--lg">
              See How It Works
            </a>
          </div>
          <div className="landing__stats">
            <div className="landing__stat">
              <span className="landing__stat-value">$2,400</span>
              <span className="landing__stat-label">Average annual waste</span>
            </div>
            <div className="landing__stat">
              <span className="landing__stat-value">12+</span>
              <span className="landing__stat-label">Subscriptions per household</span>
            </div>
            <div className="landing__stat">
              <span className="landing__stat-value">80%</span>
              <span className="landing__stat-label">Forgot at least one</span>
            </div>
          </div>
        </div>
        <div className="landing__hero-visual">
          <div className="landing__actions-preview">
            <div className="landing__action-card landing__action-card--renew">
              <div className="landing__action-badge">RENEW</div>
              <h4>Keep as-is</h4>
              <p>Subscription is active, within budget, and regularly used. No action needed.</p>
            </div>
            <div className="landing__action-card landing__action-card--switch">
              <div className="landing__action-badge">SWITCH</div>
              <h4>Downgrade or change plan</h4>
              <p>Found a cheaper plan that meets your needs. Save money without losing service.</p>
            </div>
            <div className="landing__action-card landing__action-card--decline">
              <div className="landing__action-badge">DECLINE</div>
              <h4>Cancel or prevent</h4>
              <p>Unused subscription or trial about to convert. Stop the charge before it happens.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="landing__section landing__problem" id="problem" data-animate>
        <div className={`landing__section-content ${isVisible("problem") ? "landing__section-content--visible" : ""}`}>
          <div className="landing__eyebrow">The Problem</div>
          <h2 className="landing__section-title">
            Subscriptions are designed to be<br />
            <span className="landing__title-accent">hard to cancel.</span>
          </h2>
          <div className="landing__problem-grid">
            <div className="landing__problem-card landing__problem-card--1">
              <div className="landing__problem-icon landing__problem-icon--1">
                <TrendingDown size={28} />
              </div>
              <h3>Hidden Charges</h3>
              <p>Free trials convert to paid plans without clear notice. You don't realize until you see the charge on your statement.</p>
            </div>
            <div className="landing__problem-card landing__problem-card--2">
              <div className="landing__problem-icon landing__problem-icon--2">
                <Clock size={28} />
              </div>
              <h3>Forgotten Subscriptions</h3>
              <p>The average household has 12+ active subscriptions. Most people can only name half of them.</p>
            </div>
            <div className="landing__problem-card landing__problem-card--3">
              <div className="landing__problem-icon landing__problem-icon--3">
                <CreditCard size={28} />
              </div>
              <h3>No Visibility</h3>
              <p>Charges appear across different cards, apps, and emails. There's no single view of your commitments.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="landing__section landing__features" id="features" data-animate>
        <div className={`landing__section-content ${isVisible("features") ? "landing__section-content--visible" : ""}`}>
          <div className="landing__eyebrow">How WARDEN Helps</div>
          <h2 className="landing__section-title">
            Your AI-powered<br />
            <span className="landing__title-accent">subscription guardian.</span>
          </h2>
          <div className="landing__features-grid">
            <div className="landing__feature">
              <div className="landing__feature-icon"><Shield size={28} /></div>
              <h3>Policy Engine</h3>
              <p>Write your rules in plain English. "Never spend more than $60/month" or "Cancel anything unused for 30 days."</p>
            </div>
            <div className="landing__feature">
              <div className="landing__feature-icon"><Eye size={28} /></div>
              <h3>Portfolio Tracking</h3>
              <p>See all your subscriptions in one place. Health scores, usage data, and cost breakdowns at a glance.</p>
            </div>
            <div className="landing__feature">
              <div className="landing__feature-icon"><Zap size={28} /></div>
              <h3>Smart Decisions</h3>
              <p>AI analyzes your usage patterns and suggests actions: renew, downgrade, or cancel — with clear reasoning.</p>
            </div>
            <div className="landing__feature">
              <div className="landing__feature-icon"><Lock size={28} /></div>
              <h3>Scoped Approval</h3>
              <p>Every action requires your explicit approval. No surprises. You see exactly what will happen before it does.</p>
            </div>
            <div className="landing__feature">
              <div className="landing__feature-icon"><CreditCard size={28} /></div>
              <h3>Secure Execution</h3>
              <p>Payment credentials are tokenized and never stored. Each transaction is independently verified.</p>
            </div>
            <div className="landing__feature">
              <div className="landing__feature-icon"><BarChart3 size={28} /></div>
              <h3>Evidence Ledger</h3>
              <p>Every action creates an auditable record. Hash-chained events ensure complete transparency.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="landing__section landing__how" id="how-it-works" data-animate>
        <div className={`landing__section-content ${isVisible("how-it-works") ? "landing__section-content--visible" : ""}`}>
          <div className="landing__eyebrow">How It Works</div>
          <h2 className="landing__section-title">
            Three steps to<br />
            <span className="landing__title-accent">financial control.</span>
          </h2>
          <div className="landing__steps">
            <div className="landing__step">
              <div className="landing__step-number">1</div>
              <div className="landing__step-content">
                <h3>Define Your Policy</h3>
                <p>Write rules in natural language. WARDEN compiles them into enforceable constraints.</p>
                <div className="landing__step-visual landing__step-visual--policy">
                  <div className="landing__code-block">
                    <span className="landing__code-comment"># My spending rules</span>
                    <br />
                    Max monthly spend: $60
                    <br />
                    Cancel unused after: 30 days
                    <br />
                    Take annual if savings: 15%+
                  </div>
                </div>
              </div>
            </div>
            <div className="landing__step">
              <div className="landing__step-number">2</div>
              <div className="landing__step-content">
                <h3>Review Recommendations</h3>
                <p>WARDEN analyzes your subscriptions and presents clear actions with reasoning.</p>
                <div className="landing__step-visual landing__step-visual--decisions">
                  <div className="landing__decision-preview">
                    <div className="landing__decision-action landing__decision-action--renew">RENEW</div>
                    <div>
                      <strong>Keep as-is</strong>
                      <span>Active, within budget, regularly used</span>
                    </div>
                  </div>
                  <div className="landing__decision-preview">
                    <div className="landing__decision-action landing__decision-action--switch">SWITCH</div>
                    <div>
                      <strong>Downgrade or change plan</strong>
                      <span>Found a cheaper alternative that works</span>
                    </div>
                  </div>
                  <div className="landing__decision-preview">
                    <div className="landing__decision-action landing__decision-action--decline">DECLINE</div>
                    <div>
                      <strong>Cancel or prevent</strong>
                      <span>Unused service or trial about to convert</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="landing__step">
              <div className="landing__step-number">3</div>
              <div className="landing__step-content">
                <h3>Approve & Execute</h3>
                <p>Review each action, approve with one click, and WARDEN handles the rest.</p>
                <div className="landing__step-visual landing__step-visual--approval">
                  <div className="landing__approval-preview">
                    <Shield size={20} />
                    <div>
                      <strong>Scoped Approval</strong>
                      <span>Authorize exactly what happens — no hidden changes</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Guide */}
      <section className="landing__section landing__guide" id="guide" data-animate>
        <div className={`landing__section-content ${isVisible("guide") ? "landing__section-content--visible" : ""}`}>
          <div className="landing__eyebrow">Quick Start Guide</div>
          <h2 className="landing__section-title">
            Get started in<br />
            <span className="landing__title-accent">two minutes.</span>
          </h2>
          <div className="landing__guide-grid">
            <div className="landing__guide-card">
              <div className="landing__guide-step">1</div>
              <h4>Connect Your Subscriptions</h4>
              <p>WARDEN scans your portfolio and identifies all recurring commitments. Each subscription shows its current plan, cost, and usage health.</p>
            </div>
            <div className="landing__guide-card">
              <div className="landing__guide-step">2</div>
              <h4>Set Your Policy</h4>
              <p>Edit the policy text to match your preferences. WARDEN compiles it into rules you can review before activating.</p>
            </div>
            <div className="landing__guide-card">
              <div className="landing__guide-step">3</div>
              <h4>Run the Policy</h4>
              <p>Click "Run Policy" to analyze your subscriptions. WARDEN presents recommendations for each commitment.</p>
            </div>
            <div className="landing__guide-card">
              <div className="landing__guide-step">4</div>
              <h4>Review & Approve</h4>
              <p>For each recommendation, review the reasoning and authorize the action. You're always in control.</p>
            </div>
            <div className="landing__guide-card">
              <div className="landing__guide-step">5</div>
              <h4>Track Results</h4>
              <p>Watch your savings grow. The evidence ledger shows every action taken and its verification status.</p>
            </div>
            <div className="landing__guide-card">
              <div className="landing__guide-step">6</div>
              <h4>Stay Protected</h4>
              <p>Run WARDEN monthly to catch new subscriptions and enforce your ongoing spending rules.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="landing__cta-section">
        <div className="landing__cta-content">
          <img src="/logo-white.svg" alt="Warden" width="96" height="96" className="landing__cta-logo" />
          <h2>Ready to take control?</h2>
          <p>Stop losing money to forgotten subscriptions. Start enforcing your spending rules today.</p>
          <button className="button button--primary button--lg" onClick={handleGetStarted}>
            Launch WARDEN <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing__footer">
        <div className="landing__footer-content">
          <div className="landing__footer-brand">
            <img src="/logo.svg" alt="Warden" width="32" height="32" />
            <div>
              <strong>WARDEN</strong>
              <span>Policy engine for recurring commitments</span>
            </div>
          </div>
          <div className="landing__footer-links">
            <a href="#problem">Problem</a>
            <a href="#features">Features</a>
            <a href="#how-it-works">How It Works</a>
            <a href="#guide">Guide</a>
          </div>
        </div>
      </footer>

      {/* Policy Input Modal */}
      {showPolicyInput && (
        <div className="policy-modal-backdrop" onClick={() => !isStarting && setShowPolicyInput(false)}>
          <div className="policy-modal" onClick={(e) => e.stopPropagation()}>
            <button className="policy-modal__close" onClick={() => !isStarting && setShowPolicyInput(false)} disabled={isStarting}>
              <X size={18} />
            </button>
            <img src="/logo.svg" alt="Warden" width="48" height="48" className="policy-modal__logo" />
            <h2>Set Your Spending Rules</h2>
            <p>Tell WARDEN how to manage your subscriptions. Write your rules in plain English.</p>
            <textarea
              className="policy-modal__textarea"
              value={policyText}
              onChange={(e) => setPolicyText(e.target.value)}
              placeholder="e.g., Never spend more than $60/month. Cancel anything unused for 30 days."
              rows={5}
              disabled={isStarting}
            />
            <div className="policy-modal__examples">
              <span>Examples:</span>
              <button onClick={() => setPolicyText("Never let total subscriptions exceed $100/month. Cancel or downgrade anything unused 30+ days. Always take annual billing if it saves more than 15%.")} disabled={isStarting}>
                Budget + Inactivity
              </button>
              <button onClick={() => setPolicyText("Cancel any free trial that converts to paid. Downgrade any subscription not used in 14 days. Maximum $100/month total.")} disabled={isStarting}>
                Trial Prevention
              </button>
              <button onClick={() => setPolicyText("Always choose annual plans if they save more than 20%. Cancel anything unused for 60 days. Keep total under $50/month.")} disabled={isStarting}>
                Annual Optimization
              </button>
            </div>

            <div className="policy-modal__subscriptions">
              <span className="policy-modal__subscriptions-label">Demo subscriptions:</span>
              <div className="policy-modal__sub"><strong>Adobe Creative Cloud</strong> $55/mo · Unused 35 days</div>
              <div className="policy-modal__sub"><strong>Equinox Gym</strong> $25/mo · Basic plan available</div>
              <div className="policy-modal__sub"><strong>Spotify</strong> $17/mo · Actively used</div>
              <div className="policy-modal__sub"><strong>Figma</strong> $15/mo · Annual plan saves 18%</div>
              <div className="policy-modal__sub"><strong>Notion</strong> $10/mo · Actively used</div>
              <div className="policy-modal__sub"><strong>Coursera Plus</strong> $8/mo · Trial converting soon</div>
            </div>

            <button className="button button--primary button--wide" onClick={handleStartWithPolicy} disabled={isStarting || !policyText.trim()}>
              {isStarting ? <><LoaderCircle className="spin" size={16} /> Setting up your policy...</> : <>Start WARDEN <ArrowRight size={16} /></>}
            </button>

            <p className="policy-modal__note">
              <strong>Note:</strong> This demo uses sample subscription data to showcase the policy engine and Prava integration.
              A production version would connect to your email/bank to discover real subscriptions automatically.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
