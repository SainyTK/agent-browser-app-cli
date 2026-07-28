export const detectAccountEmailScript = String.raw`
/* aba:account-email */
(() => {
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const candidates = Array.from(
    document.querySelectorAll("[aria-label], [data-email], [title]")
  );
  for (const element of candidates) {
    const values = [
      element.getAttribute("aria-label"),
      element.getAttribute("data-email"),
      element.getAttribute("title"),
      element.textContent
    ];
    for (const value of values) {
      const match = value?.match(emailPattern);
      if (match) return match[0];
    }
  }
  return null;
})()
`;

export const listNotebooksScript = String.raw`
/* aba:notebook-list */
(async () => {
  const normalizeUrl = (value) => {
    if (!value) return null;
    try {
      const url = new URL(value, location.origin);
      if (
        url.hostname !== "notebooklm.google.com" &&
        url.hostname !== "notebook.google.com"
      ) return null;
      const match = url.pathname.match(/^\/notebook\/([^/?#]+)/);
      return match
        ? { id: match[1], url: "https://notebooklm.google.com/notebook/" + match[1] }
        : null;
    } catch {
      return null;
    }
  };
  const found = new Map();
  const add = (idAndUrl, title, description) => {
    if (!idAndUrl || found.has(idAndUrl.id)) return;
    found.set(idAndUrl.id, {
      id: idAndUrl.id,
      title: (title || "Untitled notebook").trim(),
      description: (description || "").trim(),
      url: idAndUrl.url
    });
  };

  for (const anchor of document.querySelectorAll('a[href*="/notebook/"]')) {
    const container = anchor.closest("project-button, [role=listitem], article") || anchor;
    add(
      normalizeUrl(anchor.getAttribute("href")),
      container.querySelector(".project-button-title, [data-testid*=title]")?.textContent ||
        anchor.getAttribute("aria-label") ||
        anchor.textContent,
      container.querySelector(".project-button-description, [data-testid*=description]")?.textContent
    );
  }

  for (const card of document.querySelectorAll("project-button")) {
    const html = card.outerHTML;
    const pathMatch = html.match(/\/notebook\/([a-zA-Z0-9_-]+)/);
    const uuidMatch = html.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const id = pathMatch?.[1] || uuidMatch?.[0];
    add(
      id ? { id, url: "https://notebooklm.google.com/notebook/" + id } : null,
      card.querySelector(".project-button-title")?.textContent,
      card.querySelector(".project-button-description")?.textContent
    );
  }

  const tableRows = Array.from(
    document.querySelectorAll('tr[role="row"]')
  ).filter((row) => row.querySelector('[role="cell"]'));
  if (tableRows.length > 0) {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    let capturedPath = null;
    history.pushState = function(_state, _title, url) {
      capturedPath = String(url);
      throw new Error("agent-browser-app navigation capture");
    };
    history.replaceState = function() {
      throw new Error("agent-browser-app navigation rollback");
    };
    try {
      for (const row of tableRows) {
        capturedPath = null;
        const listener = row.__zone_symbol__clickfalse?.[0]?.callback;
        if (typeof listener === "function") {
          listener(new MouseEvent("click", {
            bubbles: false,
            cancelable: true
          }));
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const cells = Array.from(row.querySelectorAll('[role="cell"]'));
        const titleElement = row.querySelector(".project-table-title");
        add(
          normalizeUrl(capturedPath),
          titleElement?.getAttribute("title") || titleElement?.textContent || cells[0]?.textContent,
          cells.slice(1, 5).map((cell) => cell.textContent?.trim()).filter(Boolean).join(" | ")
        );
      }
    } finally {
      history.pushState = originalPushState;
      history.replaceState = originalReplaceState;
    }
  }

  return {
    loginRequired: location.hostname === "accounts.google.com",
    ready: Boolean(
      document.querySelector(
        ".my-projects-container, .create-new-action-button, project-button, " +
        'button[aria-label="Create new notebook"], tr[role="row"] [role="cell"]'
      )
    ),
    notebooks: Array.from(found.values())
  };
})()
`;

