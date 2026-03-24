const API = "/api";
let argumentsVisible = 6;

let currentDebateShareData = {
  question: "",
  optionA: "",
  optionB: "",
  percentA: 50,
  percentB: 50
};

let pendingArgumentScrollId = null;
let pendingCommentScrollId = null;
let openedArgumentForm = null;
let pinnedNewCommentId = null;
let pinnedNewArgumentId = null;

let currentAllArguments = [];
let currentDebateViewMode = "columns";
let similarDebatesVisible = false;
let currentTypeFilter = "all";

let pendingMobileColumnFocusElementId = null;
let pendingMobileColumnFocusElementTop = null;

function getDebateViewMode() {
  const savedMode = localStorage.getItem("debate_view_mode");
  return savedMode === "list" ? "list" : "columns";
}
function isOpenDebate(debate) {
  return String(debate?.type || "debate") === "open";
}

function updateCreateTypeUI() {
  const selected = document.querySelector('input[name="debate-type"]:checked')?.value || "debate";

  const positionsBlock = document.getElementById("positions-fields");
  const optionAInput = document.getElementById("option_a");
  const optionBInput = document.getElementById("option_b");

  setDisplay(positionsBlock, selected === "open" ? "none" : "grid");

  if (optionAInput) {
    optionAInput.required = selected !== "open";
  }

  if (optionBInput) {
    optionBInput.required = selected !== "open";
  }
}
function applyDebateTypeUI(debate) {
  const openMode = isOpenDebate(debate);

  const headings = document.querySelector(".debate-headings");
  const columns = document.querySelector(".debate-columns");
  const listView = document.getElementById("debate-list-view");
  const scoreBar = document.getElementById("debate-score-bar");
  const scoreA = document.getElementById("score-a");
  const scoreB = document.getElementById("score-b");
  const titleA = document.getElementById("title-a");
  const titleB = document.getElementById("title-b");
  const fixedBar = document.querySelector(".argument-fixed-bar");
  const viewSwitch = document.querySelector(".debate-view-switch");
  const viewSwitchCard = document.getElementById("debate-view-switch-card");
  const mainButton = document.getElementById("argument-btn-main");
const openReplyWrap = document.getElementById("open-question-reply-wrap");

  const sideFocusLeft = document.getElementById("side-focus-left-btn");
  const sideFocusRight = document.getElementById("side-focus-right-btn");

if (!openMode) {
  closeArgumentForm();

  setDisplay(headings, "");
  setDisplay(columns, currentDebateViewMode === "columns" ? "grid" : "none");
  setDisplay(listView, currentDebateViewMode === "list" ? "grid" : "none");
  setDisplay(scoreBar, "");
  setDisplay(scoreA, "");
  setDisplay(scoreB, "");
  setDisplay(viewSwitch, "");
  setDisplay(viewSwitchCard, "");
  setDisplay(fixedBar, "");
  if (openReplyWrap) openReplyWrap.style.display = "none";
setDisplay(headings, "");
setDisplay(columns, currentDebateViewMode === "columns" ? "grid" : "none");
setDisplay(listView, currentDebateViewMode === "list" ? "grid" : "none");
setDisplay(scoreBar, "");
setDisplay(scoreA, "");
setDisplay(scoreB, "");
setDisplay(viewSwitch, "");
setDisplay(viewSwitchCard, "");
setDisplay(fixedBar, "");
if (openReplyWrap) openReplyWrap.style.display = "none";

if (sideFocusLeft) sideFocusLeft.style.display = "none";
if (sideFocusRight) sideFocusRight.style.display = "none";

if (currentDebateViewMode === "columns") {
  applyDebateColumnFocusUI();
}

  if (mainButton) {
    mainButton.textContent = "Ajouter une idée";
    mainButton.onclick = () => openArgumentComposer("a");
  }

  return;
}

currentDebateViewMode = "list";

setDisplay(headings, "none");
setDisplay(columns, "none");
setDisplay(listView, "grid");

setDisplay(scoreBar, "none");
setDisplay(scoreA, "none");
setDisplay(scoreB, "none");

if (titleA) titleA.textContent = "Réponses";
if (titleB) titleB.textContent = "";

setDisplay(viewSwitch, "");
setDisplay(viewSwitchCard, "none");
setDisplay(fixedBar, "");
setDisplay(openReplyWrap, "");

setDisplay(sideFocusLeft, "none");
setDisplay(sideFocusRight, "none");

if (mainButton) {
  mainButton.textContent = "Répondre";
  mainButton.onclick = () => openArgumentComposer("a");
}
}

function updateDebateViewModeUI() {
  currentDebateViewMode = getDebateViewMode();

  const headings = document.querySelector(".debate-headings");
  const columns = document.querySelector(".debate-columns");
  const listView = document.getElementById("debate-list-view");
  const myArgumentsRow = document.querySelector(".my-arguments-row");
  const myArgumentsA = document.getElementById("my-arguments-a");
  const myArgumentsB = document.getElementById("my-arguments-b");
  const columnsBtn = document.getElementById("view-columns-btn");
  const listBtn = document.getElementById("view-list-btn");

setDisplay(headings, "grid");
setDisplay(columns, currentDebateViewMode === "columns" ? "grid" : "none");
setDisplay(listView, currentDebateViewMode === "list" ? "grid" : "none");

  if (myArgumentsRow && myArgumentsA && myArgumentsB) {
    const hasContent =
      myArgumentsA.innerHTML.trim() !== "" || myArgumentsB.innerHTML.trim() !== "";

    myArgumentsRow.style.display = hasContent ? "grid" : "none";
  }

  const listForm = document.getElementById("form-list");
  if (listForm && currentDebateViewMode !== "list") {
    listForm.style.display = "none";
    if (openedArgumentForm === listForm) {
      openedArgumentForm = null;
    }
  }

  if (columnsBtn) {
    columnsBtn.classList.toggle("debate-view-button-active", currentDebateViewMode === "columns");
  }

  if (listBtn) {
    listBtn.classList.toggle("debate-view-button-active", currentDebateViewMode === "list");
  }
const sideFocusLeft = document.getElementById("side-focus-left-btn");
const sideFocusRight = document.getElementById("side-focus-right-btn");
const isOpenMode = isCurrentOpenDebateMode();

if (currentDebateViewMode === "columns") {
  applyDebateColumnFocusUI();
} else {
  if (columns) {
    columns.classList.remove("focus-a", "focus-b");
  }

  if (headings) {
    headings.style.display = isOpenMode ? "none" : "grid";
  }

  setDisplay(sideFocusLeft, "none");
  setDisplay(sideFocusRight, "none");
}

if (isOpenMode) {
  setDisplay(sideFocusLeft, "none");
  setDisplay(sideFocusRight, "none");
}
}

function setDebateViewMode(mode) {
  const normalizedMode = mode === "list" ? "list" : "columns";
  localStorage.setItem("debate_view_mode", normalizedMode);
  currentDebateViewMode = normalizedMode;
  updateDebateViewModeUI();

  const debateId = getDebateId();
  if (debateId) {
    loadDebate(debateId);
  }
}
function isCurrentOpenDebateMode() {
  const titleB = document.getElementById("title-b");
  return !titleB || !titleB.textContent.trim();
}

function isMobileColumnFocusScrollContext() {
  return window.innerWidth <= 768 && currentDebateViewMode === "columns" && !isCurrentOpenDebateMode();
}

function captureHighestVisibleElementForMobileColumnFocus(targetMode) {
  if (!isMobileColumnFocusScrollContext()) {
    pendingMobileColumnFocusElementId = null;
    pendingMobileColumnFocusElementTop = null;
    return;
  }

  const topbar = document.querySelector(".topbar");
  const topbarHeight = topbar ? topbar.offsetHeight : 0;
  const stickyButtonsOffset = 70;
  const visibleTopLimit = topbarHeight + stickyButtonsOffset;

  const selector =
    targetMode === "a"
      ? `
        .debate-columns .column-a .argument-card[id],
        .debate-columns .column-a .comment-card[id]
      `
      : targetMode === "b"
        ? `
        .debate-columns .column-b .argument-card[id],
        .debate-columns .column-b .comment-card[id]
      `
        : `
        .debate-columns .argument-card[id],
        .debate-columns .comment-card[id]
      `;

  const candidates = Array.from(document.querySelectorAll(selector)).filter((element) => {
    if (!element.offsetParent) return false;

    const rect = element.getBoundingClientRect();

    return rect.bottom > visibleTopLimit && rect.top < window.innerHeight;
  });

  if (!candidates.length) {
    pendingMobileColumnFocusElementId = null;
    pendingMobileColumnFocusElementTop = null;
    return;
  }

  const highestVisibleElement = candidates.reduce((highest, current) => {
    const highestRect = highest.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();

    if (currentRect.top < highestRect.top) return current;
    return highest;
  });

  pendingMobileColumnFocusElementId = highestVisibleElement.id;
  pendingMobileColumnFocusElementTop = highestVisibleElement.getBoundingClientRect().top;
}

function restoreMobileColumnFocusScroll() {
  if (!isMobileColumnFocusScrollContext()) return;
  if (!pendingMobileColumnFocusElementId) return;

  const target = document.getElementById(pendingMobileColumnFocusElementId);

  if (!target || !target.offsetParent) {
    pendingMobileColumnFocusElementId = null;
    pendingMobileColumnFocusElementTop = null;
    return;
  }

  const topbar = document.querySelector(".topbar");
  const extraOffset = 110;
  const topbarHeight = topbar ? topbar.offsetHeight : 0;
  const targetY = target.getBoundingClientRect().top + window.scrollY - topbarHeight - extraOffset;

  window.scrollTo({
    top: Math.max(0, targetY),
    behavior: "smooth"
  });

  pendingMobileColumnFocusElementId = null;
  pendingMobileColumnFocusElementTop = null;
}

function getDebateColumnFocus() {
  const saved = localStorage.getItem("debate_column_focus");
  return ["split", "a", "b"].includes(saved) ? saved : "split";
}
function setDebateColumnFocus(mode) {
  const normalizedMode = ["a", "b"].includes(mode) ? mode : "split";
  const previousMode = getDebateColumnFocus();

  if (previousMode === "split" && ["a", "b"].includes(normalizedMode)) {
captureHighestVisibleElementForMobileColumnFocus(normalizedMode);
  } else {
    pendingMobileColumnFocusElementId = null;
    pendingMobileColumnFocusElementTop = null;
  }

  localStorage.setItem("debate_column_focus", normalizedMode);
  applyDebateColumnFocusUI();

  if (previousMode === "split" && ["a", "b"].includes(normalizedMode)) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreMobileColumnFocusScroll();
      });
    });
  }
}

function applyDebateColumnFocusUI() {
  const focusMode = getDebateColumnFocus();
  const openMode = isCurrentOpenDebateMode();

  const columns = document.querySelector(".debate-columns");
  const headings = document.querySelector(".debate-headings");
  const sideFocusLeft = document.getElementById("side-focus-left-btn");
  const sideFocusRight = document.getElementById("side-focus-right-btn");

  const columnA = document.getElementById("column-a");
  const columnB = document.getElementById("column-b");

  if (!columns) return;

  // 🚨 BLOQUER LES BOUTONS EN MODE LISTE
  if (currentDebateViewMode === "list") {
    if (sideFocusLeft) sideFocusLeft.style.display = "none";
    if (sideFocusRight) sideFocusRight.style.display = "none";
    return;
  }

  columns.classList.remove("focus-a", "focus-b");

  if (openMode) {
    if (headings) headings.style.display = "none";
    if (sideFocusLeft) sideFocusLeft.style.display = "none";
    if (sideFocusRight) sideFocusRight.style.display = "none";
    if (columnA) columnA.style.display = "";
    if (columnB) columnB.style.display = "";
    return;
  }

  if (focusMode === "a") {
    if (headings) headings.style.display = "none";
    if (columnA) columnA.style.display = "";
    if (columnB) columnB.style.display = "none";
    columns.classList.add("focus-a");
  } else if (focusMode === "b") {
    if (headings) headings.style.display = "none";
    if (columnA) columnA.style.display = "none";
    if (columnB) columnB.style.display = "";
    columns.classList.add("focus-b");
  } else {
    if (headings) headings.style.display = "grid";
    if (columnA) columnA.style.display = "";
    if (columnB) columnB.style.display = "";
  }

if (sideFocusLeft) {
  sideFocusLeft.style.display = "";
  sideFocusLeft.textContent = focusMode === "a" ? "Tout voir" : "Ouvrir";
  sideFocusLeft.onclick = () => setDebateColumnFocus(focusMode === "a" ? "split" : "a");

  if (focusMode === "a") {
    sideFocusLeft.style.background = "#111111";
    sideFocusLeft.style.color = "#ffffff";
    sideFocusLeft.style.border = "1px solid #111111";
  } else {
    sideFocusLeft.style.background = "#dcfce7";
    sideFocusLeft.style.color = "#166534";
    sideFocusLeft.style.border = "1px solid #86efac";
  }
}

if (sideFocusRight) {
  sideFocusRight.style.display = "";
  sideFocusRight.textContent = focusMode === "b" ? "Tout voir" : "Ouvrir";
  sideFocusRight.onclick = () => setDebateColumnFocus(focusMode === "b" ? "split" : "b");

  if (focusMode === "b") {
    sideFocusRight.style.background = "#111111";
    sideFocusRight.style.color = "#ffffff";
    sideFocusRight.style.border = "1px solid #111111";
  } else {
    sideFocusRight.style.background = "#fee2e2";
    sideFocusRight.style.color = "#991b1b";
    sideFocusRight.style.border = "1px solid #fca5a5";
  }
}
}
function getVisibleArgumentElement(argumentId) {
  if (currentDebateViewMode === "list") {
    return document.getElementById(`list-argument-${argumentId}`) || document.getElementById(`argument-${argumentId}`);
  }

  return document.getElementById(`argument-${argumentId}`) || document.getElementById(`list-argument-${argumentId}`);
}

function getVisibleCommentElement(commentId) {
  if (currentDebateViewMode === "list") {
    return document.getElementById(`list-comment-${commentId}`) || document.getElementById(`comment-${commentId}`);
  }

  return document.getElementById(`comment-${commentId}`) || document.getElementById(`list-comment-${commentId}`);
}

function getArgumentFreshnessBonus(arg) {
  if (!arg.created_at) return 0;

  const created = new Date(String(arg.created_at).replace(" ", "T"));
  const now = new Date();
  const ageHours = (now - created) / (1000 * 60 * 60);

  if (ageHours < 24 * 3) return 5;
  if (ageHours < 24 * 7) return 4;
  if (ageHours < 24 * 14) return 3;
  if (ageHours < 24 * 30) return 2;
  if (ageHours < 24 * 60) return 1;

  return 0;
}
function getArgumentsSortMode() {
  return localStorage.getItem("arguments_sort_mode") || "score";
}

function changeArgumentsSort(mode) {
  const normalizedMode = ["score", "comments", "recent", "old"].includes(mode)
    ? mode
    : "score";

  localStorage.setItem("arguments_sort_mode", normalizedMode);

  const menu = document.getElementById("sort-menu");
  if (menu) {
    menu.classList.remove("sort-menu-visible");
  }

  updateSortButtonLabel();

  const debateId = getDebateId();
  if (debateId) {
    loadDebate(debateId);
  }
}
function toggleSortMenu() {
  const menu = document.getElementById("sort-menu");
  if (!menu) return;

  menu.classList.toggle("sort-menu-visible");
}

function updateSortButtonLabel() {
  const button = document.getElementById("sort-button-label");
  if (!button) return;

  const mode = getArgumentsSortMode();

  const labels = {
    score: "Plus soutenus",
    comments: "Commentés",
    recent: "Récents",
    old: "Anciens"
  };

  button.textContent = `${labels[mode] || "Trier"} ▾`;
}

function sortArgumentsByMode(args, commentsByArgument = {}) {
  const mode = getArgumentsSortMode();
  const sorted = [...(args || [])];

  if (mode === "recent") {
    const ordered = sorted.sort((a, b) => {
      const dateA = new Date(String(a.created_at || "").replace(" ", "T")).getTime() || 0;
      const dateB = new Date(String(b.created_at || "").replace(" ", "T")).getTime() || 0;

      if (dateB !== dateA) return dateB - dateA;
      return Number(b.id || 0) - Number(a.id || 0);
    });

    return movePinnedArgumentToFourthPosition(ordered);
  } else if (mode === "old") {
    const ordered = sorted.sort((a, b) => {
      const dateA = new Date(String(a.created_at || "").replace(" ", "T")).getTime() || 0;
      const dateB = new Date(String(b.created_at || "").replace(" ", "T")).getTime() || 0;

      if (dateA !== dateB) return dateA - dateB;
      return Number(a.id || 0) - Number(b.id || 0);
    });

    return movePinnedArgumentToFourthPosition(ordered);
  } else if (mode === "comments") {
    const ordered = sorted.sort((a, b) => {
      const commentsA = (commentsByArgument?.[a.id] || []).length;
      const commentsB = (commentsByArgument?.[b.id] || []).length;

      if (commentsB !== commentsA) return commentsB - commentsA;
      return Number(b.id || 0) - Number(a.id || 0);
    });

    return movePinnedArgumentToFourthPosition(ordered);
  } else {
    return sortArgumentsByScore(sorted);
  }
}

function movePinnedArgumentToFourthPosition(sortedArgs) {
  if (!pinnedNewArgumentId) return sortedArgs;

  const pinnedIndex = sortedArgs.findIndex(
    (arg) => String(arg.id) === pinnedNewArgumentId
  );

  if (pinnedIndex === -1) return sortedArgs;

  const reordered = [...sortedArgs];
  const [pinnedArg] = reordered.splice(pinnedIndex, 1);

  const targetIndex = Math.min(3, reordered.length);
  reordered.splice(targetIndex, 0, pinnedArg);

  return reordered;
}
function sortArgumentsByScore(args) {
  const ordered = [...(args || [])].sort((a, b) => {
    const scoreA = Number(a.votes || 0) + getArgumentFreshnessBonus(a);
    const scoreB = Number(b.votes || 0) + getArgumentFreshnessBonus(b);

    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }

    return Number(b.id || 0) - Number(a.id || 0);
  });

  return movePinnedArgumentToFourthPosition(ordered);
}


function getSupportRankMap(args) {
  const sortedByVotes = [...(args || [])].sort((a, b) => {
    const votesDiff = Number(b.votes || 0) - Number(a.votes || 0);

    if (votesDiff !== 0) {
      return votesDiff;
    }

    return Number(b.id || 0) - Number(a.id || 0);
  });

  const rankMap = {};

  sortedByVotes.forEach((arg, index) => {
    rankMap[String(arg.id)] = index + 1;
  });

  return rankMap;
}

