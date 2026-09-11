import "./styles.css";

import { initSupabase, loadFromLocalStorage, registerCallbacks } from "./state";
import { renderAuthUI, renderDatasets, setupDOMEvents } from "./ui";

document.addEventListener("DOMContentLoaded", () => {
  // Register state update callbacks
  registerCallbacks(
    (shouldPersist?: boolean, targetCategoryIndex?: number) =>
      renderDatasets(shouldPersist, targetCategoryIndex),
    (notice?: string) => renderAuthUI(notice),
  );

  // Bind top level DOM listeners (add category)
  setupDOMEvents();

  // Load initial local data & initialize Supabase session
  loadFromLocalStorage();
  initSupabase();
});
