(() => {
  "use strict";

  const bootstrap = globalThis.__CLAUDE_REMOTE_BOOTSTRAP__;
  if (!bootstrap || bootstrap.transport !== "official-ion-dist-remote-ipc") return;

  const fallbackMenu = [
    {
      label: "File",
      submenu: [
        { label: "New Conversation", accelerator: "Ctrl+N" },
        { label: "Open File…" },
        { type: "separator" },
        { label: "Settings...", accelerator: "Ctrl+," },
        { type: "separator" },
        { label: "Close Window", accelerator: "Ctrl+W", role: "close" },
        { label: "Exit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "Ctrl+Z", role: "undo" },
        { label: "Redo", accelerator: "Ctrl+Shift+Z", role: "redo" },
        { type: "separator" },
        { label: "Cut", accelerator: "Ctrl+X", role: "cut" },
        { label: "Copy", accelerator: "Ctrl+C", role: "copy" },
        { label: "Paste", accelerator: "Ctrl+V", role: "paste" },
        { label: "Select All", accelerator: "Ctrl+A", role: "selectAll" },
        { type: "separator" },
        { label: "Find", accelerator: "Ctrl+F" },
        { label: "Find Next", accelerator: "Ctrl+G" },
        { label: "Find Previous", accelerator: "Ctrl+Shift+G" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "F5" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "Ctrl+0" },
        { label: "Zoom In", accelerator: "Ctrl++" },
        { label: "Zoom Out", accelerator: "Ctrl+-" },
        { type: "separator" },
        { label: "Copy URL" },
      ],
    },
    {
      label: "Developer",
      submenu: [
        { label: "Open MCP Log File..." },
        { label: "Reload MCP Configuration" },
        { type: "separator" },
        { label: "Configure Third-Party Inference..." },
        { type: "separator" },
        { label: "Open App Config File..." },
        { label: "Open Developer Config File..." },
        { type: "separator" },
        { label: "Show Dev Tools", accelerator: "Alt+Ctrl+I" },
        { label: "Show All Dev Tools" },
        { type: "separator" },
        { label: "Enable Main Process Debugger" },
        { label: "Record Performance Trace" },
        { label: "Write Main Process Heap Snapshot" },
        { label: "Record Memory Trace (auto-stop)" },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Open Documentation" },
        { type: "separator" },
        { label: "Get Support" },
        { label: "About..." },
      ],
    },
  ];

  const supportedRoles = new Set([
    "copy",
    "cut",
    "paste",
    "redo",
    "selectall",
    "undo",
  ]);
  const supportedLabels = new Set([
    "actual size",
    "configure third-party inference",
    "copy url",
    "get support",
    "new conversation",
    "open documentation",
    "reload",
    "reload mcp configuration",
    "settings",
    "zoom in",
    "zoom out",
  ]);
  const privilegedLabels = new Set([
    "enable main process debugger",
    "open app config file",
    "open developer config file",
    "open mcp log file",
    "record memory trace (auto-stop)",
    "record performance trace",
    "show all dev tools",
    "show dev tools",
    "stop performance trace",
    "write main process heap snapshot",
  ]);
  const nativeActionByLabel = new Map([
    ["enable main process debugger", "toggle-main-process-debugger"],
    ["record memory trace (auto-stop)", "record-memory-trace"],
    ["record performance trace", "toggle-performance-trace"],
    ["show all dev tools", "show-all-dev-tools"],
    ["show dev tools", "show-dev-tools"],
    ["stop performance trace", "toggle-performance-trace"],
    ["write main process heap snapshot", "write-main-process-heap-snapshot"],
  ]);

  let layer = null;
  let anchorButton = null;
  let priorFocus = null;
  let openMenus = [];
  let modelPromise = null;
  let zoomLevel = 1;

  function cleanLabel(value) {
    return String(value || "")
      .replace(/&(?=\S)/g, "")
      .replace(/\.{3}|…/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
  }

  function displayLabel(value) {
    return String(value || "").replace(/&(?=\S)/g, "");
  }

  function isSeparator(item) {
    return item?.type === "separator" || (!item?.label && !item?.submenu?.length);
  }

  function canActivate(item) {
    if (item?.enabled === false) return false;
    if (Array.isArray(item?.submenu) && item.submenu.length) return true;
    const role = cleanLabel(item?.role);
    const label = cleanLabel(item?.label);
    return supportedRoles.has(role)
      || supportedLabels.has(label)
      || (bootstrap.developerActionsEnabled === true && privilegedLabels.has(label));
  }

  async function loadMenuModel() {
    if (!modelPromise) {
      modelPromise = fetch("/api/remote/main-menu", {
        cache: "no-store",
        credentials: "same-origin",
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          return Array.isArray(payload?.value) && payload.value.length
            ? payload.value
            : fallbackMenu;
        })
        .catch(() => fallbackMenu);
    }
    return modelPromise;
  }

  function closeMenu({ restoreFocus = true } = {}) {
    if (!layer) return;
    layer.remove();
    layer = null;
    openMenus = [];
    if (anchorButton) anchorButton.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", handleOutsidePointer, true);
    globalThis.removeEventListener("resize", closeMenu);
    globalThis.removeEventListener("blur", closeMenu);
    if (restoreFocus && anchorButton instanceof HTMLElement) anchorButton.focus();
    anchorButton = null;
  }

  function handleOutsidePointer(event) {
    if (!layer || layer.contains(event.target) || anchorButton?.contains(event.target)) return;
    closeMenu({ restoreFocus: false });
  }

  function focusSibling(button, direction) {
    const menu = button.closest('[role="menu"]');
    if (!menu) return;
    const buttons = [...menu.querySelectorAll(':scope > [role="menuitem"]')]
      .filter((candidate) => !candidate.disabled);
    const index = buttons.indexOf(button);
    if (index < 0 || !buttons.length) return;
    buttons[(index + direction + buttons.length) % buttons.length].focus();
  }

  function handleMenuKeydown(event) {
    const button = event.target.closest?.('[role="menuitem"]');
    if (!(button instanceof HTMLButtonElement)) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusSibling(button, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusSibling(button, -1);
    } else if (event.key === "ArrowRight" && button.__remoteMenuItem?.submenu?.length) {
      event.preventDefault();
      openSubmenu(button, button.__remoteMenuItem, button.__remoteMenuDepth);
      openMenus[button.__remoteMenuDepth + 1]
        ?.querySelector('[role="menuitem"]:not(:disabled)')
        ?.focus();
    } else if (event.key === "ArrowLeft" && button.__remoteMenuDepth > 0) {
      event.preventDefault();
      const parentButton = openMenus[button.__remoteMenuDepth]?.__remoteParentButton;
      closeFromDepth(button.__remoteMenuDepth);
      parentButton?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      button.click();
    }
  }

  function closeFromDepth(depth) {
    while (openMenus.length > depth) openMenus.pop()?.remove();
  }

  function clampMenu(menu, desiredLeft, desiredTop) {
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const left = Math.max(margin, Math.min(desiredLeft, innerWidth - rect.width - margin));
    const top = Math.max(margin, Math.min(desiredTop, innerHeight - rect.height - margin));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function buildMenu(items, depth, parentButton = null) {
    const menu = document.createElement("div");
    menu.className = `claude-remote-native-menu depth-${depth}`;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", depth === 0 ? "Claude Desktop menu" : "Submenu");
    menu.__remoteParentButton = parentButton;
    menu.addEventListener("keydown", handleMenuKeydown);

    for (const item of items.slice(0, 80)) {
      if (isSeparator(item)) {
        const separator = document.createElement("div");
        separator.className = "claude-remote-native-menu__separator";
        separator.setAttribute("role", "separator");
        menu.append(separator);
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "claude-remote-native-menu__item";
      button.setAttribute("role", "menuitem");
      button.__remoteMenuItem = item;
      button.__remoteMenuDepth = depth;
      button.disabled = !canActivate(item);
      if (button.disabled) button.title = "Available only in the local Desktop window";

      const label = document.createElement("span");
      label.className = "claude-remote-native-menu__label";
      label.textContent = displayLabel(item.label);
      button.append(label);

      const trailing = document.createElement("span");
      trailing.className = "claude-remote-native-menu__trailing";
      if (item.submenu?.length) {
        trailing.textContent = "›";
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
      } else if (item.accelerator) {
        trailing.textContent = String(item.accelerator).replace(/CommandOrControl/gi, "Ctrl");
      }
      button.append(trailing);

      if (item.submenu?.length) {
        button.addEventListener("pointerenter", () => openSubmenu(button, item, depth));
        button.addEventListener("click", () => openSubmenu(button, item, depth));
      } else {
        button.addEventListener("click", () => activateItem(item));
      }
      menu.append(button);
    }
    return menu;
  }

  function openSubmenu(button, item, depth) {
    if (!layer || !item.submenu?.length) return;
    closeFromDepth(depth + 1);
    for (const candidate of openMenus[depth]?.querySelectorAll('[aria-expanded="true"]') || []) {
      candidate.setAttribute("aria-expanded", "false");
    }
    button.setAttribute("aria-expanded", "true");
    const submenu = buildMenu(item.submenu, depth + 1, button);
    layer.append(submenu);
    openMenus[depth + 1] = submenu;
    const buttonRect = button.getBoundingClientRect();
    const mobile = innerWidth < 680;
    submenu.classList.toggle("is-mobile", mobile);
    clampMenu(
      submenu,
      mobile ? 12 : buttonRect.right + 4,
      mobile ? Math.max(12, anchorButton?.getBoundingClientRect().bottom + 8) : buttonRect.top - 7,
    );
  }

  function restoreEditorFocus() {
    if (priorFocus instanceof HTMLElement && priorFocus.isConnected) priorFocus.focus();
  }

  function insertClipboardText(text) {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      const start = active.selectionStart ?? active.value.length;
      const end = active.selectionEnd ?? start;
      active.setRangeText(text, start, end, "end");
      active.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      return;
    }
    if (active instanceof HTMLElement && active.isContentEditable) {
      document.execCommand("insertText", false, text);
    }
  }

  async function activateEditRole(role) {
    restoreEditorFocus();
    if (role === "paste") {
      const text = await navigator.clipboard.readText();
      insertClipboardText(text);
      return;
    }
    document.execCommand(role === "selectall" ? "selectAll" : role);
  }

  function openOfficialSettings() {
    const userMenu = document.querySelector('[data-testid="user-menu-button"]');
    if (!(userMenu instanceof HTMLElement)) {
      globalThis.location.assign("/settings/desktop");
      return;
    }
    userMenu.click();
    let attempts = 0;
    const findSettings = () => {
      const settings = document.querySelector('[data-testid="user-menu-settings"]');
      if (settings instanceof HTMLElement) {
        settings.click();
      } else if (attempts++ < 20) {
        setTimeout(findSettings, 25);
      } else {
        globalThis.location.assign("/settings/desktop");
      }
    };
    findSettings();
  }

  function startNewConversation() {
    const path = globalThis.location.pathname;
    if (/^\/(task|cowork|local_sessions)(\/|$)/.test(path)) {
      globalThis.location.assign("/task/new");
    } else if (/^\/code(\/|$)/.test(path)) {
      globalThis.location.assign("/code");
    } else {
      globalThis.location.assign("/new");
    }
  }

  function applyZoom(next) {
    zoomLevel = Math.max(0.6, Math.min(1.8, next));
    document.documentElement.style.zoom = String(zoomLevel);
  }

  async function activateItem(item) {
    const label = cleanLabel(item.label);
    const role = cleanLabel(item.role);
    closeMenu({ restoreFocus: false });
    try {
      if (supportedRoles.has(role)) {
        await activateEditRole(role);
      } else if (label === "configure third-party inference") {
        globalThis.location.assign("/setup-desktop-3p");
      } else if (label === "settings") {
        openOfficialSettings();
      } else if (label === "new conversation") {
        startNewConversation();
      } else if (label === "reload") {
        globalThis.location.reload();
      } else if (label === "reload mcp configuration") {
        await invokeNativeAction("reload-mcp-configuration");
      } else if (label === "open mcp log file") {
        globalThis.location.assign("/remote-developer.html?kind=mcp-log");
      } else if (label === "open app config file") {
        globalThis.location.assign("/remote-developer.html?kind=app-config");
      } else if (label === "open developer config file") {
        globalThis.location.assign("/remote-developer.html?kind=developer-config");
      } else if (nativeActionByLabel.has(label)) {
        const action = nativeActionByLabel.get(label);
        const result = await invokeNativeAction(action);
        if (action === "toggle-performance-trace" && result?.phase === "started") {
          globalThis.alert("Performance tracing started. Select the same menu item again to stop and save it.");
        } else if (action === "record-memory-trace") {
          globalThis.location.assign("/remote-developer.html?view=artifacts&watch=1");
        } else if (action === "toggle-performance-trace" || action === "write-main-process-heap-snapshot") {
          globalThis.location.assign("/remote-developer.html?view=artifacts&watch=1");
        } else if (/dev-tools|debugger/.test(nativeActionByLabel.get(label))) {
          globalThis.alert(
            `${result?.invokedLabel || displayLabel(item.label)} was triggered in the Desktop container.`,
          );
        }
      } else if (label === "actual size") {
        applyZoom(1);
      } else if (label === "zoom in") {
        applyZoom(zoomLevel + 0.1);
      } else if (label === "zoom out") {
        applyZoom(zoomLevel - 0.1);
      } else if (label === "copy url") {
        await navigator.clipboard.writeText(globalThis.location.href);
      } else if (label === "open documentation" || label === "get support") {
        globalThis.open("https://support.claude.com/", "_blank", "noopener,noreferrer");
      }
    } catch {
      restoreEditorFocus();
    }
  }

  async function invokeNativeAction(action) {
    const response = await fetch("/api/remote/main-menu-action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.error || `Developer action returned HTTP ${response.status}`);
    }
    modelPromise = null;
    return payload.value;
  }

  async function openMenu() {
    if (layer) {
      closeMenu();
      return;
    }
    anchorButton = document.querySelector('[data-testid="topbar-windows-menu"]');
    if (!(anchorButton instanceof HTMLElement)) return;
    priorFocus = document.activeElement;
    const items = await loadMenuModel();

    layer = document.createElement("div");
    layer.className = "claude-remote-native-menu-layer";
    const rootMenu = buildMenu(items, 0);
    layer.append(rootMenu);
    document.body.append(layer);
    openMenus = [rootMenu];
    anchorButton.setAttribute("aria-expanded", "true");
    const anchorRect = anchorButton.getBoundingClientRect();
    clampMenu(rootMenu, anchorRect.left, anchorRect.bottom + 4);

    document.addEventListener("pointerdown", handleOutsidePointer, true);
    globalThis.addEventListener("resize", closeMenu, { once: true });
    globalThis.addEventListener("blur", closeMenu, { once: true });
  }

  const controller = Object.freeze({ close: closeMenu, open: openMenu });
  Object.defineProperty(globalThis, "__CLAUDE_REMOTE_MAIN_MENU__", {
    configurable: false,
    enumerable: false,
    value: controller,
    writable: false,
  });
})();