function renderUnifiedVoicesSummary(debateId, args) {
  const summary = document.getElementById("voices-summary");
  if (!summary) return;

  const state = getState(debateId);
  const totalVotesUsed = Object.values(state).reduce((sum, value) => sum + Number(value || 0), 0);
  const remainingVotes = Math.max(0, 5 - totalVotesUsed);

  summary.innerHTML = `
    <div class="voices-summary-box">
      <div class="voices-summary-title">Vous disposez de 5 voix à répartir entre les idées.</div>
      <div class="voices-summary-count">Voix restantes : ${remainingVotes} / 5</div>
      ${
        remainingVotes === 0
          ? `<div class="voices-summary-note">Toutes vos voix sont attribuées. Retirez-en une pour la déplacer.</div>`
          : ""
      }
    </div>
  `;
}
function renderUnifiedVotedArgumentsSummary(debateId, args) {
  const state = getState(debateId);
 

  const sortedArgs = sortArgumentsByScore(args || []);
  const votedArgumentsA = [];
  const votedArgumentsB = [];

  sortedArgs.forEach((a, index) => {
    const myCount = Number(state[String(a.id)] || 0);
    if (myCount <= 0) return;

    const item = {
      id: a.id,
      rank: index + 1,
      title: a.title || "Idée sans titre",
      count: myCount
    };

    if (a.side === "A") {
      votedArgumentsA.push(item);
    } else if (a.side === "B") {
      votedArgumentsB.push(item);
    }
  });

  const myArgumentsA = document.getElementById("my-arguments-a");
  const myArgumentsB = document.getElementById("my-arguments-b");

const myArgumentsRow = document.querySelector(".my-arguments-row");
const hasAnyVotedArgument = votedArgumentsA.length > 0 || votedArgumentsB.length > 0;

if (myArgumentsRow) {
  myArgumentsRow.style.display = hasAnyVotedArgument ? "grid" : "none";
}

  if (myArgumentsA) {
    if (!votedArgumentsA.length) {
      myArgumentsA.innerHTML = "";
    } else {
      myArgumentsA.innerHTML = `
        <div class="my-arguments-list">
          ${votedArgumentsA.map((item) => `
            <div class="my-argument-chip">
              <div class="my-argument-chip-text">
                <span class="my-argument-chip-rank">#${item.rank}</span>

                <button
                  type="button"
                  class="my-argument-chip-title-button"
                  onclick="scrollToArgumentFromSummary('${item.id}')"
                  title="Aller à cette idée"
                >
                  ${escapeHtml(item.title)}
                </button>
              </div>

              <div class="my-argument-chip-stepper" aria-label="Modifier les voix de cette idée">
                <button
                  type="button"
                  class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-minus"
                  onclick="unvote('${debateId}', '${item.id}', false)"
                  aria-label="Retirer une voix"
                  title="Retirer une voix"
                >
                  −
                </button>

                <span class="my-argument-chip-count">${item.count}</span>

                <button
                  type="button"
                  class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-plus"
                  onclick="vote('${debateId}', '${item.id}', false)"
                 aria-label="Ajouter une voix"
                  title="Ajouter une voix"
                >
                  +
                </button>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }
  }

  if (myArgumentsB) {
    if (!votedArgumentsB.length) {
      myArgumentsB.innerHTML = "";
    } else {
      myArgumentsB.innerHTML = `
        <div class="my-arguments-list">
          ${votedArgumentsB.map((item) => `
            <div class="my-argument-chip">
              <div class="my-argument-chip-text">
                <span class="my-argument-chip-rank">#${item.rank}</span>

                <button
                  type="button"
                  class="my-argument-chip-title-button"
                  onclick="scrollToArgumentFromSummary('${item.id}')"
                  title="Aller à cette idée"
                >
                  ${escapeHtml(item.title)}
                </button>
              </div>

              <div class="my-argument-chip-stepper" aria-label="Modifier les voix de cette idée">
                <button
                  type="button"
                  class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-minus"
                  onclick="unvote('${debateId}', '${item.id}', false)"
                  aria-label="Retirer une voix"
                  title="Retirer une voix"
                >
                  −
                </button>

                <span class="my-argument-chip-count">${item.count}</span>

                <button
                  type="button"
                  class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-plus"
                  onclick="vote('${debateId}', '${item.id}', false)"
                  aria-label="Ajouter une voix"
                  title="Ajouter une voix"
                >
                  +
                </button>
              </div>
            </div>
          `).join("")}
        </div>
      `;
    }
  }
}

/* =========================
   Helpers
========================= */

function getDebateId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("id");
}

async function fetchJSON(url, opt = {}) {
  const r = await fetch(url, opt);
  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    const error = new Error(data.error || "Erreur serveur");
    error.code = data.error;
    error.details = data;
    throw error;
  }

  return data;
}
function highlightVotedArgumentTitles() {
  const titles = document.querySelectorAll(".my-argument-chip-title-button");

  if (!titles.length) return;

  titles.forEach((title) => {
    const card = title.closest(".my-arguments-summary-left")
      ? document.getElementById("column-a") || title
      : document.getElementById("column-b") || title;

    if (title.closest("#my-arguments-a") || title.closest(".my-arguments-summary-left")) {
      title.classList.remove("voice-title-highlight");
      title.classList.remove("voice-title-highlight-green");
      void title.offsetWidth;
      title.classList.add("voice-title-highlight-green");
    } else {
      title.classList.remove("voice-title-highlight");
      title.classList.remove("voice-title-highlight-green");
      void title.offsetWidth;
      title.classList.add("voice-title-highlight");
    }
  });

  setTimeout(() => {
    titles.forEach((title) => {
      title.classList.remove("voice-title-highlight");
      title.classList.remove("voice-title-highlight-green");
    });
  }, 1600);
}
function scrollToVoicesSummary() {
  const voicesSummary = document.getElementById("voices-summary");
  const myArgumentsRow = document.querySelector(".my-arguments-row");
  const myArgumentsA = document.getElementById("my-arguments-a");
  const myArgumentsB = document.getElementById("my-arguments-b");

  const primaryTarget =
    myArgumentsRow ||
    voicesSummary ||
    myArgumentsA ||
    myArgumentsB;

  if (!primaryTarget) return;

  const topbar = document.querySelector(".topbar");

  const getSafeOffset = () => {
    return (topbar ? topbar.offsetHeight : 80) + 90;
  };

  const scrollTargetHigh = () => {
    const rect = primaryTarget.getBoundingClientRect();
    const y = rect.top + window.scrollY - getSafeOffset();

    window.scrollTo({
      top: Math.max(0, y),
      behavior: "smooth"
    });
  };

  scrollTargetHigh();

  setTimeout(() => {
    scrollTargetHigh();
  }, 260);

  setTimeout(() => {
    highlightVotedArgumentTitles();
  }, 420);
}
function applyVoiceHighlight(element) {
  if (!element) return;

  const isGreenSide =
    element.closest(".column-a") ||
    element.closest("#arguments-a") ||
    element.closest(".argument-card-a");

  element.classList.remove("voice-title-highlight");
  element.classList.remove("voice-title-highlight-green");
  void element.offsetWidth;

  if (isGreenSide) {
    element.classList.add("voice-title-highlight-green");
  } else {
    element.classList.add("voice-title-highlight");
  }
}

function removeVoiceHighlight(element) {
  if (!element) return;
  element.classList.remove("voice-title-highlight");
  element.classList.remove("voice-title-highlight-green");
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function setDisplay(element, value) {
  if (element) {
    element.style.display = value;
  }
}

function getKey() {
  let k = localStorage.getItem("key");

  if (!k) {
    k = Math.random().toString(36);
    localStorage.setItem("key", k);
  }

  return k;
}

function isArgumentOwner(argument) {
  if (!argument) return false;
  return String(argument.author_key || "") === String(getKey() || "");
}
function isCommentOwner(comment) {
  if (!comment) return false;
  return String(comment.author_key || "") === String(getKey() || "");
}

function getState(id) {
  const s = localStorage.getItem("votes_" + id);
  if (!s) return {};

  const parsed = JSON.parse(s);

  if (Array.isArray(parsed)) {
    const migrated = {};
    parsed.forEach((argId) => {
      migrated[String(argId)] = 1;
    });
    return migrated;
  }

  return parsed || {};
}

function setState(id, state) {
  localStorage.setItem("votes_" + id, JSON.stringify(state));
}
function cleanVoteStateForExistingArguments(debateId, existingArguments) {
  const state = getState(debateId);
  const validIds = new Set((existingArguments || []).map((arg) => String(arg.id)));
  const cleanedState = {};

  for (const [argId, count] of Object.entries(state)) {
    if (validIds.has(String(argId)) && Number(count || 0) > 0) {
      cleanedState[String(argId)] = Number(count || 0);
    }
  }

  setState(debateId, cleanedState);
  return cleanedState;
}

function getCommentLikeState(id) {
  const s = localStorage.getItem("comment_likes_" + id);
  if (!s) return {};

  const parsed = JSON.parse(s);

  if (Array.isArray(parsed)) {
    const migrated = {};
    parsed.forEach((commentId) => {
      migrated[String(commentId)] = 1;
    });
    return migrated;
  }

  return parsed || {};
}

function setCommentLikeState(id, state) {
  localStorage.setItem("comment_likes_" + id, JSON.stringify(state));
}
function showVoteWarning(message) {
  const existing = document.querySelector(".vote-warning-toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = "vote-warning-toast";
  toast.textContent = message;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add("vote-warning-visible");
  });

  setTimeout(() => {
    toast.classList.remove("vote-warning-visible");

    setTimeout(() => {
      toast.remove();
    }, 250);
  }, 3500);
}
function getVisitedDebateIds() {
  const raw = localStorage.getItem("visited_debates");
  if (!raw) return [];
  return JSON.parse(raw);
}

function saveVisitedDebate(debateId) {
  const id = String(debateId);
  let visited = getVisitedDebateIds();

  visited = visited.filter((item) => String(item) !== id);
  visited.unshift(id);

  localStorage.setItem("visited_debates", JSON.stringify(visited));
}

function formatDebateDate(dateString) {
  if (!dateString) return "";

  const normalized = String(dateString).includes("T")
    ? String(dateString)
    : String(dateString).replace(" ", "T");

  const d = new Date(normalized);

  if (Number.isNaN(d.getTime())) return "";

  const date = d.toLocaleDateString("fr-FR");
  const hour = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });

  return `Publié le ${date} à ${hour}`;
}

function formatLastArgumentDate(dateString) {
  if (!dateString) return "";

  const normalized = String(dateString).includes("T")
    ? String(dateString)
    : String(dateString).replace(" ", "T");

  const d = new Date(normalized);

  if (Number.isNaN(d.getTime())) return "";

  const date = d.toLocaleDateString("fr-FR");
  const hour = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });

return `Dernière idée le ${date} à ${hour}`;}

function getDebateShareUrl() {
  const id = getDebateId();
  return `${window.location.origin}/debate?id=${id}`;
}

function getDebateShareTitle() {
  const titleEl = document.getElementById("debate-question");
  const title = titleEl ? titleEl.textContent.trim() : "Arène sur Agôn";
  return title || "Arène sur Agôn";
}


function getDebateShareText() {
  const question = currentDebateShareData.question || getDebateShareTitle();
  const optionA = currentDebateShareData.optionA || "";
  const optionB = currentDebateShareData.optionB || "";
  const percentA = currentDebateShareData.percentA ?? 50;
  const percentB = currentDebateShareData.percentB ?? 50;

  return [
    question,
    "",
    `${percentA}% — ${optionA}`,
    `${percentB}% — ${optionB}`,
    "",
"Qu’est-ce qui vous paraît le plus convaincant ?\n→"
  ].join("\n");
}
async function copyDebateLink() {
  const { text, url } = getGlobalShareData();
const fullText = `${text} ${url}`;
  try {
    await navigator.clipboard.writeText(fullText);
    alert("Lien copié.");
  } catch (error) {
    alert("Impossible de copier le lien automatiquement.");
  }
}

/* =========================
   Share
========================= */


function shareOnX() {
  const { text, url } = getGlobalShareData();
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareOnFacebook() {
  const { url } = getGlobalShareData();
  const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareOnWhatsApp() {
  const { text, url } = getGlobalShareData();
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(text + " " + url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareByEmail() {
  const { title, text, url } = getGlobalShareData();
const body = `${text} ${url}`;
  window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

async function shareOnInstagram() {
  const { url } = getGlobalShareData();

  try {
    await navigator.clipboard.writeText(url);
    alert("Lien copié. Collez-le dans votre story, votre bio ou votre publication Instagram.");
  } catch (error) {
    alert("Impossible de copier automatiquement. Copiez ce lien pour Instagram : " + url);
  }
}
function getGlobalShareData() {
  const path = window.location.pathname;

  if (path === "/debate") {
    return {
      title: getDebateShareTitle(),
      text: getDebateShareText(),
      url: getDebateShareUrl()
    };
  }

  if (path === "/create") {
    return {
      title: "Ouvrir une arène sur Agôn",
      text: [
        "Ouvrir une arène sur Agôn.",
        "",
        `Qu’est-ce qui vous paraît le plus convaincant ?`
      ].join("\n"),
      url: `${window.location.origin}/create`
    };
  }

  return {
    title: "Agôn, la plateforme de confrontation d'idées",
    text: [
      "Découvrez Agôn.",
      "",
     `Qu’est-ce qui vous paraît le plus convaincant ?`
    ].join("\n"),
    url: `${window.location.origin}/`
  };
}
function renderGlobalShareBar() {
  const container = document.getElementById("global-share-bar");
  if (!container) return;

  container.innerHTML = `
    <div class="share-bar share-bar-top">
      <button class="share-button share-button-copy" type="button" onclick="copyDebateLink()">
        <i class="fa-solid fa-link"></i> Copier
      </button>

      <button class="share-button share-x" type="button" onclick="shareOnX()">
        <i class="fa-brands fa-x-twitter"></i> X
      </button>

      <button class="share-button share-facebook" type="button" onclick="shareOnFacebook()">
        <i class="fa-brands fa-facebook"></i> Facebook
      </button>

      <button class="share-button share-whatsapp" type="button" onclick="shareOnWhatsApp()">
        <i class="fa-brands fa-whatsapp"></i> WhatsApp
      </button>

      <button class="share-button share-email" type="button" onclick="shareByEmail()">
        <i class="fa-solid fa-envelope"></i> Email
      </button>

      <button class="share-button share-instagram" type="button" onclick="shareOnInstagram()">
        <i class="fa-brands fa-instagram"></i> Instagram
      </button>
    </div>
  `;
}
function getIndexDebateShareData(debateId, question, optionA = "", optionB = "", percentA = 50, percentB = 50, type = "debate") {
  const url = `${window.location.origin}/debate?id=${debateId}`;
  const title = question || "Arène sur Agôn";
  const isOpen = String(type || "debate") === "open";

  const text = isOpen
    ? [
        title,
        "",
"Qu’est-ce qui vous paraît le plus convaincant ?\n→"
      ].join("\n")
    : [
        title,
        "",
        `${percentA}%`,
        optionA || "Position A",
        "",
        `${percentB}%`,
        optionB || "Position B",
        "",
       
"Qu’est-ce qui vous paraît le plus convaincant ?\n→"
      ].join("\n");

  return { url, title, text };
}
async function copyIndexDebateLink(
  debateId,
  encodedQuestion,
  encodedOptionA = "",
  encodedOptionB = "",
  percentA = 50,
  percentB = 50,
  type = "debate"
) {
  const question = decodeURIComponent(encodedQuestion || "");
  const optionA = decodeURIComponent(encodedOptionA || "");
  const optionB = decodeURIComponent(encodedOptionB || "");

  const { text, url } = getIndexDebateShareData(
    debateId,
    question,
    optionA,
    optionB,
    percentA,
    percentB,
    type
  );

const fullText = `${text} ${url}`;
  try {
    await navigator.clipboard.writeText(fullText);
    alert("Lien copié.");
  } catch (error) {
    alert("Impossible de copier le lien automatiquement.");
  }
}

function shareIndexDebateOnX(debateId, encodedQuestion, encodedOptionA = "", encodedOptionB = "", percentA = 50, percentB = 50, type = "debate") {
  const question = decodeURIComponent(encodedQuestion || "");
  const optionA = decodeURIComponent(encodedOptionA || "");
  const optionB = decodeURIComponent(encodedOptionB || "");
  const { text, url } = getIndexDebateShareData(debateId, question, optionA, optionB, percentA, percentB, type);
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareIndexDebateOnFacebook(debateId) {
  const { url } = getIndexDebateShareData(debateId, "");
  const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareIndexDebateOnWhatsApp(debateId, encodedQuestion, encodedOptionA = "", encodedOptionB = "", percentA = 50, percentB = 50, type = "debate") {
  const question = decodeURIComponent(encodedQuestion || "");
  const optionA = decodeURIComponent(encodedOptionA || "");
  const optionB = decodeURIComponent(encodedOptionB || "");
  const { text, url } = getIndexDebateShareData(debateId, question, optionA, optionB, percentA, percentB, type);
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(text + " " + url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareIndexDebateByEmail(debateId, encodedQuestion, encodedOptionA = "", encodedOptionB = "", percentA = 50, percentB = 50, type = "debate") {
  const question = decodeURIComponent(encodedQuestion || "");
  const optionA = decodeURIComponent(encodedOptionA || "");
  const optionB = decodeURIComponent(encodedOptionB || "");
  const { title, text, url } = getIndexDebateShareData(debateId, question, optionA, optionB, percentA, percentB, type);
const body = `${text} ${url}`;

  window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
/* =========================
   Comment visibility
========================= */

const openCommentsByArgument = {};
const visibleCommentsByArgument = {};
const replyToCommentByArgument = {};
/* =========================
   Admin
========================= */

function getAdminToken() {
  return localStorage.getItem("admin_token");
}

function isAdmin() {
  return !!getAdminToken();
}

function setAdminToken(token) {
  localStorage.setItem("admin_token", token);
}

function clearAdminToken() {
  localStorage.removeItem("admin_token");
}

function refreshAdminUI() {

  const loginBtn = document.getElementById("admin-login-btn");
  const logoutBtn = document.getElementById("admin-logout-btn");
  const badge = document.getElementById("admin-badge");

  if (loginBtn) {
    loginBtn.style.display = isAdmin() ? "none" : "inline-block";
  }

  if (logoutBtn) {
    logoutBtn.style.display = isAdmin() ? "inline-block" : "none";
  }

  if (badge) {
    badge.style.display = isAdmin() ? "inline-flex" : "none";
  }

  document.querySelectorAll("[data-admin]").forEach(el => {
    el.style.display = isAdmin() ? "" : "none";
  });

}

async function adminLogin() {
  const password = window.prompt("Mot de passe admin :");
  if (!password) return;

  try {
    const result = await fetchJSON(API + "/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password })
    });

    setAdminToken(result.token);
    refreshAdminUI();
    location.reload();
  } catch (error) {
    alert(error.message);
  }
}

async function adminLogout() {
  const token = getAdminToken();
  if (!token) return;

  try {
    const result = await fetchJSON(API + "/admin/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": token
      }
    });

    if (result.error) {
      alert(result.error);
      return;
    }

    clearAdminToken();
    refreshAdminUI();
    location.reload();
  } catch (error) {
    alert(error.message);
  }
}

function attachAdminButtons() {
  const loginBtn = document.getElementById("admin-login-btn");
  const logoutBtn = document.getElementById("admin-logout-btn");

  if (loginBtn) {
    loginBtn.addEventListener("click", adminLogin);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", adminLogout);
  }

  refreshAdminUI();
}
/* =========================
   Notifications
========================= */

async function resetNotifications() {
  try {
    await fetchJSON(API + "/notifications/read-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userKey: getKey()
      })
    });

    await loadNotifications();
    await loadNotificationsPage();
  } catch (error) {
    alert(error.message);
  }
}
function updateNotificationBadgeElement(element, unreadCount) {
  if (!element) return;

  if (unreadCount > 0) {
    element.style.display = "inline-flex";
    element.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
  } else {
    element.style.display = "none";
    element.textContent = "";
  }
}
async function loadNotifications() {
  const badge = document.getElementById("notifications-count");
  const compactBadge = document.getElementById("notifications-count-compact");
  const list = document.getElementById("notifications-list");

  if (!badge && !compactBadge) return;

  try {
    const notifications = await fetchJSON(API + "/notifications?userKey=" + encodeURIComponent(getKey()));
const previousCount = Number(localStorage.getItem("notif_count") || 0);
const unreadCount = notifications.filter((n) => Number(n.is_read) === 0).length;

if (unreadCount > previousCount) {
  const bell = document.getElementById("notifications-bell");

  if (bell) {
    bell.classList.add("notif-shake");

    setTimeout(() => {
      bell.classList.remove("notif-shake");
    }, 700);
  }
}

localStorage.setItem("notif_count", unreadCount);

updateNotificationBadgeElement(badge, unreadCount);
updateNotificationBadgeElement(compactBadge, unreadCount);

   if (!notifications.length) {
  if (list) {
    list.innerHTML = `<div class="empty-state">Aucune notification.</div>`;
  }
  return;
}

if (list) {
  list.innerHTML = notifications.map((notification) => {
let link = "#";
let icon = "🔔";
let title = notification.message || "Nouvelle notification";
let subtitle = "Ouvrir";

if (notification.type === "replacement_accepted" && notification.argument_id) {
  link = `/debate?id=${notification.debate_id}&highlight=argument-${notification.argument_id}`;
} else if (notification.comment_id) {
  link = `/debate?id=${notification.debate_id}&highlight=comment-${notification.comment_id}`;
} else if (notification.argument_id) {
  link = `/debate?id=${notification.debate_id}&highlight=argument-${notification.argument_id}`;
} else if (notification.debate_id) {
  link = `/debate?id=${notification.debate_id}&highlight=debate`;
}

    if (notification.type === "vote_on_argument") {
      icon = "👍";
      title = "Votre idée a reçu une voix";
      subtitle = "Ouvrir l'idée";
    }

    if (notification.type === "comment_on_argument") {
      icon = "💬";
      title = "Quelqu’un a commenté votre idée";
      subtitle = "Ouvrir le commentaire";
    }

    if (notification.type === "argument_in_my_debate") {
      icon = "🧠";
      title = "Une nouvelle idée a été postée dans votre arène";
      subtitle = "Ouvrir l'arène";
    }

  if (notification.type === "like_on_comment") {
  icon = "👍";
  title = "Votre commentaire a reçu un pouce vers le haut";
  subtitle = "Ouvrir le commentaire";
}

if (notification.type === "dislike_on_comment") {
  icon = "👎";
  title = "Votre commentaire a reçu un pouce vers le bas";
  subtitle = "Ouvrir le commentaire";
}
if (notification.type === "replacement_accepted") {
  icon = "🏆";
  title = "Ta proposition de remplacement a été acceptée";
  subtitle = "Ouvrir l'idée remplacée";
}
if (notification.type === "reply_to_comment") {
  icon = "↩️";
  title = "Quelqu’un a répondu à votre commentaire";
  subtitle = "Ouvrir la réponse";
}
  return `
 <a
  class="notification-item ${Number(notification.is_read) === 0 ? "notification-item-unread" : ""}"
  href="${link}"
  onclick="handleNotificationClick(event, '${notification.id}', '${link}')"
>
        <div class="notification-top">
          <span class="notification-icon">${icon}</span>
          <div class="notification-texts">
            <div class="notification-title">${escapeHtml(title)}</div>
            <div class="notification-subtitle">${escapeHtml(subtitle)}</div>
          </div>
        </div>
        <div class="notification-date">${escapeHtml(formatDebateDate(notification.created_at))}</div>
      </a>
    `;
  }).join("");
}
} catch (error) {
  if (list) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}
}

async function markNotificationsAsRead() {
  try {
    await fetchJSON(API + "/notifications/read-all", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userKey: getKey()
      })
    });

    await loadNotifications();
  } catch (error) {
    alert(error.message);
  }
}
async function markOneNotificationAsRead(notificationId) {
  try {
    await fetchJSON(API + "/notifications/read-one", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        userKey: getKey(),
        notificationId
      })
    });

    await loadNotifications();
  } catch (error) {
    alert(error.message);
  }
}
async function handleNotificationClick(event, notificationId, link) {
  event.preventDefault();

  try {
    await markOneNotificationAsRead(notificationId);
    window.location.href = link;
  } catch (error) {
    window.location.href = link;
  }
}

