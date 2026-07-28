export const readAuthStateScript = String.raw`
/* aba:reddit-auth-state */
(() => {
  const usernameFromHref = (value) => {
    if (!value) return null;
    try {
      const path = new URL(value, location.origin).pathname;
      const match = path.match(/^\/(?:u|user)\/([A-Za-z0-9_-]{3,20})\/?$/);
      return match?.[1] || null;
    } catch {
      return null;
    }
  };
  const normalizeUsername = (value) => {
    if (!value) return null;
    const normalized = String(value)
      .trim()
      .replace(/^@/, "")
      .replace(/^u\//i, "");
    return /^[A-Za-z0-9_-]{3,20}$/.test(normalized)
      ? normalized
      : null;
  };
  const app = document.querySelector("shreddit-app");
  const candidates = [
    ...document.querySelectorAll(
      'header a[href^="/user/"], header a[href^="/u/"], ' +
      'reddit-header-large a[href^="/user/"], ' +
      'reddit-header-action-items a[href^="/user/"], ' +
      'faceplate-tracker[noun="profile"] a[href^="/user/"], ' +
      '#user-drawer-content a[href^="/user/"], ' +
      'rpl-dropdown [slot="content"] a[href^="/user/"], ' +
      '[slot="user-drawer"] a[href^="/user/"], ' +
      'a[data-testid="profile-button"][href^="/user/"]'
    )
  ];
  let username = null;
  for (const candidate of candidates) {
    username = usernameFromHref(candidate.getAttribute("href"));
    if (username) break;
  }
  const identityElements = [
    app,
    document.querySelector("reddit-header-action-items"),
    document.querySelector("reddit-header-large"),
    document.querySelector('[slot="user-drawer"]'),
    document.querySelector('[data-testid="profile-button"]')
  ].filter(Boolean);
  const identityAttributes = [
    "username",
    "user-name",
    "current-username",
    "account-name"
  ];
  for (const element of identityElements) {
    for (const attribute of identityAttributes) {
      username = username ||
        normalizeUsername(element.getAttribute(attribute));
    }
  }
  const labeledIdentity = identityElements
    .flatMap((element) => [
      element.getAttribute("aria-label"),
      element.getAttribute("title")
    ])
    .filter(Boolean)
    .join(" ");
  username = username ||
    labeledIdentity.match(
      /(?:u\/|profile\s+(?:for|of)\s+|account\s+)([A-Za-z0-9_-]{3,20})/i
    )?.[1] ||
    null;
  const appLoggedIn = ["is-user-logged-in", "user-logged-in", "logged-in"]
    .some((name) => {
      const value = app?.getAttribute(name);
      return app?.hasAttribute(name) && value !== "false";
    });
  const headerLoggedIn = Boolean(
    document.querySelector("#expand-user-drawer-button") &&
    document.querySelector(
      "#notifications-inbox-button, " +
      "#header-action-item-chat-button, #create-post"
    ) &&
    !document.querySelector("#login-button")
  );
  if ((appLoggedIn || headerLoggedIn) && !username) {
    const userDrawerButton = document.querySelector(
      "#expand-user-drawer-button"
    );
    if (
      userDrawerButton &&
      userDrawerButton.getAttribute("aria-expanded") !== "true"
    ) {
      userDrawerButton.click();
    }
  }
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const loginRequired = Boolean(
    /^\/login(?:\/|$)/.test(path) ||
    document.querySelector(
      'auth-flow-modal, shreddit-async-loader[bundlename*="login" i], ' +
      'form[action*="/login"]'
    )
  );
  const bodyText = document.body?.innerText || "";
  const pageText = [
    document.title,
    document.querySelector("h1")?.textContent,
    bodyText.length < 1000 ? bodyText : ""
  ].filter(Boolean).join(" ");
  const blocked = /prove your humanity|please wait for verification|blocked by network security|whoa there/i
    .test(pageText);
  return {
    authenticated: Boolean(username || appLoggedIn || headerLoggedIn),
    loginRequired,
    blocked,
    username,
    url: location.href
  };
})()
`;

