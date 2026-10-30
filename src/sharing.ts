import {
  MAX_PAGES_PER_USER,
  MAX_SHARED_USERS_PER_PAGE,
  activePageId,
  createNewPage,
  currentUser,
  deleteActivePage,
  escapeHtml,
  getActivePage,
  isViewingViaToken,
  pages,
  renameActivePage,
  selectPage,
  updatePageSharing,
} from "./state";
import type { ShareRole } from "./types";

export function renderPageNavigation(): void {
  let navContainer = document.getElementById("pagesNavContainer");
  if (!navContainer) {
    navContainer = document.createElement("div");
    navContainer.id = "pagesNavContainer";
    navContainer.className = "pages-nav-container";

    const appHeader = document.querySelector(".app-header");
    if (appHeader) {
      appHeader.after(navContainer);
    } else {
      document.querySelector(".container")?.prepend(navContainer);
    }
  }

  const activePage = getActivePage();

  if (isViewingViaToken) {
    navContainer.innerHTML = `
      <div class="shared-token-banner">
        <span class="shared-banner-icon">🔗</span>
        <div class="shared-banner-text">
          <strong>Перегляд спільної сторінки:</strong> ${escapeHtml(activePage?.title || "Без назви")} (Тільки читання)
        </div>
      </div>
    `;
    return;
  }

  const myPages = pages.filter((p) => p.isOwner);
  const sharedWithMe = pages.filter((p) => !p.isOwner);
  const isPageLimitReached = myPages.length >= MAX_PAGES_PER_USER;

  let tabsHTML = '<div class="pages-tabs-wrapper">';

  // My pages tabs
  for (const page of myPages) {
    const isActive = page.id === activePageId;
    tabsHTML += `
      <button class="page-tab ${isActive ? "active" : ""}" data-page-id="${escapeHtml(page.id)}">
        <span class="page-tab-title">${escapeHtml(page.title)}</span>
        ${page.sharedUsers.length > 0 ? `<span class="page-shared-indicator" title="Розшарено для ${page.sharedUsers.length} користувачів">👥</span>` : ""}
        ${page.shareToken ? `<span class="page-link-indicator" title="Доступно за секретним посиланням">🔗</span>` : ""}
      </button>
    `;
  }

  // Shared with me tabs
  if (sharedWithMe.length > 0) {
    for (const page of sharedWithMe) {
      const isActive = page.id === activePageId;
      const roleBadge = page.role === "edit" ? "✏️ Редактор" : "👁️ Читач";
      tabsHTML += `
        <button class="page-tab shared-tab ${isActive ? "active" : ""}" data-page-id="${escapeHtml(page.id)}" title="Спільна сторінка (${roleBadge})">
          <span class="shared-page-tag">🤝</span>
          <span class="page-tab-title">${escapeHtml(page.title)}</span>
          <span class="page-role-pill">${escapeHtml(page.role)}</span>
        </button>
      `;
    }
  }

  tabsHTML += `
    <button class="page-tab-add ${isPageLimitReached ? "disabled" : ""}" id="btnAddNewPage" ${isPageLimitReached ? "disabled" : ""} title="${isPageLimitReached ? `Досягнуто ліміт (${MAX_PAGES_PER_USER} сторінок)` : "Створити нову сторінку"}">+ Додати сторінку (${myPages.length}/${MAX_PAGES_PER_USER})</button>
  </div>`;

  let actionsHTML = "";
  if (activePage) {
    actionsHTML = `
      <div class="active-page-actions">
        ${
          activePage.isOwner
            ? `
          <button class="btn-page-action btn-share-page" id="btnSharePage" title="Налаштування доступу">
            👥 Поділитись
          </button>
          <button class="btn-page-action btn-rename-page" id="btnRenamePage" title="Перейменувати сторінку">
            ✏️
          </button>
          ${
            pages.length > 1
              ? `
            <button class="btn-page-action btn-delete-page" id="btnDeletePage" title="Видалити сторінку">
              🗑️
            </button>
          `
              : ""
          }
        `
            : `
          <span class="shared-role-notice">
            ${activePage.role === "edit" ? "✏️ Ви можете редагувати покази" : "👁️ Режим перегляду (Read-only)"}
          </span>
        `
        }
      </div>
    `;
  }

  navContainer.innerHTML = `
    <div class="pages-bar-inner">
      ${tabsHTML}
      ${actionsHTML}
    </div>
  `;

  // Bind tab click events
  for (const btn of navContainer.querySelectorAll<HTMLButtonElement>(
    ".page-tab",
  )) {
    btn.addEventListener("click", () => {
      const pid = btn.dataset.pageId;
      if (pid) selectPage(pid);
    });
  }

  // Bind Add Page
  const addBtn = navContainer.querySelector("#btnAddNewPage");
  addBtn?.addEventListener("click", () => {
    const title = prompt(
      "Введіть назву нової сторінки (наприклад: 'Дача', 'Батьки'):",
    );
    if (title?.trim()) {
      createNewPage(title.trim());
    }
  });

  // Bind Rename Page
  const renameBtn = navContainer.querySelector("#btnRenamePage");
  renameBtn?.addEventListener("click", () => {
    if (!activePage) return;
    const newTitle = prompt("Нова назва сторінки:", activePage.title);
    if (newTitle?.trim()) {
      renameActivePage(newTitle.trim());
    }
  });

  // Bind Delete Page
  const deleteBtn = navContainer.querySelector("#btnDeletePage");
  deleteBtn?.addEventListener("click", () => {
    deleteActivePage();
  });

  // Bind Share Page
  const shareBtn = navContainer.querySelector("#btnSharePage");
  shareBtn?.addEventListener("click", () => {
    openSharingModal();
  });
}