function toggleNotificationsPanel() {
  window.location.href = "/notifications";
}
/* =========================
   Admin reports
========================= */

async function loadReportsBadge() {
  if (!isAdmin()) return;

  const badge = document.getElementById("reports-count");
  if (!badge) return;

  try {
    const reports = await fetchJSON(API + "/admin/reports", {
      headers: {
        "x-admin-token": getAdminToken()
      }
    });

    const count = Array.isArray(reports) ? reports.length : 0;

    if (count > 0) {
      badge.style.display = "inline-flex";
      badge.textContent = count > 9 ? "9+" : String(count);
    } else {
      badge.style.display = "none";
      badge.textContent = "";
    }
  } catch (error) {
    console.error(error);
  }
}

async function initAdminReports() {
  const container = document.getElementById("reports-list");
  const badge = document.getElementById("reports-count");

  const totalVisitsEl = document.getElementById("total-visits-today");
  const uniqueVisitorsEl = document.getElementById("unique-visitors-today");

  if (!container) return;

  if (!isAdmin()) {
    container.innerHTML = `<div class="empty-state">Mode admin requis.</div>`;
    return;
  }

  try {
    const visitsStats = await fetchJSON(API + "/admin/visits/today", {
      headers: {
        "x-admin-token": getAdminToken()
      }
    });

    if (totalVisitsEl) {
      totalVisitsEl.textContent = String(visitsStats.total_visits_today || 0);
    }

    if (uniqueVisitorsEl) {
      uniqueVisitorsEl.textContent = String(visitsStats.unique_visitors_today || 0);
    }

    const reports = await fetchJSON(API + "/admin/reports", {
      headers: {
        "x-admin-token": getAdminToken()
      }
    });

    localStorage.setItem("admin_reports_count", reports.length);

    if (badge) {
      if (reports.length > 0) {
        badge.style.display = "inline-flex";
        badge.textContent = reports.length > 9 ? "9+" : String(reports.length);
      } else {
        badge.style.display = "none";
        badge.textContent = "";
      }
    }

    if (!reports.length) {
      container.innerHTML = `<div class="empty-state">Aucun signalement pour le moment.</div>`;
      return;
    }

    container.innerHTML = reports.map((report) => {
      const typeLabel =
        report.target_type === "debate"
          ? "Arène"
          : report.target_type === "argument"
            ? "Idée"
            : "Commentaire";

 const reasonLabel =
  report.reason === "inapproprie"
    ? "Propos inappropriés"
    : report.reason === "doublon"
      ? "Doublon / déjà existant"
      : report.reason === "plusieurs_arguments"
        ? "Plusieurs idées développés"
        : "Motif inconnu";

      const targetTitle =
        report.target_type === "debate"
          ? (report.debate_question || "Arène introuvable")
          : report.target_type === "argument"
            ? (report.argument_title || "Idée introuvable")
            : "Commentaire signalé";

      const targetBody =
        report.target_type === "argument"
          ? (report.argument_body || "")
          : report.target_type === "comment"
            ? (report.comment_content || "")
            : "";

      const viewLink =
        report.target_type === "debate"
          ? `/debate?id=${report.target_id}&highlight=debate`
          : report.target_type === "argument"
            ? (report.argument_debate_id
                ? `/debate?id=${report.argument_debate_id}&highlight=argument-${report.target_id}`
                : "#")
            : (report.comment_debate_id
                ? `/debate?id=${report.comment_debate_id}&highlight=comment-${report.target_id}`
                : "#");

      return `
        <article class="debate-card">
          <div class="debate-card-category">${typeLabel}</div>
          <h2>${escapeHtml(targetTitle)}</h2>
          <p><strong>Motif :</strong> ${reasonLabel}</p>
          <p><strong>ID ciblé :</strong> ${report.target_id}</p>
          <p><strong>Signalements :</strong> ${report.report_count}</p>
          ${
            targetBody
              ? `<p>${escapeHtml(targetBody.length > 220 ? targetBody.slice(0, 220) + "…" : targetBody)}</p>`
              : ""
          }
          <p class="debate-date">${escapeHtml(formatDebateDate(report.last_report_at))}</p>

          <div class="debate-card-actions">
            ${
              viewLink !== "#"
                ? `<a class="button button-small" href="${viewLink}">Voir</a>`
                : ""
            }

            <button
              class="delete-button"
              type="button"
              onclick="deleteReportedTarget('${report.target_type}', '${report.target_id}')"
            >
            Supprimer ${report.target_type === "debate" ? "Arène" : report.target_type === "argument" ? "idée" : "commentaire"}
            </button>

            <button
              class="button button-small"
              type="button"
              onclick="deleteReport('${report.target_type}', '${report.target_id}')"
            >
              Supprimer le signalement
            </button>
          </div>
        </article>
      `;
    }).join("");
  } catch (error) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}
/* =========================
   Index
========================= */

let debatesCache = [];
let visitedDebatesCache = [];
let otherDebatesCache = [];
let visitedDebatesVisible = 5;
let otherDebatesVisible = 6;


function renderVisitedDebatesList(debates) {
  const section = document.getElementById("visited-debates-section");
  const div = document.getElementById("visited-debates-list");

  if (!section || !div) return;

  if (!debates.length) {
    section.style.display = "none";
    div.innerHTML = "";
    return;
  }

  section.style.display = "block";

  const debatesToShow = debates.slice(0, visitedDebatesVisible);

  div.innerHTML = debatesToShow.map(d => {
    const debateTypeLabel = isOpenDebate(d) ? "Question ouverte" : "Débat";

    return `
      <article class="debate-card">
        <a class="debate-card-link" href="/debate?id=${d.id}">
          <div class="debate-card-category">${escapeHtml(d.category || "Sans catégorie")}</div>
          <div class="debate-card-type">${debateTypeLabel}</div>
          <h2>${escapeHtml(d.question)}</h2>

         ${
  isOpenDebate(d)
    ? ""
    : `
      <div class="debate-card-positions">
        <span class="pos-a">${escapeHtml(d.option_a || "Position A")}</span>
        <span class="pos-b">${escapeHtml(d.option_b || "Position B")}</span>
      </div>

      <div class="debate-card-score">
        <div class="score-bar">
          <div class="score-a" style="width:${d.percent_a ?? 50}%"></div>
          <div class="score-b" style="width:${d.percent_b ?? 50}%"></div>
        </div>

        <div class="score-labels">
          <span>${d.percent_a ?? 50}%</span>
          <span>${d.percent_b ?? 50}%</span>
        </div>
      </div>
    `
}

          <p>${d.argument_count || 0} idée(s)</p>
          <p class="debate-date">${escapeHtml(formatDebateDate(d.created_at))}</p>
          ${d.last_argument_at ? `<p class="debate-last-argument">${escapeHtml(formatLastArgumentDate(d.last_argument_at))}</p>` : ""}
        </a>

        <div class="debate-card-actions">
          <div class="debate-card-share-actions">
            <button
              class="share-icon-button"
              type="button"
              onclick="copyIndexDebateLink('${d.id}', '${encodeURIComponent(String(d.question || ""))}')"
              title="Copier le lien"
            >
              <i class="fa-solid fa-link"></i>
            </button>

            <button
              class="share-icon-button"
              type="button"
         onclick="shareIndexDebateOnX(
  '${d.id}',
  '${encodeURIComponent(String(d.question || ""))}',
  '${encodeURIComponent(String(d.option_a || ""))}',
  '${encodeURIComponent(String(d.option_b || ""))}',
  '${d.percent_a ?? 50}',
  '${d.percent_b ?? 50}',
  '${encodeURIComponent(String(d.type || "debate"))}'
)"
              title="Partager sur X"
            >
              <i class="fa-brands fa-x-twitter"></i>
            </button>

            <button
              class="share-icon-button"
              type="button"
              onclick="shareIndexDebateOnFacebook('${d.id}')"
              title="Partager sur Facebook"
            >
              <i class="fa-brands fa-facebook"></i>
            </button>

            <button
              class="share-icon-button"
              type="button"
             onclick="shareIndexDebateOnWhatsApp(
  '${d.id}',
  '${encodeURIComponent(String(d.question || ""))}',
  '${encodeURIComponent(String(d.option_a || ""))}',
  '${encodeURIComponent(String(d.option_b || ""))}',
  '${d.percent_a ?? 50}',
  '${d.percent_b ?? 50}',
  '${encodeURIComponent(String(d.type || "debate"))}'
)"
              title="Partager sur WhatsApp"
            >
              <i class="fa-brands fa-whatsapp"></i>
            </button>

            <button
              class="share-icon-button"
              type="button"
             onclick="shareIndexDebateByEmail(
  '${d.id}',
  '${encodeURIComponent(String(d.question || ""))}',
  '${encodeURIComponent(String(d.option_a || ""))}',
  '${encodeURIComponent(String(d.option_b || ""))}',
  '${d.percent_a ?? 50}',
  '${d.percent_b ?? 50}',
  '${encodeURIComponent(String(d.type || "debate"))}'
)"
              title="Partager par email"
            >
              <i class="fa-solid fa-envelope"></i>
            </button>
          </div>

          <button
            class="report-button"
            type="button"
            onclick="openReportBox('debate', '${d.id}')"
          >
            Signaler
          </button>

          <div data-admin style="display:none;">
            <button class="delete-button" onclick="deleteDebate('${d.id}', false)">Supprimer</button>
          </div>
        </div>
      </article>
    `;
  }).join("");

  if (debatesToShow.length < debates.length) {
    div.innerHTML += `
      <div class="load-more-container">
        <button class="button button-small" type="button" onclick="loadMoreVisitedDebates()">
          Découvrir plus d'arènes
        </button>
      </div>
    `;
  }

  refreshAdminUI();
}
   
function loadMoreVisitedDebates() {
  visitedDebatesVisible += 5;
  renderVisitedDebatesList(visitedDebatesCache);
}
function renderDebatesList(debates) {
  const debatesToShow = debates.slice(0, otherDebatesVisible);
  const div = document.getElementById("debates-list");
  if (!div) return;

  if (!debates.length) {
    div.innerHTML = `<div class="empty-state">Aucune arène ne correspond à votre recherche.</div>`;
    refreshAdminUI();
    return;
  }

div.innerHTML = debatesToShow.map(d => {
  const debateTypeLabel = isOpenDebate(d) ? "Question ouverte" : "Débat";

  return `
    <article class="debate-card">
      <a class="debate-card-link" href="/debate?id=${d.id}">
        <div class="debate-card-category">${escapeHtml(d.category || "Sans catégorie")}</div>
        <div class="debate-card-type">${debateTypeLabel}</div>
        <h2>${escapeHtml(d.question)}</h2>

${
  isOpenDebate(d)
    ? ""
    : `
      <div class="debate-card-positions">
        <span class="pos-a">${escapeHtml(d.option_a || "Position A")}</span>
        <span class="pos-b">${escapeHtml(d.option_b || "Position B")}</span>
      </div>

      <div class="debate-card-score">
        <div class="score-bar">
          <div class="score-a" style="width:${d.percent_a ?? 50}%"></div>
          <div class="score-b" style="width:${d.percent_b ?? 50}%"></div>
        </div>

        <div class="score-labels">
          <span>${d.percent_a ?? 50}%</span>
          <span>${d.percent_b ?? 50}%</span>
        </div>
      </div>
    `
}

        <p>${d.argument_count || 0} idée(s)</p>
        <p class="debate-date">${escapeHtml(formatDebateDate(d.created_at))}</p>
        ${d.last_argument_at ? `<p class="debate-last-argument">${escapeHtml(formatLastArgumentDate(d.last_argument_at))}</p>` : ""}
      </a>

      <div class="debate-card-actions">
        <div class="debate-card-share-actions">
          <button
            class="share-icon-button"
            type="button"
onclick="copyIndexDebateLink('${d.id}', '${encodeURIComponent(String(d.question || ""))}')"            title="Copier le lien"
          >
            <i class="fa-solid fa-link"></i>
          </button>

          <button
            class="share-icon-button"
            type="button"
onclick="shareIndexDebateOnX('${d.id}', '${encodeURIComponent(String(d.question || ""))}')"            title="Partager sur X"
          >
            <i class="fa-brands fa-x-twitter"></i>
          </button>

          <button
            class="share-icon-button"
            type="button"
onclick="shareIndexDebateOnFacebook('${d.id}')"            title="Partager sur Facebook"
          >
            <i class="fa-brands fa-facebook"></i>
          </button>

          <button
            class="share-icon-button"
            type="button"
onclick="shareIndexDebateOnWhatsApp('${d.id}', '${encodeURIComponent(String(d.question || ""))}')"            title="Partager sur WhatsApp"
          >
            <i class="fa-brands fa-whatsapp"></i>
          </button>

          <button
            class="share-icon-button"
            type="button"
onclick="shareIndexDebateByEmail('${d.id}', '${encodeURIComponent(String(d.question || ""))}')"            title="Partager par email"
          >
            <i class="fa-solid fa-envelope"></i>
          </button>
        </div>

        <button
          class="report-button"
          type="button"
          onclick="openReportBox('debate', '${d.id}')"
        >
          Signaler
        </button>

        <div data-admin style="display:none;">
          <button class="delete-button" onclick="deleteDebate('${d.id}', false)">Supprimer</button>
        </div>
      </div>
    </article>
  `;
}).join("");

 if (debatesToShow.length < debates.length) {
  div.innerHTML += `
    <div class="load-more-container">
      <button class="button button-small" type="button" onclick="loadMoreOtherDebates()">
        Découvrir plus d'arènes
      </button>
    </div>
  `;
}

  refreshAdminUI();
}
function loadMoreOtherDebates() {
  otherDebatesVisible += 6;
  renderDebatesList(otherDebatesCache);
}
function filterDebates() {
  const input = document.getElementById("debate-search");
  if (!input) return;
  visitedDebatesVisible = 5;
  otherDebatesVisible = 6;
  const query = input.value.trim().toLowerCase();

  if (!query) {
setTypeFilter("all");    return;
  }

  const filtered = debatesCache.filter((d) => {
    const question = String(d.question || "").toLowerCase();
    const category = String(d.category || "").toLowerCase();
    const optionA = String(d.option_a || "").toLowerCase();
    const optionB = String(d.option_b || "").toLowerCase();

    return (
      question.includes(query) ||
      category.includes(query) ||
      optionA.includes(query) ||
      optionB.includes(query)
    );
  });

  updateIndexLists(filtered);
}