export const readFeedScript = String.raw`
/* aba:reddit-feed */
(() => {
  const parseNumber = (value) => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().replace(/,/g, "");
    const match = normalized.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/i);
    if (!match) return null;
    const multiplier = {
      k: 1000,
      m: 1000000,
      b: 1000000000
    }[match[2]?.toLowerCase()] || 1;
    const parsed = Number(match[1]) * multiplier;
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  };
  const booleanAttribute = (element, ...names) =>
    names.some((name) => {
      if (!element.hasAttribute(name)) return false;
      const value = element.getAttribute(name);
      return value === "" || value === "true" || value === name;
    });
  const nearest = (post, selector) =>
    Array.from(post.querySelectorAll(selector)).find(
      (element) =>
        element.closest("shreddit-post, article, .thing") === post
    ) || null;
  const text = (post, selectors) => {
    for (const selector of selectors) {
      const value = nearest(post, selector)?.textContent?.trim();
      if (value) return value;
    }
    return "";
  };
  const postParts = (post) => {
    const rawPermalink =
      post.getAttribute("permalink") ||
      post.getAttribute("data-permalink") ||
      nearest(
        post,
        'a[slot="full-post-link"], a[href*="/comments/"]'
      )?.getAttribute("href");
    if (!rawPermalink) return null;
    try {
      const url = new URL(rawPermalink, location.origin);
      const match = url.pathname.match(
        /^\/r\/([^/]+)\/comments\/([A-Za-z0-9]+)(?:\/[^/]*)?\/?/
      );
      if (!match) return null;
      return {
        id: (post.getAttribute("id") ||
          post.getAttribute("data-fullname") ||
          match[2]).replace(/^t3_/, ""),
        subreddit: post.getAttribute("subreddit-name") || match[1],
        url: "https://www.reddit.com" + url.pathname
      };
    } catch {
      return null;
    }
  };
  const readPost = (post) => {
    const parts = postParts(post);
    if (!parts) return null;
    const authorLink = nearest(
      post,
      'a[href^="/user/"], a[href^="/u/"]'
    );
    const rawAuthor =
      post.getAttribute("author") ||
      post.getAttribute("data-author") ||
      authorLink?.textContent?.trim() ||
      "";
    const username = rawAuthor.replace(/^u\//i, "") || "[deleted]";
    const title =
      post.getAttribute("post-title") ||
      post.getAttribute("data-title") ||
      text(post, [
        '[slot="title"]',
        '[data-testid="post-title"]',
        "h1",
        "h2",
        "h3",
        "a.title"
      ]);
    const body = text(post, [
      '[slot="text-body"]',
      '[data-testid="post-content"]',
      '[id^="post-rtjson-content"]',
      ".usertext-body"
    ]);
    const createdAt =
      post.getAttribute("created-timestamp") ||
      post.getAttribute("data-timestamp") ||
      nearest(post, "time")?.getAttribute("datetime") ||
      null;
    const contentHref =
      post.getAttribute("content-href") ||
      post.getAttribute("data-url") ||
      nearest(
        post,
        'a[slot="post-media-container"], a[data-testid="outbound-link"]'
      )?.getAttribute("href") ||
      null;
    let contentUrl = null;
    if (contentHref) {
      try {
        const resolved = new URL(contentHref, location.origin);
        if (resolved.href !== parts.url) {
          contentUrl = resolved.href;
        }
      } catch {
        // Ignore malformed content links.
      }
    }
    return {
      id: parts.id,
      url: parts.url,
      subreddit: parts.subreddit,
      author: {
        username
      },
      title,
      text: body,
      createdAt,
      contentUrl,
      metrics: {
        score:
          parseNumber(post.getAttribute("score")) ??
          parseNumber(post.getAttribute("data-score")) ??
          parseNumber(
            text(post, [
              '[slot="vote-button"] faceplate-number',
              '[data-testid="post-vote-count"]',
              ".score"
            ])
          ),
        comments:
          parseNumber(post.getAttribute("comment-count")) ??
          parseNumber(post.getAttribute("data-comments-count")) ??
          parseNumber(
            text(post, [
              '[data-testid="comment-count"]',
              'a[href*="/comments/"] [aria-label*="comment" i]',
              "a.comments"
            ]).match(/[\d,.]+\s*[kmb]?/i)?.[0]
          )
      },
      nsfw: booleanAttribute(post, "nsfw", "over-18", "data-over18"),
      spoiler: booleanAttribute(post, "spoiler", "data-spoiler"),
      promoted: booleanAttribute(post, "promoted", "data-promoted")
    };
  };

  const found = new Map();
  for (const post of document.querySelectorAll(
    "shreddit-post, article[data-testid=\"post-container\"], .thing.link"
  )) {
    const value = readPost(post);
    if (value && !found.has(value.id)) {
      found.set(value.id, value);
    }
  }
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const headerLogin = document.querySelector(
    'reddit-header-large a[href*="/login"], header a[href*="/login"], ' +
    'a[data-testid="login-button"]'
  );
  const app = document.querySelector("shreddit-app");
  const appLoggedIn = ["is-user-logged-in", "user-logged-in", "logged-in"]
    .some((name) => {
      const value = app?.getAttribute(name);
      return app?.hasAttribute(name) && value !== "false";
    });
  const loginRequired = Boolean(
    /^\/login(?:\/|$)/.test(path) || (headerLogin && !appLoggedIn)
  );
  const bodyText = document.body?.innerText || "";
  const pageText = [
    document.title,
    document.querySelector("h1")?.textContent,
    bodyText.length < 1000 ? bodyText : ""
  ].filter(Boolean).join(" ");
  const blocked = /prove your humanity|please wait for verification|blocked by network security|whoa there/i
    .test(pageText);
  return {
    loginRequired,
    blocked,
    ready: Boolean(
      !blocked &&
      (
        found.size > 0 ||
        document.querySelector(
          'main, shreddit-feed, [data-testid="post-container-list"], #siteTable'
        )
      )
    ),
    posts: Array.from(found.values())
  };
})()
`;

