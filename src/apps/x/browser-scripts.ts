export const readAuthStateScript = String.raw`
/* aba:x-auth-state */
(() => {
  const reservedPaths = new Set([
    "",
    "compose",
    "explore",
    "home",
    "i",
    "login",
    "messages",
    "notifications",
    "search",
    "settings"
  ]);
  const profileCandidates = [
    document.querySelector('a[data-testid="AppTabBar_Profile_Link"]'),
    document.querySelector('nav[aria-label="Primary"] a[aria-label*="Profile" i]'),
    document.querySelector('a[aria-label="Profile"]')
  ].filter(Boolean);
  let username = null;
  for (const candidate of profileCandidates) {
    try {
      const path = new URL(candidate.getAttribute("href"), location.origin)
        .pathname.replace(/^\/|\/$/g, "");
      if (
        /^[A-Za-z0-9_]{1,15}$/.test(path) &&
        !reservedPaths.has(path.toLowerCase())
      ) {
        username = path;
        break;
      }
    } catch {
      // Ignore malformed candidate links.
    }
  }
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const home = path === "/home";
  const authenticated = Boolean(
    username ||
    (
      home &&
      (
        document.querySelector('article, [data-testid="primaryColumn"]') ||
        document.querySelector('nav[aria-label="Primary"]')
      )
    )
  );
  const loginRequired = Boolean(
    !authenticated &&
    (
      /^\/(?:i\/flow\/login|login)(?:\/|$)/.test(path) ||
      (
        path === "/" &&
        (
          /what.?s happening/i.test(document.title) ||
          document.querySelector(
            'a[href*="mode=login"], a[href*="/i/flow/login"]'
          )
        )
      )
    )
  );
  const googleRejected = Boolean(
    location.hostname === "accounts.google.com" &&
    /\/signin\/rejected(?:\/|$)/.test(path)
  );
  return {
    authenticated,
    loginRequired,
    googleRejected,
    username,
    url: location.href
  };
})()
`;