function setTypeFilter(type) {
  currentTypeFilter = type;

  document.getElementById("filter-all")?.classList.remove("active");
  document.getElementById("filter-debate")?.classList.remove("active");
  document.getElementById("filter-question")?.classList.remove("active");

  if (type === "all") {
    document.getElementById("filter-all")?.classList.add("active");
  }

  if (type === "debate") {
    document.getElementById("filter-debate")?.classList.add("active");
  }

  if (type === "question") {
    document.getElementById("filter-question")?.classList.add("active");
  }

  visitedDebatesVisible = 5;
  otherDebatesVisible = 6;

  updateIndexLists(debatesCache);
}

function updateIndexLists(debates) {
  const visitedIds = getVisitedDebateIds().map(String);

  let filteredDebates = debates;

  if (currentTypeFilter === "debate") {
    filteredDebates = debates.filter((d) => !isOpenDebate(d));
  }

  if (currentTypeFilter === "question") {
    filteredDebates = debates.filter((d) => isOpenDebate(d));
  }

  visitedDebatesCache = filteredDebates.filter((d) => visitedIds.includes(String(d.id)));
  otherDebatesCache = filteredDebates.filter((d) => !visitedIds.includes(String(d.id)));

  renderVisitedDebatesList(visitedDebatesCache);
  renderDebatesList(otherDebatesCache);
}
async function initIndex() {
  try {
    const debates = await fetchJSON(API + "/debates");
    debatesCache = debates;
    visitedDebatesVisible = 5;
    otherDebatesVisible = 6;

    updateIndexLists(debatesCache);

  setTypeFilter("all");

    const searchInput = document.getElementById("debate-search");
    if (searchInput) {
      searchInput.addEventListener("input", filterDebates);
    }
  } catch (error) {
    alert(error.message);
  }
}

/* =========================
   Create
========================= */

async function initCreate() {
  const form = document.getElementById("create-form");
  if (!form) return;

  const questionInput = document.getElementById("question");
  const similarBox = document.getElementById("similar-debates-box");
  const similarList = document.getElementById("similar-debates-list");
const typeInputs = document.querySelectorAll('input[name="debate-type"]');

  let debatesForSimilarity = [];

  try {
    debatesForSimilarity = await fetchJSON(API + "/debates");
  } catch (error) {
    debatesForSimilarity = [];
  }


  function renderSimilarDebates(query) {
    if (!questionInput || !similarBox || !similarList) return;

    const normalizedQuery = normalizeText(query);

    if (normalizedQuery.length < 3) {
      similarBox.style.display = "none";
      similarList.innerHTML = "";
      return;
    }

    const words = normalizedQuery.split(/\s+/).filter(Boolean);

    const matches = debatesForSimilarity
      .map((debate) => {
        const normalizedQuestion = normalizeText(debate.question);
        let score = 0;

        for (const word of words) {
          if (normalizedQuestion.includes(word)) {
            score += 1;
          }
        }

        if (normalizedQuestion.includes(normalizedQuery)) {
          score += 3;
        }

        return { debate, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    if (!matches.length) {
      similarBox.style.display = "none";
      similarList.innerHTML = "";
      return;
    }

    similarBox.style.display = "block";
    similarList.innerHTML = matches.map(({ debate }) => `
      <a class="similar-debate-item" href="/debate?id=${debate.id}" target="_blank" rel="noopener noreferrer">
        <div class="similar-debate-question">${escapeHtml(debate.question)}</div>
        <div class="similar-debate-meta">
          ${escapeHtml(debate.category || "Sans catégorie")} · ${debate.argument_count || 0} idée(s)
        </div>
      </a>
    `).join("");
  }
if (typeInputs.length) {
  typeInputs.forEach((input) => {
    input.addEventListener("change", updateCreateTypeUI);
  });

  updateCreateTypeUI();
}
  if (questionInput) {
    questionInput.addEventListener("input", (e) => {
      renderSimilarDebates(e.target.value);
    });
  }

  form.addEventListener("submit", async e => {
    e.preventDefault();

const question = document.getElementById("question").value.trim();
const category = document.getElementById("category").value.trim();
const source_url = document.getElementById("source_url").value.trim();
const selectedType =
  document.querySelector('input[name="debate-type"]:checked')?.value || "debate";

const option_a = selectedType === "open"
  ? ""
  : document.getElementById("option_a").value.trim();

const option_b = selectedType === "open"
  ? ""
  : document.getElementById("option_b").value.trim();

    try {
      const r = await fetchJSON(API + "/debates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
body: JSON.stringify({
  question,
  category,
  source_url,
  type: selectedType,
  option_a,
  option_b,
  creatorKey: getKey()
})
      });

      location = "/debate?id=" + r.id;
    } catch (error) {
      alert(error.message);
    }
  });
}
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
  .trim();
}
function getMeaningfulWords(text) {
  const stopWords = new Set([
    "a", "à", "au", "aux", "de", "des", "du", "la", "le", "les", "un", "une",
    "et", "ou", "en", "sur", "pour", "par", "dans", "avec", "sans", "que",
    "qui", "quoi", "est", "sont", "etre", "avoir", "il", "elle", "on", "nous",
    "vous", "ils", "elles", "ne", "pas", "plus", "moins", "se", "ce", "cet",
    "cette", "ces", "son", "sa", "ses", "leur", "leurs", "mon", "ma", "mes",
    "ton", "ta", "tes", "d", "l", "y"
  ]);

  return normalizeText(text)
    .split(" ")
    .filter((word) => word.length >= 4 && !stopWords.has(word));
}

function countCommonWords(wordsA, wordsB) {
  const setB = new Set(wordsB);
  return [...new Set(wordsA)].filter((word) => setB.has(word)).length;
}

function countCommonBigrams(wordsA, wordsB) {
  const bigramsA = [];
  const bigramsB = new Set();

  for (let i = 0; i < wordsA.length - 1; i++) {
    bigramsA.push(`${wordsA[i]} ${wordsA[i + 1]}`);
  }

  for (let i = 0; i < wordsB.length - 1; i++) {
    bigramsB.add(`${wordsB[i]} ${wordsB[i + 1]}`);
  }

  return [...new Set(bigramsA)].filter((bigram) => bigramsB.has(bigram)).length;
}
function getArgumentSimilarityScore(inputText, argument) {
  const sourceWords = getMeaningfulWords(inputText);
  const titleWords = getMeaningfulWords(argument.title || "");
  const bodyWords = getMeaningfulWords(argument.body || "");
  const candidateWords = [...new Set([...titleWords, ...bodyWords])];

  if (sourceWords.length === 0 || candidateWords.length === 0) {
    return 0;
  }

  const commonWords = countCommonWords(sourceWords, candidateWords);

  if (commonWords < 2) {
    return 0;
  }

  return commonWords;
}



function renderSimilarArgumentsForForm(formKey) {
  const isList = formKey === "list";

  const titleInput = document.getElementById(isList ? "list-title" : `${formKey}-title`);
  const bodyInput = document.getElementById(isList ? "list-body" : `${formKey}-body`);
  const box = document.getElementById(`similar-arguments-${formKey}`);

  if (!titleInput || !bodyInput || !box) return;

  const text = `${titleInput.value || ""} ${bodyInput.value || ""}`.trim();
  const normalizedText = normalizeText(text);

  if (normalizedText.length < 4) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  const matches = (currentAllArguments || [])
    .map((argument) => ({
      argument,
      score: getArgumentSimilarityScore(text, argument)
    }))
.filter((item) => item.score >= 2)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return Number(b.argument.votes || 0) - Number(a.argument.votes || 0);
    })
    .slice(0, 5);

  if (!matches.length) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";
  box.innerHTML = `
<div class="similar-arguments-title">Idées similaires déjà publiées :</div>    <div class="similar-arguments-list">
      ${matches.map(({ argument, score }) => `
        <button
          type="button"
          class="similar-argument-item"
          onclick="scrollToArgumentFromSummary('${argument.id}')"
        >
          <div class="similar-argument-item-title">${escapeHtml(argument.title || "Idée sans titre")}</div>
       
          ${
            argument.body
              ? `<div class="similar-argument-item-body">${escapeHtml(
                  argument.body.length > 140 ? argument.body.slice(0, 140) + "…" : argument.body
                )}</div>`
              : ""
          }
        </button>
      `).join("")}
    </div>
  `;
}

function hideSimilarArgumentsForForm(formKey) {
  const box = document.getElementById(`similar-arguments-${formKey}`);
  if (!box) return;

  box.style.display = "none";
  box.innerHTML = "";
}

function renderSimilarArgumentsForSide(side) {
  const normalizedSide = side === "B" ? "b" : side === "A" ? "a" : side;
  renderSimilarArgumentsForForm(normalizedSide);
}

function renderSimilarArgumentsForList() {
  renderSimilarArgumentsForForm("list");
}

function hideSimilarArgumentsForSide(side) {
  const normalizedSide = side === "B" ? "b" : side === "A" ? "a" : side;
  hideSimilarArgumentsForForm(normalizedSide);
}

function renderBottomSimilarDebates(currentDebate, debates) {
  const container = document.getElementById("similar-debates-bottom");
  if (!container) return;

  const currentId = Number(currentDebate.id);
  const currentQuestion = normalizeText(currentDebate.question);
  const currentCategory = normalizeText(currentDebate.category);
  const words = currentQuestion.split(/\s+/).filter(Boolean);

  const smallWords = new Set([
    "a", "à", "au", "aux", "de", "des", "du", "la", "le", "les", "un", "une",
    "et", "ou", "en", "sur", "pour", "par", "dans", "avec", "sans", "que",
    "qui", "quoi", "est", "il", "elle", "on", "ne", "pas", "plus"
  ]);

  const usefulWords = words.filter((word) => word.length >= 4 && !smallWords.has(word));

  const matches = debates
    .filter((debate) => Number(debate.id) !== currentId)
    .map((debate) => {
      const debateQuestion = normalizeText(debate.question);
      const debateCategory = normalizeText(debate.category);

      let score = 0;

      if (currentCategory && debateCategory && currentCategory === debateCategory) {
        score += 3;
      }

      for (const word of usefulWords) {
        if (debateQuestion.includes(word)) {
          score += 1;
        }
      }

      if (currentQuestion && debateQuestion.includes(currentQuestion)) {
        score += 4;
      }

      return { debate, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  if (!matches.length) {
    container.innerHTML = `<div class="empty-state">Aucune arène similaire pour le moment.</div>`;
    return;
  }

  if (!similarDebatesVisible) {
    container.innerHTML = `
      <div class="similar-debates-toggle-wrap">
        <button
          type="button"
          class="button button-small similar-debates-toggle-btn"
          onclick="toggleSimilarDebates()"
        >
          Découvrir des arènes similaires
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="similar-debates-toggle-wrap">
      <button
        type="button"
        class="button button-small similar-debates-toggle-btn"
        onclick="toggleSimilarDebates()"
      >
        Masquer les arènes similaires
      </button>
    </div>

    <div class="similar-debates-results">
    ${matches.map(({ debate }) => {
      const debateTypeLabel = isOpenDebate(debate) ? "Question ouverte" : "Débat";

      return `
        <article class="debate-card">
          <a class="debate-card-link" href="/debate?id=${debate.id}">
            <div class="debate-card-category">${escapeHtml(debate.category || "Sans catégorie")}</div>
            <div class="debate-card-type">${debateTypeLabel}</div>
            <h2>${escapeHtml(debate.question)}</h2>

           ${
  isOpenDebate(debate)
    ? ""
    : `
      <div class="debate-card-positions">
        <span class="pos-a">${escapeHtml(debate.option_a || "Position A")}</span>
        <span class="pos-b">${escapeHtml(debate.option_b || "Position B")}</span>
      </div>

      <div class="debate-card-score">
        <div class="score-bar">
          <div class="score-a" style="width:${debate.percent_a ?? 50}%"></div>
          <div class="score-b" style="width:${debate.percent_b ?? 50}%"></div>
        </div>

        <div class="score-labels">
          <span>${debate.percent_a ?? 50}%</span>
          <span>${debate.percent_b ?? 50}%</span>
        </div>
      </div>
    `
}

<p>${debate.argument_count || 0} idée(s)</p>            <p class="debate-date">${escapeHtml(formatDebateDate(debate.created_at))}</p>
            ${debate.last_argument_at ? `<p class="debate-last-argument">${escapeHtml(formatLastArgumentDate(debate.last_argument_at))}</p>` : ""}
          </a>
        </article>
      `;
    }).join("")}
    </div>
  `;
}
function toggleSimilarDebates() {
  similarDebatesVisible = !similarDebatesVisible;

  const debateId = getDebateId();
  if (!debateId) return;

  loadDebate(debateId);
}
/* =========================
   Debate
========================= */

async function initDebate() {
  const id = getDebateId();
localStorage.removeItem("debate_column_focus");

  if (!id) return;

  currentDebateViewMode = getDebateViewMode();
  updateDebateViewModeUI();

  const formA = document.getElementById("form-a");
  const formB = document.getElementById("form-b");
  const deleteDebateBtn = document.getElementById("delete-debate-btn");

if (formA) {
  formA.addEventListener("submit", async (e) => {
    e.preventDefault();

    await submitArgument(id, "A");
  });
}

if (formB) {
  formB.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitArgument(id, "B");
  });
}

const formList = document.getElementById("form-list");
if (formList) {
  formList.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitListArgument(id);
  });
}

  if (deleteDebateBtn) {
    deleteDebateBtn.addEventListener("click", async () => {
      await deleteDebate(id, true);
    });
  }

  await loadDebate(id);
}


function getYouTubeVideoId(url) {
  if (!url) return "";

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "").toLowerCase();

    if (hostname === "youtu.be") {
      return parsed.pathname.split("/").filter(Boolean)[0] || "";
    }

    if (hostname === "youtube.com" || hostname === "m.youtube.com") {
      if (parsed.pathname === "/watch") {
        return parsed.searchParams.get("v") || "";
      }

      const pathParts = parsed.pathname.split("/").filter(Boolean);
      if (!pathParts.length) return "";

      if (["embed", "shorts", "live"].includes(pathParts[0])) {
        return pathParts[1] || "";
      }
    }

    return "";
  } catch (error) {
    return "";
  }
}