export function openSharingModal(): void {
  const activePage = getActivePage();
  if (!activePage || !activePage.isOwner) return;

  let modalOverlay = document.getElementById("shareModalOverlay");
  if (!modalOverlay) {
    modalOverlay = document.createElement("div");
    modalOverlay.id = "shareModalOverlay";
    modalOverlay.className = "tracker-modal-overlay";
    document.body.appendChild(modalOverlay);
  }

  const renderModalContent = () => {
    if (!modalOverlay) return;

    const hasLink = !!activePage.shareToken;
    const shareUrl = hasLink
      ? `${window.location.origin}${window.location.pathname}?share=${activePage.shareToken}`
      : "";
    const isSharedUsersLimitReached =
      activePage.sharedUsers.length >= MAX_SHARED_USERS_PER_PAGE;

    modalOverlay.innerHTML = `
      <div class="tracker-modal-content">
        <div class="tracker-modal-header">
          <h3>Налаштування доступу: "${escapeHtml(activePage.title)}"</h3>
          <button class="modal-close-btn" id="modalCloseBtn">&times;</button>
        </div>

        <div class="tracker-modal-body">
          ${
            !currentUser
              ? `<div class="modal-warning-banner">⚠️ Для збереження доступу в хмарі необхідно увійти через Google. У гостьовому режимі шерінг діє лише локально.</div>`
              : ""
          }

          <!-- 1. Secret Link Sharing -->
          <div class="sharing-section">
            <div class="sharing-section-title">
              <span class="icon">🔗</span>
              <div>
                <strong>Доступ за секретним посиланням</strong>
                <p class="section-desc">Будь-хто з посиланням зможе переглядати графіки без входу (тільки перегляд).</p>
              </div>
            </div>

            <div class="sharing-link-box">
              <label class="toggle-switch">
                <input type="checkbox" id="toggleShareLink" ${hasLink ? "checked" : ""}>
                <span class="slider round"></span>
              </label>
              <span class="toggle-label">${hasLink ? "Посилання активне" : "Посилання вимкнене"}</span>
            </div>

            ${
              hasLink
                ? `
              <div class="link-copy-row">
                <input type="text" readonly class="input-share-link" value="${escapeHtml(shareUrl)}" id="shareLinkInput" />
                <button class="btn-modal-action" id="btnCopyShareLink">Копіювати</button>
                <button class="btn-modal-secondary" id="btnResetShareLink" title="Створити нове посилання (старе перестане працювати)">Оновити</button>
              </div>
            `
                : ""
            }
          </div>

          <!-- 2. Email Access List -->
          <div class="sharing-section">
            <div class="sharing-section-title">
              <span class="icon">👥</span>
              <div>
                <strong>Доступ за Google Email</strong>
                <p class="section-desc">Додайте користувачів із правами перегляду або редагування (макс. ${MAX_SHARED_USERS_PER_PAGE}).</p>
              </div>
            </div>

            <div class="add-user-row">
              <input type="email" placeholder="example@gmail.com" id="newShareEmail" class="input-modal-text" ${isSharedUsersLimitReached ? "disabled" : ""} />
              <select id="newShareRole" class="select-modal" ${isSharedUsersLimitReached ? "disabled" : ""}>
                <option value="view">👁️ Перегляд (View)</option>
                <option value="edit">✏️ Редагування (Edit)</option>
              </select>
              <button class="btn-modal-action" id="btnAddShareUser" ${isSharedUsersLimitReached ? "disabled" : ""}>
                ${isSharedUsersLimitReached ? "Ліміт" : "Додати"}
              </button>
            </div>

            <div class="shared-users-list" id="sharedUsersList">
              ${
                activePage.sharedUsers.length === 0
                  ? `<div class="empty-list-note">Ще немає доданих користувачів</div>`
                  : activePage.sharedUsers
                      .map(
                        (user, idx) => `
                    <div class="shared-user-item">
                      <span class="user-email-text">${escapeHtml(user.email)}</span>
                      <div class="user-role-actions">
                        <select class="select-modal-sm user-role-select" data-index="${idx}">
                          <option value="view" ${user.role === "view" ? "selected" : ""}>👁️ Перегляд</option>
                          <option value="edit" ${user.role === "edit" ? "selected" : ""}>✏️ Редагування</option>
                        </select>
                        <button class="btn-remove-user" data-index="${idx}" title="Видалити доступ">&times;</button>
                      </div>
                    </div>
                  `,
                      )
                      .join("")
              }
            </div>
          </div>
        </div>

        <div class="tracker-modal-footer">
          <button class="btn-modal-primary" id="modalSaveAndCloseBtn">Готово</button>
        </div>
      </div>
    `;

    // Bind Close
    modalOverlay
      .querySelector("#modalCloseBtn")
      ?.addEventListener("click", () => {
        modalOverlay.style.display = "none";
      });
    modalOverlay
      .querySelector("#modalSaveAndCloseBtn")
      ?.addEventListener("click", () => {
        modalOverlay.style.display = "none";
        renderPageNavigation();
      });

    // Toggle Secret Link
    const toggle = modalOverlay.querySelector(
      "#toggleShareLink",
    ) as HTMLInputElement | null;
    toggle?.addEventListener("change", async () => {
      const token = toggle.checked ? crypto.randomUUID() : null;
      await updatePageSharing(activePage.id, token, activePage.sharedUsers);
      renderModalContent();
    });

    // Reset Secret Link
    modalOverlay
      .querySelector("#btnResetShareLink")
      ?.addEventListener("click", async () => {
        if (
          confirm(
            "Створити нове секретне посилання? Попереднє одразу перестане відкриватися.",
          )
        ) {
          await updatePageSharing(
            activePage.id,
            crypto.randomUUID(),
            activePage.sharedUsers,
          );
          renderModalContent();
        }
      });

    // Copy Link
    modalOverlay
      .querySelector("#btnCopyShareLink")
      ?.addEventListener("click", () => {
        const input = modalOverlay.querySelector(
          "#shareLinkInput",
        ) as HTMLInputElement | null;
        if (input) {
          input.select();
          navigator.clipboard.writeText(input.value);
          alert("Посилання скопійовано до буфера обміну!");
        }
      });

    // Add Shared User
    modalOverlay
      .querySelector("#btnAddShareUser")
      ?.addEventListener("click", async () => {
        const emailInput = modalOverlay.querySelector(
          "#newShareEmail",
        ) as HTMLInputElement | null;
        const roleSelect = modalOverlay.querySelector(
          "#newShareRole",
        ) as HTMLSelectElement | null;
        const email = emailInput?.value.trim().toLowerCase();
        const role = (roleSelect?.value as ShareRole) || "view";

        if (!email || !email.includes("@")) {
          alert("Введіть коректну адресу електронної пошти.");
          return;
        }

        if (email === currentUser?.email?.toLowerCase()) {
          alert("Ви є власником цієї сторінки.");
          return;
        }

        const existingIndex = activePage.sharedUsers.findIndex(
          (u) => u.email.toLowerCase() === email,
        );
        if (
          activePage.sharedUsers.length >= MAX_SHARED_USERS_PER_PAGE &&
          existingIndex === -1
        ) {
          alert(`Досягнуто ліміт (${MAX_SHARED_USERS_PER_PAGE} користувачів).`);
          return;
        }

        if (existingIndex !== -1) {
          activePage.sharedUsers[existingIndex].role = role;
        } else {
          activePage.sharedUsers.push({ email, role });
        }

        await updatePageSharing(
          activePage.id,
          activePage.shareToken,
          activePage.sharedUsers,
        );
        renderModalContent();
      });

    // Change user role
    for (const sel of modalOverlay.querySelectorAll<HTMLSelectElement>(
      ".user-role-select",
    )) {
      sel.addEventListener("change", async () => {
        const idx = Number(sel.dataset.index);
        const newRole = sel.value as ShareRole;
        if (activePage.sharedUsers[idx]) {
          activePage.sharedUsers[idx].role = newRole;
          await updatePageSharing(
            activePage.id,
            activePage.shareToken,
            activePage.sharedUsers,
          );
        }
      });
    }

    // Remove user
    for (const btn of modalOverlay.querySelectorAll<HTMLButtonElement>(
      ".btn-remove-user",
    )) {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.index);
        activePage.sharedUsers.splice(idx, 1);
        await updatePageSharing(
          activePage.id,
          activePage.shareToken,
          activePage.sharedUsers,
        );
        renderModalContent();
      });
    }
  };

  renderModalContent();
  modalOverlay.style.display = "flex";
}