export const markOnboardingButtonScript = String.raw`
/* aba:onboarding */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const target = Array.from(
    document.querySelectorAll("button, [role=button]")
  ).find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
    return visible(element) && /^let['\u2019]s go$/i.test(label);
  });
  if (!target) return false;
  target.setAttribute("data-agent-browser-app-target", "onboarding");
  return true;
})()
`;

export const markCreateButtonScript = String.raw`
/* aba:create-button */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const candidates = Array.from(
    document.querySelectorAll(".create-new-action-button, button, [role=button]")
  );
  const target = candidates.find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent
    ].filter(Boolean).join(" ");
    return visible(element) && /create\s+(new\s+)?(notebook)?|new\s+notebook/i.test(label);
  });
  if (!target) return false;
  target.setAttribute("data-agent-browser-app-target", "create-notebook");
  return true;
})()
`;

export function markNotebookMenuButtonScript(notebookId: string): string {
  return String.raw`
/* aba:notebook-menu */
(async () => {
  const notebookId = ${JSON.stringify(notebookId)};
  const notebookPath = "/notebook/" + notebookId;
  const menuSelector =
    'button[aria-label="Project Actions Menu"], button.project-button-more';
  for (const element of document.querySelectorAll(
    '[data-agent-browser-app-target="notebook-menu"]'
  )) {
    element.removeAttribute("data-agent-browser-app-target");
  }

  for (const anchor of document.querySelectorAll('a[href*="/notebook/"]')) {
    try {
      const url = new URL(anchor.getAttribute("href"), location.origin);
      if (url.pathname !== notebookPath) continue;
      const container =
        anchor.closest("project-button, [role=listitem], article, tr[role=row]") ||
        anchor;
      const button = container.querySelector(menuSelector);
      if (!button || button.hasAttribute("disabled")) return false;
      button.scrollIntoView({ block: "center", inline: "nearest" });
      button.setAttribute("data-agent-browser-app-target", "notebook-menu");
      return true;
    } catch {
      // Continue to application-specific containers.
    }
  }

  for (const card of document.querySelectorAll("project-button")) {
    if (!card.outerHTML.includes(notebookId)) continue;
    const button = card.querySelector(menuSelector);
    if (!button || button.hasAttribute("disabled")) return false;
    button.scrollIntoView({ block: "center", inline: "nearest" });
    button.setAttribute("data-agent-browser-app-target", "notebook-menu");
    return true;
  }

  const rows = Array.from(
    document.querySelectorAll('tr[role="row"]')
  ).filter((row) => row.querySelector('[role="cell"]'));
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  let capturedPath = null;
  history.pushState = function(_state, _title, url) {
    capturedPath = String(url);
    throw new Error("agent-browser-app navigation capture");
  };
  history.replaceState = function() {
    throw new Error("agent-browser-app navigation rollback");
  };
  try {
    for (const row of rows) {
      capturedPath = null;
      const listener = row.__zone_symbol__clickfalse?.[0]?.callback;
      if (typeof listener !== "function") continue;
      listener(new MouseEvent("click", {
        bubbles: false,
        cancelable: true
      }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      let path = null;
      try {
        path = new URL(capturedPath, location.origin).pathname;
      } catch {
        // The row did not expose a notebook route.
      }
      if (path !== notebookPath) continue;
      const button = row.querySelector(menuSelector);
      if (!button || button.hasAttribute("disabled")) return false;
      button.scrollIntoView({ block: "center", inline: "nearest" });
      button.setAttribute("data-agent-browser-app-target", "notebook-menu");
      return true;
    }
  } finally {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  }
  return false;
})()
`;
}

export const markRemoveNotebookMenuItemScript = String.raw`
/* aba:notebook-remove-menu-item */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const target = Array.from(
    document.querySelectorAll('[role="menuitem"], button')
  ).find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
    return visible(element) &&
      (
        element.matches(".delete-button") ||
        /^(delete|remove)(\s+(delete|remove))?$/i.test(label)
      );
  });
  if (!target) return false;
  target.setAttribute(
    "data-agent-browser-app-target",
    "remove-notebook"
  );
  return true;
})()
`;