function getEmbeddableSourceData(url) {
  if (!url) {
    return { embedUrl: "", forceShowPreview: false, videoId: "", posterUrl: "" };
  }

  const videoId = getYouTubeVideoId(url);
  if (videoId) {
    return {
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1`,
      forceShowPreview: true,
      videoId,
      posterUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    };
  }

  return {
    embedUrl: url,
    forceShowPreview: false,
    videoId: "",
    posterUrl: ""
  };
}

const debateSourcePreviewState = {
  retryTimers: [],
  currentToken: 0,
  handlersBound: false
};

function clearDebateSourcePreviewTimers() {
  debateSourcePreviewState.retryTimers.forEach(timer => clearTimeout(timer));
  debateSourcePreviewState.retryTimers = [];
}

function resetDebateSourcePreview() {
  clearDebateSourcePreviewTimers();

  const sourcePreviewWrap = document.getElementById("debate-source-preview-wrap");
  const sourcePreview = document.getElementById("debate-source-preview");
  const sourceFallback = document.getElementById("debate-source-fallback");
  const sourceDomain = document.getElementById("debate-source-domain");
  const sourceFallbackLink = document.getElementById("debate-source-fallback-link");
  const sourcePoster = document.getElementById("debate-source-preview-poster");
  const sourcePosterImg = document.getElementById("debate-source-preview-poster-img");
  const sourceLoading = document.getElementById("debate-source-preview-loading");

  if (sourcePreviewWrap) {
    sourcePreviewWrap.style.display = "none";
  }

  if (sourcePreview) {
    sourcePreview.dataset.loaded = "0";
    sourcePreview.dataset.token = "";
    sourcePreview.style.display = "none";
    sourcePreview.style.visibility = "hidden";
    sourcePreview.removeAttribute("src");
    sourcePreview.src = "about:blank";
  }

  if (sourcePoster) {
    sourcePoster.style.display = "none";
    sourcePoster.removeAttribute("href");
  }

  if (sourcePosterImg) {
    sourcePosterImg.removeAttribute("src");
    sourcePosterImg.alt = "";
  }

  if (sourceLoading) {
    sourceLoading.style.display = "none";
  }

  if (sourceFallback) {
    sourceFallback.style.display = "none";
  }

  if (sourceDomain) {
    sourceDomain.textContent = "";
  }

  if (sourceFallbackLink) {
    sourceFallbackLink.href = "#";
  }
}

function showDebateSourceFallback(sourceUrl) {
  const sourceFallback = document.getElementById("debate-source-fallback");
  const sourceDomain = document.getElementById("debate-source-domain");
  const sourceFallbackLink = document.getElementById("debate-source-fallback-link");

  if (!sourceFallback || !sourceFallbackLink) return;

  try {
    const domain = new URL(sourceUrl).hostname.replace("www.", "");
    if (sourceDomain) {
      sourceDomain.textContent = "🔗 " + domain;
    }
  } catch (error) {
    if (sourceDomain) {
      sourceDomain.textContent = "🔗 Source externe";
    }
  }

  sourceFallbackLink.href = sourceUrl;
  sourceFallback.style.display = "block";
}

function bindDebateSourcePreviewHandlers() {
  if (debateSourcePreviewState.handlersBound) return;

  const sourcePreview = document.getElementById("debate-source-preview");
  const sourcePoster = document.getElementById("debate-source-preview-poster");
  const sourceLoading = document.getElementById("debate-source-preview-loading");

  if (!sourcePreview) return;

  sourcePreview.addEventListener("load", () => {
    sourcePreview.dataset.loaded = "1";
    sourcePreview.style.visibility = "visible";
    sourcePreview.style.display = "block";

    if (sourcePoster) {
      sourcePoster.style.display = "none";
    }

    if (sourceLoading) {
      sourceLoading.style.display = "none";
    }

    clearDebateSourcePreviewTimers();
  });

  sourcePreview.addEventListener("error", () => {
    const src = sourcePreview.getAttribute("src");
    if (src && src !== "about:blank") {
      showDebateSourceFallback(src);
    }
  });

  debateSourcePreviewState.handlersBound = true;
}

function loadDebateSourceIframe(embedUrl, token, attempt = 0) {
  const sourcePreview = document.getElementById("debate-source-preview");
  const sourcePoster = document.getElementById("debate-source-preview-poster");
  const sourceLoading = document.getElementById("debate-source-preview-loading");

  if (!sourcePreview || token !== debateSourcePreviewState.currentToken) return;

  sourcePreview.dataset.loaded = "0";
  sourcePreview.dataset.token = String(token);
  sourcePreview.style.display = "block";
  sourcePreview.style.visibility = "hidden";
  sourcePreview.removeAttribute("src");
  sourcePreview.src = "about:blank";

  if (sourcePoster) {
    sourcePoster.style.display = "flex";
  }

  if (sourceLoading) {
    sourceLoading.textContent = attempt === 0 ? "Chargement de la vidéo…" : "Nouvelle tentative de chargement…";
    sourceLoading.style.display = "block";
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (token !== debateSourcePreviewState.currentToken) return;
      sourcePreview.src = embedUrl;
    });
  });

  if (attempt < 2) {
    const timer = setTimeout(() => {
      if (token !== debateSourcePreviewState.currentToken) return;
      if (sourcePreview.dataset.loaded === "1") return;
      loadDebateSourceIframe(embedUrl, token, attempt + 1);
    }, attempt === 0 ? 1600 : 3200);

    debateSourcePreviewState.retryTimers.push(timer);
  }
}

function renderDebateSourcePreview(sourceUrl) {
  resetDebateSourcePreview();

  if (!sourceUrl) return;

  const sourcePreviewWrap = document.getElementById("debate-source-preview-wrap");
  const sourcePoster = document.getElementById("debate-source-preview-poster");
  const sourcePosterImg = document.getElementById("debate-source-preview-poster-img");
  const sourceLoading = document.getElementById("debate-source-preview-loading");

  const { embedUrl, forceShowPreview, videoId, posterUrl } = getEmbeddableSourceData(sourceUrl);

  if (!embedUrl || !forceShowPreview || !videoId) {
    showDebateSourceFallback(sourceUrl);
    return;
  }

  bindDebateSourcePreviewHandlers();

  if (sourcePreviewWrap) {
    sourcePreviewWrap.style.display = "block";
  }

  if (sourcePoster) {
    sourcePoster.href = sourceUrl;
    sourcePoster.style.display = "flex";
  }

  if (sourcePosterImg) {
    sourcePosterImg.alt = "Aperçu de la vidéo YouTube";
    sourcePosterImg.src = posterUrl;
    sourcePosterImg.onerror = function () {
      this.onerror = null;
      this.src = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    };
  }

  if (sourceLoading) {
    sourceLoading.textContent = "Chargement de la vidéo…";
    sourceLoading.style.display = "block";
  }

  debateSourcePreviewState.currentToken += 1;
  const token = debateSourcePreviewState.currentToken;
  loadDebateSourceIframe(embedUrl, token, 0);
}


async function loadDebate(id) {
saveVisitedDebate(id);

  try {
    const data = await fetchJSON(API + "/debates/" + id);

  document.getElementById("debate-question").textContent = data.debate.question;

const sourceUrl = String(data.debate.source_url || "").trim();
renderDebateSourcePreview(sourceUrl);
if (isOpenDebate(data.debate)) {
  document.getElementById("title-a").textContent = "Réponses";
  document.getElementById("title-b").textContent = "";
} else {
  document.getElementById("title-a").textContent = data.debate.option_a;
  document.getElementById("title-b").textContent = data.debate.option_b;
}

currentDebateViewMode = getDebateViewMode();
updateDebateViewModeUI();
updateSortButtonLabel();
applyDebateTypeUI(data.debate);

currentAllArguments = [...(data.optionA || []), ...(data.optionB || [])];

cleanVoteStateForExistingArguments(id, currentAllArguments);

renderUnifiedVoicesSummary(id, currentAllArguments);
renderUnifiedVotedArgumentsSummary(id, currentAllArguments);

if (isOpenDebate(data.debate) || currentDebateViewMode === "list") {
  const argsA = document.getElementById("arguments-a");
  const argsB = document.getElementById("arguments-b");
  if (argsA) argsA.innerHTML = "";
  if (argsB) argsB.innerHTML = "";

  renderUnifiedArgs("arguments-unified", currentAllArguments, id, data.commentsByArgument || {});
} else {
  const unified = document.getElementById("arguments-unified");
  if (unified) unified.innerHTML = "";

  renderArgs("arguments-a", data.optionA, id, data.commentsByArgument || {});
  renderArgs("arguments-b", data.optionB, id, data.commentsByArgument || {});
}

if (pendingArgumentScrollId) {
  const targetId = pendingArgumentScrollId;

  setTimeout(() => {
    const element = getVisibleArgumentElement(targetId);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

if (element.classList.contains("argument-card-a") || element.closest("#arguments-a")) {        element.classList.add("flash-green");

        setTimeout(() => {
          element.classList.remove("flash-green");
        }, 2000);
      } else {
        element.classList.add("admin-highlight");

        setTimeout(() => {
          element.classList.remove("admin-highlight");
        }, 2000);
      }
    }

    pendingArgumentScrollId = null;
pinnedNewArgumentId = null;
  }, 250);
}

if (pendingCommentScrollId) {
  const targetId = pendingCommentScrollId;

  setTimeout(() => {
    const element = getVisibleCommentElement(targetId);

    if (element) {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });

      applyVoiceHighlight(element);

      setTimeout(() => {
        removeVoiceHighlight(element);
      }, 2000);
    }

    pendingCommentScrollId = null;
  }, 250);
}

  const isOpen = isOpenDebate(data.debate);

const votesA = data.optionA.reduce((sum, a) => sum + a.votes, 0);
const votesB = data.optionB.reduce((sum, a) => sum + a.votes, 0);

const total = votesA + votesB;

let percentA = 50;
let percentB = 50;

if (!isOpen && total > 0) {
  percentA = Math.round((votesA / total) * 100);
  percentB = 100 - percentA;
}
const scoreBar = document.getElementById("debate-score-bar");
const scoreA = document.getElementById("score-a");
const scoreB = document.getElementById("score-b");

if (isOpen) {
  if (scoreBar) scoreBar.style.display = "none";
  if (scoreA) scoreA.style.display = "none";
  if (scoreB) scoreB.style.display = "none";
} else {
  if (scoreBar) {
    scoreBar.style.display = "";
    scoreBar.innerHTML = `
      <div class="score-bar-label score-bar-label-a">${percentA}%</div>
      <div class="score-bar">
        <div class="score-bar-a" style="width:${percentA}%"></div>
        <div class="score-bar-b" style="width:${percentB}%"></div>
      </div>
      <div class="score-bar-label score-bar-label-b">${percentB}%</div>
    `;
  }

  if (scoreA) {
    scoreA.style.display = "";
    scoreA.innerHTML = `
      <strong>${percentA}%</strong>
      <span class="score-votes">(${votesA} voix)</span>
    `;
  }

  if (scoreB) {
    scoreB.style.display = "";
    scoreB.innerHTML = `
      <strong>${percentB}%</strong>
      <span class="score-votes">(${votesB} voix)</span>
    `;
  }
}

currentDebateShareData = {
  question: data.debate.question || "",
  optionA: isOpen ? "" : (data.debate.option_a || ""),
  optionB: isOpen ? "" : (data.debate.option_b || ""),
  percentA,
  percentB
};
const allDebates = await fetchJSON(API + "/debates");
renderBottomSimilarDebates(data.debate, allDebates);

refreshAdminUI();

const params = new URLSearchParams(window.location.search);
const highlight = params.get("highlight");

if (highlight) {
  if (highlight.startsWith("comment-")) {
    const commentId = highlight.replace("comment-", "");

    for (const argumentId in (data.commentsByArgument || {})) {
      const comments = data.commentsByArgument[argumentId] || [];

      if (comments.some((comment) => String(comment.id) === String(commentId))) {
        openCommentsByArgument[argumentId] = true;
      }
    }

    if (currentDebateViewMode === "list") {
      renderUnifiedArgs("arguments-unified", currentAllArguments, id, data.commentsByArgument || {});
    } else {
      renderArgs("arguments-a", data.optionA, id, data.commentsByArgument || {});
      renderArgs("arguments-b", data.optionB, id, data.commentsByArgument || {});
    }
  }

  setTimeout(() => {
    let element = null;

    if (highlight === "debate") {
      element = document.getElementById("debate-question");
    } else if (highlight.startsWith("comment-")) {
      const commentId = highlight.replace("comment-", "");
      element = getVisibleCommentElement(commentId);
    } else if (highlight.startsWith("argument-")) {
      const argumentId = highlight.replace("argument-", "");
      element = getVisibleArgumentElement(argumentId);
    } else {
      element = document.getElementById(highlight);
    }

if (element) {
  element.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

if (
  highlight.startsWith("argument-") &&
  (element.classList.contains("argument-card-a") || element.closest("#arguments-a"))
) {    element.classList.add("flash-green");

    setTimeout(() => {
      element.classList.remove("flash-green");
    }, 5000);
  } else {
    element.classList.add("admin-highlight");

    setTimeout(() => {
      element.classList.remove("admin-highlight");
    }, 5000);
  }
}

    const url = new URL(window.location.href);
    url.searchParams.delete("highlight");
    window.history.replaceState({}, "", url);
  }, 300);
}

  } catch (error) {
    alert(error.message);
  }
}

function renderArgs(container, args, debateId, commentsByArgument) {
  const state = getState(debateId);
  const commentLikeState = getCommentLikeState(debateId);

  const supportRankMap = getSupportRankMap(args);
args = sortArgumentsByMode(args, commentsByArgument);

  let visibleArgs = args.slice(0, argumentsVisible);
  let hiddenArgs = args.slice(argumentsVisible);

const totalVotesUsed = Object.values(state).reduce((sum, value) => {
  return sum + Number(value || 0);
}, 0);

const remainingVotes = Math.max(0, 5 - totalVotesUsed);



const votedArgumentsGlobal = Object.entries(state)
  .map(([id, count]) => ({
    id: String(id),
    count: Number(count || 0)
  }))
  .filter((item) => item.count > 0);

const allArgumentsSorted = [...currentAllArguments].sort((a, b) => {
  const diff = Number(b.votes || 0) - Number(a.votes || 0);
  if (diff !== 0) return diff;
  return Number(b.id || 0) - Number(a.id || 0);
});

const globalVoicesText = `
  <div class="voices-summary-box">
    <div class="voices-summary-title">Vous disposez de 5 voix à répartir entre les idées.</div>
    <div class="voices-summary-count">Voix restantes : ${remainingVotes} / 5</div>
    ${
      remainingVotes === 0
        ? `<div class="voices-summary-note">Toutes vos voix sont attribuées. Retirez-en une pour la déplacer.</div>`
        : ""
    }
  </div>
`;

if (container === "arguments-a") {
  const summary = document.getElementById("voices-summary");
  if (summary) {
    summary.innerHTML = globalVoicesText;
  }
}

const votedArgumentsForColumn = args
  .map((a, i) => {
    const myCount = Number(state[String(a.id)] || 0);

    if (myCount <= 0) return null;

    return {
      id: a.id,
      rank: i + 1,
      title: a.title || "Idée sans titre",
      count: myCount
    };
  })
  .filter(Boolean);

const summaryTargetId = container === "arguments-a" ? "my-arguments-a" : "my-arguments-b";
const summaryEl = document.getElementById(summaryTargetId);

if (summaryEl) {
  if (!votedArgumentsForColumn.length) {
    summaryEl.innerHTML = "";
  } else {
    summaryEl.innerHTML = `
      <div class="my-arguments-list">
        ${votedArgumentsForColumn.map((item) => `
  <div class="my-argument-chip">
    <div class="my-argument-chip-text">
      <span class="my-argument-chip-rank">#${item.rank}</span>

      <button
        type="button"
        class="my-argument-chip-title-button"
        onclick="scrollToArgumentFromSummary('${item.id}')"
        title="Aller à cette idée"
      >
        ${escapeHtml(item.title)}
      </button>
    </div>

    <div class="my-argument-chip-stepper" aria-label="Modifier les voix de cette idée">
      <button
        type="button"
        class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-minus"
onclick="unvote('${debateId}', '${item.id}', false)"
        aria-label="Retirer une voix"
        title="Retirer une voix"
      >
        −
      </button>

      <span class="my-argument-chip-count">${item.count}</span>

      <button
        type="button"
        class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-plus"
onclick="vote('${debateId}', '${item.id}', false)"
        aria-label="Ajouter une voix"
        title="Ajouter une voix"
      >
        +
      </button>
    </div>
  </div>
`).join("")}
      </div>
    `;
  }
}

  const div = document.getElementById(container);
  if (!div) return;

  if (!args.length) {
    div.innerHTML = `<div class="empty-state">Aucune idée pour le moment.</div>`;
    return;
  }

div.innerHTML = visibleArgs.map((a, index) => {
  const myVoteCount = Number(state[String(a.id)] || 0);
  const voted = myVoteCount > 0;
  const supportRank = supportRankMap[String(a.id)] || null;
  const currentSortMode = getArgumentsSortMode();
const isOwner = isArgumentOwner(a);
  let medal = "";
  let rankLabel = "";

  if (supportRank === 1) medal = '<span class="argument-medal">🥇</span>';
  if (supportRank === 2) medal = '<span class="argument-medal">🥈</span>';
  if (supportRank === 3) medal = '<span class="argument-medal">🥉</span>';

  if (currentSortMode === "score" && supportRank > 3) {
    rankLabel = `${supportRank}e`;
  }
    const comments = [...(commentsByArgument[a.id] || [])];
    const commentsOpen = !!openCommentsByArgument[a.id];

const favorableCommentsCount = comments.filter(
  (comment) => comment.stance === "favorable"
).length;

const defavorableCommentsCount = comments.filter(
  (comment) => comment.stance === "defavorable"
).length;

const ameliorationCommentsCount = comments.filter(
  (comment) => comment.stance === "amelioration"
).length;

comments.sort((c1, c2) => {
  const c1Pinned = String(c1.id) === pinnedNewCommentId;
  const c2Pinned = String(c2.id) === pinnedNewCommentId;

  if (c1Pinned && !c2Pinned) return -1;
  if (!c1Pinned && c2Pinned) return 1;

  function getCommentFreshnessBonus(comment) {
    if (!comment.created_at) return 0;

    const created = new Date(String(comment.created_at).replace(" ", "T"));
    const now = new Date();
    const ageHours = (now - created) / (1000 * 60 * 60);

    if (ageHours < 24 * 2) return 4;   // 2 jours
    if (ageHours < 24 * 7) return 3;   // 7 jours
    if (ageHours < 24 * 14) return 2;  // 14 jours
    if (ageHours < 24 * 30) return 1;  // 30 jours

    return 0;
  }

  const score1 = Number(c1.likes || 0) + getCommentFreshnessBonus(c1);
  const score2 = Number(c2.likes || 0) + getCommentFreshnessBonus(c2);

  if (score2 !== score1) return score2 - score1;

  return Number(c2.id || 0) - Number(c1.id || 0);
});
const visibleCommentsCount = visibleCommentsByArgument[a.id] || 5;
const visibleComments = comments.slice(0, visibleCommentsCount);
const hiddenCommentsCount = Math.max(0, comments.length - visibleComments.length);

    return `
<article id="argument-${a.id}" class="argument-card ${voted ? "argument-card-voted" : ""}">
  ${(isOwner || isAdmin()) ? `
    <button
      class="argument-owner-delete"
      type="button"
      onclick="deleteArgument('${debateId}','${a.id}')"
      title="Supprimer cette idée"
    >
      ✕
    </button>
  ` : ""}        <div class="argument-top">
<span class="vote-badge">
  ${medal}${rankLabel ? " " + rankLabel : ""}
  ${(medal || rankLabel) ? '<span class="vote-separator">•</span>' : ""}
<span class="vote-count">${a.votes} voix</span></span>
        </div>

        <h3 class="argument-title">${escapeHtml(a.title || "")}</h3>
        ${a.body ? `<p class="argument-body">${escapeHtml(a.body)}</p>` : ""}





<div class="argument-actions">
  <div class="voice-stepper" aria-label="Répartition des voix sur cette idée">
    <button
      class="voice-stepper-btn voice-stepper-btn-minus"
      type="button"
      onclick="unvote('${debateId}','${a.id}')"
      ${myVoteCount > 0 ? "" : "disabled"}
      aria-label="Retirer une voix"
      title="Retirer une voix"
    >
      −
    </button>

    <div class="voice-stepper-center">
      <div class="voice-stepper-value">${myVoteCount}</div>
      <div class="voice-stepper-label">Mes voix</div>
    </div>

    <button
      class="voice-stepper-btn voice-stepper-btn-plus"
      type="button"
      onclick="vote('${debateId}','${a.id}')"
      aria-label="Ajouter une voix"
      title="Ajouter une voix"
    >
      +
    </button>
  </div>

  <button
    class="report-button"
    type="button"
    onclick="openReportBox('argument', '${a.id}')"
  >
    Signaler
  </button>

  ${isAdmin() ? `
    <div class="admin-argument-actions">
      <button
        class="button button-small"
        type="button"
        onclick="editArgument('${a.id}')"
      >
        Modifier l'idée
      </button>

      <button
        class="delete-button"
        type="button"
        onclick="deleteArgument('${debateId}','${a.id}')"
      >
        Supprimer l'idée
      </button>
    </div>
  ` : ""}
</div>

<div class="comments-block">
  <div class="comments-summary">
    <button class="button button-small" type="button" onclick="toggleComments('${a.id}')">
      ${commentsOpen ? "Masquer les commentaires" : "Voir les commentaires"} (${comments.length})
    </button>

<div class="comments-summary-details">
  <span class="comments-count-favorable">
    ${favorableCommentsCount} favorable${favorableCommentsCount > 1 ? "s" : ""}
  </span>

  <span class="comments-count-defavorable">
    ${defavorableCommentsCount} défavorable${defavorableCommentsCount > 1 ? "s" : ""}
  </span>

  <span class="comments-count-amelioration">
    ${ameliorationCommentsCount} amélioration${ameliorationCommentsCount > 1 ? "s" : ""}
  </span>
</div>
  </div>

          ${commentsOpen ? `
            <div class="comments-content">
              <h4>Commentaires (${comments.length})</h4>

<form class="comment-form" onsubmit="submitComment(event, '${debateId}', '${a.id}')">
${
  replyToCommentByArgument[a.id]
    ? `
      <div class="argument-warning">
        <div class="reply-preview-text">
          <span class="reply-preview-label">Vous répondez à :</span>
          <span class="reply-preview-content">${escapeHtml(
            replyToCommentByArgument[a.id].commentContent.length > 140
              ? replyToCommentByArgument[a.id].commentContent.slice(0, 140) + "…"
              : replyToCommentByArgument[a.id].commentContent
          )}</span>
        </div>

        <button
          type="button"
          class="button button-small"
          onclick="cancelReply('${a.id}')"
        >
          Annuler la réponse
        </button>
      </div>
    `
    : ""
}

  <div class="comment-stance-row">
    <label class="comment-stance-option">
      <input type="radio" name="comment-stance-${a.id}" value="favorable">
      Favorable à l'idée
    </label>

    <label class="comment-stance-option">
      <input type="radio" name="comment-stance-${a.id}" value="defavorable">
      Défavorable à l'idée
    </label>

    <label class="comment-stance-option">
      <input type="radio" name="comment-stance-${a.id}" value="amelioration">
      Proposition d'amélioration
    </label>
  </div>

  <div class="comment-main-field">
<textarea
  id="comment-input-${a.id}"
  placeholder="Ajouter un commentaire"
  maxlength="600"
  oninput="updateCounter('comment-input-${a.id}','count-comment-${a.id}',600)"
></textarea>
<small id="count-comment-${a.id}">0 / 600</small>  </div>
<div class="comment-amelioration-fields" style="display:none;">
<input
  type="text"
  id="comment-improvement-title-${a.id}"
  class="comment-improvement-title-input"
  placeholder="Titre proposé"
  maxlength="100"
  oninput="updateCounter('comment-improvement-title-${a.id}','count-improvement-title-${a.id}',100)"
>
<small id="count-improvement-title-${a.id}">0 / 100</small>

<textarea
  id="comment-improvement-body-${a.id}"
  class="comment-improvement-body-input"
  placeholder="Texte proposé pour remplacer l’idée"
  maxlength="600"
  oninput="updateCounter('comment-improvement-body-${a.id}','count-improvement-body-${a.id}',600)"
></textarea>
<small id="count-improvement-body-${a.id}">0 / 600</small>

  <div class="comment-amelioration-hint">
   Propose une version améliorée de cette idée. Si elle convainc davantage, elle pourra la remplacer.
  </div>
</div>

<button type="submit" class="button">Publier le commentaire</button></form>
<div class="comments-list">
  ${
    comments.length
      ? `
        ${visibleComments.map(c => {
const isCommentAuthor = isCommentOwner(c);
         const voteValue = Number(commentLikeState[String(c.id)] || 0);
const liked = voteValue === 1;
const disliked = voteValue === -1;
const likes = Number(c.likes || 0);

          return `
<div id="comment-${c.id}" class="comment-card">
  ${(isCommentAuthor || isAdmin()) ? `
    <button
      class="comment-owner-delete"
      type="button"
      onclick="deleteComment('${debateId}','${c.id}')"
      title="Supprimer ce commentaire"
    >
      ✕
    </button>
  ` : ""}             
${
  c.stance === "favorable"
    ? `<div class="comment-stance-badge comment-stance-favorable">Commentaire favorable à l'idée</div>`
    : c.stance === "defavorable"
      ? `<div class="comment-stance-badge comment-stance-defavorable">Commentaire défavorable à l'idée</div>`
      : c.stance === "amelioration"
        ? `<div class="comment-stance-badge comment-stance-amelioration">Proposition d'amélioration</div>`
        : ""
}

${
  c.stance === "amelioration"
    ? `
      ${c.content ? `<p>${escapeHtml(c.content)}</p>` : ""}
      <div class="comment-improvement-preview">
        <div class="comment-improvement-preview-label">Proposition de remplacement</div>
        <div class="comment-improvement-preview-title">${escapeHtml(c.improvement_title || "Sans titre")}</div>
        <div class="comment-improvement-preview-body">${escapeHtml(c.improvement_body || "")}</div>
      </div>
    `
    : `<p>${escapeHtml(c.content)}</p>`
}




<div class="comment-actions">
  <button
    class="comment-like-button ${liked ? "comment-like-button-active comment-vote-disabled" : ""}"
    type="button"
    onclick="voteComment('${debateId}','${c.id}','${a.id}', 1)"
    title="${liked ? "Déjà voté positif" : "Vote positif"}"
    ${liked ? "disabled" : ""}
  >
    👍
  </button>

  <button
    class="comment-dislike-button ${disliked ? "comment-dislike-button-active comment-vote-disabled" : ""}"
    type="button"
    onclick="voteComment('${debateId}','${c.id}','${a.id}', -1)"
    title="${disliked ? "Déjà voté négatif" : "Vote négatif"}"
    ${disliked ? "disabled" : ""}
  >
    👎
  </button>

<span class="comment-like-count">${likes} ${likes > 1 ? "likes" : "like"}</span>

  <button
    class="button button-small"
    type="button"
    onclick="replyToComment('${a.id}', '${c.id}')"
  >
    Répondre
  </button>

  <button
    class="report-button"
    type="button"
    onclick="openReportBox('comment', '${c.id}')"
  >
    Signaler
  </button>

  ${(isCommentAuthor || isAdmin()) ? `
    <button
      class="delete-button"
      type="button"
      onclick="deleteComment('${debateId}','${c.id}')"
    >
      Supprimer le commentaire
    </button>
  ` : ""}
</div>
</div>
          `;
        }).join("")}

        ${
          hiddenCommentsCount > 0
            ? `
              <div class="load-more-container">
                <button
                  class="button button-small"
                  type="button"
                  onclick="loadMoreComments('${a.id}')"
                >
                  Charger plus de commentaires
                </button>
              </div>
            `
            : ""
        }
      `
      : `<div class="empty-comments">Aucun commentaire.</div>`
  }
</div> <div class="comments-bottom-actions">
  <button class="button button-small" type="button" onclick="toggleComments('${a.id}')">
    Masquer les commentaires
  </button>
</div>
            </div>
          ` : ""}

        </div>
      </article>
    `;
  }).join("");
if (hiddenArgs.length > 0) {
  div.innerHTML += `
    <div class="load-more-container">
      <button class="button button-small" type="button" onclick="loadMoreArguments()">
        Voir plus d'idées
      </button>
    </div>
  `;
}

  refreshAdminUI();

}
function renderUnifiedArgs(container, args, debateId, commentsByArgument) {
  const state = getState(debateId);
  const commentLikeState = getCommentLikeState(debateId);
  const supportRankMap = getSupportRankMap(args || []);
const sortedArgs = sortArgumentsByMode(args || [], commentsByArgument);  const visibleArgs = sortedArgs.slice(0, argumentsVisible);
  const hiddenArgs = sortedArgs.slice(argumentsVisible);

  const totalVotesUsed = Object.values(state).reduce((sum, value) => {
    return sum + Number(value || 0);
  }, 0);

  const remainingVotes = Math.max(0, 5 - totalVotesUsed);
  const div = document.getElementById(container);
  if (!div) return;

  if (!sortedArgs.length) {
    div.innerHTML = `<div class="empty-state">Aucune idée pour le moment.</div>`;
    return;
  }

div.innerHTML = visibleArgs.map((a, index) => {
  const myVoteCount = Number(state[String(a.id)] || 0);
  const voted = myVoteCount > 0;
  const supportRank = supportRankMap[String(a.id)] || null;
  const currentSortMode = getArgumentsSortMode();
const isOwner = isArgumentOwner(a);
  let medal = "";
  let rankLabel = "";

  if (supportRank === 1) medal = '<span class="argument-medal">🥇</span>';
  if (supportRank === 2) medal = '<span class="argument-medal">🥈</span>';
  if (supportRank === 3) medal = '<span class="argument-medal">🥉</span>';

  if (currentSortMode === "score" && supportRank > 3) {
    rankLabel = `${supportRank}e`;
  }

    const comments = [...(commentsByArgument[a.id] || [])];
    const commentsOpen = !!openCommentsByArgument[a.id];

const favorableCommentsCount = comments.filter((comment) => comment.stance === "favorable").length;
const defavorableCommentsCount = comments.filter((comment) => comment.stance === "defavorable").length;
const ameliorationCommentsCount = comments.filter((comment) => comment.stance === "amelioration").length;

comments.sort((c1, c2) => {
  const c1Pinned = String(c1.id) === pinnedNewCommentId;
  const c2Pinned = String(c2.id) === pinnedNewCommentId;

  if (c1Pinned && !c2Pinned) return -1;
  if (!c1Pinned && c2Pinned) return 1;

  function getCommentFreshnessBonus(comment) {
    if (!comment.created_at) return 0;

    const created = new Date(String(comment.created_at).replace(" ", "T"));
    const now = new Date();
    const ageHours = (now - created) / (1000 * 60 * 60);

    if (ageHours < 24 * 2) return 4;
    if (ageHours < 24 * 7) return 3;
    if (ageHours < 24 * 14) return 2;
    if (ageHours < 24 * 30) return 1;

    return 0;
  }

  const score1 = Number(c1.likes || 0) + getCommentFreshnessBonus(c1);
  const score2 = Number(c2.likes || 0) + getCommentFreshnessBonus(c2);

  if (score2 !== score1) return score2 - score1;

  return Number(c2.id || 0) - Number(c1.id || 0);
});

    const visibleCommentsCount = visibleCommentsByArgument[a.id] || 5;
    const visibleComments = comments.slice(0, visibleCommentsCount);
    const hiddenCommentsCount = Math.max(0, comments.length - visibleComments.length);

const debateIsOpen = document.getElementById("title-b")?.textContent.trim() === "";
const cardSideClass = debateIsOpen
  ? ""
  : (a.side === "A" ? "argument-card-a" : "argument-card-b");
   
return `
    <article id="list-argument-${a.id}" class="argument-card argument-card-unified ${cardSideClass} ${voted ? "argument-card-voted" : ""}">
      ${(isOwner || isAdmin()) ? `
        <button
          class="argument-owner-delete"
          type="button"
          onclick="deleteArgument('${debateId}','${a.id}')"
          title="Supprimer cette idée"
        >
          ✕
        </button>
      ` : ""}
      <div class="argument-top argument-top-unified">
<span class="vote-badge">

  ${medal}${rankLabel ? " " + rankLabel : ""}
  ${(medal || rankLabel) ? '<span class="vote-separator">•</span>' : ""}
<span class="vote-count">${a.votes} voix${a.votes > 1 ? "s" : ""}</span></span>
</div>

<h3 class="argument-title">${escapeHtml(a.title || "")}</h3>
${a.body ? `<p class="argument-body">${escapeHtml(a.body)}</p>` : ""}

        <div class="argument-actions">
          <div class="voice-stepper" aria-label="Répartition des voix sur cette idée">
            <button
              class="voice-stepper-btn voice-stepper-btn-minus"
              type="button"
              onclick="unvote('${debateId}','${a.id}')"
              ${myVoteCount > 0 ? "" : "disabled"}
              aria-label="Retirer une voix"
              title="Retirer une voix"
            >
              −
            </button>

            <div class="voice-stepper-center">
              <div class="voice-stepper-value">${myVoteCount}</div>
              <div class="voice-stepper-label">Mes voix</div>
            </div>

            <button
              class="voice-stepper-btn voice-stepper-btn-plus"
              type="button"
              onclick="vote('${debateId}','${a.id}')"
              aria-label="Ajouter une voix"
              title="Ajouter une voix"
            >
              +
            </button>
          </div>

          <button
            class="report-button"
            type="button"
            onclick="openReportBox('argument', '${a.id}')"
          >
            Signaler
          </button>

          ${isAdmin() ? `
            <div class="admin-argument-actions">
              <button
                class="button button-small"
                type="button"
                onclick="editArgument('${a.id}')"
              >
                Modifier l'idée
              </button>

              <button
                class="delete-button"
                type="button"
                onclick="deleteArgument('${debateId}','${a.id}')"
              >
                Supprimer l'idée
              </button>
            </div>
          ` : ""}
        </div>

        <div class="comments-block">
          <div class="comments-summary">
            <button class="button button-small" type="button" onclick="toggleComments('${a.id}')">
              ${commentsOpen ? "Masquer les commentaires" : "Voir les commentaires"} (${comments.length})
            </button>

<div class="comments-summary-details">
  <span class="comments-count-favorable">
    ${favorableCommentsCount} favorable${favorableCommentsCount > 1 ? "s" : ""}
  </span>

  <span class="comments-count-defavorable">
    ${defavorableCommentsCount} défavorable${defavorableCommentsCount > 1 ? "s" : ""}
  </span>

  <span class="comments-count-amelioration">
    ${ameliorationCommentsCount} amélioration${ameliorationCommentsCount > 1 ? "s" : ""}
  </span>
</div>
</div>
          </div>

          ${commentsOpen ? `
            <div class="comments-content">
              <h4>Commentaires (${comments.length})</h4>

<form class="comment-form" onsubmit="submitComment(event, '${debateId}', '${a.id}')">
${
  replyToCommentByArgument[a.id]
    ? `
      <div class="argument-warning">
        <div class="reply-preview-text">
          <span class="reply-preview-label">Vous répondez à :</span>
          <span class="reply-preview-content">${escapeHtml(
            replyToCommentByArgument[a.id].commentContent.length > 140
              ? replyToCommentByArgument[a.id].commentContent.slice(0, 140) + "…"
              : replyToCommentByArgument[a.id].commentContent
          )}</span>
        </div>

        <button
          type="button"
          class="button button-small"
          onclick="cancelReply('${a.id}')"
        >
          Annuler la réponse
        </button>
      </div>
    `
    : ""
}

<div class="comment-stance-row">
  <label class="comment-stance-option">
    <input type="radio" name="comment-stance-${a.id}" value="favorable">
    Favorable à l'idée
  </label>

  <label class="comment-stance-option">
    <input type="radio" name="comment-stance-${a.id}" value="defavorable">
    Défavorable à l'idée
  </label>

  <label class="comment-stance-option">
    <input type="radio" name="comment-stance-${a.id}" value="amelioration">
    Proposition d'amélioration
  </label>
</div>

<div class="comment-main-field">
  <textarea
    id="comment-input-${a.id}"
    placeholder="Ajouter un commentaire"
    maxlength="600"
    oninput="updateCounter('comment-input-${a.id}','count-comment-${a.id}',600)"
  ></textarea>
  <small id="count-comment-${a.id}">0 / 600</small>
</div>

<div class="comment-amelioration-fields" style="display:none;">
  <input
  type="text"
  id="comment-improvement-title-${a.id}"
  class="comment-improvement-title-input"
  placeholder="Titre proposé"
  maxlength="100"
  oninput="updateCounter('comment-improvement-title-${a.id}','count-improvement-title-${a.id}',100)"
>
<small id="count-improvement-title-${a.id}">0 / 100</small>

<textarea
  id="comment-improvement-body-${a.id}"
  class="comment-improvement-body-input"
  placeholder="Texte proposé pour remplacer l’idée"
  maxlength="600"
  oninput="updateCounter('comment-improvement-body-${a.id}','count-improvement-body-${a.id}',600)"
></textarea>
<small id="count-improvement-body-${a.id}">0 / 600</small>

  <div class="comment-amelioration-hint">
   Propose une version améliorée de cette idée. Si elle convainc davantage, elle pourra la remplacer.
  </div>
</div>

<button type="submit" class="button">Publier le commentaire</button>
              </form>

              <div class="comments-list">
                ${
                  comments.length
                    ? `
                      ${visibleComments.map(c => {
const isCommentAuthor = isCommentOwner(c);

                       const voteValue = Number(commentLikeState[String(c.id)] || 0);
const liked = voteValue === 1;
const disliked = voteValue === -1;
const likes = Number(c.likes || 0);

                        return `
                        <div id="list-comment-${c.id}" class="comment-card">
  ${(isCommentAuthor || isAdmin()) ? `
    <button
      class="comment-owner-delete"
      type="button"
      onclick="deleteComment('${debateId}','${c.id}')"
      title="Supprimer ce commentaire"
    >
      ✕
    </button>
  ` : ""}

${
  c.stance === "favorable"
    ? `<div class="comment-stance-badge comment-stance-favorable">Commentaire favorable à l'idée</div>`
    : c.stance === "defavorable"
      ? `<div class="comment-stance-badge comment-stance-defavorable">Commentaire défavorable à l'idée</div>`
      : c.stance === "amelioration"
        ? `<div class="comment-stance-badge comment-stance-amelioration">Proposition d'amélioration</div>`
        : ""
}

${
  c.stance === "amelioration"
    ? `
      ${c.content ? `<p>${escapeHtml(c.content)}</p>` : ""}
      <div class="comment-improvement-preview">
        <div class="comment-improvement-preview-label">Proposition de remplacement</div>
        <div class="comment-improvement-preview-title">${escapeHtml(c.improvement_title || "Sans titre")}</div>
        <div class="comment-improvement-preview-body">${escapeHtml(c.improvement_body || "")}</div>
      </div>
    `
    : `<p>${escapeHtml(c.content)}</p>`
}
<div class="comment-actions">
  <button
    class="comment-like-button ${liked ? "comment-like-button-active comment-vote-disabled" : ""}"
    type="button"
    onclick="voteComment('${debateId}','${c.id}','${a.id}', 1)"
    title="${liked ? "Déjà voté positif" : "Vote positif"}"
    ${liked ? "disabled" : ""}
  >
    👍
  </button>

  <button
    class="comment-dislike-button ${disliked ? "comment-dislike-button-active comment-vote-disabled" : ""}"
    type="button"
    onclick="voteComment('${debateId}','${c.id}','${a.id}', -1)"
    title="${disliked ? "Déjà voté négatif" : "Vote négatif"}"
    ${disliked ? "disabled" : ""}
  >
    👎
  </button>

<span class="comment-like-count">${likes} ${likes > 1 ? "likes" : "like"}</span>

<button
  class="button button-small"
  type="button"
  onclick="replyToComment('${a.id}', '${c.id}')"
>
  Répondre
</button>

  <button
    class="report-button"
    type="button"
    onclick="openReportBox('comment', '${c.id}')"
  >
    Signaler
  </button>

  <button
    class="delete-button"
    data-admin
    style="display:none;"
    type="button"
    onclick="deleteComment('${debateId}','${c.id}')"
  >
    Supprimer le commentaire
  </button>
</div>
                          </div>
                        `;
                      }).join("")}

                      ${
                        hiddenCommentsCount > 0
                          ? `
                            <div class="load-more-container">
                              <button
                                class="button button-small"
                                type="button"
                                onclick="loadMoreComments('${a.id}')"
                              >
                                Charger plus de commentaires
                              </button>
                            </div>
                          `
                          : ""
                      }
                    `
                    : `<div class="empty-comments">Aucun commentaire.</div>`
                }
              </div>

              <div class="comments-bottom-actions">
                <button class="button button-small" type="button" onclick="toggleComments('${a.id}')">
                  Masquer les commentaires
                </button>
              </div>
            </div>
          ` : ""}
        </div>
      </article>
    `;
  }).join("");

  if (hiddenArgs.length > 0) {
    div.innerHTML += `
      <div class="load-more-container">
        <button class="button button-small" type="button" onclick="loadMoreArguments()">
          Voir plus d'idées
        </button>
      </div>
    `;
  }

  refreshAdminUI();
}

async function submitListArgument(debateId) {
  const titleField = document.getElementById("list-title");
  const bodyField = document.getElementById("list-body");
  const sideField = document.getElementById("list-side-value");
  const warning = document.getElementById("warning-list");

  if (!titleField || !bodyField || !sideField) return;

  const title = titleField.value.trim();
  const body = bodyField.value.trim();
if (body.length > 600) {
  alert("Maximum 600 caractères pour le texte de l'idée.");
  return;
}
  const titleB = document.getElementById("title-b");
  const isOpenMode = !titleB || !titleB.textContent.trim();
  const side = isOpenMode ? "A" : sideField.value;

  if (!title) {
    alert("Tu dois écrire une idée.");
    return;
  }

  if (!isOpenMode && side !== "A" && side !== "B") {
    alert("Tu dois choisir une position.");
    return;
  }

  try {
    const r = await fetchJSON(API + "/arguments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        debate_id: debateId,
        side,
        title,
        body,
        authorKey: getKey()
      })
    });

    titleField.value = "";
    bodyField.value = "";
    hideSimilarArgumentsForForm("list");

    if (warning) {
      warning.style.display = "none";
    }

    const form = document.getElementById("form-list");
    if (form) {
      form.style.display = "none";
    }

    openedArgumentForm = null;
    document.body.classList.remove("argument-form-open");

    if (typeof updateCounter === "function") {
      updateCounter("list-title", "count-title-list", 100);
updateCounter("list-body", "count-body-list", 600);    }

pendingArgumentScrollId = String(r.id);
pinnedNewArgumentId = String(r.id);
    await loadDebate(debateId);

  } catch (error) {
    if (error.code === "similar_arguments" && error.details?.similarArguments) {
      const list = error.details.similarArguments;

      alert(
        "Des idées similaires existent déjà :\n\n" +
        list.map(a => "• " + (a.title || "Idée")).join("\n")
      );

      return;
    }

    alert(error.message);
  }
}


