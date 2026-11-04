/** MR-10 event taxonomy; strictly no network or persistence in prelaunch previews. */
export const FunnelEvents = {
  pageView: "page.view",
  demoStepViewed: "demo.step_viewed",
  featuresViewed: "features.viewed",
  trustViewed: "trust.viewed",
  faqOpened: "faq.item_opened",
  checkStarted: "check.started",
  checkStepCompleted: "check.step_completed",
  checkCompleted: "check.completed",
  reportViewed: "report.viewed",
  reportExampleViewed: "report.example_viewed",
  trialDialogOpened: "trial.dialog_opened",
  trialInterestRegistered: "trial.interest_registered",
} as const;
export function track(_event: string, _props?: Record<string, unknown>): void {
  void _event;
  void _props;
  // No analytics, logging, transmission, cookies, or storage in this preview.
}
