import {
  type SupabaseClient,
  type User,
  createClient,
} from "@supabase/supabase-js";
import type { CategoryDataset, ReadingEntry, TrackerPage } from "./types";

const DEFAULT_SUPABASE_URL = "https://gxbpsbqpuaudtlfliezs.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY =
  "sb_publishable_HgFswhUnZWkHwtVyXTxt2g_h371PL5z";

const LOCAL_STORAGE_GUEST_PAGES_KEY = "readings_tracker_guest_pages";
const LOCAL_STORAGE_LEGACY_GUEST_KEY = "readings_tracker_guest_datasets";
const LOCAL_STORAGE_LEGACY_KEY = "readings_tracker_datasets";

export let supabaseClient: SupabaseClient | null = null;
export let currentUser: User | null = null;
export type SyncState = "offline" | "synced" | "syncing" | "error";
export let syncState: SyncState = "offline";
export let migrationNotice: string | null = null;

// Multi-page state
export let pages: TrackerPage[] = [];
export let activePageId = "default";
export let isViewingViaToken = false;

// Active datasets proxy for chart rendering
export function getActiveDatasets(): CategoryDataset[] {
  const p = pages.find((page) => page.id === activePageId);
  return p ? p.datasets : [];
}

export function getActivePage(): TrackerPage | null {
  return pages.find((page) => page.id === activePageId) || null;
}

export function canEditActivePage(): boolean {
  if (isViewingViaToken) return false;
  const p = getActivePage();
  if (!p) return true;
  return p.isOwner || p.role === "edit";
}

export function clearMigrationNotice(): void {
  migrationNotice = null;
}

let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let renderCallback:
  | ((shouldPersist?: boolean, targetCategoryIndex?: number) => void)
  | null = null;
let authUpdateCallback: ((notice?: string) => void) | null = null;

export function registerCallbacks(
  onRender: (shouldPersist?: boolean, targetCategoryIndex?: number) => void,
  onAuthUpdate: (notice?: string) => void,
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

    // Check if we are viewing via token in URL: ?share=<uuid>
    const urlParams = new URLSearchParams(window.location.search);
    const shareToken = urlParams.get("share");

    if (shareToken) {
      await loadPageFromShareToken(shareToken);
      return;
    }

    if (currentUser) {
      await loadFromSupabase();
    } else {
      syncState = "offline";
      authUpdateCallback?.();
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
  currentUser = null;
  syncState = "offline";
  isViewingViaToken = false;
  loadFromLocalStorage();
  authUpdateCallback?.();
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

export function clearCharts(dsList?: CategoryDataset[]): void {
  const list = dsList || getActiveDatasets();
  for (const ds of list) {
    ds.chart?.destroy();
    if (ds.barCharts) {
      for (const key of Object.keys(ds.barCharts)) {
        ds.barCharts[key]?.destroy();
      }
    }
  }
}

function normalizeDatasets(raw: unknown): CategoryDataset[] {
  if (!Array.isArray(raw)) return [];
  return (
    raw as { name: string; entries?: ReadingEntry[]; collapsed?: boolean }[]
  ).map((d) => ({
    name: d.name,
    entries: d.entries || [],
    chart: null,
    barCharts: {},
    collapsed: !!d.collapsed,
  }));
}

export function persistState(): void {
  if (isViewingViaToken) return;
  if (!canEditActivePage()) return;

  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    const page = getActivePage();
    if (!page) return;

    const serializable = page.datasets.map((d) => ({
      name: d.name,
      entries: d.entries,
      collapsed: d.collapsed,
    }));

    if (currentUser && supabaseClient) {
      syncToSupabase(page, serializable);
    } else {
      persistLocalPages();
    }
  }, 300);
}

function persistLocalPages(): void {
  const serializedPages = pages.map((p) => ({
    id: p.id,
    dataKey: p.dataKey,
    title: p.title,
    shareToken: p.shareToken,
    sharedUsers: p.sharedUsers,
    datasets: p.datasets.map((d) => ({
      name: d.name,
      entries: d.entries,
      collapsed: d.collapsed,
    })),
  }));
  localStorage.setItem(
    LOCAL_STORAGE_GUEST_PAGES_KEY,
    JSON.stringify(serializedPages),
  );
}