export const markConfirmNotebookRemovalScript = String.raw`
/* aba:notebook-remove-confirm */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"], mat-dialog-container')
  ).filter((dialog) =>
    /delete notebook everywhere|permanently deleted from all locations/i.test(
      dialog.textContent || ""
    )
  );
  const target = dialogs.flatMap((dialog) =>
    Array.from(dialog.querySelectorAll("button"))
  ).find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
    return visible(element) && /^(delete|remove)$/i.test(label);
  });
  if (!target) return false;
  target.setAttribute(
    "data-agent-browser-app-target",
    "confirm-notebook-removal"
  );
  return true;
})()
`;

export const notebookRemovalSettledScript = String.raw`
/* aba:notebook-removal-settled */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  return !Array.from(
    document.querySelectorAll(
      '[role="dialog"], mat-dialog-container, .cdk-overlay-backdrop-showing'
    )
  ).some(visible);
})()
`;

export const readNotebookScript = String.raw`
/* aba:notebook-read */
(() => {
  const text = (selector) => {
    const element = document.querySelector(selector);
    return element?.textContent?.trim() || null;
  };
  const titleInput = document.querySelector(
    'input[aria-label*="title" i], textarea[aria-label*="title" i]'
  );
  const sources = Array.from(
    document.querySelectorAll(
      ".source-title, [data-testid*=source] [data-testid*=title], source-item"
    )
  ).map((element) => element.textContent?.trim()).filter(Boolean);
  const summaries = Array.from(
    document.querySelectorAll(
      ".chat-summary, .summary, [data-testid*=summary], " +
      ".to-user-container .message-text-content"
    )
  ).map((element) => element.textContent?.trim()).filter(Boolean);
  return {
    url: location.href,
    title:
      titleInput?.value ||
      text(".project-title") ||
      text(".notebook-title") ||
      text("h1") ||
      document.title.replace(/\s*-\s*(NotebookLM|Gemini Notebook).*$/i, ""),
    sources: Array.from(new Set(sources)),
    summary: summaries[0] || null
  };
})()
`;

export const markQueryInputScript = String.raw`
/* aba:query-input */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const selectors = [
    "textarea.query-box-input",
    'textarea[aria-label="Query box"]',
    '[aria-label="Query box"][role="textbox"]',
    'textarea[aria-label="Input for queries"]',
    'textarea[aria-label*="quer" i]',
    'textarea[placeholder*="ask" i]',
    '[contenteditable="true"][aria-label*="ask" i]',
    '[contenteditable="true"][role="textbox"]'
  ];
  for (const selector of selectors) {
    const target = Array.from(document.querySelectorAll(selector)).find(visible);
    if (target) {
      target.setAttribute("data-agent-browser-app-target", "query");
      return true;
    }
  }
  return false;
})()
`;

export const markUploadButtonScript = String.raw`
/* aba:upload-button */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const candidates = Array.from(
    document.querySelectorAll(
      "[xapscottyuploadertrigger], button, [role=button]"
    )
  );
  const target = candidates.find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
    return visible(element) && /upload files/i.test(label);
  });
  if (!target) return false;
  target.setAttribute("data-agent-browser-app-target", "upload");
  return true;
})()
`;

export function markSourceDialogOptionScript(
  option: "copied-text" | "websites" | "drive",
): string {
  const label = {
    "copied-text": "Copied text",
    websites: "Websites",
    drive: "Drive",
  }[option];
  return String.raw`
/* aba:source-dialog-option-${option} */
(() => {
  const expected = ${JSON.stringify(label)};
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"], mat-dialog-container')
  ).filter(visible);
  const target = dialogs.flatMap((dialog) =>
    Array.from(dialog.querySelectorAll("button, [role=button]"))
  ).find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return visible(element) && label.endsWith(expected);
  });
  if (!target) return false;
  target.setAttribute(
    "data-agent-browser-app-target",
    "source-option-${option}"
  );
  return true;
})()
`;
}

