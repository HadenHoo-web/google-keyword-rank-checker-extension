let queue = [];
let currentState = null;
let running = false;
let waitVolumeTimer = null;

let keywordBuffer = {};
function normalizeAllintitle(value) {
  if (!value) return 0;
  return Math.max(1, Math.round(value / 1000));
}

function normalizeKeyword(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function toPositiveNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .replace(/\./g, "")
    .replace(/,/g, "");

  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function hasValidVolume(value) {
  return toPositiveNumber(value) !== null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "KEYWORD_CHECK_SINGLE") {
    (async () => {
      const volume = await fetchVolume(msg.keyword);

      queue.push({
        type: "KEYWORD",
        step: "ALLINTITLE",
        keyword: msg.keyword,
        volume,
        returnTabId: sender.tab.id,
        allintitle: 0,
        results: 0
      });


      if (!running) runNext();
    })();

    return true;
  }

  if (msg.action === "CHECK_RANK") {
    queue.push({
      type: "RANK",
      keyword: msg.keyword,
      domain: msg.domain,
      returnTabId: sender.tab?.id || null
    });
    if (!running) runNext();
    return true;
  }

  if (msg.action === "CHECK_INDEX") {
    queue.push({
      type: "INDEX",
      domain: msg.domain,
      url: msg.url || null,
      returnTabId: sender.tab?.id || null
    });
    if (!running) runNext();
    return true;
  }

  if (msg.action === "CHECK_IP") {
    checkIP(msg.domain, sender.tab?.id || null);
    return true;
  }

  if (msg.action === "KEYWORD_SUGGEST") {
    startKeywordSuggest(msg.keyword, sender.tab.id);
    return true;
  }

  if (
    msg.action === "SEARCH_RESULT" ||
    msg.action === "ALLINTITLE_RESULT"
  ) {
    handleKeywordResult(msg);
    return true;
  }

  if (msg.action === "RANK_RESULT" || msg.action === "INDEX_RESULT") {
    handleResult(msg);
    return true;
  }
});

async function fetchVolumes(keywords) {
  try {
    const res = await fetch(
      "https://52.buffdemo.com/granking/api/get_keyword_volume.php",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keywords })
      }
    );
    const json = await res.json();

    if (json.status !== "success") {
      console.warn("Volume API error:", json.message || json);
      return {};
    }

    const result = {};
    Object.entries(json.items || {}).forEach(([keyword, item]) => {
      result[normalizeKeyword(keyword)] = toPositiveNumber(item?.volume);
    });

    return result;
  } catch (e) {
    console.warn("Volume error:", e);
    return {};
  }
}

async function fetchVolume(keyword) {
  const map = await fetchVolumes([keyword]);
  return map[normalizeKeyword(keyword)] ?? null;
}