async function syncToSupabase(
  page: TrackerPage,
  serializableData: unknown[],
): Promise<void> {
  if (!supabaseClient || !currentUser) return;
  try {
    syncState = "syncing";
    authUpdateCallback?.();

    if (page.isOwner) {
      const { error } = await supabaseClient.from("user_readings").upsert(
        {
          id: page.id.length === 36 ? page.id : undefined, // pass UUID if exists
          user_id: currentUser.id,
          data_key: page.dataKey,
          title: page.title,
          share_token: page.shareToken,
          shared_users: page.sharedUsers,
          payload: serializableData,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id, data_key" },
      );
      if (error) throw error;
    } else {
      // Invited editor updating payload
      const { error } = await supabaseClient
        .from("user_readings")
        .update({
          payload: serializableData,
          updated_at: new Date().toISOString(),
        })
        .eq("id", page.id);
      if (error) throw error;
    }

    syncState = "synced";
    authUpdateCallback?.();
  } catch (e: unknown) {
    console.error("Cloud sync error:", (e as Error)?.message || e);
    syncState = "error";
    authUpdateCallback?.();
  }
}

export async function loadPageFromShareToken(token: string): Promise<void> {
  if (!supabaseClient) initSupabase();
  if (!supabaseClient) return;

  try {
    syncState = "syncing";
    authUpdateCallback?.();

    const { data, error } = await supabaseClient.rpc(
      "get_shared_page_by_token",
      {
        token_input: token,
      },
    );

    if (error || !data || data.length === 0) {
      alert(
        "Не вдалося завантажити сторінку за посиланням. Можливо, посилання недійсне або видалене.",
      );
      isViewingViaToken = false;
      loadFromLocalStorage();
      return;
    }

    const row = data[0];
    clearCharts();

    isViewingViaToken = true;
    pages = [
      {
        id: row.id,
        dataKey: "shared_token_page",
        title: row.title || "Спільна сторінка",
        datasets: normalizeDatasets(row.payload),
        isOwner: false,
        role: "view",
        shareToken: token,
        sharedUsers: [],
        updatedAt: row.updated_at,
      },
    ];
    activePageId = row.id;

    syncState = "synced";
    renderCallback?.(false);
    authUpdateCallback?.();
  } catch (e) {
    console.error("Exception loading page via token:", e);
    syncState = "error";
    authUpdateCallback?.();
  }
}

interface DBUserReadingRow {
  id: string;
  user_id: string;
  data_key: string;
  title: string;
  payload: unknown;
  share_token: string | null;
  shared_users: { email: string; role: "view" | "edit" }[];
  updated_at: string;
}

export async function loadFromSupabase(): Promise<void> {
  if (!supabaseClient || !currentUser) {
    syncState = "offline";
    authUpdateCallback?.();
    return;
  }

  try {
    syncState = "syncing";
    authUpdateCallback?.();

    const { data, error } = await supabaseClient
      .from("user_readings")
      .select(
        "id, user_id, data_key, title, payload, share_token, shared_users, updated_at",
      )
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("Error loading cloud data:", error.message);
      syncState = "error";
      authUpdateCallback?.();
      return;
    }

    clearCharts();

    const rows = (data || []) as DBUserReadingRow[];
    const userEmailLower = (currentUser.email || "").toLowerCase();

    if (rows.length > 0) {
      pages = rows.map((r) => {
        const isOwner = r.user_id === currentUser?.id;
        let role: "owner" | "view" | "edit" = isOwner ? "owner" : "view";
        if (!isOwner && Array.isArray(r.shared_users)) {
          const match = r.shared_users.find(
            (u) => u.email.toLowerCase() === userEmailLower,
          );
          if (match) role = match.role;
        }

        return {
          id: r.id,
          dataKey: r.data_key || "readings_data",
          title:
            r.title ||
            (r.data_key === "readings_data" ? "Основна" : r.data_key),
          datasets: normalizeDatasets(r.payload),
          isOwner,
          role,
          shareToken: r.share_token,
          sharedUsers: r.shared_users || [],
          updatedAt: r.updated_at,
        };
      });

      if (!pages.some((p) => p.id === activePageId)) {
        activePageId = pages[0].id;
      }
    } else {
      const guestSaved =
        localStorage.getItem(LOCAL_STORAGE_GUEST_PAGES_KEY) ||
        localStorage.getItem(LOCAL_STORAGE_LEGACY_GUEST_KEY) ||
        localStorage.getItem(LOCAL_STORAGE_LEGACY_KEY);

      let initialDatasets: CategoryDataset[] = [];
      if (guestSaved) {
        try {
          const parsed = JSON.parse(guestSaved);
          if (
            Array.isArray(parsed) &&
            parsed.length > 0 &&
            "datasets" in parsed[0]
          ) {
            initialDatasets = normalizeDatasets(parsed[0].datasets);
          } else {
            initialDatasets = normalizeDatasets(parsed);
          }
        } catch {
          // ignore
        }
      }

      const newId = crypto.randomUUID();
      pages = [
        {
          id: newId,
          dataKey: "readings_data",
          title: "Основна",
          datasets: initialDatasets,
          isOwner: true,
          role: "owner",
          shareToken: null,
          sharedUsers: [],
        },
      ];
      activePageId = newId;

      if (initialDatasets.length > 0) {
        migrationNotice = "Локальні покази успішно перенесено у ваш акаунт!";
        persistState();
      }
    }

    renderCallback?.(false);
    syncState = "synced";
    authUpdateCallback?.(migrationNotice || undefined);
  } catch (e) {
    console.error("Exception loading cloud data:", e);
    syncState = "error";
    authUpdateCallback?.();
  }
}