async function submitComment(event, debateId, argumentId) {
  event.preventDefault();

const input = document.getElementById(`comment-input-${argumentId}`);
const selectedStance = document.querySelector(
  `input[name="comment-stance-${argumentId}"]:checked`
);
const stance = selectedStance ? selectedStance.value : null;

const improvementTitleInput = document.getElementById(`comment-improvement-title-${argumentId}`);
const improvementBodyInput = document.getElementById(`comment-improvement-body-${argumentId}`);

const content = input ? input.value.trim() : "";
if (content.length > 600) {
  alert("Maximum 600 caractères pour un commentaire.");
  return;
}
const improvement_title = improvementTitleInput ? improvementTitleInput.value.trim() : "";
const improvement_body = improvementBodyInput ? improvementBodyInput.value.trim() : "";

const replyData = replyToCommentByArgument[argumentId] || null;
const replyToCommentId = replyData ? replyData.commentId : null;

if (stance === "amelioration") {
  if (!improvement_title) {
    alert("Tu dois proposer un titre d'amélioration.");
    return;
  }

  if (!improvement_body) {
    alert("Tu dois proposer un texte d'amélioration.");
    return;
  }
} else {
  if (!content) {
    alert("Tu dois écrire un commentaire.");
    return;
  }
}
if (stance === "amelioration") {
  if (!improvement_title) {
    alert("Tu dois proposer un titre d'amélioration.");
    return;
  }

  if (!improvement_body) {
    alert("Tu dois proposer un texte d'amélioration.");
    return;
  }
}
try {
  const data = await fetchJSON(API + "/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      argument_id: argumentId,
      content: stance === "amelioration" ? "" : content,
      authorKey: getKey(),
      stance,
      reply_to_comment_id: replyToCommentId,
      improvement_title,
      improvement_body
    })
  });

    openCommentsByArgument[argumentId] = true;