function markSourceInputScript(
  marker: string,
  selectors: string[],
): string {
  return String.raw`
/* aba:${marker} */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const selectors = ${JSON.stringify(selectors)};
  for (const selector of selectors) {
    const target = Array.from(document.querySelectorAll(selector)).find(visible);
    if (!target) continue;
    target.setAttribute("data-agent-browser-app-target", "${marker}");
    return true;
  }
  return false;
})()
`;
}

export const markCopiedTextInputScript = markSourceInputScript(
  "copied-text-input",
  [
    'textarea[aria-label="Pasted text"]',
    'textarea[placeholder="Paste text here"]',
  ],
);

export const markUrlsInputScript = markSourceInputScript(
  "urls-input",
  [
    'textarea[aria-label="Enter URLs"]',
    'textarea[placeholder="Paste any links"]',
  ],
);

export const markSourceInsertButtonScript = String.raw`
/* aba:source-insert-button */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"], mat-dialog-container')
  ).filter(visible);
  const target = dialogs.flatMap((dialog) =>
    Array.from(dialog.querySelectorAll("button"))
  ).find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    return visible(element) && /^insert$/i.test(label) &&
      !element.hasAttribute("disabled");
  });
  if (!target) return false;
  target.setAttribute("data-agent-browser-app-target", "source-insert");
  return true;
})()
`;

export function readDrivePickerStateScript(target: string): string {
  return String.raw`
/* aba:drive-picker-state */
(() => {
  const expected = ${JSON.stringify(target)}
    .replace(/\s+/g, " ").trim().toLowerCase();
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const input = document.querySelector(
    'input[role="combobox"][aria-label*="Search in Drive" i], ' +
    'input[placeholder*="Search in Drive" i]'
  );
  const optionName = (option) => {
    const attribute = option.getAttribute("data-is-doc-name");
    if (attribute && attribute !== "true") return attribute;
    const named = option.querySelector("[data-is-doc-name]");
    if (named && named !== option) return named.textContent || "";
    return option.getAttribute("aria-label") || option.textContent || "";
  };
  const options = Array.from(
    document.querySelectorAll('[role="option"]:not([aria-disabled="true"])')
  );
  const exactMatchCount = options.filter((option) =>
    optionName(option).replace(/\s+/g, " ").trim().toLowerCase() === expected
  ).length;
  return {
    ready: Boolean(input),
    searchValue: input?.value || "",
    searching: Array.from(
      document.querySelectorAll(
        '[role="progressbar"], [aria-label*="loading" i]'
      )
    ).some(visible),
    optionCount: options.length,
    exactMatchCount
  };
})()
`;
}

export function selectDrivePickerItemScript(target: string): string {
  const targetIsUrl = /^https?:\/\//i.test(target);
  return String.raw`
/* aba:drive-picker-select */
(() => {
  const expected = ${JSON.stringify(target)}
    .replace(/\s+/g, " ").trim().toLowerCase();
  const targetIsUrl = ${targetIsUrl};
  const optionName = (option) => {
    const attribute = option.getAttribute("data-is-doc-name");
    if (attribute && attribute !== "true") return attribute;
    const named = option.querySelector("[data-is-doc-name]");
    if (named && named !== option) return named.textContent || "";
    return option.getAttribute("aria-label") || option.textContent || "";
  };
  const options = Array.from(
    document.querySelectorAll('[role="option"]:not([aria-disabled="true"])')
  );
  const exactMatches = options.filter((option) =>
    optionName(option).replace(/\s+/g, " ").trim().toLowerCase() === expected
  );
  const target = exactMatches.length === 1
    ? exactMatches[0]
    : targetIsUrl && options.length === 1
      ? options[0]
      : null;
  if (!target) return false;
  const rect = target.getBoundingClientRect();
  const eventOptions = {
    bubbles: true,
    clientX: rect.left + Math.min(12, rect.width / 2),
    clientY: rect.top + Math.min(12, rect.height / 2)
  };
  target.dispatchEvent(new MouseEvent("mousedown", eventOptions));
  target.dispatchEvent(new MouseEvent("mouseup", eventOptions));
  target.dispatchEvent(new MouseEvent("click", eventOptions));
  return true;
})()
`;
}