export async function manualReSync(): Promise<void> {
  if (currentUser) {
    await loadFromSupabase();
  }
}

export function loadFromLocalStorage(): void {
  clearCharts();
  const rawPages = localStorage.getItem(LOCAL_STORAGE_GUEST_PAGES_KEY);
  if (rawPages) {
    try {
      const parsed = JSON.parse(rawPages);
      if (Array.isArray(parsed) && parsed.length > 0) {
        pages = parsed.map((p) => ({
          id: p.id || crypto.randomUUID(),
          dataKey: p.dataKey || "guest_data",
          title: p.title || "Основна",
          datasets: normalizeDatasets(p.datasets),
          isOwner: true,
          role: "owner",
          shareToken: null,
          sharedUsers: [],
        }));
        if (!pages.some((p) => p.id === activePageId)) {
          activePageId = pages[0].id;
        }
        renderCallback?.(false);
        return;
      }
    } catch (e) {
      console.error("Error parsing local pages:", e);
    }
  }

  const legacy =
    localStorage.getItem(LOCAL_STORAGE_LEGACY_GUEST_KEY) ||
    localStorage.getItem(LOCAL_STORAGE_LEGACY_KEY);
  let ds: CategoryDataset[] = [];
  if (legacy) {
    try {
      ds = normalizeDatasets(JSON.parse(legacy));
    } catch {
      ds = [];
    }
  }

  const defId = "local-main";
  pages = [
    {
      id: defId,
      dataKey: "readings_data",
      title: "Основна",
      datasets: ds,
      isOwner: true,
      role: "owner",
      shareToken: null,
      sharedUsers: [],
    },
  ];
  activePageId = defId;
  renderCallback?.(false);
}

// Multi-page CRUD
export async function createNewPage(title: string): Promise<void> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;

  const newId = crypto.randomUUID();
  const dataKey = `page_${Date.now()}`;
  const newPage: TrackerPage = {
    id: newId,
    dataKey,
    title: cleanTitle,
    datasets: [],
    isOwner: true,
    role: "owner",
    shareToken: null,
    sharedUsers: [],
  };

  pages.push(newPage);
  activePageId = newId;

  if (currentUser && supabaseClient) {
    await syncToSupabase(newPage, []);
  } else {
    persistLocalPages();
  }

  renderCallback?.(false);
}

export function selectPage(pageId: string): void {
  if (pageId === activePageId) return;
  const p = pages.find((x) => x.id === pageId);
  if (!p) return;

  clearCharts();
  activePageId = pageId;
  renderCallback?.(false);
}

export async function renameActivePage(newTitle: string): Promise<void> {
  const page = getActivePage();
  if (!page || !page.isOwner) return;

  const clean = newTitle.trim();
  if (!clean || clean === page.title) return;

  page.title = clean;
  if (currentUser && supabaseClient) {
    await supabaseClient
      .from("user_readings")
      .update({ title: clean })
      .eq("id", page.id);
  } else {
    persistLocalPages();
  }
  renderCallback?.(false);
}

export async function deleteActivePage(): Promise<void> {
  const page = getActivePage();
  if (!page || !page.isOwner) return;

  if (pages.length <= 1) {
    alert("Неможливо видалити єдину сторінку.");
    return;
  }

  if (!confirm(`Видалити сторінку "${page.title}" разом з усіма її графіками?`))
    return;

  clearCharts();
  const pageIndex = pages.findIndex((p) => p.id === page.id);
  pages.splice(pageIndex, 1);
  activePageId = pages[0].id;

  if (currentUser && supabaseClient) {
    await supabaseClient.from("user_readings").delete().eq("id", page.id);
  } else {
    persistLocalPages();
  }

  renderCallback?.(false);
}

