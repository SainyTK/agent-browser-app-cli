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