export const readDrivePickerSelectionScript = String.raw`
/* aba:drive-picker-selection */
(() => {
  const selectedCount = document.querySelectorAll(
    '[role="option"][aria-selected="true"]'
  ).length;
  const insert = Array.from(
    document.querySelectorAll("button, [role=button]")
  ).find((element) => {
    const ariaLabel = (element.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ").trim();
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    return (
      /^insert\s+\d+\s+items?$/i.test(ariaLabel) ||
      /^insert$/i.test(text)
    ) &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-disabled") !== "true";
  });
  return { selectedCount, canInsert: Boolean(insert) };
})()
`;

export const insertDrivePickerSelectionScript = String.raw`
/* aba:drive-picker-insert */
(() => {
  const insert = Array.from(
    document.querySelectorAll("button, [role=button]")
  ).find((element) => {
    const ariaLabel = (element.getAttribute("aria-label") || "")
      .replace(/\s+/g, " ").trim();
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    return (
      /^insert\s+\d+\s+items?$/i.test(ariaLabel) ||
      /^insert$/i.test(text)
    ) &&
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-disabled") !== "true";
  });
  if (!insert) return false;
  insert.click();
  return true;
})()
`;

export function readUploadStatusScript(
  fileName: string,
  baselineMatchingCount = 0,
): string {
  return String.raw`
/* aba:upload-status */
(() => {
  const expected = ${JSON.stringify(fileName)}.trim().toLowerCase();
  const baselineMatchingCount = ${baselineMatchingCount};
  const sourceItems = Array.from(
    document.querySelectorAll(".single-source-container, source-item")
  );
  const sourceName = (element) =>
    (
      element.querySelector(".source-title")?.textContent ||
      element.querySelector(".source-stretched-button")?.getAttribute("aria-label") ||
      ""
    ).trim();
  const matchingItems = sourceItems.filter((element) =>
    sourceName(element).toLowerCase() === expected
  );
  const newMatchingItems = matchingItems.slice(baselineMatchingCount);
  const matchingItem = newMatchingItems.at(-1) || null;
  const processing = Boolean(
    matchingItem?.matches(".shimmer") ||
    matchingItem?.querySelector(
      '.loading-spinner-container, [role="progressbar"]'
    ) ||
    matchingItem?.querySelector('button[aria-label="More"][disabled]')
  );
  const failed = Boolean(
    matchingItem?.matches(
      ".single-source-error-container, [class*=error]"
    ) ||
    matchingItem?.querySelector('[aria-label*="error" i]')
  );
  const sourceCountText =
    document.querySelector(".cover-subtitle-source-count")?.textContent || "";
  const sourceCountMatch = sourceCountText.match(/\b(\d+)\s+sources?\b/i);
  const expectedSourceCount = sourceCountMatch
    ? Number(sourceCountMatch[1])
    : null;
  return {
    loaded:
      expectedSourceCount !== null &&
      sourceItems.length >= expectedSourceCount,
    sourceCount: sourceItems.length,
    expectedSourceCount,
    matchingCount: matchingItems.length,
    newItemPresent: Boolean(matchingItem),
    ready: Boolean(matchingItem) && !processing && !failed,
    dialogOpen: Boolean(
      document.querySelector(
        'mat-dialog-container [xapscottyuploadertrigger], [role="dialog"] [xapscottyuploadertrigger]'
      )
    ),
    processing,
    error: failed ? "NotebookLM marked the new source as failed." : null
  };
})()
`;
}