visibleCommentsByArgument[argumentId] = 5;
    delete replyToCommentByArgument[argumentId];
    input.value = "";
if (improvementTitleInput) {
  improvementTitleInput.value = "";
}

if (improvementBodyInput) {
  improvementBodyInput.value = "";
}

document
  .querySelectorAll(`input[name="comment-stance-${argumentId}"]`)
  .forEach((input) => {
    input.checked = false;
    input.dataset.waschecked = "false";
  });

const commentForm = input ? input.closest(".comment-form") : null;
const ameliorationFields = commentForm?.querySelector(".comment-amelioration-fields");
const mainField = commentForm?.querySelector(".comment-main-field");

if (ameliorationFields) {
  ameliorationFields.style.display = "none";
}

if (mainField) {
  mainField.style.display = "block";
}

pendingCommentScrollId = String(data.id);
pinnedNewCommentId = String(data.id);
await loadDebate(debateId);

  } catch (error) {
    alert(error.message);
  }
}
async function vote(debateId, argId, shouldScroll = true) {

  const state = getState(debateId);
  const argIdString = String(argId);
  const voterKey = getKey();

  const totalVotesUsed = Object.values(state).reduce((sum, value) => {
    return sum + Number(value || 0);
  }, 0);

  if (totalVotesUsed >= 5) {
  showVoteWarning("Toutes tes voix sont déjà attribuées. Retire-en une pour en donner ailleurs.");
  scrollToVoicesSummary();
  return;
}

  try {

    await fetchJSON(API + "/arguments/" + argId + "/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ voterKey })
    });

    state[argIdString] = Number(state[argIdString] || 0) + 1;

    setState(debateId, state);

pendingArgumentScrollId = shouldScroll ? String(argId) : null;
    await loadDebate(debateId);

  } catch (error) {

    if (error.message === "limit") {
  showVoteWarning("Vous avez déjà attribué vos 5 voix.");
  scrollToVoicesSummary();
  return;
}

    alert(error.message);

  }

}

async function unvote(debateId, argId, shouldScroll = true) {

  const state = getState(debateId);
  const argIdString = String(argId);
  const voterKey = getKey();

  if (!state[argIdString] || Number(state[argIdString]) <= 0) {
    return;
  }

  try {

    await fetchJSON(API + "/arguments/" + argId + "/unvote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ voterKey })
    });

    state[argIdString] = Number(state[argIdString] || 0) - 1;

    if (state[argIdString] <= 0) {
      delete state[argIdString];
    }

  setState(debateId, state);

pendingArgumentScrollId = shouldScroll ? String(argId) : null;

await loadDebate(debateId);

  } catch (error) {

    alert(error.message);

  }

}

async function confirmRemoveVoice(debateId, argId) {
  const ok = window.confirm("Retirer 1 voix de cette idée ?");

  if (!ok) return;

  await unvote(debateId, argId);
}

async function voteComment(debateId, commentId, argumentId, value) {
  let state = getCommentLikeState(debateId);
  const commentIdString = String(commentId);
  const voterKey = getKey();

  if (argumentId) {
    openCommentsByArgument[argumentId] = true;
    visibleCommentsByArgument[argumentId] =
      Math.max(visibleCommentsByArgument[argumentId] || 5, 9999);
  }

  try {
    const debateData = await fetchJSON(API + "/debates/" + debateId);
    let targetComment = null;

    for (const comments of Object.values(debateData.commentsByArgument || {})) {
      const found = (comments || []).find(
        (comment) => String(comment.id) === commentIdString
      );
      if (found) {
        targetComment = found;
        break;
      }
    }

    const currentValue = Number(state[commentIdString] || 0);
    let nextValue = 0;

    if (currentValue === 0) {
      nextValue = value;
    } else if (currentValue === value) {
      return;
    } else {
      nextValue = 0;
    }

    if (
      value === 1 &&
      targetComment &&
      targetComment.stance === "amelioration" &&
      nextValue === 1
    ) {
      alert("Plus de likes que de voix : elle remplace l’idée.");
    }

const result = await fetchJSON(API + "/comments/" + commentId + "/vote", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    voterKey,
    value: nextValue
  })
});

if (nextValue === 0) {
  delete state[commentIdString];
} else {
  state[commentIdString] = nextValue;
}

setCommentLikeState(debateId, state);
pendingCommentScrollId = String(commentId);
await loadDebate(debateId);

if (result && result.replaced) {
  showReplacementSuccessMessage();
}
  } catch (error) {
    alert(error.message);
  }
}

function replyToComment(argumentId, commentId) {
  const debateId = getDebateId();
  if (!debateId) return;

  fetchJSON(API + "/debates/" + debateId)
    .then((debateData) => {
      const comments = debateData.commentsByArgument?.[String(argumentId)] || [];
      const targetComment = comments.find(
        (comment) => String(comment.id) === String(commentId)
      );

      replyToCommentByArgument[argumentId] = {
        commentId: String(commentId),
        commentContent: targetComment ? String(targetComment.content || "") : ""
      };

      openCommentsByArgument[argumentId] = true;
      visibleCommentsByArgument[argumentId] =
        Math.max(visibleCommentsByArgument[argumentId] || 5, 9999);

      return loadDebate(debateId);
    })
    .then(() => {
      const replyLabel = document.querySelector(
        `#argument-${argumentId} .reply-preview-label, #list-argument-${argumentId} .reply-preview-label`
      );

      const input = document.getElementById(`comment-input-${argumentId}`);
      const target = replyLabel || input;

      if (target) {
        const topbar = document.querySelector(".topbar");
        const offset = topbar ? topbar.offsetHeight + 120 : 220;
        const y = target.getBoundingClientRect().top + window.scrollY - offset;

        window.scrollTo({
          top: y,
          behavior: "smooth"
        });
document.addEventListener("focusin", function(event) {
  const target = event.target;

  if (target.tagName === "TEXTAREA" && target.id.startsWith("comment-input-")) {
    
    setTimeout(() => {
      const topbar = document.querySelector(".topbar");

      // 🔥 AJUSTE ICI LA VALEUR
      const extraOffset = 180;

      const offset = (topbar ? topbar.offsetHeight : 80) + extraOffset;

      const y = target.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({
        top: Math.max(0, y),
        behavior: "smooth"
      });

    }, 250); // important pour laisser le clavier apparaître
  }
});
      }

      if (input) {
        setTimeout(() => {
          input.focus();
        }, 250);
      }
    })
    .catch((error) => {
      alert(error.message);
    });
}

function cancelReply(argumentId) {
  delete replyToCommentByArgument[argumentId];

  const debateId = getDebateId();
  if (!debateId) return;

  loadDebate(debateId);
}
function scrollToArgumentFromSummary(argId) {
  const element = getVisibleArgumentElement(argId);
  if (!element) return;

  const topbar = document.querySelector(".topbar");

  const scrollElementHigh = () => {
    const rect = element.getBoundingClientRect();
    const offset = (topbar ? topbar.offsetHeight : 80) + 110;
    const y = rect.top + window.scrollY - offset;

    window.scrollTo({
      top: Math.max(0, y),
      behavior: "smooth"
    });
  };

  scrollElementHigh();

  setTimeout(() => {
    scrollElementHigh();
  }, 260);

  setTimeout(() => {
    applyVoiceHighlight(element);

    setTimeout(() => {
      removeVoiceHighlight(element);
    }, 2000);
  }, 420);
}
async function deleteReportedTarget(targetType, targetId) {
  if (!isAdmin()) {
    alert("Mode admin requis.");
    return;
  }

  let url = "";
  let confirmMessage = "";

  if (targetType === "debate") {
    url = API + "/debates/" + targetId;
    confirmMessage = "Supprimer cette arène ?";
  }

  if (targetType === "argument") {
    url = API + "/arguments/" + targetId;
    confirmMessage = "Supprimer cette idée ?";
  }

  if (targetType === "comment") {
    url = API + "/comments/" + targetId;
    confirmMessage = "Supprimer ce commentaire ?";
  }

  if (!url) {
    alert("Type de contenu inconnu.");
    return;
  }

  const confirmed = window.confirm(confirmMessage);
  if (!confirmed) return;

  try {
    await fetchJSON(url, {
      method: "DELETE",
      headers: {
        "x-admin-token": getAdminToken()
      }
    });

    await initAdminReports();
  } catch (error) {
    alert(error.message);
  }
}
async function deleteReport(targetType, targetId) {
  if (!isAdmin()) {
    alert("Mode admin requis.");
    return;
  }

  const confirmed = window.confirm("Supprimer ce signalement de la liste ?");
  if (!confirmed) return;

  try {
    await fetchJSON(API + "/admin/reports/by-target", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": getAdminToken()
      },
      body: JSON.stringify({
        target_type: targetType,
        target_id: targetId
      })
    });

    await initAdminReports();
  } catch (error) {
    alert(error.message);
  }
}
/* =========================
   Delete admin
========================= */
function openReportBox(targetType, targetId) {
  const existing = document.getElementById("report-box-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "report-box-overlay";
  overlay.className = "report-box-overlay";

  overlay.innerHTML = `
    <div class="report-box">
      <h3>Signaler ce contenu</h3>
      <p>Choisis un motif :</p>

      <div class="report-box-actions">
        <button
          class="report-choice-button"
          type="button"
          onclick="submitReport('${targetType}', '${targetId}', 'inapproprie')"
        >
          Propos inappropriés
        </button>

        <button
          class="report-choice-button"
          type="button"
          onclick="submitReport('${targetType}', '${targetId}', 'doublon')"
        >
          Doublon / déjà existant
        </button>

        ${
          targetType === "argument"
            ? `
              <button
                class="report-choice-button"
                type="button"
                onclick="submitReport('${targetType}', '${targetId}', 'plusieurs_arguments')"
              >
                Plusieurs arguments développés
              </button>
            `
            : ""
        }
      </div>

      <button class="report-close-button" type="button" onclick="closeReportBox()">
        Annuler
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
}

function closeReportBox() {
  const overlay = document.getElementById("report-box-overlay");
  if (overlay) overlay.remove();
}

async function submitReport(targetType, targetId, reason) {
  try {
   await fetchJSON(API + "/reports", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    target_type: targetType,
    target_id: targetId,
    reason,
    voterKey: getKey()
  })
});

    closeReportBox();
    alert("Signalement envoyé.");
 } catch (error) {
  if (error.message === "already_reported") {
    alert("Tu as déjà signalé ce contenu.");
    return;
  }

  alert(error.message);
}
}
async function deleteDebate(debateId, redirectAfter) {
  if (!isAdmin()) {
    alert("Mode admin requis.");
    return;
  }

  const confirmed = window.confirm("Supprimer définitivement cette arène ?");
  if (!confirmed) return;

  try {
    await fetchJSON(API + "/debates/" + debateId, {
      method: "DELETE",
      headers: {
        "x-admin-token": getAdminToken()
      }
    });

    if (redirectAfter) {
      location = "/";
    } else {
      location.reload();
    }
  } catch (error) {
    alert(error.message);
  }
}


async function deleteComment(debateId, commentId) {
  const confirmed = window.confirm("Supprimer définitivement ce commentaire ?");
  if (!confirmed) return;

  try {
    await fetchJSON(
      API + "/comments/" + commentId + "?authorKey=" + encodeURIComponent(getKey()),
      {
        method: "DELETE",
        headers: isAdmin()
          ? { "x-admin-token": getAdminToken() }
          : {}
      }
    );

    await loadDebate(debateId);
  } catch (error) {
    alert(error.message);
  }
}

/* =========================
   Toggle form
========================= */

function toggleForm(side) {
  const form = document.getElementById("form-" + side);
  if (!form) return;

  const isHidden =
    form.style.display === "none" ||
    form.style.display === "";

  const otherSide = side === "a" ? "b" : "a";
  const otherForm = document.getElementById("form-" + otherSide);

  if (otherForm) {
    otherForm.style.display = "none";
  }

  if (isHidden) {
    form.style.display = "grid";
    openedArgumentForm = form;
    document.body.classList.add("argument-form-open");
  } else {
    form.style.display = "none";
    openedArgumentForm = null;
    document.body.classList.remove("argument-form-open");
  }
}

function toggleComments(argumentId) {
  const willOpen = !openCommentsByArgument[argumentId];
  openCommentsByArgument[argumentId] = willOpen;

  if (willOpen && !visibleCommentsByArgument[argumentId]) {
    visibleCommentsByArgument[argumentId] = 5;
  }

  const debateId = getDebateId();
  if (!debateId) return;

  if (!willOpen) {
    pendingArgumentScrollId = String(argumentId);
  }

  loadDebate(debateId);
}

document.addEventListener("click", function(event) {
  const radio = event.target;

  if (
    radio.tagName === "INPUT" &&
    radio.type === "radio" &&
    radio.name.startsWith("comment-stance-")
  ) {
    if (radio.dataset.waschecked === "true") {
      radio.checked = false;
      radio.dataset.waschecked = "false";
    } else {
      document
        .querySelectorAll(`input[name="${radio.name}"]`)
        .forEach((r) => (r.dataset.waschecked = "false"));

      radio.dataset.waschecked = "true";
    }

    const commentForm = radio.closest(".comment-form");
    const ameliorationFields = commentForm?.querySelector(".comment-amelioration-fields");
    const mainField = commentForm?.querySelector(".comment-main-field");

    if (ameliorationFields) {
      const shouldShow = radio.checked && radio.value === "amelioration";
      ameliorationFields.style.display = shouldShow ? "grid" : "none";

      if (mainField) {
        mainField.style.display = shouldShow ? "none" : "block";
      }
    }
  }
});

function loadMoreComments(argumentId) {
  visibleCommentsByArgument[argumentId] =
    (visibleCommentsByArgument[argumentId] || 5) + 5;

  const debateId = getDebateId();
  if (!debateId) return;

  loadDebate(debateId);
}
window.toggleForm = toggleForm;
window.toggleComments = toggleComments;

function initDebateTopbarAutoHide() {
  if (window.location.pathname !== "/debate") return;

  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  let ticking = false;
  let lastScrollY = window.scrollY;
  const SHOW_THRESHOLD = 80;
  const HIDE_THRESHOLD = 10;

  function updateTopbar() {
    const currentScrollY = window.scrollY;
    const delta = currentScrollY - lastScrollY;

    if (currentScrollY <= 10) {
      topbar.classList.remove("topbar-hidden");
      document.body.classList.remove("debate-topbar-hidden");
      lastScrollY = currentScrollY;
      ticking = false;
      return;
    }

    if (delta > HIDE_THRESHOLD) {
      topbar.classList.add("topbar-hidden");
      document.body.classList.add("debate-topbar-hidden");
      lastScrollY = currentScrollY;
      ticking = false;
      return;
    }

    if (delta < -SHOW_THRESHOLD) {
      topbar.classList.remove("topbar-hidden");
      document.body.classList.remove("debate-topbar-hidden");
      lastScrollY = currentScrollY;
      ticking = false;
      return;
    }

    lastScrollY = currentScrollY;
    ticking = false;
  }

  window.addEventListener("scroll", () => {
    if (!ticking) {
      window.requestAnimationFrame(updateTopbar);
      ticking = true;
    }
  });

  updateTopbar();
}

function loadMoreArguments() {
  argumentsVisible += 6;

  const debateId = getDebateId();
  if (!debateId) return;

  loadDebate(debateId);
}
async function editDebate() {
  const debateId = getDebateId();
  if (!debateId) return;

  const currentQuestion = document.getElementById("debate-question")?.textContent?.trim() || "";
  const currentOptionA = document.getElementById("title-a")?.textContent?.trim() || "";
  const currentOptionB = document.getElementById("title-b")?.textContent?.trim() || "";

  const question = window.prompt("Modifier le titre de l'arène :", currentQuestion);
  if (question === null) return;

  const option_a = window.prompt("Modifier la position A :", currentOptionA);
  if (option_a === null) return;

  const option_b = window.prompt("Modifier la position B :", currentOptionB);
  if (option_b === null) return;

  try {
    await fetchJSON(API + "/admin/debate/" + debateId, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": getAdminToken()
      },
      body: JSON.stringify({
        question: question.trim(),
        option_a: option_a.trim(),
        option_b: option_b.trim()
      })
    });

    await loadDebate(debateId);
  } catch (error) {
    alert(error.message);
  }
}
async function editArgument(argumentId) {
  const debateId = getDebateId();
  if (!debateId) return;

  try {
    const data = await fetchJSON(API + "/debates/" + debateId);

    const allArguments = [...(data.optionA || []), ...(data.optionB || [])];
    const argument = allArguments.find(a => String(a.id) === String(argumentId));

    if (!argument) {
      alert("Idée introuvable.");
      return;
    }

    const title = window.prompt("Modifier le titre de l'idée :", argument.title || "");
    if (title === null) return;

    const body = window.prompt("Modifier le texte de l'idée :", argument.body || "");
    if (body === null) return;

    await fetchJSON(API + "/admin/argument/" + argumentId, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": getAdminToken()
      },
      body: JSON.stringify({
        title: title.trim(),
        body: body.trim()
      })
    });

    await loadDebate(debateId);

  } catch (error) {
    alert(error.message);
  }
}
/* =========================
   Boot
========================= */
function showReplacementSuccessMessage() {
  const existing = document.getElementById("replacement-success-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "replacement-success-overlay";
  overlay.className = "replacement-success-overlay";

  overlay.innerHTML = `
    <div class="replacement-success-box">
      <div class="replacement-success-icon">✨</div>
      <div class="replacement-success-title">Nouvelle meilleure idée</div>
<div class="replacement-success-text">
  Cette proposition d'amélioration a convaincu, elle prend désormais la place de l’idée initiale !
</div>
      <button
        type="button"
        class="replacement-success-button"
        onclick="closeReplacementSuccessMessage()"
      >
        Continuer
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.classList.add("replacement-success-overlay-visible");
  }, 10);
}

