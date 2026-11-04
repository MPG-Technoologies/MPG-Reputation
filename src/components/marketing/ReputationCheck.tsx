"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Star,
  Users,
  Send,
  Wrench,
  Loader2,
  Lock,
} from "lucide-react";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import { useSeo } from "@/components/marketing/useSeo";
import { track, FunnelEvents } from "@/components/marketing/funnel";
import {
  BUSINESS_CATEGORY_OPTIONS,
  LOCATION_OPTIONS,
  MONTHLY_JOB_OPTIONS,
  REQUEST_PROCESS_OPTIONS,
  FOLLOWUP_OPTIONS,
  TRACKING_OPTIONS,
  SOFTWARE_OPTIONS,
  GAP_OPTIONS,
  type ReputationCheckInput,
  type ReputationReport,
} from "@/components/marketing/reputation-contracts";
import { buildReport } from "@/components/marketing/buildReport";
import { ReportView } from "@/components/marketing/ReputationReport";
import { ConversionNextSteps } from "@/components/marketing/site/ConversionNextSteps";

const STEPS = [
  { id: "business", title: "Your business", icon: Building2 },
  { id: "profile", title: "Current review profile", icon: Star },
  { id: "volume", title: "Completed services", icon: Users },
  { id: "process", title: "Requests & follow-up", icon: Send },
  { id: "workflow", title: "Tools & workflow", icon: Wrench },
] as const;

interface FormState {
  businessName: string;
  website: string;
  businessCategory: string;
  locations: string;
  googleRating: string;
  reviewCount: string;
  ratingUnknown: boolean;
  monthlyJobs: string;
  requestProcess: string;
  followUp: string;
  tracking: string;
  software: string;
  gaps: string[];
}

const INITIAL: FormState = {
  businessName: "",
  website: "",
  businessCategory: "",
  locations: "",
  googleRating: "",
  reviewCount: "",
  ratingUnknown: false,
  monthlyJobs: "",
  requestProcess: "",
  followUp: "",
  tracking: "",
  software: "",
  gaps: [],
};

const inputCls =
  "min-h-[48px] w-full rounded-lg border border-line bg-paper px-4 text-[15px] text-ink placeholder:text-ink-mute";