export const readFeedScript = String.raw`
/* aba:x-feed */
(() => {
  const directMeta = (scope, property) => {
    const element = Array.from(scope.children).find(
      (child) =>
        child.tagName === "META" &&
        child.getAttribute("itemprop") === property
    );
    return element?.getAttribute("content") || null;
  };
  const nearestItems = (article, selector) =>
    Array.from(article.querySelectorAll(selector)).filter(
      (element) => element.closest("article") === article
    );
  const counter = (article, expectedName) => {
    const statistics = nearestItems(
      article,
      '[itemprop="interactionStatistic"]'
    );
    for (const statistic of statistics) {
      const name = statistic.querySelector(
        'meta[itemprop="name"]'
      )?.getAttribute("content");
      if (name !== expectedName) continue;
      const value = statistic.querySelector(
        'meta[itemprop="userInteractionCount"]'
      )?.getAttribute("content");
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const actionCounter = (article, testId, actionPattern) => {
    const element = nearestItems(
      article,
      '[data-testid="' + testId + '"]'
    )[0];
    const label = [
      element?.getAttribute("aria-label"),
      element?.getAttribute("title")
    ].filter(Boolean).join(" ");
    const match = label.match(
      new RegExp("([\\d,]+)\\s+" + actionPattern, "i")
    );
    if (!match) return null;
    const parsed = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const statusParts = (value) => {
    if (!value) return null;
    try {
      const parsed = new URL(value, location.origin);
      const match = parsed.pathname.match(
        /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/
      );
      if (!match) return null;
      return {
        username: match[1],
        id: match[2],
        url: "https://x.com/" + match[1] + "/status/" + match[2]
      };
    } catch {
      return null;
    }
  };
  const readTweet = (article) => {
    const schemaUrl = directMeta(article, "url");
    const statusAnchor = nearestItems(
      article,
      'a[href*="/status/"]'
    ).find((anchor) => statusParts(anchor.getAttribute("href")));
    const parts = statusParts(schemaUrl || statusAnchor?.getAttribute("href"));
    if (!parts) return null;

    const author = nearestItems(article, '[itemprop="author"]').find(
      (element) =>
        element.getAttribute("itemtype") === "https://schema.org/Person"
    );
    const authorMeta = (property) =>
      author?.querySelector(
        'meta[itemprop="' + property + '"]'
      )?.getAttribute("content") || null;
    const authorLink = nearestItems(article, "a").find((anchor) => {
      try {
        return new URL(anchor.getAttribute("href"), location.origin).pathname ===
          "/" + parts.username;
      } catch {
        return false;
      }
    });
    const userNameRegion = article.querySelector('[data-testid="User-Name"]');
    const fallbackName = Array.from(
      userNameRegion?.querySelectorAll("a, span") || []
    ).map((element) => element.textContent?.trim()).find(
      (value) => value && !value.startsWith("@")
    );
    const text =
      directMeta(article, "text") ||
      directMeta(article, "articleBody") ||
      article.querySelector('[data-testid="tweetText"]')?.innerText?.trim() ||
      "";
    const date =
      directMeta(article, "datePublished") ||
      article.querySelector("time")?.getAttribute("datetime") ||
      null;
    return {
      id: directMeta(article, "identifier") || parts.id,
      url: parts.url,
      author: {
        id: authorMeta("identifier"),
        name:
          authorMeta("name") ||
          fallbackName ||
          authorLink?.textContent?.trim() ||
          parts.username,
        username: parts.username
      },
      text,
      createdAt: date,
      metrics: {
        replies:
          counter(article, "Replies") ??
          counter(article, "Comments") ??
          actionCounter(article, "reply", "repl(?:y|ies)"),
        reposts:
          counter(article, "Retweets") ??
          actionCounter(article, "retweet", "(?:reposts?|retweets?)"),
        quotes: counter(article, "Quotes"),
        likes:
          counter(article, "Likes") ??
          actionCounter(article, "like", "likes?"),
        views: counter(article, "Views")
      }
    };
  };

  const found = new Map();
  for (const article of document.querySelectorAll("article")) {
    const tweet = readTweet(article);
    if (tweet && !found.has(tweet.id)) {
      found.set(tweet.id, tweet);
    }
  }
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const loginRequired = Boolean(
    /^\/(?:i\/flow\/login|login)(?:\/|$)/.test(path) ||
    (
      path === "/" &&
      (
        /what.?s happening/i.test(document.title) ||
        document.querySelector(
          'a[href*="mode=login"], a[href*="/i/flow/login"]'
        )
      )
    )
  );
  return {
    loginRequired,
    ready: Boolean(
      path === "/home" &&
      document.querySelector(
        'main, [data-testid="primaryColumn"], [aria-label*="Home timeline" i]'
      )
    ),
    tweets: Array.from(found.values())
  };
})()
`;

export const scrollFeedScript = String.raw`
/* aba:x-feed-scroll */
(() => {
  const before = window.scrollY;
  window.scrollBy({ top: Math.max(window.innerHeight * 0.85, 600) });
  return { before, after: window.scrollY };
})()
`;