function closeReplacementSuccessMessage() {
  const overlay = document.getElementById("replacement-success-overlay");
  if (!overlay) return;

  overlay.classList.remove("replacement-success-overlay-visible");

  setTimeout(() => {
    overlay.remove();
  }, 250);
}
document.addEventListener("DOMContentLoaded", () => {
  attachAdminButtons();
  loadNotifications();
  renderGlobalShareBar();
  initDebateTopbarAutoHide();

  if (location.pathname === "/") initIndex();
  if (location.pathname === "/create") initCreate();
  if (location.pathname === "/debate") initDebate();
  if (location.pathname === "/admin-reports") initAdminReports();
  if (location.pathname === "/notifications") loadNotificationsPage();

  loadReportsBadge();

  setInterval(() => {
    loadNotifications();
  }, 20000);

  setInterval(() => {
    loadReportsBadge();
  }, 20000);
  const resetNotificationsBtn = document.getElementById("reset-notifications-btn");
  if (resetNotificationsBtn) {
    resetNotificationsBtn.addEventListener("click", resetNotifications);
  }
});

async function loadNotificationsPage() {
  const list = document.getElementById("notifications-page-list");
  if (!list) return;

  try {
    const notifications = await fetchJSON(
      API + "/notifications?userKey=" + encodeURIComponent(getKey())
    );
const unread = notifications.filter(n => !n.is_read).length;

const previous = Number(localStorage.getItem("lastNotifCount") || 0);

if (unread > previous) {
  const bell = document.querySelector(".notifications-button");
  if (bell) {
    bell.classList.add("bell-ring");
    setTimeout(() => bell.classList.remove("bell-ring"), 2000);
  }
}

localStorage.setItem("lastNotifCount", unread);

    if (!notifications.length) {
      list.innerHTML = `<div class="empty-state">Aucune notification.</div>`;
      return;
    }

    list.innerHTML = notifications.map((notification) => {
  let link = "#";
let icon = "🔔";
let title = notification.message || "Nouvelle notification";
let subtitle = "Ouvrir";

if (notification.type === "replacement_accepted" && notification.argument_id) {
  link = `/debate?id=${notification.debate_id}&highlight=argument-${notification.argument_id}`;
} else if (notification.comment_id) {
  link = `/debate?id=${notification.debate_id}&highlight=comment-${notification.comment_id}`;
} else if (notification.argument_id) {
  link = `/debate?id=${notification.debate_id}&highlight=argument-${notification.argument_id}`;
} else if (notification.debate_id) {
  link = `/debate?id=${notification.debate_id}&highlight=debate`;
}

if (notification.type === "vote_on_argument") {
  icon = "🗳️";
  title = "Votre idée a reçu une voix";
  subtitle = "Ouvrir l'idée";
}
if (notification.type === "replacement_accepted") {
  icon = "🏆";
  title = "Votre proposition a remplacé l'idée initiale";
  subtitle = "Voir l'idée remplacée";
}

      if (notification.type === "comment_on_argument") {
        icon = "💬";
        title = "Quelqu’un a commenté votre idée";
        subtitle = "Ouvrir le commentaire";
      }

      if (notification.type === "argument_in_my_debate") {
        icon = "🧠";
        title = "Une nouvelle idée a été postée dans votre arène";
        subtitle = "Ouvrir l'arène";
      }

if (notification.type === "like_on_comment") {
  icon = "👍";
  title = "Votre commentaire a été apprécié";
  subtitle = "Ouvrir le commentaire";
}
if (notification.type === "dislike_on_comment") {
  icon = "👎";
  title = "Votre commentaire n’a pas été apprécié";
  subtitle = "Ouvrir le commentaire";
}
if (notification.type === "reply_to_comment") {
  icon = "↩️";
  title = "Quelqu’un a répondu à votre commentaire";
  subtitle = "Ouvrir la réponse";
}
     return `
 <a
  class="notification-item ${Number(notification.is_read) === 0 ? "notification-item-unread" : ""}"
  href="${link}"
  onclick="handleNotificationClick(event, '${notification.id}', '${link}')"
>
          <div class="notification-top">
            <span class="notification-icon">${icon}</span>
            <div class="notification-texts">
              <div class="notification-title">${escapeHtml(title)}</div>
              <div class="notification-subtitle">${escapeHtml(subtitle)}</div>
            </div>
          </div>
          <div class="notification-date">${escapeHtml(formatDebateDate(notification.created_at))}</div>
        </a>
      `;
    }).join("");

  } catch (error) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}




document.addEventListener("click", function(event) {
  const dropdown = document.querySelector(".sort-dropdown");
  const menu = document.getElementById("sort-menu");

  if (!dropdown || !menu) return;

  if (!dropdown.contains(event.target)) {
    menu.classList.remove("sort-menu-visible");
  }
});

function updateCounter(inputId, counterId, max) {
  const input = document.getElementById(inputId);
  const counter = document.getElementById(counterId);
  if (!input || !counter) return;

  counter.textContent = `${input.value.length} / ${max}`;
}

function handleArgumentInput(side) {
  const normalizedSide = side === "B" ? "b" : side === "A" ? "a" : side;

  const warning = document.getElementById(`warning-${normalizedSide}`);
  const titleInput = document.getElementById(
    normalizedSide === "list" ? "list-title" : `${normalizedSide}-title`
  );
  const bodyInput = document.getElementById(
    normalizedSide === "list" ? "list-body" : `${normalizedSide}-body`
  );

  const text = `${titleInput?.value || ""} ${bodyInput?.value || ""}`.trim();

  if (warning) {
    warning.style.display = text.length >= 10 ? "flex" : "none";
  }

  if (normalizedSide === "list") {
    renderSimilarArgumentsForList();
  } else {
    renderSimilarArgumentsForSide(normalizedSide);
  }
}

function setListArgumentSide(side = "") {
  const normalizedSide = side === "a" || side === "b" ? side : "";

  const hiddenInput = document.getElementById("list-side-value");
  const buttonA = document.getElementById("list-side-a");
  const buttonB = document.getElementById("list-side-b");
  const titleA = document.getElementById("title-a");
  const titleB = document.getElementById("title-b");
  const subtitle = document.getElementById("list-form-subtitle");
  const closeBtn = document.getElementById("list-form-close-btn");

  const isOpenMode = !titleB || !titleB.textContent.trim();

  if (hiddenInput) {
    hiddenInput.value = isOpenMode ? "A" : (normalizedSide ? normalizedSide.toUpperCase() : "");
  }

  if (isOpenMode) {
    if (buttonA) buttonA.style.display = "none";
    if (buttonB) buttonB.style.display = "none";
    if (subtitle) subtitle.style.display = "none";
    if (closeBtn) closeBtn.style.display = "";
    return;
  }

  if (subtitle) subtitle.style.display = "";
  if (closeBtn) closeBtn.style.display = "";

  if (buttonA) {
    buttonA.style.display = "";
    buttonA.classList.toggle("list-position-button-active", normalizedSide === "a");
    buttonA.textContent = titleA ? titleA.textContent.trim() : "Position A";
  }

  if (buttonB) {
    buttonB.style.display = "";
    buttonB.classList.toggle("list-position-button-active", normalizedSide === "b");
    buttonB.textContent = titleB ? titleB.textContent.trim() : "Position B";
  }
}

function closeListArgumentForm() {
  const form = document.getElementById("form-list");
  if (!form) return;

  form.style.display = "none";

  if (openedArgumentForm === form) {
    openedArgumentForm = null;
  }

  document.body.classList.remove("argument-form-open");
}

function closeArgumentForm() {
  ["form-a", "form-b", "form-list"].forEach((id) => {
    const form = document.getElementById(id);
    if (form) {
      form.style.display = "none";
    }
  });

  openedArgumentForm = null;
  document.body.classList.remove("argument-form-open");
}


function openListArgumentForm(side = "a") {
  const form = document.getElementById("form-list");
  if (!form) return;

  const formA = document.getElementById("form-a");
  const formB = document.getElementById("form-b");

  if (formA) formA.style.display = "none";
  if (formB) formB.style.display = "none";

  form.style.display = "grid";
  openedArgumentForm = form;
  document.body.classList.add("argument-form-open");

setListArgumentSide("");

  setTimeout(() => {
    const titleInput = document.getElementById("list-title");
    if (titleInput) titleInput.focus();
  }, 50);
}

function openArgumentFormAndScroll(side) {
  const normalizedSide = side === "b" ? "b" : "a";
  const form = document.getElementById(`form-${normalizedSide}`);
  if (!form) return;

  const otherForm = document.getElementById(`form-${normalizedSide === "a" ? "b" : "a"}`);
  const listForm = document.getElementById("form-list");

  if (otherForm) otherForm.style.display = "none";
  if (listForm) listForm.style.display = "none";

  form.style.display = "grid";
  openedArgumentForm = form;
  document.body.classList.add("argument-form-open");

  setTimeout(() => {
    const topbar = document.querySelector(".topbar");
    const offset = (topbar ? topbar.offsetHeight : 80) + 100;
    const y = form.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({
      top: Math.max(0, y),
      behavior: "smooth"
    });

    const titleInput = document.getElementById(`${normalizedSide}-title`);
    if (titleInput) titleInput.focus();
  }, 50);
}

function openArgumentComposer(side) {
  const listForm = document.getElementById("form-list");
  if (!listForm) return;

  const formA = document.getElementById("form-a");
  const formB = document.getElementById("form-b");

  if (formA) formA.style.display = "none";
  if (formB) formB.style.display = "none";

  listForm.style.display = "grid";
  openedArgumentForm = listForm;
  document.body.classList.add("argument-form-open");

setListArgumentSide("");
  setTimeout(() => {
    const topbar = document.querySelector(".topbar");
    const offset = topbar ? topbar.offsetHeight + 20 : 100;
    const y = listForm.offsetTop - offset;

    window.scrollTo({
      top: y,
      behavior: "smooth"
    });

    const titleInput = document.getElementById("list-title");
    if (titleInput) titleInput.focus();
  }, 50);
}
async function deleteArgument(debateId, argumentId) {
  const confirmed = window.confirm("Supprimer définitivement cette idée ?");
  if (!confirmed) return;

  try {
    await fetchJSON(
      API + "/arguments/" + argumentId + "?authorKey=" + encodeURIComponent(getKey()),
      {
        method: "DELETE",
        headers: isAdmin()
          ? { "x-admin-token": getAdminToken() }
          : {}
      }
    );

 delete openCommentsByArgument[argumentId];

const state = getState(debateId);
delete state[String(argumentId)];
setState(debateId, state);

await loadDebate(debateId);
  } catch (error) {
    alert(error.message);
  }
}

window.updateCounter = updateCounter;
window.handleArgumentInput = handleArgumentInput;
window.setListArgumentSide = setListArgumentSide;
window.closeListArgumentForm = closeListArgumentForm;
window.openListArgumentForm = openListArgumentForm;
window.openArgumentFormAndScroll = openArgumentFormAndScroll;
window.openArgumentComposer = openArgumentComposer;
window.vote = vote;
window.unvote = unvote;
window.voteComment = voteComment;
window.editDebate = editDebate;window.editArgument = editArgument;
window.deleteDebate = deleteDebate;
window.deleteArgument = deleteArgument;
window.deleteComment = deleteComment;
window.submitComment = submitComment;
window.getDebateId = getDebateId;
window.copyDebateLink = copyDebateLink;
window.shareOnX = shareOnX;
window.shareOnFacebook = shareOnFacebook;
window.shareOnWhatsApp = shareOnWhatsApp;
window.shareByEmail = shareByEmail;
window.shareOnInstagram = shareOnInstagram;
window.copyIndexDebateLink = copyIndexDebateLink;
window.shareIndexDebateOnX = shareIndexDebateOnX;
window.shareIndexDebateOnFacebook = shareIndexDebateOnFacebook;
window.shareIndexDebateOnWhatsApp = shareIndexDebateOnWhatsApp;
window.shareIndexDebateByEmail = shareIndexDebateByEmail;
window.openReportBox = openReportBox;
window.closeReportBox = closeReportBox;
window.submitReport = submitReport;
window.deleteReport = deleteReport;
window.deleteReportedTarget = deleteReportedTarget;

window.toggleNotificationsPanel = toggleNotificationsPanel;
window.handleNotificationClick = handleNotificationClick;
window.resetNotifications = resetNotifications;
window.loadMoreVisitedDebates = loadMoreVisitedDebates;
window.loadMoreOtherDebates = loadMoreOtherDebates;
window.loadMoreComments = loadMoreComments;
window.replyToComment = replyToComment;
window.cancelReply = cancelReply;
window.changeArgumentsSort = changeArgumentsSort;
window.setTypeFilter = setTypeFilter;
window.toggleSortMenu = toggleSortMenu;
window.loadMoreArguments = loadMoreArguments;
window.setDebateViewMode = setDebateViewMode;
window.toggleSimilarDebates = toggleSimilarDebates;
window.scrollToArgumentFromSummary = scrollToArgumentFromSummary;
window.setDebateColumnFocus = setDebateColumnFocus;
window.closeReplacementSuccessMessage = closeReplacementSuccessMessage;