async function startKeywordSuggest(keyword, tabId) {
  console.log("[BG] START KEYWORD SUGGEST:", keyword);

  const suffixes = ["a", "b", "c", "d", "e"];
  const seen = new Set();
  const rows = [];

  for (const s of suffixes) {
    if (rows.length >= 50) break;

    const q = `${keyword} ${s}`;
    console.log("[BG] FETCH SUGGEST:", q);

    const url =
      "https://suggestqueries.google.com/complete/search" +
      "?client=firefox&hl=vi&q=" + encodeURIComponent(q);

    try {
      const res = await fetch(url);
      const json = await res.json();
      const suggestions = json[1] || [];

      for (const k of suggestions) {
        if (rows.length >= 50) break;
        if (seen.has(k)) continue;

        seen.add(k);

        rows.push({
          keyword: k,
          volume: "...",
          allintitle: "...",
          results: "...",
          kei: "...",
          competition: "Đang kiểm tra"
        });
      }
    } catch (e) {
      console.warn("Suggest error:", q);
    }

    await sleep(400);
  }

  const volumeMap = await fetchVolumes(rows.map(r => r.keyword));
  rows.forEach(row => {
    const volume = volumeMap[normalizeKeyword(row.keyword)] ?? null;
    row.volume = volume ?? "--";
  });

  console.log("🔥 TOTAL KEYWORDS:", rows.length);
  chrome.tabs.sendMessage(tabId, {
    action: "KEYWORD_RESULT_FROM_EXTENSION",
    data: rows
  }).catch(() => { });

  keywordBuffer[tabId] = [];

  rows.forEach(r => {
    queue.push({
      type: "KEYWORD",
      step: "ALLINTITLE",
      keyword: r.keyword,
      volume: toPositiveNumber(r.volume),
      returnTabId: tabId,
      allintitle: 0,
      results: 0
    });
  });

  if (!running) runNext();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function runNext() {
  if (queue.length === 0) {
    running = false;

    if (currentState?.type === "KEYWORD") {
      const tabId = currentState.returnTabId;
      const data = keywordBuffer[tabId] || [];

      chrome.tabs.sendMessage(tabId, {
        action: "KEYWORD_RESULT_FROM_EXTENSION",
        data
      }).catch(() => { });

      keywordBuffer[tabId] = [];
    }

    currentState = null;
    return;
  }

  running = true;
  const job = queue.shift();
  currentState = job;
  console.log("[BG] STEP:", currentState.step, currentState.keyword);

  if (job.type === "KEYWORD") {
    if (job.step === "SEARCH") {
      openGoogleSearch(job.keyword);
    } else {
      openAllintitle(job.keyword);
    }
    return;
  }

  if (job.type === "RANK") {
    currentState.page = 0;
    currentState.maxPage = 10;
    openGoogleRankPage();
    return;
  }

  if (job.type === "INDEX") {
    openGoogleIndexPage();
  }
}

function openGoogleSearch(keyword) {
  const url = `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;
  chrome.tabs.create({ url, active: false }, tab => {
    currentState.googleTabId = tab.id;
  });
}

function openAllintitle(keyword) {
  console.log("[BG] OPEN ALLINTITLE:", keyword);

  const q = `allintitle:"${keyword}"`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;

  chrome.tabs.create({ url, active: false }, tab => {
    currentState.googleTabId = tab.id;
  });
}


function openGoogleRankPage() {
  const start = currentState.page * 10;
  const url =
    `https://www.google.com/search?q=${encodeURIComponent(currentState.keyword)}` +
    `&target_domain=${encodeURIComponent(currentState.domain)}` +
    `&start=${start}`;

  chrome.tabs.create({ url, active: false }, tab => {
    currentState.googleTabId = tab.id;
  });
}

function getFirst6Digits(value) {
  if (!value) return 0;

  const digits = value.toString().replace(/\D/g, '');

  return Number(digits.slice(0, 6));
}

function openGoogleIndexPage() {
  const q = currentState.url
    ? `site:${currentState.url}`
    : `site:${currentState.domain}`;

  const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  chrome.tabs.create({ url, active: false }, tab => {
    currentState.googleTabId = tab.id;
  });
}

function handleKeywordResult(msg) {
  if (!currentState || currentState.type !== "KEYWORD") return;

  if (msg.action === "ALLINTITLE_RESULT" && currentState.step === "ALLINTITLE") {
    currentState.allintitle = Number(msg.count) || 0;
    // currentState.allintitle = getFirst6Digits(msg.count);
    currentState.step = "SEARCH";

    closeGoogleTab(() => {
      openGoogleSearch(currentState.keyword);
    });
    return;
  }

  if (msg.action === "SEARCH_RESULT" && currentState.step === "SEARCH") {
    currentState.results = Number(msg.results) || 0;

    finalizeKeyword();
  }
  function finalizeKeyword() {
    const volume = toPositiveNumber(currentState.volume);
    const allintitle = currentState.allintitle;
    const results = currentState.results;

    const kei = volume && allintitle > 0
      ? +((volume / allintitle) * 1000).toFixed(2)
      : null;

    const competition = calcCompetition(kei);

    chrome.tabs.sendMessage(currentState.returnTabId, {
      action: "KEYWORD_RESULT_FROM_EXTENSION",
      data: [{
        keyword: currentState.keyword,
        volume: volume ?? "--",
        allintitle,
        results,
        kei: kei ?? "--",
        competition
      }]
    });

    closeGoogleTab(() => runNext());
  }
}
function handleResult(msg) {
  if (!currentState) return;

  if (msg.action === "INDEX_RESULT" && currentState.type === "INDEX") {
    chrome.tabs.sendMessage(currentState.returnTabId, {
      action: "INDEX_RESULT_FROM_EXTENSION",
      domain: currentState.url || currentState.domain,
      indexed: msg.indexed
    }).catch(() => { });

    cleanupAndNext();
    return;
  }

  if (msg.action === "RANK_RESULT" && currentState.type === "RANK") {
    if (msg.position !== -1) {
      sendRankResult(msg.position, msg.link);
      cleanupAndNext();
      return;
    }

    currentState.page++;
    if (currentState.page < currentState.maxPage) {
      closeGoogleTab(() => openGoogleRankPage());
    } else {
      sendRankResult(-1, "");
      cleanupAndNext();
    }
  }
}
function sendRankResult(position, link) {
  chrome.tabs.sendMessage(currentState.returnTabId, {
    action: "RANK_RESULT_FROM_EXTENSION",
    keyword: currentState.keyword,
    domain: currentState.domain,
    position,
    link
  }).catch(() => { });
}

function cleanupAndNext() {
  closeGoogleTab(() => {
    currentState = null;
    runNext();
  });
}

function closeGoogleTab(cb) {
  if (!currentState?.googleTabId) {
    cb && cb();
    return;
  }

  chrome.tabs.remove(currentState.googleTabId, () => {
    currentState.googleTabId = null;
    cb && cb();
  });
}

function calcKEI(volume, results) {
  if (!volume || !results) return 0;
  return +(volume * volume / results).toFixed(2);
}

function calcCompetition(kei) {
  if (kei === null || kei === undefined || kei === "--") return "Thiếu volume";
  if (kei >= 50) return "Thấp";
  if (kei >= 20) return "Trung bình";
  return "Cao";
}

async function checkIP(domain, returnTabId) {
  try {
    const res = await fetch(`https://dns.google/resolve?name=${domain}&type=A`);
    const json = await res.json();
    const ip = json.Answer?.[0]?.data || "N/A";

    chrome.tabs.sendMessage(returnTabId, {
      action: "IP_RESULT_FROM_EXTENSION",
      domain,
      ip
    }).catch(() => { });
  } catch {
    chrome.tabs.sendMessage(returnTabId, {
      action: "IP_RESULT_FROM_EXTENSION",
      domain,
      ip: "ERROR"
    }).catch(() => { });
  }
}