export const readProfileScript = String.raw`
/* aba:x-profile */
(() => {
  const content = (scope, property, direct = false) => {
    if (!scope) return null;
    const candidates = direct
      ? Array.from(scope.children)
      : Array.from(scope.querySelectorAll('[itemprop="' + property + '"]'));
    const element = candidates.find(
      (candidate) => candidate.getAttribute("itemprop") === property
    );
    return element?.getAttribute("content") ||
      element?.textContent?.trim() ||
      null;
  };
  const profile = document.querySelector(
    '[itemprop="mainEntity"][itemtype="https://schema.org/Person"]'
  );
  const profilePage = document.querySelector(
    '[itemtype="https://schema.org/ProfilePage"]'
  );
  let jsonProfilePage = null;
  for (const script of document.querySelectorAll(
    'script[data-testid="UserProfileSchema-test"], script[type="application/ld+json"]'
  )) {
    try {
      const parsed = JSON.parse(script.textContent || "");
      if (
        parsed?.["@type"] === "ProfilePage" &&
        parsed.mainEntity?.["@type"] === "Person"
      ) {
        jsonProfilePage = parsed;
      }
    } catch {
      // Ignore unrelated or incomplete schema scripts.
    }
  }
  const jsonProfile = jsonProfilePage?.mainEntity || null;
  const canonical =
    content(profile, "url", true) ||
    jsonProfile?.url ||
    document.querySelector('link[rel="canonical"]')?.getAttribute("href") ||
    location.href;
  let username = null;
  try {
    const path = new URL(canonical, location.origin).pathname
      .replace(/^\/|\/$/g, "");
    if (/^[A-Za-z0-9_]{1,15}$/.test(path)) {
      username = path;
    }
  } catch {
    // Keep the username unresolved.
  }
  const title =
    document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    document.title;
  const titleMatch = title?.match(/\(@([A-Za-z0-9_]{1,15})\)/);
  username = username || titleMatch?.[1] || null;

  const counter = (...expectedNames) => {
    if (profile) {
      const statistics = profile.querySelectorAll(
        '[itemprop="agentInteractionStatistic"], [itemprop="interactionStatistic"]'
      );
      for (const statistic of statistics) {
        const name = content(statistic, "name");
        if (!expectedNames.includes(name)) continue;
        const raw = content(statistic, "userInteractionCount");
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
    for (const statistic of jsonProfile?.interactionStatistic || []) {
      if (!expectedNames.includes(statistic?.name)) continue;
      const parsed = Number(statistic?.userInteractionCount);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
  const visibleText = (selector) =>
    document.querySelector(selector)?.textContent?.trim() || null;
  const mainText = document.querySelector("main")?.innerText || "";
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const loginRequired = Boolean(
    /^\/(?:i\/flow\/login|login)(?:\/|$)/.test(path) ||
    (
      path === "/" &&
      (
        /what.?s happening/i.test(document.title) ||
        document.querySelector(
          'a[href*="mode=login"], a[href*="/i/flow/login"]'
        )
      )
    )
  );
  const unavailableMessage = [
    "This account doesn’t exist",
    "This account doesn't exist",
    "Account suspended"
  ].find((message) => mainText.includes(message)) || null;
  const website =
    content(profile, "sameAs", true) ||
    document.querySelector(
      'a[data-testid="UserUrl"], [data-testid="UserUrl"] a'
    )?.href ||
    null;
  return {
    loginRequired,
    unavailableMessage,
    ready: Boolean(
      profile ||
      jsonProfile ||
      (
        username &&
        document.querySelector('[data-testid="UserName"]')
      )
    ),
    profile: username
      ? {
          id:
            content(profile, "identifier", true) ||
            jsonProfile?.identifier ||
            null,
          username,
          name:
            content(profile, "name", true) ||
            jsonProfile?.name ||
            title?.replace(/\s*\(@[^)]+\).*$/, "").trim() ||
            username,
          bio:
            content(profile, "description", true) ||
            jsonProfile?.description ||
            document.querySelector(
              'meta[property="og:description"]'
            )?.getAttribute("content") ||
            visibleText('[data-testid="UserDescription"]'),
          location:
            jsonProfile?.homeLocation?.name ||
            visibleText('[data-testid="UserLocation"]'),
          website,
          joinedAt:
            content(profilePage, "dateCreated", true) ||
            jsonProfilePage?.dateCreated ||
            visibleText('[data-testid="UserJoinDate"]'),
          verified: Boolean(
            Array.from(
              document.querySelectorAll(
                '[aria-label="Verified account"], [data-testid="icon-verified"]'
              )
            ).find((element) => !element.closest("article"))
          ),
          protected: Boolean(
            document.querySelector('[data-testid="icon-lock"]') ||
            /These posts are protected/i.test(mainText)
          ),
          posts: counter("Tweets"),
          following: counter("Following", "Friends"),
          followers: counter("Follows"),
          url: "https://x.com/" + username
        }
      : null
  };
})()
`;
