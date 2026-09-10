let sentAllintitle = false;
let sentSearch = false;
let lastUrl = location.href;
console.log("CONTENT SCRIPT LOADED");
function parseSurferVolume() {
  const isBadVolumeContext = (text) => {
    return /(allintitle|kết quả|results?|giây|seconds?|cpc|difficulty|related|people also ask)/i.test(text);
  };

  const parseVolumeText = (text) => {
    if (!text) return null;

    const normalized = text
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (isBadVolumeContext(normalized)) {
      return null;
    }

    const hasVolumeContext = /(volume|search volume|lưu lượng|monthly searches|keyword surfer|\/mo|\/tháng|\/month|per month|mo\b)/i.test(normalized);
    if (!hasVolumeContext) return null;

    const patterns = [
      /(?:volume|search volume|lưu lượng|monthly searches)[^\d]{0,20}(\d+(?:[.,]\d+)?)\s*([kKmM])?/i,
      /(\d+(?:[.,]\d+)?)\s*([kKmM])?\s*(?:\/mo|\/tháng|\/month|per month|mo\b)/i,
      /keyword surfer[^\d]{0,40}(\d+(?:[.,]\d+)?)\s*([kKmM])?/i
    ];

    let match = null;
    for (const pattern of patterns) {
      match = normalized.match(pattern);
      if (match) break;
    }

    if (!match) return null;

    const base = Number(match[1].replace(",", "."));
    if (!Number.isFinite(base) || base <= 0) return null;

    const suffix = (match[2] || "").toLowerCase();
    const multiplier = suffix === "m" ? 1000000 : suffix === "k" ? 1000 : 1;
    const value = Math.round(base * multiplier);

    return value > 0 && value < 100000000 ? value : null;
  };

  const getTextAround = (el) => {
    const parts = [];
    let node = el;

    for (let i = 0; node && i < 4; i++) {
      parts.push(node.innerText, node.textContent, node.getAttribute?.("aria-label"), node.getAttribute?.("title"));
      node = node.parentElement;
    }

    return parts.filter(Boolean).join(" ");
  };

  const selectors = [
    '[data-testid="keyword-volume"]',
    '[data-testid*="volume" i]',
    '.keyword-surfer-volume',
    '.surfer-volume',
    '[class*="volume" i]',
    '[class*="surfer" i]',
    '[id*="surfer" i]',
    '[id*="volume" i]',
    '[aria-label*="volume" i]',
    '[title*="volume" i]',
    '[aria-label*="lưu lượng" i]',
    '[title*="lưu lượng" i]'
  ];

  for (const sel of selectors) {
    const els = document.querySelectorAll(sel);
    for (const el of els) {
      const text = getTextAround(el);

      const volume = parseVolumeText(text);
      if (volume) return volume;
    }
  }

  const bodyText = document.body?.innerText || "";
  const lines = bodyText.split("\n").map(s => s.trim()).filter(Boolean);

  for (const line of lines) {
    const volume = parseVolumeText(line);
    if (volume) return volume;
  }

  for (let i = 0; i < lines.length; i++) {
    if (!/(volume|search volume|lưu lượng|monthly searches|keyword surfer)/i.test(lines[i])) continue;
    const chunk = lines.slice(i, i + 4).join(" ");
    const volume = parseVolumeText(chunk);
    if (volume) return volume;
  }

  return null;
}
function safeSendMessage(payload) {
  try {
    if (chrome.runtime && chrome.runtime.id) {
      chrome.runtime.sendMessage(payload);
    }
  } catch (e) {
    console.warn("sendMessage failed:", e.message);
  }
}
window.addEventListener("message", (event) => {
  if (!event.data) return;
  if (event.data.action === "KEYWORD_CHECK_SINGLE") {
    safeSendMessage({
      action: "KEYWORD_CHECK_SINGLE",
      keyword: event.data.keyword
    });
  }
  if (event.data.action === "CHECK_RANK") {
    safeSendMessage({
      action: "CHECK_RANK",
      keyword: event.data.keyword,
      domain: event.data.domain
    });
  }

  if (event.data.action === "CHECK_INDEX") {
    safeSendMessage({
      action: "CHECK_INDEX",
      domain: event.data.domain,
      url: event.data.url || null
    });
  }

  if (event.data.action === "CHECK_IP") {
    safeSendMessage({
      action: "CHECK_IP",
      domain: event.data.domain
    });
  }

  if (event.data.action === "KEYWORD_SUGGEST") {
    safeSendMessage({
      action: "KEYWORD_SUGGEST",
      keyword: event.data.keyword
    });
  }
});