export const readChatStateScript = String.raw`
/* aba:chat-state */
(() => {
  const pairs = Array.from(
    document.querySelectorAll(".chat-message-pair")
  ).map((pair) => {
    const question = pair.querySelector(
      ".from-user-message-card-content .message-text-content"
    )?.innerText?.trim() || null;
    const assistantCard = pair.querySelector(
      ".to-user-message-card-content"
    );
    const answer = assistantCard?.querySelector(
      ".message-text-content"
    )?.innerText?.trim() || null;
    const complete = Boolean(
      answer &&
      assistantCard?.querySelector(
        "mat-card-actions.message-actions, .message-actions"
      )
    );
    return { question, answer, complete };
  }).filter((pair) => pair.question || pair.answer);
  return { pairs };
})()
`;

export const readSourcesScript = String.raw`
/* aba:source-list */
(() => {
  const items = Array.from(
    document.querySelectorAll(".single-source-container, source-item")
  );
  const sourceCountText =
    document.querySelector(".cover-subtitle-source-count")?.textContent || "";
  const sourceCountMatch = sourceCountText.match(/\b(\d+)\s+sources?\b/i);
  const expectedSourceCount = sourceCountMatch
    ? Number(sourceCountMatch[1])
    : null;
  const sources = items.map((item, index) => {
    const title = (
      item.querySelector(".source-title")?.textContent ||
      item.querySelector(".source-stretched-button")?.getAttribute("aria-label") ||
      "Untitled source"
    ).trim();
    const menuButton = item.querySelector('button[aria-label="More"]');
    const failed = Boolean(
      item.matches(".single-source-error-container, [class*=error]") ||
      item.querySelector('[aria-label*="error" i]')
    );
    const processing = Boolean(
      !failed && (
        item.matches(".shimmer") ||
        item.querySelector(
          '.loading-spinner-container, [role="progressbar"]'
        ) ||
        menuButton?.hasAttribute("disabled")
      )
    );
    return {
      id: "source-" + (index + 1),
      title,
      status: failed ? "error" : processing ? "processing" : "ready",
      removable: Boolean(menuButton && !menuButton.hasAttribute("disabled"))
    };
  });
  return {
    loaded:
      expectedSourceCount !== null &&
      items.length >= expectedSourceCount,
    expectedSourceCount,
    sources
  };
})()
`;

export function markSourceMenuButtonScript(sourceIndex: number): string {
  return String.raw`
/* aba:source-menu */
(() => {
  const sourceIndex = ${sourceIndex};
  const items = Array.from(
    document.querySelectorAll(".single-source-container, source-item")
  );
  const button = items[sourceIndex]?.querySelector('button[aria-label="More"]');
  if (!button || button.hasAttribute("disabled")) return false;
  button.setAttribute("data-agent-browser-app-target", "source-menu");
  return true;
})()
`;
}

export const markRemoveSourceMenuItemScript = String.raw`
/* aba:source-remove-menu-item */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const target = Array.from(
    document.querySelectorAll(
      ".more-menu-delete-source-button, [role=menuitem], button"
    )
  ).find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
    return visible(element) && (
      element.matches(".more-menu-delete-source-button") ||
      /\b(remove|delete)\s+source\b/i.test(label)
    );
  });
  if (!target) return false;
  target.setAttribute("data-agent-browser-app-target", "remove-source");
  return true;
})()
`;

export const markConfirmSourceRemovalScript = String.raw`
/* aba:source-remove-confirm */
(() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none";
  };
  const dialogs = Array.from(
    document.querySelectorAll('[role="dialog"], mat-dialog-container')
  );
  const target = dialogs.flatMap((dialog) =>
    Array.from(dialog.querySelectorAll("button"))
  ).find((element) => {
    const label = [
      element.getAttribute("aria-label"),
      element.textContent
    ].filter(Boolean).join(" ").trim();
    return visible(element) && /^(delete|remove)$/i.test(label);
  });
  if (!target) return false;
  target.setAttribute(
    "data-agent-browser-app-target",
    "confirm-source-removal"
  );
  return true;
})()
`;
