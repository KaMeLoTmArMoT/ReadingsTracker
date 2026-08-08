import {
  type SupabaseClient,
  type User,
  createClient,
} from "@supabase/supabase-js";
import type { CategoryDataset, ReadingEntry } from "./types";

const DEFAULT_SUPABASE_URL = "https://gxbpsbqpuaudtlfliezs.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "sb_publishable_HgFswhUnZWkHwtVyXTxt2g_h371PL5z";
const LOCAL_STORAGE_KEY = "readings_tracker_datasets";

export let datasets: CategoryDataset[] = [];
export let supabaseClient: SupabaseClient | null = null;
export let currentUser: User | null = null;

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let renderCallback: ((shouldPersist?: boolean) => void) | null = null;
let authUpdateCallback: (() => void) | null = null;

export function registerCallbacks(
  onRender: (shouldPersist?: boolean) => void,
  onAuthUpdate: () => void,
): void {
  renderCallback = onRender;
  authUpdateCallback = onAuthUpdate;
}

export function initSupabase(): void {
  const url =
    (import.meta.env.VITE_SUPABASE_URL as string) ||
    localStorage.getItem("VITE_SUPABASE_URL") ||
    DEFAULT_SUPABASE_URL;
  const key =
    (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ||
    localStorage.getItem("VITE_SUPABASE_ANON_KEY") ||
    DEFAULT_SUPABASE_ANON_KEY;

  if (url && key) {
    try {
      supabaseClient = createClient(url, key);
      setupAuthListeners();
    } catch (e) {
      console.warn("Supabase init error:", e);
      authUpdateCallback?.();
    }
  } else {
    authUpdateCallback?.();
  }
}

function setupAuthListeners(): void {
  if (!supabaseClient) return;

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    authUpdateCallback?.();

    if (currentUser) {
      await loadFromSupabase();
    } else {
      loadFromLocalStorage();
    }
  });
}

export async function handleGoogleSignIn(): Promise<void> {
  if (!supabaseClient) {
    promptSupabaseConfig();
    return;
  }
  const redirectUrl = window.location.protocol.startsWith("http")
    ? window.location.origin + window.location.pathname
    : "https://kamelotmarmot.github.io/ReadingsTracker/";

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: redirectUrl },
  });
  if (error) alert(`Login error: ${error.message}`);
}

export async function handleSignOut(): Promise<void> {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
}

export function promptSupabaseConfig(): void {
  const url = prompt("Enter your Supabase URL:");
  const key = prompt("Enter your Supabase Anon Key:");
  if (url && key) {
    localStorage.setItem("VITE_SUPABASE_URL", url.trim());
    localStorage.setItem("VITE_SUPABASE_ANON_KEY", key.trim());
    initSupabase();
  }
}

export function persistState(): void {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    const serializable = datasets.map((d) => ({
      name: d.name,
      entries: d.entries,
      collapsed: d.collapsed,
    }));
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(serializable));

    if (supabaseClient && currentUser) {
      syncToSupabase(serializable);
    }
  }, 300);
}

async function syncToSupabase(serializableData: unknown[]): Promise<void> {
  if (!supabaseClient || !currentUser) return;
  try {
    const { error } = await supabaseClient.from("user_readings").upsert(
      {
        user_id: currentUser.id,
        data_key: "readings_data",
        payload: serializableData,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id, data_key" },
    );

    if (error) console.error("Cloud sync error:", error.message);
  } catch (e) {
    console.error("Cloud sync exception:", e);
  }
}

export async function loadFromSupabase(): Promise<void> {
  if (!supabaseClient || !currentUser) return;
  try {
    const { data, error } = await supabaseClient
      .from("user_readings")
      .select("payload")
      .eq("user_id", currentUser.id)
      .eq("data_key", "readings_data")
      .maybeSingle();

    if (error) {
      console.error("Error loading cloud data:", error.message);
      return;
    }

    if (data && Array.isArray(data.payload)) {
      datasets = data.payload.map(
        (d: {
          name: string;
          entries?: ReadingEntry[];
          collapsed?: boolean;
        }) => ({
          name: d.name,
          entries: d.entries || [],
          chart: null,
          barCharts: {},
          collapsed: !!d.collapsed,
        }),
      );
      renderCallback?.(false);
    }
  } catch (e) {
    console.error("Exception loading cloud data:", e);
  }
}

export function loadFromLocalStorage(): void {
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        datasets = parsed.map(
          (d: {
            name: string;
            entries?: ReadingEntry[];
            collapsed?: boolean;
          }) => ({
            name: d.name,
            entries: d.entries || [],
            chart: null,
            barCharts: {},
            collapsed: !!d.collapsed,
          }),
        );
        renderCallback?.(false);
      }
    } catch (e) {
      console.error("Error parsing local state:", e);
    }
  }
}

// Data manipulation CRUD
export function addCategory(
  name: string,
  entries: ReadingEntry[] = [],
): void {
  const cleanName = name.trim();
  if (!cleanName) return;

  datasets.push({
    name: cleanName,
    entries,
    chart: null,
    barCharts: {},
    collapsed: true,
  });
  renderCallback?.();
}

export function deleteCategory(i: number): void {
  const ds = datasets[i];
  if (!ds) return;
  if (confirm(`Delete category "${ds.name}"?`)) {
    ds.chart?.destroy();
    if (ds.barCharts) {
      for (const key of Object.keys(ds.barCharts)) {
        ds.barCharts[key]?.destroy();
      }
    }
    datasets.splice(i, 1);
    renderCallback?.();
  }
}

export function toggleCollapse(i: number): void {
  if (datasets[i]) {
    datasets[i].collapsed = !datasets[i].collapsed;
    renderCallback?.();
  }
}

export function addEntry(i: number): void {
  if (!datasets[i]) return;
  const today = new Date().toISOString().slice(0, 10);
  datasets[i].entries.push({ date: today, value: 0 });
  renderCallback?.();
}

export function updateEntry(
  i: number,
  j: number,
  field: "date" | "value",
  value: string,
): void {
  if (!datasets[i] || !datasets[i].entries[j]) return;
  if (field === "value") {
    datasets[i].entries[j].value = Number(value);
  } else {
    datasets[i].entries[j].date = value;
  }
  renderCallback?.();
}

export function deleteEntry(i: number, j: number): void {
  if (!datasets[i]) return;
  datasets[i].entries.splice(j, 1);
  renderCallback?.();
}

export function moveEntry(i: number, j: number, dir: -1 | 1): void {
  if (!datasets[i]) return;
  const arr = datasets[i].entries;
  if (dir === -1 && j > 0) [arr[j - 1], arr[j]] = [arr[j], arr[j - 1]];
  if (dir === 1 && j < arr.length - 1)
    [arr[j + 1], arr[j]] = [arr[j], arr[j + 1]];
  renderCallback?.();
}

export function importCSVEntries(i: number, entries: ReadingEntry[]): void {
  if (!datasets[i]) return;
  datasets[i].entries = entries;
  datasets[i].collapsed = true;
  renderCallback?.();
}