function RadioCard({
  name,
  value,
  label,
  checked,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border px-4 transition-colors ${
        checked
          ? "border-ember bg-ember-tint"
          : "border-line bg-paper hover:border-ink-mute"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 accent-[#e8490f]"
      />
      <span className="text-[14.5px] font-medium text-ink">{label}</span>
    </label>
  );
}

export default function ReputationCheck() {
  useSeo(
    "Free Reputation Check",
    "A private, browser-only self-assessment of your review-request process. Recommendations are derived from your answers; public review data is not fetched.",
  );
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      track(FunnelEvents.checkStarted);
    }
  }, []);

  const [report, setReport] = useState<ReputationReport | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  function toggleGap(g: string) {
    setForm((f) => ({
      ...f,
      gaps: f.gaps.includes(g)
        ? f.gaps.filter((x) => x !== g)
        : [...f.gaps, g],
    }));
    setError(null);
  }

  function validate(): boolean {
    switch (step) {
      case 0:
        if (!form.businessCategory) {
          setError("Choose the category closest to your business.");
          return false;
        }
        if (!form.locations) {
          setError("Tell us whether you operate one or several locations.");
          return false;
        }
        return true;
      case 1: {
        if (form.ratingUnknown) return true;
        if (form.googleRating !== "") {
          const r = Number(form.googleRating);
          if (Number.isNaN(r) || r < 0 || r > 5) {
            setError("Rating must be between 0 and 5 — or choose “I'd rather not say”.");
            return false;
          }
        }
        if (form.reviewCount !== "") {
          const c = Number(form.reviewCount);
          if (!Number.isInteger(c) || c < 0) {
            setError("Review count must be a whole number, 0 or more.");
            return false;
          }
        }
        return true;
      }
      case 2:
        if (!form.monthlyJobs) {
          setError("Choose the option closest to your monthly volume of completed services.");
          return false;
        }
        return true;
      case 3:
        if (!form.requestProcess) {
          setError("Tell us how review requests currently happen.");
          return false;
        }
        if (!form.followUp) {
          setError("Tell us how consistently requests are followed up.");
          return false;
        }
        if (!form.tracking) {
          setError("Tell us how request activity is tracked today.");
          return false;
        }
        return true;
      case 4:
        if (!form.software) {
          setError("Select the tool closest to your setup.");
          return false;
        }
        return true;
      default:
        return true;
    }
  }

  function next() {
    if (!validate()) return;
    track(FunnelEvents.checkStepCompleted, { step: STEPS[step].id });
    if (step < STEPS.length - 1) {
      setStep((s) => s + 1);
    } else {
      generate();
    }
  }

  function generate() {
    setGenerating(true);
    setError(null);
    const input: ReputationCheckInput = {
      businessName: form.businessName.trim() || "Your business",
      website: form.website.trim() || undefined,
      businessCategory: form.businessCategory,
      locations: form.locations as ReputationCheckInput["locations"],
      googleRating:
        !form.ratingUnknown && form.googleRating !== ""
          ? Number(form.googleRating)
          : null,
      reviewCount:
        !form.ratingUnknown && form.reviewCount !== ""
          ? Number(form.reviewCount)
          : null,
      monthlyJobs: form.monthlyJobs as ReputationCheckInput["monthlyJobs"],
      requestProcess:
        form.requestProcess as ReputationCheckInput["requestProcess"],
      followUp: form.followUp as ReputationCheckInput["followUp"],
      tracking: form.tracking as ReputationCheckInput["tracking"],
      software: form.software,
      gaps: form.gaps,
    };
    setReport(buildReport(input));
    track(FunnelEvents.checkCompleted);
    setGenerating(false);
  }

  const progress = useMemo(
    () => Math.round(((step + 1) / STEPS.length) * 100),
    [step],
  );

  if (report) {
    return (
      <div className="min-h-screen bg-paper">
        <SiteNav />
        <main className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16">
          <p className="mb-7 rounded-lg border border-line bg-cream p-4 text-[13px] text-ink-soft">Your responses and report exist only in this browser tab until you close or refresh it. Nothing was submitted or saved.</p>
          <ReportView report={report} example={false} />
          <ConversionNextSteps origin="check" />
          <button type="button" onClick={() => { setForm(INITIAL); setReport(null); setStep(0); }} className="mt-8 min-h-[44px] rounded-lg bg-ink px-6 py-3 font-semibold text-cream hover:bg-ember">Start a new check</button>
        </main>
        <SiteFooter />
      </div>
    );
  }

  /* ---------- generating state ---------- */
  if (generating) {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <SiteNav />
        <main className="flex flex-1 items-center justify-center px-5">
          <div className="text-center" role="status" aria-live="polite">
            <Loader2
              className="mx-auto h-8 w-8 animate-spin text-ember"
              aria-hidden
            />
            <h1 className="mt-5 font-display text-2xl font-bold text-ink">
              Building your Reputation Opportunity Report
            </h1>
            <p className="mt-2 max-w-md text-[14px] text-ink-mute">
              Reviewing your answers to identify process gaps and suggested next steps…
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteNav />
      <main className="flex-1">
        <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
          {/* header */}
          <div className="max-w-2xl">
            <p className="kicker text-ember">Free Reputation Check</p>
            <h1 className="mt-3 font-display text-[clamp(1.8rem,3.6vw,2.6rem)] font-bold leading-tight text-ink">
              Five minutes. One honest report.
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
              Explore how your business asks for reviews after a completed service. Your report highlights process gaps and suggested next steps derived from your answers, not verified Google review data.
            </p>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[240px_1fr]">
            {/* progress rail */}
            <nav aria-label="Check progress" className="lg:sticky lg:top-24 lg:self-start">
              <ol className="flex gap-2 overflow-x-auto lg:flex-col lg:gap-0">
                {STEPS.map((s, i) => {
                  const state =
                    i < step ? "done" : i === step ? "current" : "todo";
                  return (
                    <li
                      key={s.id}
                      className="flex min-w-[44px] items-center gap-3 lg:py-2.5"
                      aria-current={state === "current" ? "step" : undefined}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border font-mono2 text-[11px] font-semibold ${
                          state === "done"
                            ? "border-ok bg-ok text-white"
                            : state === "current"
                              ? "border-ember bg-ember text-white"
                              : "border-line bg-card text-ink-mute"
                        }`}
                      >
                        {state === "done" ? "✓" : i + 1}
                      </span>
                      <span
                        className={`hidden text-[13.5px] lg:block ${
                          state === "current"
                            ? "font-semibold text-ink"
                            : "text-ink-mute"
                        }`}
                      >
                        {s.title}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div
                className="mt-4 h-1 w-full overflow-hidden rounded-full bg-line lg:mt-2"
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-ember transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-ink-mute">
                <Lock className="h-3 w-3" aria-hidden />
                No data sent or saved. Answers stay in this browser tab only.
              </p>
            </nav>

            {/* step card */}
            <div className="surface-card p-6 sm:p-8">
              {error && (
                <div
                  role="alert"
                  className="mb-6 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-[13.5px] text-bad"
                >
                  {error}
                </div>
              )}

              {step === 0 && (
                <fieldset>
                  <legend className="font-display text-xl font-semibold text-ink">
                    Which business is this for?
                  </legend>
                  <p className="mt-2 text-[13.5px] text-ink-mute">
                    You can name your business, or leave it blank for an anonymous report. This check does not fetch or verify any public review data.
                  </p>
                  <div className="mt-6 space-y-5">
                    <div>
                      <label
                        htmlFor="businessName"
                        className="mb-1.5 block text-[13.5px] font-medium text-ink"
                      >
                        Business name <span className="text-ink-mute">(optional)</span>
                      </label>
                      <input
                        id="businessName"
                        type="text"
                        autoComplete="organization"
                        placeholder="e.g. Ridgeline Heating & Air"
                        value={form.businessName}
                        onChange={(e) => set("businessName", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="businessCategory"
                        className="mb-1.5 block text-[13.5px] font-medium text-ink"
                      >
                        Business category <span className="text-ember">*</span>
                      </label>
                      <select
                        id="businessCategory"
                        value={form.businessCategory}
                        onChange={(e) => set("businessCategory", e.target.value)}
                        className={inputCls}
                      >
                        <option value="">Select…</option>
                        {BUSINESS_CATEGORY_OPTIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <p className="mb-2 block text-[13.5px] font-medium text-ink">
                        How many locations do you operate?{" "}
                        <span className="text-ember">*</span>
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-2" role="radiogroup">
                        {LOCATION_OPTIONS.map((o) => (
                          <RadioCard
                            key={o.value}
                            name="locations"
                            value={o.value}
                            label={o.label}
                            checked={form.locations === o.value}
                            onChange={() => set("locations", o.value)}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label
                        htmlFor="website"
                        className="mb-1.5 block text-[13.5px] font-medium text-ink"
                      >
                        Website <span className="text-ink-mute">(optional)</span>
                      </label>
                      <input
                        id="website"
                        type="url"
                        autoComplete="url"
                        placeholder="https://…"
                        value={form.website}
                        onChange={(e) => set("website", e.target.value)}
                        className={inputCls}
                      />
                    </div>
                  </div>
                </fieldset>
              )}

              {step === 1 && (
                <fieldset>
                  <legend className="font-display text-xl font-semibold text-ink">
                    Your current review profile
                  </legend>
                  <p className="mt-2 text-[13.5px] text-ink-mute">
                    As you know it — figures here are treated as
                    customer-provided estimates, not verified data.
                  </p>
                  <div className="mt-6 grid gap-5 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="googleRating"
                        className="mb-1.5 block text-[13.5px] font-medium text-ink"
                      >
                        Google rating (0–5)
                      </label>
                      <input
                        id="googleRating"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={5}
                        step={0.1}
                        disabled={form.ratingUnknown}
                        placeholder="e.g. 4.6"
                        value={form.googleRating}
                        onChange={(e) => set("googleRating", e.target.value)}
                        className={`${inputCls} disabled:opacity-40`}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="reviewCount"
                        className="mb-1.5 block text-[13.5px] font-medium text-ink"
                      >
                        Approx. review count
                      </label>
                      <input
                        id="reviewCount"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        disabled={form.ratingUnknown}
                        placeholder="e.g. 87"
                        value={form.reviewCount}
                        onChange={(e) => set("reviewCount", e.target.value)}
                        className={`${inputCls} disabled:opacity-40`}
                      />
                    </div>
                  </div>
                  <label className="mt-4 flex min-h-[44px] cursor-pointer items-center gap-3 text-[13.5px] text-ink-soft">
                    <input
                      type="checkbox"
                      checked={form.ratingUnknown}
                      onChange={(e) => set("ratingUnknown", e.target.checked)}
                      className="h-4 w-4 accent-[#e8490f]"
                    />
                    I&apos;d rather not say / I&apos;m not sure
                  </label>
                  <p className="mt-3 rounded-lg bg-cream px-4 py-3 text-[12.5px] leading-relaxed text-ink-mute">
                    Missing figures aren&apos;t penalized — the report will simply
                    mark that part of your baseline as unknown.
                  </p>
                </fieldset>
              )}

              {step === 2 && (
                <fieldset>
                  <legend className="font-display text-xl font-semibold text-ink">
                    How many services do you complete in a typical month?
                  </legend>
                  <p className="mt-2 text-[13.5px] text-ink-mute">
                    Jobs, appointments or projects — a rough range is fine.
                    Completed services are the raw material of review
                    opportunities.
                  </p>
                  <div className="mt-6 grid gap-2.5" role="radiogroup">
                    {MONTHLY_JOB_OPTIONS.map((o) => (
                      <RadioCard
                        key={o.value}
                        name="monthlyJobs"
                        value={o.value}
                        label={o.label}
                        checked={form.monthlyJobs === o.value}
                        onChange={() => set("monthlyJobs", o.value)}
                      />
                    ))}
                  </div>
                </fieldset>
              )}

              {step === 3 && (
                <fieldset>
                  <legend className="font-display text-xl font-semibold text-ink">
                    Requests, follow-up and tracking today
                  </legend>
                  <p className="mt-2 text-[13.5px] text-ink-mute">
                    Be candid — the report is only useful if these answers are
                    honest.
                  </p>

                  <p className="mb-2 mt-6 block text-[13.5px] font-medium text-ink">
                    How do review requests currently happen?{" "}
                    <span className="text-ember">*</span>
                  </p>
                  <div className="grid gap-2.5" role="radiogroup">
                    {REQUEST_PROCESS_OPTIONS.map((o) => (
                      <RadioCard
                        key={o.value}
                        name="requestProcess"
                        value={o.value}
                        label={o.label}
                        checked={form.requestProcess === o.value}
                        onChange={() => set("requestProcess", o.value)}
                      />
                    ))}
                  </div>

                  <p className="mb-2 mt-7 block text-[13.5px] font-medium text-ink">
                    When a request goes unanswered, how consistent is follow-up?{" "}
                    <span className="text-ember">*</span>
                  </p>
                  <div className="grid gap-2.5" role="radiogroup">
                    {FOLLOWUP_OPTIONS.map((o) => (
                      <RadioCard
                        key={o.value}
                        name="followUp"
                        value={o.value}
                        label={o.label}
                        checked={form.followUp === o.value}
                        onChange={() => set("followUp", o.value)}
                      />
                    ))}
                  </div>

                  <p className="mb-2 mt-7 block text-[13.5px] font-medium text-ink">
                    How do you track request activity?{" "}
                    <span className="text-ember">*</span>
                  </p>
                  <div className="grid gap-2.5" role="radiogroup">
                    {TRACKING_OPTIONS.map((o) => (
                      <RadioCard
                        key={o.value}
                        name="tracking"
                        value={o.value}
                        label={o.label}
                        checked={form.tracking === o.value}
                        onChange={() => set("tracking", o.value)}
                      />
                    ))}
                  </div>
                </fieldset>
              )}

              {step === 4 && (
                <fieldset>
                  <legend className="font-display text-xl font-semibold text-ink">
                    Your tools &amp; workflow gaps
                  </legend>
                  <div className="mt-6">
                    <label
                      htmlFor="software"
                      className="mb-1.5 block text-[13.5px] font-medium text-ink"
                    >
                      What do you use to manage customers or jobs?{" "}
                      <span className="text-ember">*</span>
                    </label>
                    <select
                      id="software"
                      value={form.software}
                      onChange={(e) => set("software", e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select…</option>
                      {SOFTWARE_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="mb-2 mt-6 block text-[13.5px] font-medium text-ink">
                    Which of these sound familiar?{" "}
                    <span className="text-ink-mute">(select any)</span>
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {GAP_OPTIONS.map((g) => (
                      <label
                        key={g}
                        className={`flex min-h-[48px] cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors ${
                          form.gaps.includes(g)
                            ? "border-ember bg-ember-tint"
                            : "border-line bg-paper hover:border-ink-mute"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={form.gaps.includes(g)}
                          onChange={() => toggleGap(g)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[#e8490f]"
                        />
                        <span className="text-[13px] leading-snug text-ink-soft">
                          {g}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="mt-6 rounded-lg bg-cream px-4 py-3 text-[12.5px] leading-relaxed text-ink-mute">
                    That&apos;s everything. This check collects no contact details —
                    your report is generated immediately and shown on screen.
                  </p>
                </fieldset>
              )}

              {/* nav buttons */}
              <div className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep((s) => Math.max(0, s - 1));
                  }}
                  disabled={step === 0}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border border-line px-5 py-2.5 text-[14px] font-medium text-ink transition-colors hover:border-ink disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-lg bg-ink px-6 py-2.5 text-[14.5px] font-semibold text-cream transition-colors hover:bg-ember"
                >
                  {step === STEPS.length - 1
                    ? "Generate my report"
                    : "Continue"}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