export async function updatePageSharing(
  pageId: string,
  shareToken: string | null,
  sharedUsers: { email: string; role: "view" | "edit" }[],
): Promise<void> {
  const page = pages.find((p) => p.id === pageId);
  if (!page || !page.isOwner) return;

  page.shareToken = shareToken;
  page.sharedUsers = sharedUsers;

  if (currentUser && supabaseClient) {
    await supabaseClient
      .from("user_readings")
      .update({
        share_token: shareToken,
        shared_users: sharedUsers,
      })
      .eq("id", page.id);
  } else {
    persistLocalPages();
  }
}

// Data manipulation CRUD for active page
export function addCategory(name: string, entries: ReadingEntry[] = []): void {
  if (!canEditActivePage()) return;
  const cleanName = name.trim();
  if (!cleanName) return;

  const activeDs = getActiveDatasets();
  activeDs.push({
    name: cleanName,
    entries,
    chart: null,
    barCharts: {},
    collapsed: true,
  });
  renderCallback?.();
}

export function deleteCategory(i: number): void {
  if (!canEditActivePage()) return;
  const activeDs = getActiveDatasets();
  const ds = activeDs[i];
  if (!ds) return;
  if (confirm(`Видалити категорію "${ds.name}"?`)) {
    ds.chart?.destroy();
    if (ds.barCharts) {
      for (const key of Object.keys(ds.barCharts)) {
        ds.barCharts[key]?.destroy();
      }
    }
    activeDs.splice(i, 1);
    renderCallback?.();
  }
}

export function toggleCollapse(i: number): void {
  const activeDs = getActiveDatasets();
  if (activeDs[i]) {
    activeDs[i].collapsed = !activeDs[i].collapsed;
    renderCallback?.(true, i);
  }
}

export function sortCategoryEntries(i: number): void {
  if (!canEditActivePage()) return;
  const activeDs = getActiveDatasets();
  if (!activeDs[i] || !activeDs[i].entries.length) return;
  activeDs[i].entries.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return da - db;
  });
  renderCallback?.(true, i);
}

export function addEntry(i: number): void {
  if (!canEditActivePage()) return;
  const activeDs = getActiveDatasets();
  if (!activeDs[i]) return;
  const today = new Date().toISOString().slice(0, 10);
  activeDs[i].entries.push({ date: today, value: 0 });
  renderCallback?.(true, i);
}

export function updateEntry(
  i: number,
  j: number,
  field: "date" | "value" | "supplier",
  value: string,
): void {
  if (!canEditActivePage()) return;
  const activeDs = getActiveDatasets();
  if (!activeDs[i] || !activeDs[i].entries[j]) return;
  if (field === "value") {
    activeDs[i].entries[j].value = Number(value);
  } else if (field === "supplier") {
    const trimmed = value.trim();
    if (trimmed) {
      activeDs[i].entries[j].supplier = trimmed;
    } else {
      activeDs[i].entries[j].supplier = undefined;
    }
  } else {
    activeDs[i].entries[j].date = value;
  }
  renderCallback?.(true, i);
}

export function deleteEntry(i: number, j: number): void {
  if (!canEditActivePage()) return;
  const activeDs = getActiveDatasets();
  if (!activeDs[i]) return;
  activeDs[i].entries.splice(j, 1);
  renderCallback?.(true, i);
}

export function moveEntry(i: number, j: number, dir: -1 | 1): void {
  if (!canEditActivePage()) return;
  const activeDs = getActiveDatasets();
  if (!activeDs[i]) return;
  const arr = activeDs[i].entries;
  if (dir === -1 && j > 0) [arr[j - 1], arr[j]] = [arr[j], arr[j - 1]];
  if (dir === 1 && j < arr.length - 1)
    [arr[j + 1], arr[j]] = [arr[j], arr[j + 1]];
  renderCallback?.(true, i);
}

export function importCSVEntries(i: number, entries: ReadingEntry[]): void {
  if (!canEditActivePage()) return;
  const activeDs = getActiveDatasets();
  if (!activeDs[i]) return;
  activeDs[i].entries = entries;
  activeDs[i].collapsed = true;
  renderCallback?.(true, i);
}