export const scrollFeedScript = String.raw`
/* aba:reddit-feed-scroll */
(() => {
  const before = window.scrollY;
  window.scrollBy({ top: Math.max(window.innerHeight * 0.85, 600) });
  return { before, after: window.scrollY };
})()
`;

export const readProfileScript = String.raw`
/* aba:reddit-profile */
(() => {
  const parseNumber = (value) => {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().replace(/,/g, "");
    const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*([kmb])?/i);
    if (!match) return null;
    const multiplier = {
      k: 1000,
      m: 1000000,
      b: 1000000000
    }[match[2]?.toLowerCase()] || 1;
    const parsed = Number(match[1]) * multiplier;
    return Number.isFinite(parsed) ? Math.round(parsed) : null;
  };
  const content = (scope, property) => {
    const element = scope?.querySelector('[itemprop="' + property + '"]');
    return element?.getAttribute("content") ||
      element?.textContent?.trim() ||
      null;
  };
  const visibleText = (...selectors) => {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return null;
  };
  const labeledNumber = (...labels) => {
    const candidates = Array.from(
      document.querySelectorAll("dt, dd, span, p, div")
    ).filter((element) => element.children.length <= 3);
    const escapePattern = (value) =>
      value.replace(/[.*+?^{}()|[\]\\$]/g, "\\$&");
    for (const label of labels) {
      for (const element of candidates) {
        const ownText = element.textContent?.trim() || "";
        if (ownText.toLowerCase() !== label.toLowerCase()) continue;
        for (const sibling of [
          element.previousElementSibling,
          element.nextElementSibling
        ].filter(Boolean)) {
          const parsed = parseNumber(sibling.textContent);
          if (parsed !== null) return parsed;
        }
        const withoutLabel = (element.parentElement?.textContent || "")
          .replace(new RegExp(escapePattern(label), "ig"), " ");
        const parsed = parseNumber(withoutLabel);
        if (parsed !== null) return parsed;
      }
      const numberPattern = "(-?\\\\d+(?:\\\\.\\\\d+)?\\\\s*[kmb]?)";
      const labelPattern = escapePattern(label);
      const combined = new RegExp(
        "^(?:" +
          numberPattern + "\\\\s*" + labelPattern +
          "|" + labelPattern + "\\\\s*" + numberPattern +
        ")$",
        "i"
      );
      for (const element of candidates) {
        const ownText = element.textContent?.trim() || "";
        const match = ownText.match(combined);
        if (!match) continue;
        const parsed = parseNumber(match[1] || match[2]);
        if (parsed !== null) return parsed;
      }
    }
    return null;
  };
  const pathMatch = location.pathname.match(
    /^\/(?:u|user)\/([A-Za-z0-9_-]{3,20})(?:\/|$)/
  );
  const username = pathMatch?.[1] || null;
  const mainText = document.querySelector("main")?.innerText || "";
  const pageText = [document.title, mainText].join(" ");
  const blockedText = [
    document.title,
    document.querySelector("h1")?.textContent,
    mainText.length < 1000 ? mainText : ""
  ].filter(Boolean).join(" ");
  const blocked = /prove your humanity|please wait for verification|blocked by network security|whoa there/i
    .test(blockedText);
  const unavailableMessage = [
    "Sorry, nobody on Reddit goes by that name",
    "This account has been suspended",
    "This account is suspended",
    "page not found"
  ].find((message) => pageText.toLowerCase().includes(message.toLowerCase())) ||
    null;
  const headerLogin = document.querySelector(
    'reddit-header-large a[href*="/login"], header a[href*="/login"], ' +
    'a[data-testid="login-button"]'
  );
  const app = document.querySelector("shreddit-app");
  const appLoggedIn = ["is-user-logged-in", "user-logged-in", "logged-in"]
    .some((name) => {
      const value = app?.getAttribute(name);
      return app?.hasAttribute(name) && value !== "false";
    });
  const loginRequired = Boolean(
    /^\/login(?:\/|$)/.test(location.pathname) ||
    (headerLogin && !appLoggedIn)
  );
  const schemaProfile = document.querySelector(
    '[itemtype="https://schema.org/Person"]'
  );
  const profileRegion = document.querySelector(
    'reddit-user-profile-info, [data-testid="profile-overview"], ' +
    '[data-testid="profile-sidebar"], aside'
  );
  const regionText = profileRegion?.innerText || "";
  const heading = visibleText(
    '[data-testid="profile-name"]',
    'h1[slot="title"]',
    "main h1"
  );
  const normalizedHeading = heading
    ?.replace(/^u\//i, "")
    .replace(/\s*-\s*Reddit\s*$/i, "")
    .trim();
  const description =
    content(schemaProfile, "description") ||
    visibleText(
      '[data-testid="profile-description"]',
      '[slot="description"]',
      ".usertext-body .md"
    );
  const profileElement = document.querySelector(
    "reddit-user-profile-info, shreddit-profile-page"
  );
  const createdAt =
    content(schemaProfile, "dateCreated") ||
    profileElement?.getAttribute("created-timestamp") ||
    profileElement?.getAttribute("account-created-at") ||
    document.querySelector(
      '[data-testid="cake-day"] time, [aria-label*="cake day" i] time'
    )?.getAttribute("datetime") ||
    null;
  const postKarma =
    parseNumber(
      document.querySelector('[data-testid="post-karma"]')
        ?.getAttribute("content")
    ) ??
    parseNumber(
      document.querySelector('[data-testid="post-karma"]')?.textContent
    ) ??
    labeledNumber("Post Karma");
  const commentKarma =
    parseNumber(
      document.querySelector('[data-testid="comment-karma"]')
        ?.getAttribute("content")
    ) ??
    parseNumber(
      document.querySelector('[data-testid="comment-karma"]')?.textContent
    ) ??
    labeledNumber("Comment Karma");
  return {
    loginRequired,
    blocked,
    unavailableMessage,
    ready: Boolean(
      username &&
      !blocked &&
      !unavailableMessage &&
      document.querySelector("main, #siteTable")
    ),
    profile: username
      ? {
          id:
            schemaProfile?.getAttribute("data-user-id") ||
            profileElement?.getAttribute("user-id") ||
            null,
          username,
          name:
            content(schemaProfile, "name") ||
            (
              normalizedHeading &&
              normalizedHeading.toLowerCase() !== username.toLowerCase()
                ? normalizedHeading
                : username
            ),
          bio: description,
          createdAt,
          karma:
            labeledNumber("Total Karma") ??
            (
              postKarma !== null && commentKarma !== null
                ? postKarma + commentKarma
                : null
            ),
          postKarma,
          commentKarma,
          followers: labeledNumber("Followers"),
          admin: /reddit admin/i.test(regionText),
          moderator: /moderator/i.test(regionText),
          url: "https://www.reddit.com/user/" + username + "/"
        }
      : null
  };
})()
`;