chrome.runtime.onMessage.addListener((msg) => {

  if (msg.action === "RANK_RESULT_FROM_EXTENSION") {
    window.postMessage(
      {
        action: "RANK_RESULT",
        keyword: msg.keyword,
        domain: msg.domain,
        position: msg.position,
        link: msg.link
      },
      "*"
    );
  }

  if (msg.action === "INDEX_RESULT_FROM_EXTENSION") {
    window.postMessage(
      {
        action: "INDEX_RESULT",
        domain: msg.domain,
        indexed: msg.indexed
      },
      "*"
    );
  }

  if (msg.action === "IP_RESULT_FROM_EXTENSION") {
    window.postMessage(
      {
        action: "IP_RESULT",
        domain: msg.domain,
        ip: msg.ip
      },
      "*"
    );
  }

  if (msg.action === "KEYWORD_RESULT_FROM_EXTENSION") {
    window.postMessage(
      {
        source: "BUFF_EXT",
        action: "KEYWORD_RESULT",
        data: msg.data
      },
      "*"
    );
  }
});

function normalize(u) {
  return u
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

function checkRank() {
  if (!location.href.includes("google.com/search")) return;

  const url = new URL(location.href);
  const keyword = url.searchParams.get("q");
  const rawDomain = url.searchParams.get("target_domain");
  const start = parseInt(url.searchParams.get("start") || "0", 10);

  if (!keyword || !rawDomain) return;

  const cleanDomain = normalize(rawDomain);

  let index = 1;
  let rank = -1;
  let foundLink = "";

  const results = document.querySelectorAll("div.g, div.yuRUbf");

  results.forEach((item) => {
    const a = item.querySelector("a");
    if (!a) return;

    const href = normalize(a.href);
    if (href.includes(cleanDomain) && rank === -1) {
      rank = start + index;
      foundLink = a.href;
    }
    index++;
  });

  safeSendMessage({
    action: "RANK_RESULT",
    keyword,
    domain: cleanDomain,
    position: rank,
    link: foundLink
  });
}

function checkIndex() {
  if (!location.href.includes("google.com/search")) return;

  const q = new URL(location.href).searchParams.get("q");
  if (!q || !q.startsWith("site:")) return;

  const target = normalize(q.replace("site:", "").trim());

  const links = Array.from(document.querySelectorAll("a"))
    .map(a => normalize(a.href))
    .filter(Boolean);

  const indexed = links.some(href => href === target);

  safeSendMessage({
    action: "INDEX_RESULT",
    domain: target,
    indexed
  });
}

function parseSearchResult() {
  if (sentSearch) return;

  const el = document.querySelector("#result-stats");
  if (!el) {
    setTimeout(parseSearchResult, 300);
    return;
  }

  const results = parseInt(el.innerText.replace(/\D/g, ""), 10) || 0;
  sentSearch = true;

  safeSendMessage({
    action: "SEARCH_RESULT",
    results
  });
}

function parseAllintitle() {
  if (sentAllintitle) return;

  const el = document.querySelector("#result-stats");
  if (!el) {
    setTimeout(parseAllintitle, 300);
    return;
  }

  const count = parseInt(el.innerText.replace(/\D/g, ""), 10) || 0;
  sentAllintitle = true;

  safeSendMessage({
    action: "ALLINTITLE_RESULT",
    count
  });
}
let timeout = null;
if (location.href !== lastUrl) {
  lastUrl = location.href;
  sentSearch = false;
  sentAllintitle = false;
}
let sentVolume = false;

const observer = new MutationObserver(() => {
  clearTimeout(timeout);
  timeout = setTimeout(() => {

    if (!location.href.includes("google.com/search")) return;

    const params = new URL(location.href).searchParams;

    // 1️⃣ Check rank
    if (params.get("target_domain")) {
      checkRank();
      return;
    }

    // 2️⃣ Check index
    checkIndex();

    const q = params.get("q");
    if (!q) return;

    // 3️⃣ Allintitle
    if (q.startsWith('allintitle:"')) {
      parseAllintitle();
      return;
    }

    // 4️⃣ Search result
    parseSearchResult();

  }, 800);
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// const observer = new MutationObserver(() => {
//   clearTimeout(timeout);
//   timeout = setTimeout(() => {

//     if (!location.href.includes("google.com/search")) return;

//     const params = new URL(location.href).searchParams;

//     if (params.get("target_domain")) {
//       checkRank();
//       return;
//     }

//     checkIndex();

//     const q = params.get("q");
//     if (!q) return;

//     if (q.startsWith('allintitle:"')) {
//       parseAllintitle();
//     } else {
//       parseSearchResult();
//     }

//   }, 800);
// });
