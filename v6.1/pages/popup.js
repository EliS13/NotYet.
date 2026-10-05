// popup.js — the planner in the toolbar popup.

(async () => {
  const planner = Planner(document.getElementById('app'), { mode: 'popup' });
  await hwRollForward();
  await planner.refresh();
  hwSyncFromCalendar().catch(() => {});        // throttled; the list redraws when it lands

  // After setup, the first popup gets a short tour. Before setup, the popup
  // points at setup instead, so the tour would only get in the way.
  if (NY_CFG.onboarded && !NY_CFG.toured) startTour(POPUP_TOUR, () => nySaveConfig({ toured: true }));
})();
