const API = "/api";
let argumentsVisible = 6;

let currentDebateShareData = {
  question: "",
  optionA: "",
  optionB: "",
  percentA: 50,
  percentB: 50
};

let indexCardHighlightRaf = null;
let indexCardHighlightBound = false;

let pendingArgumentScrollId = null;
let pendingCommentScrollId = null;
let openedArgumentForm = null;
let pinnedNewCommentId = null;
let pinnedNewArgumentId = null;
let pendingTopCommentScroll = null;

let currentAllArguments = [];
let currentCommentsByArgument = {};
let currentDebateViewMode = "columns";
let similarDebatesVisible = false;
let currentDebateCache = null;
let similarDebatesCache = null;
let currentTypeFilter = "all";
let currentCategoryFilter = "all";
let currentArgumentsSortMode = "score";

let pendingMobileColumnFocusElementId = null;
let pendingMobileColumnFocusElementTop = null
let pendingColumnFocusScrollMode = null;
let pendingVoicesSummaryHighlight = false;

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
  mainButton.textContent = "Ajouter une idée";
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
  const previousMode = getDebateViewMode();

  localStorage.setItem("debate_view_mode", normalizedMode);
  currentDebateViewMode = normalizedMode;

  if (normalizedMode === "columns") {
    localStorage.setItem("debate_column_focus", "split");

    const columns = document.querySelector(".debate-columns");
    if (columns) {
      columns.classList.remove("focus-a", "focus-b");
    }
  }

  if (normalizedMode === previousMode) {
    updateDebateViewModeUI();
    return;
  }

  if (Array.isArray(currentAllArguments)) {
    requestAnimationFrame(() => {
      rerenderCurrentDebateArguments();
      updateDebateViewModeUI();
    });
    return;
  }

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

function isColumnFocusScrollContext() {
  return currentDebateViewMode === "columns" && !isCurrentOpenDebateMode();
}



function captureHighestVisibleElementForMobileColumnFocus(targetMode) {
  if (!isColumnFocusScrollContext()) {
    pendingMobileColumnFocusElementId = null;
    pendingMobileColumnFocusElementTop = null;
    return;
  }

  const topbar = document.querySelector(".topbar");
  const topbarHeight = topbar ? topbar.offsetHeight : 0;
  const stickyButtonsOffset = window.innerWidth <= 768 ? 70 : 20;
  const visibleTopLimit = topbarHeight + stickyButtonsOffset;

  const commentSelector =
    targetMode === "a"
      ? `.debate-columns .column-a .comment-card[id]`
      : targetMode === "b"
        ? `.debate-columns .column-b .comment-card[id]`
        : `.debate-columns .comment-card[id]`;

  const argumentSelector =
    targetMode === "a"
      ? `.debate-columns .column-a .argument-card[id]`
      : targetMode === "b"
        ? `.debate-columns .column-b .argument-card[id]`
        : `.debate-columns .argument-card[id]`;

  const getVisibleElements = (selector) => {
    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      if (!element.offsetParent) return false;

      const rect = element.getBoundingClientRect();
      return rect.bottom > visibleTopLimit && rect.top < window.innerHeight;
    });
  };

  const visibleComments = getVisibleElements(commentSelector);
  const visibleArguments = getVisibleElements(argumentSelector);

  const candidates = visibleComments.length ? visibleComments : visibleArguments;

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
  if (!isColumnFocusScrollContext()) return;
  if (!pendingMobileColumnFocusElementId) return;

  const target = document.getElementById(pendingMobileColumnFocusElementId);

  if (!target || !target.offsetParent) {
    pendingMobileColumnFocusElementId = null;
    pendingMobileColumnFocusElementTop = null;
    return;
  }

  const currentTop = target.getBoundingClientRect().top;
  const savedTop = pendingMobileColumnFocusElementTop;

  let delta = 0;
  if (typeof savedTop === "number") {
    delta = currentTop - savedTop;
  }

  window.scrollTo({
    top: Math.max(0, window.scrollY + delta),
    behavior: "auto"
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

  const isGoingFromSplitToSingle =
    previousMode === "split" && ["a", "b"].includes(normalizedMode);

  const isGoingFromSingleToSplit =
    ["a", "b"].includes(previousMode) && normalizedMode === "split";

if (pendingColumnFocusScrollMode === "dblclick") {
  // on garde la carte ciblée → ne rien faire
} else if (isGoingFromSplitToSingle) {
  captureHighestVisibleElementForMobileColumnFocus(normalizedMode);
} else if (isGoingFromSingleToSplit) {
  captureHighestVisibleElementForMobileColumnFocus(previousMode);
} else {
  pendingMobileColumnFocusElementId = null;
  pendingMobileColumnFocusElementTop = null;
}

  localStorage.setItem("debate_column_focus", normalizedMode);
  applyDebateColumnFocusUI();

  if (isGoingFromSplitToSingle || isGoingFromSingleToSplit) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreMobileColumnFocusScroll();
      });
    });
  }

  pendingColumnFocusScrollMode = null;
}

function handleArgumentDoubleClick(event, side, argumentId) {
  pendingColumnFocusScrollMode = "dblclick";

  const clickedComment = event?.target?.closest(".comment-card[id]");
  const clickedArgument = event?.target?.closest(".argument-card[id]");

  if (clickedComment) {
    pendingMobileColumnFocusElementId = clickedComment.id;
    pendingMobileColumnFocusElementTop = clickedComment.getBoundingClientRect().top;
  } else if (clickedArgument) {
    pendingMobileColumnFocusElementId = clickedArgument.id;
    pendingMobileColumnFocusElementTop = clickedArgument.getBoundingClientRect().top;
  } else {
    captureHighestVisibleElementForMobileColumnFocus(side);

    if (!pendingMobileColumnFocusElementId && argumentId) {
      pendingMobileColumnFocusElementId = `argument-${argumentId}`;
      pendingMobileColumnFocusElementTop = 0;
    }
  }

  const currentFocus = getDebateColumnFocus();
  setDebateColumnFocus(currentFocus === side ? "split" : side);
}
function handleHeadingDoubleClick(side) {
  pendingColumnFocusScrollMode = "dblclick";

  const currentFocus = getDebateColumnFocus();
  setDebateColumnFocus(currentFocus === side ? "split" : side);
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
const headingA = document.querySelector(".debate-headings .position-a");
const headingB = document.querySelector(".debate-headings .position-b");

  if (!columns) return;

  // 🚨 BLOQUER LES BOUTONS EN MODE LISTE
  if (currentDebateViewMode === "list") {
    if (sideFocusLeft) sideFocusLeft.style.display = "none";
    if (sideFocusRight) sideFocusRight.style.display = "none";
    return;
  }

  columns.classList.remove("focus-a", "focus-b");


if (openMode) {
  if (headings) headings.style.display = "grid";
  if (sideFocusLeft) sideFocusLeft.style.display = "none";
  if (sideFocusRight) sideFocusRight.style.display = "none";
  if (columnA) columnA.style.display = "";
  if (columnB) columnB.style.display = "";
  return;
}

if (headingA) {
  headingA.classList.remove("position-focus-active", "position-focus-a");
  headingA.style.display = "";
}

if (headingB) {
  headingB.classList.remove("position-focus-active", "position-focus-b");
  headingB.style.display = "";
}

if (headings) headings.style.display = "grid";

if (focusMode === "a") {
  if (headingA) {
    headingA.classList.add("position-focus-active", "position-focus-a");
  }

  if (columnA) columnA.style.display = "";
  if (columnB) columnB.style.display = "none";
  columns.classList.add("focus-a");
} else if (focusMode === "b") {
  if (headingB) {
    headingB.classList.add("position-focus-active", "position-focus-b");
  }

  if (columnA) columnA.style.display = "none";
  if (columnB) columnB.style.display = "";
  columns.classList.add("focus-b");
} else {
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
  return currentArgumentsSortMode || "score";
}

function changeArgumentsSort(mode) {
  const normalizedMode = ["score", "progress", "comments", "recent", "old"].includes(mode)
    ? mode
    : "score";
  const previousMode = getArgumentsSortMode();

  currentArgumentsSortMode = normalizedMode;

  const menu = document.getElementById("sort-menu");
  if (menu) {
    menu.classList.remove("sort-menu-visible");
  }

  updateSortButtonLabel();

  if (normalizedMode === previousMode) {
    return;
  }

  if (pinnedNewArgumentId) {
    pinnedNewArgumentId = null;
  }

  if (Array.isArray(currentAllArguments) && currentAllArguments.length) {
    requestAnimationFrame(() => {
      rerenderCurrentDebateArguments();
    });
    return;
  }

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
    progress: "Idées en progression",
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
  } else if (mode === "progress") {
    return sortArgumentsByProgress(sorted);
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
function getLastVotedAtTimestamp(arg) {
  return new Date(String(arg?.last_voted_at || "").replace(" ", "T")).getTime() || 0;
}
function sortArgumentsByScore(args) {
  const ordered = [...(args || [])].sort((a, b) => {
    const votesA = Number(a.votes || 0);
    const votesB = Number(b.votes || 0);

    if (votesB !== votesA) {
      return votesB - votesA;
    }

    return Number(b.id || 0) - Number(a.id || 0);
  });

  return movePinnedArgumentToFourthPosition(ordered);
}
function sortArgumentsByProgress(args) {
  const ordered = [...(args || [])].sort((a, b) => {
    const lastVoteA = getLastVotedAtTimestamp(a);
    const lastVoteB = getLastVotedAtTimestamp(b);

    if (lastVoteB !== lastVoteA) {
      return lastVoteB - lastVoteA;
    }

    const votesA = Number(a.votes || 0);
    const votesB = Number(b.votes || 0);

    if (votesB !== votesA) {
      return votesB - votesA;
    }

    return Number(b.id || 0) - Number(a.id || 0);
  });

  return movePinnedArgumentToFourthPosition(ordered);
}

function getSupportRankMap(args) {
  const sortedArgs = sortArgumentsByScore(args || []);
  const rankMap = {};

  sortedArgs.forEach((arg, index) => {
    rankMap[String(arg.id)] = index + 1;
  });

  return rankMap;
}

function formatIdeaRank(rank) {
  const numericRank = Number(rank || 0);

  if (!numericRank || numericRank < 1) {
    return "classement inconnu";
  }

  if (numericRank === 1) {
    return "première place";
  }

  if (numericRank === 2) {
    return "deuxième place";
  }

  if (numericRank === 3) {
    return "troisième place";
  }

  return `${numericRank}e place`;
}

function showVoteRankProgress(beforeRankMap, afterArgs, argId) {
  const argIdString = String(argId);
  const previousRank = Number(beforeRankMap?.[argIdString] || 0);
  const afterRankMap = getSupportRankMap(afterArgs || []);
  const newRank = Number(afterRankMap[argIdString] || 0);

  if (!previousRank || !newRank || newRank >= previousRank) {
    return;
  }

  const gainedPlaces = previousRank - newRank;
  const placeLabel = gainedPlaces === 1 ? "place" : "places";
if (newRank >= 1 && newRank <= 3) {
  const medalIcon =
    newRank === 1 ? "🥇" :
    newRank === 2 ? "🥈" :
    "🥉";

  const topTitle =
    newRank === 1 ? "Première place du classement" :
    newRank === 2 ? "Deuxième place du classement" :
    "Troisième place du classement";

  showReplacementSuccessMessage(
    topTitle,
    `Vous avez fait gagner ${gainedPlaces} ${placeLabel} à cette idée, qui arrive maintenant à la ${formatIdeaRank(newRank)} du classement.`,
    null,
    medalIcon,
    "ranking-medal-vibrate"
  );

  return;
}

  showReplacementSuccessMessage(
    "🚀 Belle progression",
    `Vous avez fait gagner ${gainedPlaces} ${placeLabel} à cette idée, qui arrive maintenant à la ${formatIdeaRank(newRank)} du classement.`
  );
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
  syncVoiceGuidanceState(debateId);
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
  myArgumentsRow.classList.remove("my-arguments-row-single");

  if (!hasAnyVotedArgument) {
    myArgumentsRow.style.display = "none";
  } else if (votedArgumentsA.length > 0 && votedArgumentsB.length > 0) {
    myArgumentsRow.style.display = "grid";
  } else {
    myArgumentsRow.style.display = "block";
    myArgumentsRow.classList.add("my-arguments-row-single");
  }
}

  if (myArgumentsA) {
    if (!votedArgumentsA.length) {
      myArgumentsA.innerHTML = "";
      myArgumentsA.style.display = "none";
    } else {
      myArgumentsA.style.display = "";
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
                  data-voice-arg-id="${item.id}"
                  data-voice-action="minus"
                  onclick="unvote('${debateId}', '${item.id}', false, this)"
                  aria-label="Retirer une voix"
                  title="Retirer une voix"
                >
                  −
                </button>

                <span class="my-argument-chip-count">${item.count}</span>

                <button
                  type="button"
                  class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-plus"
                  data-voice-arg-id="${item.id}"
                  data-voice-action="plus"
                  onclick="vote('${debateId}', '${item.id}', false, this)"
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
      myArgumentsB.style.display = "none";
    } else {
      myArgumentsB.style.display = "";
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
                  data-voice-arg-id="${item.id}"
                  data-voice-action="minus"
                  onclick="unvote('${debateId}', '${item.id}', false, this)"
                  aria-label="Retirer une voix"
                  title="Retirer une voix"
                >
                  −
                </button>

                <span class="my-argument-chip-count">${item.count}</span>

                <button
                  type="button"
                  class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-plus"
                  data-voice-arg-id="${item.id}"
                  data-voice-action="plus"
                  onclick="vote('${debateId}', '${item.id}', false, this)"
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
  syncVoiceGuidanceState(debateId);
}
/* =========================
   Helpers
========================= */

function getDebateId() {
  const p = new URLSearchParams(window.location.search);
  return p.get("id");
}

function openIndexDebateFromMedia(debateId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const safeDebateId = String(debateId || "").trim();
  if (!safeDebateId) return;

  window.location.href = `/debate?id=${encodeURIComponent(safeDebateId)}`;
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
function ensureArgumentCardVisibleForScroll(argumentId) {
  const argIdString = String(argumentId || "");
  if (!argIdString) return null;

  let element = getVisibleArgumentElement(argIdString);
  if (element) return element;

  const sortedArgs = sortArgumentsByMode(
    currentAllArguments || [],
    currentCommentsByArgument || {}
  );

  const targetIndex = sortedArgs.findIndex(
    (arg) => String(arg.id) === argIdString
  );

  if (targetIndex === -1) return null;

  const minimumVisibleCount = targetIndex + 1;
  const expandedVisibleCount = Math.ceil(minimumVisibleCount / 6) * 6;

  if (argumentsVisible < expandedVisibleCount) {
    argumentsVisible = expandedVisibleCount;
    rerenderCurrentDebateArguments();
    element = getVisibleArgumentElement(argIdString);
  }

  return element || getVisibleArgumentElement(argIdString);
}
function scrollToTopOfArgumentCardAndFlash(argumentId) {
  const element = ensureArgumentCardVisibleForScroll(argumentId);
  if (!element) return;

  const topbar = document.querySelector(".topbar");
  const offset = (topbar ? topbar.offsetHeight : 80) + 60;

  const scrollHigh = () => {
    const rect = element.getBoundingClientRect();
    const y = rect.top + window.scrollY - offset;

    window.scrollTo({
      top: Math.max(0, y),
      behavior: "smooth"
    });
  };

  scrollHigh();

  setTimeout(() => {
    scrollHigh();
  }, 260);

  setTimeout(() => {
    const isGreenTarget =
      element.classList.contains("argument-card-a") ||
      !!element.closest(".argument-card-a") ||
      !!element.closest("#arguments-a") ||
      !!element.closest(".column-a");

    element.classList.remove("flash-green", "admin-highlight");
    void element.offsetWidth;

    if (isGreenTarget) {
      element.classList.add("flash-green");
      setTimeout(() => {
        element.classList.remove("flash-green");
      }, 5000);
    } else {
      element.classList.add("admin-highlight");
      setTimeout(() => {
        element.classList.remove("admin-highlight");
      }, 5000);
    }
  }, 420);
}
function scrollToTopOfArgumentCard(argumentId) {
  const element = ensureArgumentCardVisibleForScroll(argumentId);
  if (!element) return;

  const topbar = document.querySelector(".topbar");
  const offset = (topbar ? topbar.offsetHeight : 80) + 60;

  const rect = element.getBoundingClientRect();
  const y = rect.top + window.scrollY - offset;

  window.scrollTo({
    top: Math.max(0, y),
    behavior: "smooth"
  });
}
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#039;");
}

function getDomainLabel(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "");
  } catch (error) {
    return "Source externe";
  }
}

function truncateSourcePreviewText(text, maxLength = 240) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function pickFirstSourcePreviewValue(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      const normalized = value.trim();
      if (normalized) return normalized;
      continue;
    }

    if (Array.isArray(value)) {
      const picked = pickFirstSourcePreviewValue(...value);
      if (picked) return picked;
      continue;
    }

    if (value && typeof value === "object") {
      const picked = pickFirstSourcePreviewValue(
        value.url,
        value.secure_url,
        value.src,
        value.href,
        value.content,
        value.image,
        value.thumbnail
      );
      if (picked) return picked;
    }
  }

  return "";
}

function normalizeSourcePreviewData(preview, sourceUrl = "") {
  const safePreview = preview && typeof preview === "object" ? preview : {};
  const safeUrl = pickFirstSourcePreviewValue(
    safePreview.finalUrl,
    safePreview.canonicalUrl,
    safePreview.url,
    sourceUrl
  );
  const domain = pickFirstSourcePreviewValue(
    safePreview.siteName,
    safePreview.domain,
    safePreview.publisher,
    safePreview.provider,
    safePreview.source,
    getDomainLabel(safeUrl || sourceUrl)
  ) || "Source externe";
  const title = pickFirstSourcePreviewValue(
    safePreview.title,
    safePreview.ogTitle,
    safePreview.metaTitle,
    safePreview.headline,
    safePreview.name,
    domain,
    "Source externe"
  ) || "Source externe";
  const description = truncateSourcePreviewText(
    pickFirstSourcePreviewValue(
      safePreview.description,
      safePreview.ogDescription,
      safePreview.metaDescription,
      safePreview.excerpt,
      safePreview.summary,
      safePreview.text,
      safePreview.content,
      safePreview.snippet
    ),
    240
  );
  const image = pickFirstSourcePreviewValue(
    safePreview.image,
    safePreview.imageUrl,
    safePreview.thumbnail,
    safePreview.thumbnailUrl,
    safePreview.ogImage,
    safePreview.cover,
    safePreview.poster,
    safePreview.posterUrl,
    safePreview.media?.image,
    safePreview.images
  );

  return {
    url: safeUrl,
    domain,
    title,
    description,
    image
  };
}

function isWeakSourcePreviewData(preview, sourceUrl = "") {
  const normalized = normalizeSourcePreviewData(preview, sourceUrl);
  const title = String(normalized.title || "").trim().toLowerCase();
  const description = String(normalized.description || "").trim().toLowerCase();
  const image = String(normalized.image || "").trim();

  if (!title || title === "source externe") return true;
  if (!image && (!description || description === "source externe")) return true;

  const blockedMarkers = [
    "access denied",
    "just a moment",
    "attention required",
    "enable javascript",
    "verify you are human"
  ];

  return blockedMarkers.some((marker) => title.includes(marker) || description.includes(marker));
}

function buildXIndexSourceCardHtml(sourceUrl, preview = null) {
  const normalizedPreview = normalizeSourcePreviewData(preview, sourceUrl);
  const safeUrl = normalizedPreview.url || String(sourceUrl || "").trim() || "#";
  const title = normalizedPreview.title && normalizedPreview.title !== "Source externe"
    ? normalizedPreview.title
    : "Source publiée sur X";
  const description = normalizedPreview.description || "Voir le post source sur X.";
  const image = normalizedPreview.image || "";

  return `
    <div
      class="debate-card-source debate-card-source-x"
      style="display:block; overflow:hidden; border-radius:20px; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 28px rgba(15,23,42,0.08); color:inherit;"
    >
      ${image ? `
        <div style="display:block; width:100%; aspect-ratio:16/9; background:#f3f4f6; overflow:hidden;">
          <img
            src="${escapeAttribute(image)}"
            alt="Aperçu du post X"
            loading="lazy"
            decoding="async"
            style="display:block; width:100%; height:100%; object-fit:cover;"
            onerror="this.closest('div')?.remove();"
          >
        </div>
      ` : ""}
      <div style="padding:10px 16px 14px; display:flex; flex-direction:column; gap:6px;">
        <div style="font-size:12px; line-height:1.4; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em;">𝕏 Source</div>
        <div style="font-size:18px; line-height:1.35; font-weight:800; color:#111827;">${escapeHtml(title)}</div>
        <div style="font-size:14px; line-height:1.55; color:#4b5563;">${escapeHtml(description)}</div>
        <div>
          <a
            class="debate-source-link"
            href="${escapeAttribute(safeUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            style="display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:700; color:#111111; text-decoration:none;"
          >↗ Voir le post sur X</a>
        </div>
      </div>
    </div>
  `;
}

function buildIndexDebateNavigationOverlay(debateId, label = "Ouvrir le débat") {
  const safeDebateId = String(debateId || "").trim();
  if (!safeDebateId) return "";

  return `
    <button
      type="button"
      class="debate-card-index-nav-overlay"
      data-index-debate-nav
      onclick="openIndexDebateFromMedia('${escapeAttribute(safeDebateId)}', event)"
      aria-label="${escapeAttribute(label)}"
      title="${escapeAttribute(label)}"
      style="position:absolute; inset:0; z-index:30; display:block; width:100%; height:100%; border:0; padding:0; margin:0; background:transparent; cursor:pointer;"
    ></button>
  `;
}

function buildIndexXEmbedHtml(sourceUrl, preview = null, debateId = "") {
  const tweetId = getXStatusId(sourceUrl);
  if (!tweetId) {
    return buildXIndexSourceCardHtml(sourceUrl, preview);
  }

  return `
    <div class="debate-card-media debate-card-media-x">
      <div
        class="debate-card-x-shell"
        data-index-x-shell
        data-source-url="${escapeAttribute(String(sourceUrl || "").trim())}"
        data-tweet-id="${escapeAttribute(tweetId)}"
        style="position:relative;"
      >
        <div
          data-index-x-loading
          style="display:flex; align-items:center; justify-content:center; min-height:220px; padding:18px; border-radius:20px; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 28px rgba(15,23,42,0.08); color:#374151; font-size:14px; font-weight:700; text-align:center;"
        >Chargement du post X…</div>
        <div data-index-x-embed style="display:none;"></div>
        <div data-index-x-fallback style="display:none;">${buildXIndexSourceCardHtml(sourceUrl, preview)}</div>
        ${buildIndexDebateNavigationOverlay(debateId, "Ouvrir le débat lié à ce post X")}
      </div>
    </div>
  `;
}

function buildIndexInstagramFallbackHtml(sourceUrl, preview = null) {
  const normalizedPreview = normalizeSourcePreviewData(preview, sourceUrl);
  const safeUrl = getInstagramEmbedPermalink(sourceUrl) || normalizedPreview.url || String(sourceUrl || "").trim() || "#";
  const image = normalizedPreview.image || "";
  const title = normalizedPreview.title || "Post Instagram";
  const description = normalizedPreview.description || "Ouvrir ce post Instagram.";

  return `
    <div
      class="debate-card-source debate-card-source-instagram"
      style="display:block; overflow:hidden; border-radius:20px; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 28px rgba(15,23,42,0.08); color:inherit;"
    >
      ${image ? `
        <div style="display:block; width:100%; aspect-ratio:16/9; background:#f3f4f6; overflow:hidden;">
          <img
            src="${escapeAttribute(image)}"
            alt="Aperçu du post Instagram"
            loading="lazy"
            decoding="async"
            style="display:block; width:100%; height:100%; object-fit:cover;"
            onerror="this.closest('div')?.remove();"
          >
        </div>
      ` : ""}
      <div style="padding:10px 16px 14px; display:flex; flex-direction:column; gap:6px;">
        <div style="font-size:12px; line-height:1.4; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em;">Instagram</div>
        <div style="font-size:18px; line-height:1.35; font-weight:800; color:#111827;">${escapeHtml(title)}</div>
        <div style="font-size:14px; line-height:1.55; color:#4b5563;">${escapeHtml(description)}</div>
        <div>
          <a
            class="debate-source-link"
            href="${escapeAttribute(safeUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            style="display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:700; color:#111111; text-decoration:none;"
          >↗ Voir le post sur Instagram</a>
        </div>
      </div>
    </div>
  `;
}

function buildIndexInstagramEmbedHtml(sourceUrl, preview = null, debateId = "") {
  const embedPermalink = getInstagramEmbedPermalink(sourceUrl);
  if (!embedPermalink) {
    return buildIndexInstagramFallbackHtml(sourceUrl, preview);
  }

  return `
    <div class="debate-card-media debate-card-media-instagram">
      <div
        class="debate-card-instagram-shell"
        data-index-instagram-shell
        data-source-url="${escapeAttribute(String(sourceUrl || "").trim())}"
        data-instagram-permalink="${escapeAttribute(embedPermalink)}"
        style="position:relative;"
      >
        <div
          data-index-instagram-loading
          style="display:flex; align-items:center; justify-content:center; min-height:220px; padding:18px; border-radius:20px; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 28px rgba(15,23,42,0.08); color:#374151; font-size:14px; font-weight:700; text-align:center;"
        >Chargement du post Instagram…</div>
        <div data-index-instagram-embed style="display:none; justify-content:center;"></div>
        <div data-index-instagram-fallback style="display:none;">${buildIndexInstagramFallbackHtml(sourceUrl, preview)}</div>
        ${buildIndexDebateNavigationOverlay(debateId, "Ouvrir le débat lié à ce post Instagram")}
      </div>
    </div>
  `;
}

function isIndexYouTubeSourceDebate(debate) {
  const sourceUrl = String(debate?.source_url || "").trim();
  if (!sourceUrl) return false;

  const embedData = getEmbeddableSourceData(sourceUrl);
  return !!String(embedData.videoId || "").trim();
}

function buildIndexYouTubeEmbedHtml(sourceUrl) {
  const embedData = getEmbeddableSourceData(sourceUrl);
  if (!embedData.videoId || !embedData.embedUrl) return "";

  return `
    <div class="debate-card-media debate-card-media-youtube">
      <div
        class="debate-card-youtube-shell"
        data-index-youtube-shell
        data-embed-base="${escapeAttribute(embedData.embedUrl)}"
        data-poster-url="${escapeAttribute(embedData.posterUrl || "") }"
      >
        <button
          type="button"
          class="debate-card-youtube-poster"
          data-index-youtube-poster
          aria-label="Lire la vidéo YouTube"
        >
          ${embedData.posterUrl ? `<img class="debate-card-youtube-poster-img" src="${escapeAttribute(embedData.posterUrl)}" alt="Aperçu de la vidéo YouTube" loading="lazy" decoding="async">` : ""}
          <span class="debate-card-youtube-overlay" data-index-youtube-overlay>
            <span class="debate-card-youtube-play" aria-hidden="true"><i class="fa-solid fa-play"></i></span>
            <span class="debate-card-youtube-label">Vidéo YouTube</span>
          </span>
        </button>
        <iframe
          class="debate-card-youtube-iframe"
          title="Vidéo YouTube"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      </div>
    </div>
  `;
}

function isIndexLocalVideoDebate(debate) {
  return !!String(debate?.video_url || "").trim();
}
function isIndexLocalImageDebate(debate) {
  return !!String(debate?.image_url || "").trim();
}

function buildIndexLocalImageCardHtml(imageUrl, debateId = "") {
  const safeImageUrl = String(imageUrl || "").trim();
  if (!safeImageUrl) return "";

  const safeDebateId = String(debateId || "").trim();
  const debateHref = safeDebateId ? `/debate?id=${encodeURIComponent(safeDebateId)}` : "";
  const wrapperTag = debateHref ? "a" : "div";
  const wrapperAttributes = debateHref
    ? `class="debate-card-local-image-shell" href="${escapeAttribute(debateHref)}" style="display:block; text-decoration:none;"`
    : `class="debate-card-local-image-shell"`;

  return `
    <div class="debate-card-media debate-card-media-local-image">
      <${wrapperTag} ${wrapperAttributes}>
        <img
          class="debate-card-local-image"
          src="${escapeAttribute(safeImageUrl)}"
          alt="Image importée du débat"
          loading="lazy"
          decoding="async"
        >
      </${wrapperTag}>
    </div>
  `;
}

function buildIndexLocalVideoCardHtml(videoUrl) {
  const safeVideoUrl = String(videoUrl || "").trim();
  if (!safeVideoUrl) return "";

  return `
    <div class="debate-card-media debate-card-media-local-video">
      <div
        class="debate-card-youtube-shell debate-card-local-video-shell"
        data-index-local-video-shell
        data-video-src="${escapeAttribute(safeVideoUrl)}"
      >
        <button
          type="button"
          class="debate-card-youtube-poster debate-card-local-video-poster"
          data-index-local-video-poster
          aria-label="Lire la vidéo importée"
          style="background:#000;"
        >
          <span class="debate-card-youtube-overlay" data-index-local-video-overlay>
            <span class="debate-card-youtube-play" aria-hidden="true"><i class="fa-solid fa-play"></i></span>
            <span class="debate-card-youtube-label">Vidéo importée</span>
          </span>
        </button>
        <video
          class="debate-card-youtube-iframe debate-card-local-video-player"
          data-index-local-video-player
          playsinline
          muted
          loop
          preload="none"
          style="display:block; width:100%; height:100%; border:0; background:#000;"
        ></video>
      </div>
    </div>
  `;
}

function renderIndexInlineSourceCard(debate) {
  const safeDebateId = String(debate?.id || "").trim();
  const debateHref = safeDebateId ? `/debate?id=${encodeURIComponent(safeDebateId)}` : "";
  const localImageUrl = String(debate?.image_url || "").trim();
  if (localImageUrl) {
    return buildIndexLocalImageCardHtml(localImageUrl, safeDebateId);
  }

  const localVideoUrl = String(debate?.video_url || "").trim();
  if (localVideoUrl) {
    return buildIndexLocalVideoCardHtml(localVideoUrl);
  }

  const sourceUrl = String(debate?.source_url || "").trim();
  if (!sourceUrl) return "";

  if (isIndexYouTubeSourceDebate(debate)) {
    return buildIndexYouTubeEmbedHtml(sourceUrl);
  }

  const sourcePreview = debate?.source_preview && typeof debate.source_preview === "object"
    ? debate.source_preview
    : null;
  const debateId = String(debate?.id || "").trim();

  if (isXStatusUrl(sourceUrl)) {
    return buildIndexXEmbedHtml(sourceUrl, sourcePreview, debateId);
  }

  if (isInstagramPostUrl(sourceUrl)) {
    return buildIndexInstagramEmbedHtml(sourceUrl, sourcePreview, debateId);
  }

  if (isWeakSourcePreviewData(sourcePreview, sourceUrl)) {
    return "";
  }

  return buildSourcePreviewCardHtml(sourcePreview, sourceUrl, { debateHref });
}

function getIndexYouTubeEmbedSrc(baseUrl, options = {}) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";

  const autoplay = options === true ? true : !!options.autoplay;
  const muted = options === true ? true : options.muted !== false;

  try {
    const parsed = new URL(raw);
    parsed.searchParams.set("playsinline", "1");
    parsed.searchParams.set("enablejsapi", "1");
    parsed.searchParams.set("rel", parsed.searchParams.get("rel") || "0");
    parsed.searchParams.set("modestbranding", parsed.searchParams.get("modestbranding") || "1");

    if (autoplay) {
      parsed.searchParams.set("autoplay", "1");
    } else {
      parsed.searchParams.delete("autoplay");
    }

    if (muted) {
      parsed.searchParams.set("mute", "1");
    } else {
      parsed.searchParams.delete("mute");
    }

    return parsed.toString();
  } catch (error) {
    return raw;
  }
}

function postMessageToIndexYouTubeIframe(iframe, command) {
  if (!iframe?.contentWindow || !command) return;

  try {
    iframe.contentWindow.postMessage(JSON.stringify({
      event: 'command',
      func: command,
      args: []
    }), '*');
  } catch (error) {
    // noop
  }
}

function ensureIndexYouTubeOverlayLayer(shell) {
  if (!shell) return null;

  const overlay = shell.querySelector('[data-index-youtube-overlay]');
  const poster = shell.querySelector('[data-index-youtube-poster]');
  if (!overlay) return null;

  if (poster && overlay.parentElement === poster) {
    shell.appendChild(overlay);
  }

  overlay.style.zIndex = '2';
  return overlay;
}

function ensureIndexLocalVideoOverlayLayer(shell) {
  if (!shell) return null;

  const overlay = shell.querySelector('[data-index-local-video-overlay]');
  const poster = shell.querySelector('[data-index-local-video-poster]');
  if (!overlay) return null;

  if (poster && overlay.parentElement === poster) {
    shell.appendChild(overlay);
  }

  overlay.style.zIndex = '2';
  return overlay;
}

function queueIndexYouTubeSoundActivation(shell, iframe) {
  if (!shell || !iframe) return;
  if (shell.dataset.userActivated !== 'true') return;

  const applySound = () => {
    if (shell.dataset.userActivated !== 'true') return;
    postMessageToIndexYouTubeIframe(iframe, 'unMute');
  };

  applySound();
  [150, 350, 700, 1200].forEach((delay) => {
    window.setTimeout(applySound, delay);
  });
}

function updateIndexYouTubeShellOverlay(shell) {
  if (!shell) return;

  const overlay = ensureIndexYouTubeOverlayLayer(shell);
  const label = overlay?.querySelector('.debate-card-youtube-label');
  const isActive = shell.dataset.active === 'true';
  const isUserActivated = shell.dataset.userActivated === 'true';

  if (!overlay) return;

  if (!isActive) {
    overlay.style.display = '';
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = '';
    if (label) label.textContent = 'Vidéo YouTube';
    return;
  }

  if (isUserActivated) {
    overlay.style.display = 'none';
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = '';
    if (label) label.textContent = 'Vidéo YouTube';
    return;
  }

  overlay.style.display = 'flex';
  overlay.style.pointerEvents = 'auto';
  overlay.style.cursor = 'pointer';
  if (label) label.textContent = 'Activer le son';
}

function unloadIndexYouTubeShell(shell) {
  if (!shell) return;
  const iframe = shell.querySelector('.debate-card-youtube-iframe');
  const poster = shell.querySelector('[data-index-youtube-poster]');
  if (!iframe) return;

  iframe.onload = null;
  iframe.removeAttribute('src');
  iframe.src = 'about:blank';
  shell.dataset.active = 'false';
  shell.dataset.userActivated = 'false';

  if (poster) poster.style.display = '';
  updateIndexYouTubeShellOverlay(shell);
}

function activateIndexYouTubeShell(shell) {
  if (!shell) return;
  const iframe = shell.querySelector('.debate-card-youtube-iframe');
  const poster = shell.querySelector('[data-index-youtube-poster]');
  const baseUrl = String(shell.dataset.embedBase || '').trim();
  if (!iframe || !baseUrl) return;

const currentSrc = String(iframe.getAttribute('src') || '').trim();

if (!currentSrc || currentSrc === 'about:blank') {
  iframe.src = getIndexYouTubeEmbedSrc(baseUrl, {
    autoplay: true,
    muted: true
  });
}

  shell.dataset.active = 'true';
  if (poster) poster.style.display = 'none';
  updateIndexYouTubeShellOverlay(shell);

  if (shell.dataset.userActivated === 'true') {
    iframe.onload = () => {
      queueIndexYouTubeSoundActivation(shell, iframe);
      iframe.onload = null;
    };

    queueIndexYouTubeSoundActivation(shell, iframe);
  } else {
    iframe.onload = null;
  }
}

function enableSoundOnIndexYouTubeShell(shell) {
  if (!shell || shell.dataset.active !== 'true') return;

  const iframe = shell.querySelector('.debate-card-youtube-iframe');
  if (!iframe) return;

  shell.dataset.userActivated = 'true';
  updateIndexYouTubeShellOverlay(shell);
  queueIndexYouTubeSoundActivation(shell, iframe);
}

function updateIndexYouTubeActiveShell() {
  const state = window.indexYouTubePlaybackState;
  if (!state) return;

 const candidates = Array.from(state.shells).filter((shell) => {
  if (!shell || shell.dataset.inView !== 'true') return false;
  if (!shell.isConnected || !shell.offsetParent) return false;

  const rect = shell.getBoundingClientRect();
const topTolerance = window.innerHeight * 0.18;
const bottomTolerance = window.innerHeight * 0.18;

  return rect.bottom > -topTolerance && rect.top < window.innerHeight + bottomTolerance;
});

  if (!candidates.length) {
    if (state.activeShell) {
      unloadIndexYouTubeShell(state.activeShell);
      state.activeShell = null;
    }
    return;
  }

  const viewportCenter = window.innerHeight / 2;
  let bestShell = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((shell) => {
    const rect = shell.getBoundingClientRect();
    const shellCenter = rect.top + (rect.height / 2);
    const distance = Math.abs(shellCenter - viewportCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestShell = shell;
    }
  });

  if (!bestShell) return;

  if (state.activeShell && state.activeShell !== bestShell) {
    unloadIndexYouTubeShell(state.activeShell);
  }

  state.activeShell = bestShell;
  activateIndexYouTubeShell(bestShell);

  candidates.forEach((shell) => {
    if (shell !== bestShell) {
      unloadIndexYouTubeShell(shell);
    }
  });
}

function scheduleIndexYouTubeActiveUpdate() {
  const state = window.indexYouTubePlaybackState;
  if (!state) return;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(() => {
    state.rafId = null;
    updateIndexYouTubeActiveShell();
  });
}

function updateIndexLocalVideoShellOverlay(shell) {
  if (!shell) return;

  const overlay = ensureIndexLocalVideoOverlayLayer(shell);
  const label = overlay?.querySelector('.debate-card-youtube-label');
  const isActive = shell.dataset.active === 'true';
  const isUserActivated = shell.dataset.userActivated === 'true';

  if (!overlay) return;

  if (!isActive) {
    overlay.style.display = '';
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = '';
    if (label) label.textContent = 'Vidéo importée';
    return;
  }

  if (isUserActivated) {
    overlay.style.display = 'none';
    overlay.style.pointerEvents = 'none';
    overlay.style.cursor = '';
    if (label) label.textContent = 'Vidéo importée';
    return;
  }

  overlay.style.display = 'flex';
  overlay.style.pointerEvents = 'auto';
  overlay.style.cursor = 'pointer';
  if (label) label.textContent = 'Activer le son';
}

function unloadIndexLocalVideoShell(shell) {
  if (!shell) return;
  const video = shell.querySelector('[data-index-local-video-player]');
  const poster = shell.querySelector('[data-index-local-video-poster]');
  if (!video) return;

  try {
    video.pause();
  } catch (error) {
    // noop
  }

  video.removeAttribute('src');
  video.load();
  video.defaultMuted = true;
  video.muted = true;
  video.controls = false;
  shell.dataset.active = 'false';
  shell.dataset.userActivated = 'false';

  if (poster) poster.style.display = '';
  updateIndexLocalVideoShellOverlay(shell);
}

function activateIndexLocalVideoShell(shell) {
  if (!shell) return;
  const video = shell.querySelector('[data-index-local-video-player]');
  const poster = shell.querySelector('[data-index-local-video-poster]');
  const videoSrc = String(shell.dataset.videoSrc || '').trim();
  if (!video || !videoSrc) return;

  if (video.getAttribute('src') !== videoSrc) {
    video.src = videoSrc;
    video.load();
  }

  const shouldStartMuted = shell.dataset.userActivated !== 'true';
  video.defaultMuted = shouldStartMuted;
  video.muted = shouldStartMuted;
  video.controls = shell.dataset.userActivated === 'true';
  shell.dataset.active = 'true';

  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      // noop
    });
  }

  if (poster) poster.style.display = 'none';
  updateIndexLocalVideoShellOverlay(shell);
}

function enableSoundOnIndexLocalVideoShell(shell) {
  if (!shell || shell.dataset.active !== 'true') return;

  const video = shell.querySelector('[data-index-local-video-player]');
  if (!video) return;

  shell.dataset.userActivated = 'true';
  video.muted = false;
  video.controls = true;
  updateIndexLocalVideoShellOverlay(shell);

  const playPromise = video.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      // noop
    });
  }
}

function updateIndexLocalVideoActiveShell() {
  const state = window.indexLocalVideoPlaybackState;
  if (!state) return;

  const candidates = Array.from(state.shells).filter((shell) => {
    if (!shell || shell.dataset.inView !== 'true') return false;
    if (!shell.isConnected || !shell.offsetParent) return false;
    const rect = shell.getBoundingClientRect();
const topTolerance = window.innerHeight * 0.12;
const bottomTolerance = window.innerHeight * 0.12;

return rect.bottom > -topTolerance && rect.top < window.innerHeight + bottomTolerance;  });

  if (!candidates.length) {
    if (state.activeShell) {
      unloadIndexLocalVideoShell(state.activeShell);
      state.activeShell = null;
    }
    return;
  }

  const viewportCenter = window.innerHeight / 2;
  let bestShell = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  candidates.forEach((shell) => {
    const rect = shell.getBoundingClientRect();
    const shellCenter = rect.top + (rect.height / 2);
    const distance = Math.abs(shellCenter - viewportCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestShell = shell;
    }
  });

  if (!bestShell) return;

  if (state.activeShell && state.activeShell !== bestShell) {
    unloadIndexLocalVideoShell(state.activeShell);
  }

  const shouldActivateBestShell =
    state.activeShell !== bestShell || bestShell.dataset.active !== 'true';

  state.activeShell = bestShell;

  if (shouldActivateBestShell) {
    activateIndexLocalVideoShell(bestShell);
  }

  candidates.forEach((shell) => {
    if (shell !== bestShell) {
      unloadIndexLocalVideoShell(shell);
    }
  });
}


function scheduleIndexLocalVideoActiveUpdate() {
  const state = window.indexLocalVideoPlaybackState;
  if (!state) return;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = requestAnimationFrame(() => {
    state.rafId = null;
    updateIndexLocalVideoActiveShell();
  });
}

function clearMobileIndexCardHighlight() {
  document.querySelectorAll(
    '.page-home-mobile .debate-card.index-card-active, .page-debate .similar-debate-item.index-card-active'
  ).forEach((card) => {
    card.classList.remove('index-card-active');
  });
}
function updateMobileIndexCardHighlight() {
  if (window.innerWidth > 768) {
    clearMobileIndexCardHighlight();
    return;
  }

  const isMobileHome =
    document.body.classList.contains('page-home-mobile') &&
    !getDebateId();

  const isMobileOpenDebate =
    document.body.classList.contains('page-debate') &&
    !!getDebateId();

  let cards = [];

  if (isMobileHome) {
    cards = Array.from(
      document.querySelectorAll('.page-home-mobile .debates-list .debate-card')
    ).filter((card) => card.offsetParent !== null);
  } else if (isMobileOpenDebate) {
    cards = Array.from(
      document.querySelectorAll('.page-debate .similar-debates-list .similar-debate-item')
    ).filter((card) => card.offsetParent !== null);
  } else {
    clearMobileIndexCardHighlight();
    return;
  }

  if (!cards.length) {
    clearMobileIndexCardHighlight();
    return;
  }

  const topbar = document.querySelector('.topbar');
  const topOffset = (topbar ? topbar.offsetHeight : 0) + 12;
  const viewportCenter = topOffset + ((window.innerHeight - topOffset) * 0.32);

  let bestCard = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  cards.forEach((card) => {
    const rect = card.getBoundingClientRect();

    const visible =
      rect.bottom > topOffset + 20 &&
      rect.top < window.innerHeight - 20;

    if (!visible) return;

    const cardCenter = rect.top + (rect.height / 2);
    const distance = Math.abs(cardCenter - viewportCenter);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestCard = card;
    }
  });

  cards.forEach((card) => {
    card.classList.toggle('index-card-active', card === bestCard);
  });
}

function scheduleMobileIndexCardHighlightUpdate() {
  if (indexCardHighlightRaf) {
    cancelAnimationFrame(indexCardHighlightRaf);
  }

  indexCardHighlightRaf = requestAnimationFrame(() => {
    indexCardHighlightRaf = null;
    updateMobileIndexCardHighlight();
  });
}
function initMobileIndexCardHighlight() {
  if (indexCardHighlightBound) return;
  indexCardHighlightBound = true;

  window.addEventListener('scroll', scheduleMobileIndexCardHighlightUpdate, { passive: true });
  window.addEventListener('resize', scheduleMobileIndexCardHighlightUpdate);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    scheduleMobileIndexCardHighlightUpdate();
  });

  scheduleMobileIndexCardHighlightUpdate();
}

function initIndexLocalVideoObserver(root = document) {


  const shells = Array.from(root.querySelectorAll('[data-index-local-video-shell]'));
  const previousState = window.indexLocalVideoPlaybackState;

  if (previousState?.observer) {
    previousState.observer.disconnect();
  }

  if (previousState?.resizeHandler) {
    window.removeEventListener('resize', previousState.resizeHandler);
  }

  if (previousState?.scrollHandler) {
    window.removeEventListener('scroll', previousState.scrollHandler, { passive: true });
  }

  if (!shells.length) {
    window.indexLocalVideoPlaybackState = null;
    return;
  }

  const state = {
    observer: null,
    shells: new Set(shells),
    activeShell: null,
    rafId: null,
    resizeHandler: null,
    scrollHandler: null
  };

  window.indexLocalVideoPlaybackState = state;

  shells.forEach((shell) => {
    shell.dataset.inView = 'false';
    shell.dataset.active = 'false';
    shell.dataset.userActivated = 'false';
    ensureIndexLocalVideoOverlayLayer(shell);
    unloadIndexLocalVideoShell(shell);

    const poster = shell.querySelector('[data-index-local-video-poster]');
    const overlay = shell.querySelector('[data-index-local-video-overlay]');

    if (poster) {
      poster.onclick = (event) => {
        event.preventDefault();
        shell.dataset.inView = 'true';
        scheduleIndexLocalVideoActiveUpdate();
      };
    }

    if (overlay) {
      overlay.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        shell.dataset.inView = 'true';

        if (state.activeShell !== shell) {
          state.activeShell = shell;
          activateIndexLocalVideoShell(shell);
        }

        enableSoundOnIndexLocalVideoShell(shell);
      };
    }
  });

  state.observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const shell = entry.target;
      shell.dataset.inView = entry.isIntersecting && entry.intersectionRatio >= 0.55 ? 'true' : 'false';
      if (shell.dataset.inView !== 'true' && state.activeShell === shell) {
        unloadIndexLocalVideoShell(shell);
        state.activeShell = null;
      }
    });

    scheduleIndexLocalVideoActiveUpdate();
  }, {
    threshold: [0, 0.25, 0.55, 0.85],
    rootMargin: '0px 0px 0px 0px'
  });

  shells.forEach((shell) => state.observer.observe(shell));

  state.resizeHandler = () => scheduleIndexLocalVideoActiveUpdate();
  state.scrollHandler = () => scheduleIndexLocalVideoActiveUpdate();

  window.addEventListener('resize', state.resizeHandler);
  window.addEventListener('scroll', state.scrollHandler, { passive: true });

  scheduleIndexLocalVideoActiveUpdate();
}

function initIndexYouTubeObserver(root = document) {
  const shells = Array.from(root.querySelectorAll('[data-index-youtube-shell]'));
  const previousState = window.indexYouTubePlaybackState;

  if (previousState?.observer) {
    previousState.observer.disconnect();
  }

  if (previousState?.resizeHandler) {
    window.removeEventListener('resize', previousState.resizeHandler);
  }

  if (previousState?.scrollHandler) {
    window.removeEventListener('scroll', previousState.scrollHandler, { passive: true });
  }

  if (!shells.length) {
    window.indexYouTubePlaybackState = null;
    return;
  }

  const state = {
    observer: null,
    shells: new Set(shells),
    activeShell: null,
    rafId: null,
    resizeHandler: null,
    scrollHandler: null
  };

  window.indexYouTubePlaybackState = state;

  shells.forEach((shell) => {
    shell.dataset.inView = 'false';
    shell.dataset.active = 'false';
    shell.dataset.userActivated = 'false';
    ensureIndexYouTubeOverlayLayer(shell);
    unloadIndexYouTubeShell(shell);

    const poster = shell.querySelector('[data-index-youtube-poster]');
    const overlay = shell.querySelector('[data-index-youtube-overlay]');

    if (poster) {
      poster.onclick = (event) => {
        event.preventDefault();
        shell.dataset.inView = 'true';
        scheduleIndexYouTubeActiveUpdate();
      };
    }

    if (overlay) {
      overlay.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        shell.dataset.inView = 'true';

        if (state.activeShell !== shell) {
          state.activeShell = shell;
          activateIndexYouTubeShell(shell);
        }

        enableSoundOnIndexYouTubeShell(shell);
      };
    }
  });

state.observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    const shell = entry.target;
    shell.dataset.inView =
      entry.isIntersecting && entry.intersectionRatio >= 0.12 ? 'true' : 'false';
  });

  scheduleIndexYouTubeActiveUpdate();
}, {
  threshold: [0, 0.05, 0.12, 0.25, 0.55, 0.85],
  rootMargin: '0px 0px 0px 0px'
});



  shells.forEach((shell) => state.observer.observe(shell));

  state.resizeHandler = () => scheduleIndexYouTubeActiveUpdate();
  state.scrollHandler = () => scheduleIndexYouTubeActiveUpdate();

  window.addEventListener('resize', state.resizeHandler);
  window.addEventListener('scroll', state.scrollHandler, { passive: true });

  scheduleIndexYouTubeActiveUpdate();
}


function isElementNearViewport(element, extraMargin = 160) {
  if (!element || typeof element.getBoundingClientRect !== 'function') return false;

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

  return rect.bottom >= -extraMargin && rect.top <= viewportHeight + extraMargin;
}

async function renderIndexXShell(shell) {
  if (!shell) return;
  if (shell.dataset.rendered === 'true') return;
  if (shell.dataset.rendering === 'true') return;

  const tweetId = String(shell.dataset.tweetId || '').trim();
  const sourceUrl = String(shell.dataset.sourceUrl || '').trim();
  const loading = shell.querySelector('[data-index-x-loading]');
  const embed = shell.querySelector('[data-index-x-embed]');
  const fallback = shell.querySelector('[data-index-x-fallback]');

  if (!tweetId || !embed) {
    if (loading) loading.style.display = 'none';
    if (fallback) fallback.style.display = '';
    shell.dataset.rendered = 'failed';
    return;
  }

  shell.dataset.rendering = 'true';

  if (loading) loading.style.display = 'flex';
  if (fallback) fallback.style.display = 'none';

  embed.innerHTML = '';
  embed.style.display = 'block';
  embed.style.visibility = 'hidden';
  embed.style.minHeight = '220px';

  try {
    await loadXWidgetsScript();

    if (!window.twttr?.widgets?.createTweet) {
      throw new Error('API widgets X indisponible.');
    }

    const created = await window.twttr.widgets.createTweet(tweetId, embed, {
      align: 'center',
      theme: 'light',
      dnt: true,
      conversation: 'all'
    });

    if (!created) {
      throw new Error('Embed X non généré.');
    }

    shell.dataset.rendered = 'true';
    embed.style.display = 'block';
    embed.style.visibility = 'visible';
    embed.style.minHeight = '';
    if (loading) loading.style.display = 'none';
  } catch (error) {
    shell.dataset.rendered = 'failed';
    embed.innerHTML = '';
    embed.style.display = 'none';
    embed.style.visibility = 'visible';
    embed.style.minHeight = '';
    if (loading) loading.style.display = 'none';
    if (fallback) fallback.style.display = '';
    console.warn('Impossible de rendre le post X sur index:', sourceUrl || tweetId, error);
  } finally {
    shell.dataset.rendering = 'false';
  }
}

function initIndexXObserver(root = document) {
  const shells = Array.from(root.querySelectorAll('[data-index-x-shell]'));
  const previousState = window.indexXEmbedState;

  if (previousState?.observer) {
    previousState.observer.disconnect();
  }

  if (!shells.length) {
    window.indexXEmbedState = null;
    return;
  }

  const state = {
    observer: null,
    shells: new Set(shells)
  };

  window.indexXEmbedState = state;

  shells.forEach((shell) => {
    if (!shell.dataset.rendered) {
      shell.dataset.rendered = 'false';
    }
    shell.dataset.rendering = 'false';
  });

  if (typeof IntersectionObserver !== 'function') {
    shells.forEach((shell) => {
      renderIndexXShell(shell);
    });
    return;
  }

  state.observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const shell = entry.target;
      if (!entry.isIntersecting || entry.intersectionRatio < 0.35) return;
      renderIndexXShell(shell);

      if (shell.dataset.rendered === 'true' || shell.dataset.rendered === 'failed') {
        state.observer?.unobserve(shell);
      }
    });
  }, {
    threshold: [0, 0.1, 0.35, 0.7],
    rootMargin: '120px 0px 120px 0px'
  });

  shells.forEach((shell) => {
    state.observer.observe(shell);

    if (isElementNearViewport(shell, 220)) {
      requestAnimationFrame(() => {
        renderIndexXShell(shell);
      });
    }
  });
}

async function renderIndexInstagramShell(shell) {
  if (!shell) return;
  if (shell.dataset.rendered === 'true') return;
  if (shell.dataset.rendering === 'true') return;

  const embedPermalink = String(shell.dataset.instagramPermalink || '').trim();
  const sourceUrl = String(shell.dataset.sourceUrl || '').trim();
  const loading = shell.querySelector('[data-index-instagram-loading]');
  const embed = shell.querySelector('[data-index-instagram-embed]');
  const fallback = shell.querySelector('[data-index-instagram-fallback]');

  if (!embedPermalink || !embed) {
    if (loading) loading.style.display = 'none';
    if (fallback) fallback.style.display = '';
    shell.dataset.rendered = 'failed';
    return;
  }

  shell.dataset.rendering = 'true';

  if (loading) loading.style.display = 'flex';
  if (fallback) fallback.style.display = 'none';

  embed.innerHTML = '';
  embed.style.display = 'flex';
  embed.style.visibility = 'hidden';
  embed.style.minHeight = '220px';

  try {
    await loadInstagramEmbedScript();

    if (!window.instgrm?.Embeds?.process) {
      throw new Error('API embed Instagram indisponible.');
    }

    embed.innerHTML = `
      <blockquote
        class="instagram-media"
        data-instgrm-captioned
        data-instgrm-permalink="${escapeAttribute(embedPermalink)}?utm_source=ig_embed&amp;utm_campaign=loading"
        data-instgrm-version="14"
        style="background:#fff; border:0; border-radius:18px; box-shadow:0 10px 28px rgba(15,23,42,0.08); margin:0; max-width:540px; min-width:280px; padding:0; width:100%;"
      >
        <a href="${escapeAttribute(embedPermalink)}" target="_blank" rel="noopener noreferrer">Voir ce post sur Instagram</a>
      </blockquote>
    `;

    window.instgrm.Embeds.process();

    shell.dataset.rendered = 'true';
    embed.style.display = 'flex';
    embed.style.visibility = 'visible';
    embed.style.minHeight = '';
    if (loading) loading.style.display = 'none';
  } catch (error) {
    shell.dataset.rendered = 'failed';
    embed.innerHTML = '';
    embed.style.display = 'none';
    embed.style.visibility = 'visible';
    embed.style.minHeight = '';
    if (loading) loading.style.display = 'none';
    if (fallback) fallback.style.display = '';
    console.warn('Impossible de rendre le post Instagram sur index:', sourceUrl || embedPermalink, error);
  } finally {
    shell.dataset.rendering = 'false';
  }
}

function initIndexInstagramObserver(root = document) {
  const shells = Array.from(root.querySelectorAll('[data-index-instagram-shell]'));
  const previousState = window.indexInstagramEmbedState;

  if (previousState?.observer) {
    previousState.observer.disconnect();
  }

  if (!shells.length) {
    window.indexInstagramEmbedState = null;
    return;
  }

  const state = {
    observer: null,
    shells: new Set(shells)
  };

  window.indexInstagramEmbedState = state;

  shells.forEach((shell) => {
    if (!shell.dataset.rendered) {
      shell.dataset.rendered = 'false';
    }
    shell.dataset.rendering = 'false';
  });

  if (typeof IntersectionObserver !== 'function') {
    shells.forEach((shell) => {
      renderIndexInstagramShell(shell);
    });
    return;
  }

  state.observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const shell = entry.target;
      if (!entry.isIntersecting || entry.intersectionRatio < 0.35) return;
      renderIndexInstagramShell(shell);

      if (shell.dataset.rendered === 'true' || shell.dataset.rendered === 'failed') {
        state.observer?.unobserve(shell);
      }
    });
  }, {
    threshold: [0, 0.1, 0.35, 0.7],
    rootMargin: '120px 0px 120px 0px'
  });

  shells.forEach((shell) => {
    state.observer.observe(shell);

    if (isElementNearViewport(shell, 220)) {
      requestAnimationFrame(() => {
        renderIndexInstagramShell(shell);
      });
    }
  });
}

function buildSourcePreviewCardHtml(preview, sourceUrl = "", options = {}) {
  const normalizedPreview = normalizeSourcePreviewData(preview, sourceUrl);
  const safeUrl = normalizedPreview.url || String(sourceUrl || "").trim() || "#";
  const domain = normalizedPreview.domain || "Source externe";
  const title = normalizedPreview.title || domain;
  const description = normalizedPreview.description || "";
  const image = normalizedPreview.image || "";
  const debateHref = String(options?.debateHref || "").trim();
  const cardTag = debateHref ? "a" : "div";
  const cardAttributes = debateHref
    ? `class="debate-source-card" href="${escapeAttribute(debateHref)}" style="display:block; overflow:hidden; border-radius:20px; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 28px rgba(15,23,42,0.08); color:inherit; text-decoration:none;"`
    : `class="debate-source-card" style="display:block; overflow:hidden; border-radius:20px; background:#ffffff; border:1px solid #e5e7eb; box-shadow:0 10px 28px rgba(15,23,42,0.08); color:inherit;"`;
  const openSourceHtml = debateHref
    ? ""
    : `<div>
          <a
            class="debate-source-link"
            href="${escapeAttribute(safeUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            style="display:inline-flex; align-items:center; gap:6px; font-size:14px; font-weight:700; color:#111111; text-decoration:none;"
          >↗ Ouvrir la source</a>
        </div>`;

  return `
    <${cardTag}
      ${cardAttributes}
    >
      ${image ? `
    <div class="debate-source-card-image-wrap" style="display:block; width:100%; aspect-ratio:16/9; background:transparent; overflow:hidden;">
          <img
            class="debate-source-card-image"
            src="${escapeAttribute(image)}"
            alt="${escapeAttribute(title)}"
            loading="lazy"
            style="display:block; width:100%; height:100%; object-fit:cover;"
            onerror="this.closest('.debate-source-card-image-wrap')?.remove();"
          >
        </div>
      ` : ""}
     <div class="debate-source-card-body" style="padding:8px 16px 14px; display:flex; flex-direction:column; gap:6px;">
        <div class="debate-source-card-domain" style="font-size:12px; line-height:1.4; font-weight:700; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em;">${escapeHtml(domain)}</div>
        <div class="debate-source-card-title" style="font-size:18px; line-height:1.35; font-weight:800; color:#111827;">${escapeHtml(title)}</div>
        ${description ? `<div class="debate-source-card-description" style="font-size:14px; line-height:1.55; color:#4b5563;">${escapeHtml(description)}</div>` : ""}
        ${openSourceHtml}
      </div>
    </${cardTag}>
  `;
}

function linkifyText(str) {
  const escaped = escapeHtml(str ?? "");

  return escaped.replace(
    /((?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s<]*)?)/gi,
    (match) => {
      const href = /^https?:\/\//i.test(match) ? match : `https://${match}`;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${match}</a>`;
    }
  );
}
function setDisplay(element, value) {
  if (element) {
    element.style.display = value;
  }
}
function getNotificationDisplayTitle(notification, fallbackTitle) {
  const detailedTypes = new Set([
    "vote_on_argument",
    "comment_on_argument",
    "argument_in_my_debate",
    "like_on_comment",
    "dislike_on_comment",
    "reply_to_comment",
    "replacement_accepted"
  ]);

  if (detailedTypes.has(notification?.type)) {
    const message = String(notification?.message || "").trim();
    if (message) return message;
  }

  return fallbackTitle;
}
function setButtonLoading(button, loadingClass = "button-loading") {
  if (!button) return;
  button.disabled = true;
  button.classList.add(loadingClass);
}

function clearButtonLoading(button, loadingClass = "button-loading") {
  if (!button) return;
  button.disabled = false;
  button.classList.remove(loadingClass);
}

function setActionLoading(element, loadingClass = "button-loading") {
  if (!element) return;

  if (typeof element.disabled !== "undefined") {
    element.disabled = true;
  }

  element.dataset.loading = "true";
  element.classList.add(loadingClass);
  element.style.pointerEvents = "none";
  element.style.opacity = "0.55";
}

function clearActionLoading(element, loadingClass = "button-loading") {
  if (!element) return;

  if (typeof element.disabled !== "undefined") {
    element.disabled = false;
  }

  delete element.dataset.loading;
  element.classList.remove(loadingClass);
  element.style.pointerEvents = "";
  element.style.opacity = "";
}

const NOTIFICATION_TRANSITION_STORAGE_KEY = "notification_transition_pending";

function ensureNotificationTransitionOverlayStyles() {
  if (document.getElementById("notification-transition-overlay-styles")) return;

  const style = document.createElement("style");
  style.id = "notification-transition-overlay-styles";
  style.textContent = `
    .notification-transition-overlay {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 180ms ease;
    }

    .notification-transition-overlay-visible {
      opacity: 1;
      pointer-events: auto;
    }

    .notification-transition-box {
      width: min(92vw, 360px);
      border-radius: 24px;
      padding: 22px 20px 18px;
      background: rgba(255, 255, 255, 0.95);
      border: 1px solid rgba(17, 17, 17, 0.08);
      box-shadow: 0 18px 50px rgba(17, 17, 17, 0.14);
      text-align: center;
    }

    .notification-transition-hourglass {
      width: 54px;
      height: 54px;
      margin: 0 auto 12px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, #ffffff 0%, #f6f7fb 100%);
      border: 1px solid rgba(17, 17, 17, 0.08);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
      font-size: 28px;
      animation: notificationHourglassFloat 1.2s ease-in-out infinite;
      transform-origin: center;
    }

    .notification-transition-title {
      font-size: 16px;
      font-weight: 700;
      color: #111111;
      margin-bottom: 6px;
    }

    .notification-transition-text {
      font-size: 14px;
      line-height: 1.45;
      color: #4b5563;
    }

    @keyframes notificationHourglassFloat {
      0% { transform: translateY(0) rotate(0deg); }
      50% { transform: translateY(-2px) rotate(180deg); }
      100% { transform: translateY(0) rotate(360deg); }
    }
  `;

  document.head.appendChild(style);
}

function getNotificationTransitionState() {
  try {
    return JSON.parse(sessionStorage.getItem(NOTIFICATION_TRANSITION_STORAGE_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function setNotificationTransitionState(state) {
  try {
    sessionStorage.setItem(NOTIFICATION_TRANSITION_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // ignore storage failures
  }
}

function clearNotificationTransitionState() {
  try {
    sessionStorage.removeItem(NOTIFICATION_TRANSITION_STORAGE_KEY);
  } catch (error) {
    // ignore storage failures
  }
}

function showNotificationTransitionOverlay(message = "Ouverture en cours…") {
  ensureNotificationTransitionOverlayStyles();

  let overlay = document.getElementById("notification-transition-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "notification-transition-overlay";
    overlay.className = "notification-transition-overlay";
    overlay.innerHTML = `
      <div class="notification-transition-box" role="status" aria-live="polite" aria-busy="true">
        <div class="notification-transition-hourglass" aria-hidden="true">⌛</div>
        <div class="notification-transition-text" id="notification-transition-text"></div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  const textEl = document.getElementById("notification-transition-text");
  if (textEl) {
    textEl.textContent = message;
  }

  overlay.classList.add("notification-transition-overlay-visible");
}

function hideNotificationTransitionOverlay() {
  const overlay = document.getElementById("notification-transition-overlay");
  if (!overlay) {
    clearNotificationTransitionState();
    return;
  }

  overlay.classList.remove("notification-transition-overlay-visible");

  setTimeout(() => {
    overlay.remove();
  }, 180);

  clearNotificationTransitionState();
}

function beginNotificationTransition(link) {
  const state = {
    active: true,
    link: String(link || ""),
    startedAt: Date.now()
  };

  setNotificationTransitionState(state);
  showNotificationTransitionOverlay();
}

function initNotificationTransitionOverlay() {
  const state = getNotificationTransitionState();
  if (!state?.active) return;

  showNotificationTransitionOverlay();

  if (location.pathname !== "/debate") {
    setTimeout(() => {
      hideNotificationTransitionOverlay();
    }, 400);
  }
}

function finalizeNotificationTransitionAfterFocus() {
  const state = getNotificationTransitionState();
  if (!state?.active) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hideNotificationTransitionOverlay();
    });
  });
}

function finalizeNotificationTransitionAtScrollStart() {
  const state = getNotificationTransitionState();
  if (!state?.active) return;

  requestAnimationFrame(() => {
    hideNotificationTransitionOverlay();
  });
}

function waitForNotificationTargetScrollToFinish(onDone, options = {}) {
  const callback = typeof onDone === "function" ? onDone : () => {};
  const maxWaitMs = Number(options.maxWaitMs || 650);
  const stableFramesNeeded = Number(options.stableFramesNeeded || 3);
  const tolerance = Number(options.tolerance || 3);
  const startedAt = performance.now();
  let stableFrames = 0;
  let previousY = window.scrollY;

  const finish = () => {
    callback();
  };

  const step = () => {
    const currentY = window.scrollY;
    const delta = Math.abs(currentY - previousY);

    if (delta <= tolerance) {
      stableFrames += 1;
    } else {
      stableFrames = 0;
    }

    previousY = currentY;

    const elapsed = performance.now() - startedAt;
    if (stableFrames >= stableFramesNeeded || elapsed >= maxWaitMs) {
      finish();
      return;
    }

    requestAnimationFrame(step);
  };

  requestAnimationFrame(step);
}

function waitForNotificationTargetElement(getElement, onReady, onMissing, options = {}) {
  const resolveElement = typeof getElement === "function" ? getElement : () => null;
  const handleReady = typeof onReady === "function" ? onReady : () => {};
  const handleMissing = typeof onMissing === "function" ? onMissing : () => {};
  const maxWaitMs = Number(options.maxWaitMs || 180);
  const pollDelayMs = Number(options.pollDelayMs || 0);
  const startedAt = performance.now();

  const tryResolve = () => {
    const element = resolveElement();

    if (element) {
      handleReady(element);
      return;
    }

    if ((performance.now() - startedAt) >= maxWaitMs) {
      handleMissing();
      return;
    }

    if (pollDelayMs > 0) {
      setTimeout(() => {
        requestAnimationFrame(tryResolve);
      }, pollDelayMs);
      return;
    }

    requestAnimationFrame(tryResolve);
  };

  tryResolve();
}

function fireAndForgetMarkOneNotificationAsRead(notificationId) {
  const payload = JSON.stringify({
    userKey: getKey(),
    notificationId
  });

  if (navigator.sendBeacon) {
    try {
      const blob = new Blob([payload], { type: "application/json" });
      const sent = navigator.sendBeacon(API + "/notifications/read-one", blob);
      if (sent) return;
    } catch (error) {
      // fallback to fetch keepalive below
    }
  }

  fetch(API + "/notifications/read-one", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: payload,
    keepalive: true
  }).catch((error) => {
    console.error(error);
  });
}

const pendingVoiceRequests = {};

function getVoiceButtons(argId) {
  return Array.from(document.querySelectorAll(`[data-voice-arg-id="${String(argId)}"]`));
}

function syncVoiceGuidanceState(debateId) {
  const state = getState(debateId);
  const totalVotesUsed = Object.values(state).reduce((sum, value) => sum + Number(value || 0), 0);
  const shouldGuide = totalVotesUsed < 5;

  document.querySelectorAll(".voice-stepper-btn, .my-argument-chip-stepper-btn").forEach((button) => {
    button.classList.remove("voice-stepper-btn-guided", "my-argument-chip-stepper-btn-guided");

    if (!shouldGuide) return;

    if (button.classList.contains("voice-stepper-btn")) {
      button.classList.add("voice-stepper-btn-guided");
    }

    if (button.classList.contains("my-argument-chip-stepper-btn")) {
      button.classList.add("my-argument-chip-stepper-btn-guided");
    }
  });
}


function syncVoiceButtonsDisabledState(debateId, argId) {
  const argIdString = String(argId);
  const state = getState(debateId);
  const myVoteCount = Number(state[argIdString] || 0);
  const isPending = pendingVoiceRequests[argIdString] === true;

  getVoiceButtons(argIdString).forEach((button) => {
    const action = button.dataset.voiceAction;

    if (isPending) {
      button.disabled = true;
      button.dataset.loading = "true";
      button.classList.remove("button-loading");
      button.style.pointerEvents = "none";
      button.style.opacity = "";
      return;
    }

    delete button.dataset.loading;
    button.classList.remove("button-loading");
    button.style.pointerEvents = "";
    button.style.opacity = "";

    if (action === "minus") {
      button.disabled = myVoteCount <= 0;
    } else if (action === "plus") {
      button.disabled = false;
    } else {
      button.disabled = false;
    }
  });

  syncVoiceGuidanceState(debateId);
}


function setVoiceRequestPending(debateId, argId, isPending) {
  pendingVoiceRequests[String(argId)] = !!isPending;
  syncVoiceButtonsDisabledState(debateId, argId);
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
function isDebateOwner(debate) {
  if (!debate) return false;
  return String(debate.creator_key || "") === String(getKey() || "");
}

function canDeleteDebate(debate) {
  return isAdmin() || isDebateOwner(debate);
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
function showVoteWarning(titleOrMessage, message = "") {
  const existing = document.getElementById("vote-warning-overlay");
  if (existing) existing.remove();

  const hasExplicitMessage =
    typeof message === "string" && message.trim() !== "";

  const title = hasExplicitMessage ? titleOrMessage : "⚠️ Attention";
  const text = hasExplicitMessage ? message : titleOrMessage;

  const overlay = document.createElement("div");
  overlay.id = "vote-warning-overlay";
  overlay.className = "replacement-success-overlay replacement-success-overlay-visible";

  overlay.innerHTML = `
    <div class="replacement-success-box warning-box">
      <div class="replacement-success-icon warning-icon-wrap" aria-hidden="true">
        <span class="warning-icon-symbol">🔄🗳️</span>
      </div>
      <div class="replacement-success-title">${escapeHtml(title)}</div>
      <div class="replacement-success-text">${escapeHtml(text)}</div>
      <button
        type="button"
        class="replacement-success-button warning-button"
        id="vote-warning-close-btn"
      >
        Compris
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("vote-warning-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeVoteWarning);
  }
}

function closeVoteWarning() {
  const overlay = document.getElementById("vote-warning-overlay");
  if (!overlay) return;

  const shouldHighlightVoices = pendingVoicesSummaryHighlight;
  pendingVoicesSummaryHighlight = false;

  overlay.classList.remove("replacement-success-overlay-visible");

  setTimeout(() => {
    overlay.remove();

    if (shouldHighlightVoices) {
      scrollToVoicesSummary();
    }
  }, 250);
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

function getIdeaShareUrl(debateId, argumentId) {
  return `${window.location.origin}/debate?id=${encodeURIComponent(String(debateId))}&highlight=argument-${encodeURIComponent(String(argumentId))}`;
}

function getIdeaShareData(debateId, argument) {
  const question = currentDebateShareData.question || getDebateShareTitle();
  const isOpen = isCurrentOpenDebateMode();
  const sideLabel = isOpen
    ? "Réponse"
    : argument?.side === "A"
      ? (currentDebateShareData.optionA || "Position A")
      : (currentDebateShareData.optionB || "Position B");

  const ideaTitle = String(argument?.title || "Idée sans titre").trim();
  const ideaBody = String(argument?.body || "").trim();
const shortBody = ideaBody;
  const textParts = [
    question,
    "",
    `${sideLabel} — ${ideaTitle}`
  ];

  if (shortBody) {
    textParts.push(shortBody, "");
  } else {
    textParts.push("");
  }

  textParts.push("Qu’est-ce qui vous paraît le plus convaincant ?\n→");

  return {
    title: `${ideaTitle} — ${question}`,
    text: textParts.join("\n"),
    url: getIdeaShareUrl(debateId, argument?.id)
  };
}

async function copyIdeaLink(debateId, encodedArgumentJson) {
  try {
    const argument = JSON.parse(decodeURIComponent(encodedArgumentJson || ""));
    const { url } = getIdeaShareData(debateId, argument);
    await navigator.clipboard.writeText(url);
    showCopyLinkSuccessMessage();
  } catch (error) {
    alert("Impossible de copier le lien automatiquement.");
  }
}

function shareIdeaOnX(debateId, encodedArgumentJson) {
  const argument = JSON.parse(decodeURIComponent(encodedArgumentJson || ""));
  const { text, url } = getIdeaShareData(debateId, argument);
  const shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareIdeaOnFacebook(debateId, encodedArgumentJson) {
  const argument = JSON.parse(decodeURIComponent(encodedArgumentJson || ""));
  const { url } = getIdeaShareData(debateId, argument);
  const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareIdeaOnWhatsApp(debateId, encodedArgumentJson) {
  const argument = JSON.parse(decodeURIComponent(encodedArgumentJson || ""));
  const { text, url } = getIdeaShareData(debateId, argument);
  const shareUrl = `https://wa.me/?text=${encodeURIComponent(text + " " + url)}`;
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}

function shareIdeaByEmail(debateId, encodedArgumentJson) {
  const argument = JSON.parse(decodeURIComponent(encodedArgumentJson || ""));
  const { title, text, url } = getIdeaShareData(debateId, argument);
  const body = `${text} ${url}`;
  window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

let openedIdeaShareMenuId = null;

function closeIdeaShareMenus() {
  if (!openedIdeaShareMenuId) return;

  const openedMenu = document.getElementById(openedIdeaShareMenuId);
  if (openedMenu) {
    openedMenu.style.display = 'none';
  }

  openedIdeaShareMenuId = null;
}

function toggleIdeaShareMenu(event, argumentId) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const menuId = `idea-share-menu-${argumentId}`;
  const menu = document.getElementById(menuId);
  if (!menu) return;

  const isSameMenuOpen = openedIdeaShareMenuId === menuId && menu.style.display === 'flex';

  closeIdeaShareMenus();

  if (!isSameMenuOpen) {
    menu.style.display = 'flex';
    openedIdeaShareMenuId = menuId;
  }
}

function handleIdeaShareAction(event, callback) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  closeIdeaShareMenus();

  if (typeof callback === 'function') {
    callback();
  }
}

if (!window.__ideaShareMenuListenerAttached) {
  document.addEventListener('click', (event) => {
    if (event.target.closest('.idea-share-discreet-wrap')) return;
    closeIdeaShareMenus();
  });

  document.addEventListener('touchstart', (event) => {
    if (event.target.closest('.idea-share-discreet-wrap')) return;
    closeIdeaShareMenus();
  });

  window.__ideaShareMenuListenerAttached = true;
}

function renderIdeaShareButtons(debateId, argument) {
  const encodedArgument = encodeURIComponent(JSON.stringify({
    id: argument?.id || "",
    title: argument?.title || "",
    body: argument?.body || "",
    side: argument?.side || ""
  }));
  const menuId = `idea-share-menu-${argument?.id || ''}`;

  return `
    <div class="idea-share-discreet-wrap" style="position:relative; display:inline-flex; align-items:center;">
      <button
        class="share-icon-button idea-share-discreet-trigger"
        type="button"
        onclick="toggleIdeaShareMenu(event, '${argument?.id || ''}')"
        title="Partager cette idée"
        aria-label="Partager cette idée"
        aria-haspopup="true"
        aria-expanded="false"
      >
        <i class="fa-solid fa-share-nodes"></i>
      </button>

      <div
        id="${menuId}"
        class="idea-share-menu"
        onclick="event.stopPropagation()"
style="display:none; position:absolute; left:50%; top:calc(100% + 8px); transform:translateX(-50%); z-index:30; flex-direction:column; gap:6px; min-width:152px; padding:8px; border:1px solid #e5e7eb; border-radius:12px; background:#ffffff; box-shadow:0 10px 30px rgba(0,0,0,0.12);"
      >
        <button
          class="share-icon-button"
          type="button"
          onclick="handleIdeaShareAction(event, function(){ copyIdeaLink('${debateId}', '${encodedArgument}'); })"
          title="Copier le lien de l'idée"
          aria-label="Copier le lien de l'idée"
          style="width:100%; justify-content:flex-start; gap:8px; padding:8px 10px; border-radius:10px;"
        >
          <i class="fa-solid fa-link"></i>
          <span>Copier</span>
        </button>

        <button
          class="share-icon-button"
          type="button"
          onclick="handleIdeaShareAction(event, function(){ showIdeaQrCode('${debateId}', '${encodedArgument}'); })"
          title="Afficher le QR code de l'idée"
          aria-label="Afficher le QR code de l'idée"
          style="width:100%; justify-content:flex-start; gap:8px; padding:8px 10px; border-radius:10px;"
        >
          <i class="fa-solid fa-qrcode"></i>
          <span>QR code</span>
        </button>

        <button
          class="share-icon-button"
          type="button"
          onclick="handleIdeaShareAction(event, function(){ shareIdeaOnWhatsApp('${debateId}', '${encodedArgument}'); })"
          title="Partager l'idée sur WhatsApp"
          aria-label="Partager l'idée sur WhatsApp"
          style="width:100%; justify-content:flex-start; gap:8px; padding:8px 10px; border-radius:10px;"
        >
          <i class="fa-brands fa-whatsapp"></i>
          <span>WhatsApp</span>
        </button>

        <button
          class="share-icon-button"
          type="button"
          onclick="handleIdeaShareAction(event, function(){ shareIdeaOnX('${debateId}', '${encodedArgument}'); })"
          title="Partager l'idée sur X"
          aria-label="Partager l'idée sur X"
          style="width:100%; justify-content:flex-start; gap:8px; padding:8px 10px; border-radius:10px;"
        >
          <i class="fa-brands fa-x-twitter"></i>
          <span>X</span>
        </button>

        <button
          class="share-icon-button"
          type="button"
          onclick="handleIdeaShareAction(event, function(){ shareIdeaByEmail('${debateId}', '${encodedArgument}'); })"
          title="Partager l'idée par email"
          aria-label="Partager l'idée par email"
          style="width:100%; justify-content:flex-start; gap:8px; padding:8px 10px; border-radius:10px;"
        >
          <i class="fa-solid fa-envelope"></i>
          <span>Email</span>
        </button>
      </div>
    </div>
  `;
}
async function copyDebateLink() {
  const { url } = getGlobalShareData();
  try {
    await navigator.clipboard.writeText(url);
    showCopyLinkSuccessMessage();
  } catch (error) {
    alert("Impossible de copier le lien automatiquement.");
  }
}

function getQrCodeImageUrl(url, size = 320) {
  const safeSize = Math.max(160, Number(size || 320));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${safeSize}x${safeSize}&margin=16&data=${encodeURIComponent(String(url || ""))}`;
}

let hiddenQrCodeBaseModal = null;

function restoreHiddenQrCodeBaseModal() {
  if (!hiddenQrCodeBaseModal) return;

  hiddenQrCodeBaseModal.style.display = "flex";
  hiddenQrCodeBaseModal = null;
}

function closeQrCodeFullscreen(options = {}) {
  const shouldRestoreBaseModal = options.restoreBaseModal !== false;
  const overlay = document.getElementById("custom-qrcode-fullscreen-modal");
  if (overlay) {
    overlay.remove();
  }

  if (shouldRestoreBaseModal) {
    restoreHiddenQrCodeBaseModal();
  }
}

function openQrCodeFullscreen(title, url) {
  const safeTitle = String(title || "QR code").trim() || "QR code";
  const safeUrl = String(url || "").trim();

  if (!safeUrl) return;

  const baseModal = document.getElementById("custom-qrcode-modal");
  if (baseModal) {
    hiddenQrCodeBaseModal = baseModal;
    hiddenQrCodeBaseModal.style.display = "none";
  }

  const existing = document.getElementById("custom-qrcode-fullscreen-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "custom-qrcode-fullscreen-modal";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "10001";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.padding = "18px";
  overlay.style.background = "rgba(17, 17, 17, 0.88)";

  overlay.innerHTML = `
    <div style="width:min(96vw, 560px); text-align:center;">
      <div style="display:flex; justify-content:flex-end; margin-bottom:12px;">
        <button
          type="button"
          id="qrcode-fullscreen-close-btn"
          aria-label="Fermer le QR code agrandi"
          style="display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; border:none; border-radius:999px; background:rgba(255,255,255,0.14); color:#ffffff; font-size:20px; cursor:pointer;"
        >
          ✕
        </button>
      </div>

      <div style="margin:0 0 12px; color:#ffffff; font-size:15px; font-weight:700; line-height:1.4;">
        ${escapeHtml(safeTitle)}
      </div>

      <div style="display:flex; justify-content:center;">
        <img
          src="${escapeHtml(getQrCodeImageUrl(safeUrl, 640))}"
          alt="QR code agrandi pour ${escapeHtml(safeTitle)}"
          width="520"
          height="520"
          loading="eager"
          style="display:block; width:min(88vw, 520px); height:auto; border-radius:24px; background:#ffffff; padding:16px; box-shadow:0 20px 60px rgba(0,0,0,0.38);"
        />
      </div>

      <div style="margin-top:14px; color:rgba(255,255,255,0.82); font-size:13px; line-height:1.45;">
        Touchez l’arrière-plan ou la croix pour fermer.
      </div>
    </div>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeQrCodeFullscreen({ restoreBaseModal: true });
    }
  });

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("qrcode-fullscreen-close-btn");
  if (closeBtn) {
    closeBtn.onclick = () => closeQrCodeFullscreen({ restoreBaseModal: true });
    closeBtn.focus();
  }
}

function closeQrCodeModal() {
  closeQrCodeFullscreen({ restoreBaseModal: false });

  const overlay = document.getElementById("custom-qrcode-modal");
  if (!overlay) {
    hiddenQrCodeBaseModal = null;
    return;
  }

  if (hiddenQrCodeBaseModal === overlay) {
    hiddenQrCodeBaseModal = null;
  }

  overlay.remove();
}

function showQrCodeModal(title, url, helperText = "Scannez ce QR code pour ouvrir le lien.") {
  const safeTitle = String(title || "QR code").trim() || "QR code";
  const safeUrl = String(url || "").trim();

  if (!safeUrl) {
    alert("Lien introuvable pour générer le QR code.");
    return;
  }

  const existing = document.getElementById("custom-qrcode-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "custom-qrcode-modal";
  overlay.className = "custom-modal-overlay";

  overlay.innerHTML = `
    <div class="custom-modal-box" style="max-width:420px; width:min(92vw,420px); text-align:center;">
      <div class="custom-modal-title">${escapeHtml(safeTitle)}</div>
      <div class="custom-modal-text">${escapeHtml(helperText)}</div>

      <div style="display:flex; justify-content:center; margin:18px 0 14px;">
        <button
          type="button"
          id="qrcode-preview-btn"
          aria-label="Agrandir le QR code"
          title="Agrandir le QR code"
          style="display:block; padding:0; border:none; background:transparent; cursor:zoom-in;"
        >
          <img
            src="${escapeHtml(getQrCodeImageUrl(safeUrl))}"
            alt="QR code pour ${escapeHtml(safeTitle)}"
            width="220"
            height="220"
            loading="eager"
            style="display:block; width:min(220px, 62vw); height:auto; border-radius:18px; border:1px solid #e5e7eb; background:#ffffff; padding:12px;"
          />
        </button>
      </div>

      <div style="margin:-2px 0 14px; font-size:12px; color:#6b7280;">
        Touchez le QR code pour l’agrandir.
      </div>

      <div style="margin:0 0 18px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:12px; background:#f9fafb; font-size:12px; line-height:1.45; color:#4b5563; word-break:break-word;">
        ${escapeHtml(safeUrl)}
      </div>

      <div class="custom-modal-actions" style="display:flex; flex-wrap:wrap; gap:10px; justify-content:center;">
        <button type="button" class="button button-secondary" id="qrcode-close-btn">
          Fermer
        </button>
        <button type="button" class="button button-secondary" id="qrcode-expand-btn">
          Agrandir
        </button>
        <button type="button" class="button" id="qrcode-copy-btn">
          Copier le lien
        </button>
      </div>
    </div>
  `;

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeQrCodeModal();
    }
  });

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("qrcode-close-btn");
  const copyBtn = document.getElementById("qrcode-copy-btn");
  const expandBtn = document.getElementById("qrcode-expand-btn");
  const previewBtn = document.getElementById("qrcode-preview-btn");

  if (closeBtn) {
    closeBtn.onclick = () => closeQrCodeModal();
  }

  if (expandBtn) {
    expandBtn.onclick = () => openQrCodeFullscreen(safeTitle, safeUrl);
  }

  if (previewBtn) {
    previewBtn.onclick = () => openQrCodeFullscreen(safeTitle, safeUrl);
  }

  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(safeUrl);
        showCopyLinkSuccessMessage();
      } catch (error) {
        alert("Impossible de copier le lien automatiquement.");
      }
    };
  }
}

function showDebateQrCode() {
  const { title, url } = getGlobalShareData();
  showQrCodeModal(title || "QR code de l'arène", url, "Scannez ce QR code pour ouvrir cette arène.");
}

function showIdeaQrCode(debateId, encodedArgumentJson) {
  const argument = JSON.parse(decodeURIComponent(encodedArgumentJson || ""));
  const { title, url } = getIdeaShareData(debateId, argument);
  showQrCodeModal(title || "QR code de l'idée", url, "Scannez ce QR code pour ouvrir directement cette idée.");
}

function showIndexDebateQrCode(debateId, encodedQuestion = "", encodedOptionA = "", encodedOptionB = "", percentA = 50, percentB = 50, type = "debate") {
  const question = decodeURIComponent(encodedQuestion || "");
  const optionA = decodeURIComponent(encodedOptionA || "");
  const optionB = decodeURIComponent(encodedOptionB || "");
  const { title, url } = getIndexDebateShareData(debateId, question, optionA, optionB, percentA, percentB, type);
  showQrCodeModal(title || "QR code de l'arène", url, "Scannez ce QR code pour ouvrir cette arène.");
}

if (!window.__qrCodeModalEscapeListenerAttached) {
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const fullscreenOverlay = document.getElementById("custom-qrcode-fullscreen-modal");

      if (fullscreenOverlay) {
        closeQrCodeFullscreen();
        return;
      }

      closeQrCodeModal();
    }
  });

  window.__qrCodeModalEscapeListenerAttached = true;
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

      <button class="share-button" type="button" onclick="showDebateQrCode()">
        <i class="fa-solid fa-qrcode"></i> QR code
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

  const { url } = getIndexDebateShareData(
    debateId,
    question,
    optionA,
    optionB,
    percentA,
    percentB,
    type
  );

  try {
    await navigator.clipboard.writeText(url);
    showCopyLinkSuccessMessage();
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
function getStoredUnreadNotificationCount() {
  return Math.max(0, Number(localStorage.getItem("notif_count") || 0));
}
function setStoredUnreadNotificationCount(unreadCount) {
  const safeCount = Math.max(0, Number(unreadCount || 0));
  localStorage.setItem("notif_count", safeCount);
  localStorage.setItem("lastNotifCount", safeCount);

  const badge = document.getElementById("notifications-count");
  const compactBadge = document.getElementById("notifications-count-compact");

  updateNotificationBadgeElement(badge, safeCount);
  updateNotificationBadgeElement(compactBadge, safeCount);
}
function decrementStoredUnreadNotificationCount(step = 1) {
  const current = getStoredUnreadNotificationCount();
  setStoredUnreadNotificationCount(Math.max(0, current - Math.max(1, Number(step || 1))));
}
function markNotificationElementAsReadLocally(element) {
  if (!element) return false;

  const wasUnread = element.classList.contains("notification-item-unread");
  element.classList.remove("notification-item-unread");
  return wasUnread;
}
function markAllNotificationElementsAsReadLocally() {
  document.querySelectorAll(".notification-item.notification-item-unread").forEach((element) => {
    element.classList.remove("notification-item-unread");
  });
}
let notificationsLoadInFlight = null;
async function loadNotifications() {
  const badge = document.getElementById("notifications-count");
  const compactBadge = document.getElementById("notifications-count-compact");
  const list = document.getElementById("notifications-list");

  if (!badge && !compactBadge) return;
  if (notificationsLoadInFlight) return notificationsLoadInFlight;

  notificationsLoadInFlight = (async () => {
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

setStoredUnreadNotificationCount(unreadCount);

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

title = getNotificationDisplayTitle(notification, title);
  return `
 <a
  class="notification-item ${Number(notification.is_read) === 0 ? "notification-item-unread" : ""}"
  href="${link}"
  onclick="handleNotificationClick(event, '${notification.id}', '${link}', this)"
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
} finally {
  notificationsLoadInFlight = null;
}
  })();

  return notificationsLoadInFlight;
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

    markAllNotificationElementsAsReadLocally();
    setStoredUnreadNotificationCount(0);
  } catch (error) {
    alert(error.message);
  }
}
async function markOneNotificationAsRead(notificationId) {
  return fetchJSON(API + "/notifications/read-one", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userKey: getKey(),
      notificationId
    })
  });
}
async function handleNotificationClick(event, notificationId, link, element = null) {
  event.preventDefault();
  beginNotificationTransition(link);
  setActionLoading(element);

  const wasUnread = markNotificationElementAsReadLocally(element);
  if (wasUnread) {
    decrementStoredUnreadNotificationCount(1);
  }

  fireAndForgetMarkOneNotificationAsRead(notificationId);

  window.location.href = link;
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
        ? "Plusieurs idées développées"
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
<article class="debate-card ${mediaOutsideLink ? '' : 'debate-card-no-media'}">
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

        </a>

        ${mediaOutsideLink ? mediaHtml : ""}

      </a>

      ${mediaOutsideLink ? mediaHtml : ""}

      <div class="debate-card-actions">${
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

function getDebateCardDeleteButtonHtml(debate) {
  if (!canDeleteDebate(debate)) return "";

  return `
    <button
      class="delete-button"
      type="button"
      onclick="deleteDebate('${debate.id}', false)"
    >
      Supprimer
    </button>
  `;
}

function buildIndexContextPreviewHtml(debate) {
  const fullText = String(debate?.content || '').trim();
  if (!fullText) return "";

  const previewLimit = 170;
  const shortText = fullText.length > previewLimit
    ? `${fullText.slice(0, previewLimit).trimEnd()}…`
    : fullText;
  const needsToggle = fullText.length > previewLimit;
  const debateId = escapeAttribute(String(debate?.id || ""));

  return `
    <div class="debate-card-context" data-index-context-card>
      <p
        class="debate-card-context-text"
        data-index-context-text
        data-full-text="${escapeAttribute(fullText)}"
        data-short-text="${escapeAttribute(shortText)}"
        data-expanded="false"
      >${escapeHtml(shortText)}</p>
      ${needsToggle ? `
        <button
          type="button"
          class="debate-card-context-toggle"
          data-index-context-toggle
          data-debate-id="${debateId}"
          aria-expanded="false"
          onclick="toggleIndexContextPreview(this)"
        >Voir plus</button>
      ` : ""}
    </div>
  `;
}

function toggleIndexContextPreview(button) {
  const card = button?.closest('[data-index-context-card]');
  const textEl = card?.querySelector('[data-index-context-text]');
  if (!button || !textEl) return;

  const expanded = textEl.getAttribute('data-expanded') === 'true';
  const nextExpanded = !expanded;
  const nextText = nextExpanded
    ? String(textEl.getAttribute('data-full-text') || '')
    : String(textEl.getAttribute('data-short-text') || '');

  textEl.textContent = nextText;
  textEl.setAttribute('data-expanded', nextExpanded ? 'true' : 'false');
  button.textContent = nextExpanded ? 'Voir moins' : 'Voir plus';
  button.setAttribute('aria-expanded', nextExpanded ? 'true' : 'false');
}


function getNormalizedCategoryValue(value) {
  const normalized = String(value || "").trim();
  return normalized || "Sans catégorie";
}

function getSortedUniqueDebateCategories(debates) {
  return Array.from(
    new Set((debates || []).map((debate) => getNormalizedCategoryValue(debate.category)))
  ).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
}

function ensureCategoryFilterVisualStyles() {
  if (document.getElementById("theme-filter-styles")) return;

  const style = document.createElement("style");
  style.id = "theme-filter-styles";
  style.textContent = `
    .index-theme-filter-wrap {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 8px;
      width: 100%;
      flex: 0 0 100%;
      order: 99;
      margin: 2px 0 0;
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      max-width: 100%;
    }

    .index-theme-filter-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .index-theme-filter-label-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: #f3f4f6;
      color: #6b7280;
      font-size: 10px;
      border: 1px solid #e5e7eb;
    }

    .index-theme-filter-select {
      appearance: none;
      -webkit-appearance: none;
      min-width: 220px;
      max-width: min(100%, 280px);
      padding: 7px 34px 7px 10px;
      border-radius: 10px;
      border: 1px solid #d1d5db;
      background-color: #ffffff;
      background-image: linear-gradient(45deg, transparent 50%, #9ca3af 50%), linear-gradient(135deg, #9ca3af 50%, transparent 50%);
      background-position: calc(100% - 16px) calc(50% - 2px), calc(100% - 11px) calc(50% - 2px);
      background-size: 5px 5px, 5px 5px;
      background-repeat: no-repeat;
      color: #374151;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      transition: border-color 0.18s ease, box-shadow 0.18s ease, background-color 0.18s ease;
    }

    .index-theme-filter-select:hover {
      border-color: #9ca3af;
      background-color: #f9fafb;
    }

    .index-theme-filter-select:focus {
      border-color: #9ca3af;
      box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.14);
    }

    .index-theme-filter-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      padding: 0 7px;
      border-radius: 999px;
      background: #f3f4f6;
      color: #6b7280;
      font-size: 11px;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .index-theme-filter-wrap[data-active="true"] .index-theme-filter-select {
      border-color: #9ca3af;
      background-color: #f9fafb;
      color: #111827;
    }

    .index-theme-filter-wrap[data-active="true"] .index-theme-filter-badge {
      background: #e5e7eb;
      color: #374151;
    }

    @media (max-width: 768px) {
    .index-theme-filter-wrap {
  width: 100%;
  flex: 0 0 100%;
  order: 99;
  gap: 6px;
  margin-top: 2px;
}

      .index-theme-filter-label {
        font-size: 11px;
      }

      .index-theme-filter-select {
        min-width: 0;
        max-width: none;
        width: 100%;
        font-size: 12px;
        padding: 7px 32px 7px 10px;
      }
    }
  `;

  document.head.appendChild(style);
}

function updateCategoryFilterVisualState() {
  const wrap = document.getElementById("filter-theme-wrap");
  const badge = document.getElementById("filter-theme-badge");
  const select = document.getElementById("filter-theme");
  if (!wrap || !badge || !select) return;

  const value = select.value || "all";
  const isActive = value !== "all";
  const count = Math.max(0, getFilteredDebatesForIndex(debatesCache).length);

  wrap.dataset.active = isActive ? "true" : "false";
  badge.textContent = String(count);
  badge.title = `${count} arène${count > 1 ? "s" : ""}`;
}

function ensureCategoryFilterControl() {
  const searchInput = document.getElementById("debate-search");
  if (!searchInput) return null;

  ensureCategoryFilterVisualStyles();

  let select = document.getElementById("filter-theme");
  if (select) {
    updateCategoryFilterVisualState();
    return select;
  }

  const themeFilterSlot = document.getElementById("theme-filter-slot");
  if (!themeFilterSlot) return null;

  const wrap = document.createElement("div");
  wrap.id = "filter-theme-wrap";
  wrap.className = "index-theme-filter-wrap";
  wrap.dataset.active = "false";

  select = document.createElement("select");
  select.id = "filter-theme";
  select.className = "index-theme-filter-select";
  select.setAttribute("aria-label", "Filtrer les arènes par thématique");

  const badge = document.createElement("span");
  badge.id = "filter-theme-badge";
  badge.className = "index-theme-filter-badge";
  badge.textContent = "0";
  badge.setAttribute("aria-hidden", "true");

  select.addEventListener("change", () => {
    currentCategoryFilter = select.value || "all";
    visitedDebatesVisible = 5;
    otherDebatesVisible = 6;
    applyIndexFilters();
  });

  wrap.appendChild(select);
  wrap.appendChild(badge);

  themeFilterSlot.innerHTML = "";
  themeFilterSlot.appendChild(wrap);

  updateCategoryFilterVisualState();
  return select;
}

function refreshCategoryFilterOptions(debates) {
  const select = ensureCategoryFilterControl();
  if (!select) return;

  const categories = getSortedUniqueDebateCategories(debates);
  const previousValue = currentCategoryFilter;

  select.innerHTML = [
    '<option value="all">Toutes les thématiques</option>',
    ...categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`)
  ].join("");

  const allowedValues = new Set(["all", ...categories]);
  const nextValue = allowedValues.has(previousValue) ? previousValue : "all";

  currentCategoryFilter = nextValue;
  select.value = nextValue;
  updateCategoryFilterVisualState();
}

function getFilteredDebatesForIndex(baseDebates) {
  let filteredDebates = Array.isArray(baseDebates) ? [...baseDebates] : [];

  const searchInput = document.getElementById("debate-search");
  const query = String(searchInput?.value || "").trim().toLowerCase();

  if (query) {
    filteredDebates = filteredDebates.filter((debate) => {
      const question = String(debate.question || "").toLowerCase();
      const category = String(debate.category || "").toLowerCase();
      const optionA = String(debate.option_a || "").toLowerCase();
      const optionB = String(debate.option_b || "").toLowerCase();

      return (
        question.includes(query) ||
        category.includes(query) ||
        optionA.includes(query) ||
        optionB.includes(query)
      );
    });
  }

  if (currentTypeFilter === "debate") {
    filteredDebates = filteredDebates.filter((debate) => !isOpenDebate(debate));
  }

  if (currentTypeFilter === "question") {
    filteredDebates = filteredDebates.filter((debate) => isOpenDebate(debate));
  }

  if (currentCategoryFilter !== "all") {
    filteredDebates = filteredDebates.filter(
      (debate) => getNormalizedCategoryValue(debate.category) === currentCategoryFilter
    );
  }

  return filteredDebates;
}

function applyIndexFilters() {
  const filteredDebates = getFilteredDebatesForIndex(debatesCache);
  updateIndexLists(filteredDebates);
  updateCategoryFilterVisualState();
}

function renderVisitedDebatesList(debates) {
  const section = document.getElementById("visited-debates-section");
  const div = document.getElementById("visited-debates-list");
  const header = document.getElementById("visited-section-header");

if (!section || !div || !header) return;

if (!debates.length) {
  header.style.display = "none";
  section.style.display = "none";
  div.innerHTML = "";
  return;
}

header.style.display = "flex";
section.style.display = "block";

  const debatesToShow = debates.slice(0, visitedDebatesVisible);

  div.innerHTML = debatesToShow.map(d => {
    const debateTypeLabel = isOpenDebate(d) ? "Arène libre" : "Arène à position";
const mediaHtml = renderIndexInlineSourceCard(d);
const mediaOutsideLink = !!mediaHtml;
const contextHtml = buildIndexContextPreviewHtml(d);

    return `
      <article class="debate-card">
        <a class="debate-card-link" href="/debate?id=${d.id}">
          <div class="debate-card-category">${escapeHtml(d.category || "Sans catégorie")}</div>
          <div class="debate-card-type">${debateTypeLabel}</div>
          <h2>${escapeHtml(d.question)}</h2>

          ${mediaOutsideLink ? "" : mediaHtml}

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

        </a>

        ${mediaOutsideLink ? mediaHtml : ""}
        ${contextHtml}

<div class="debate-card-meta-below-media ${mediaOutsideLink ? '' : 'debate-card-meta-no-media'}">
          <p class="debate-card-ideas-count">${d.argument_count || 0} idée(s)</p>
          <p class="debate-date">${escapeHtml(formatDebateDate(d.created_at))}</p>
          ${d.last_argument_at ? `<p class="debate-last-argument">${escapeHtml(formatLastArgumentDate(d.last_argument_at))}</p>` : ""}
        </div>

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
              onclick="showIndexDebateQrCode(
  '${d.id}',
  '${encodeURIComponent(String(d.question || ""))}',
  '${encodeURIComponent(String(d.option_a || ""))}',
  '${encodeURIComponent(String(d.option_b || ""))}',
  '${d.percent_a ?? 50}',
  '${d.percent_b ?? 50}',
  '${encodeURIComponent(String(d.type || "debate"))}'
)"
              title="Afficher le QR code"
            >
              <i class="fa-solid fa-qrcode"></i>
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

          ${getDebateCardDeleteButtonHtml(d)}
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
  initIndexYouTubeObserver(document);
  initIndexLocalVideoObserver(document);
  initIndexXObserver(document);
  initIndexInstagramObserver(document);
}
   
function loadMoreVisitedDebates() {
  visitedDebatesVisible += 5;
  renderVisitedDebatesList(visitedDebatesCache);
}
function renderDebatesList(debates) {
  const debatesToShow = debates.slice(0, otherDebatesVisible);
  const div = document.getElementById("debates-list");
  const header = document.getElementById("other-section-header");
  if (!div || !header) return;

if (!debates.length) {
  header.style.display = "none";
  div.innerHTML = "";
  refreshAdminUI();
  return;
}

header.style.display = "flex";

div.innerHTML = debatesToShow.map(d => {
  const debateTypeLabel = isOpenDebate(d) ? "Arène libre" : "Arène à position";
const mediaHtml = renderIndexInlineSourceCard(d);
const mediaOutsideLink = !!mediaHtml;
const contextHtml = buildIndexContextPreviewHtml(d);

  return `
    <article class="debate-card">
      <a class="debate-card-link" href="/debate?id=${d.id}">
        <div class="debate-card-category">${escapeHtml(d.category || "Sans catégorie")}</div>
        <div class="debate-card-type">${debateTypeLabel}</div>
        <h2>${escapeHtml(d.question)}</h2>

        ${mediaOutsideLink ? "" : mediaHtml}

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

          </a>

      ${mediaOutsideLink ? mediaHtml : ""}
      ${contextHtml}

      <div class="debate-card-meta-below-media">
        <p class="debate-card-ideas-count">${d.argument_count || 0} idée(s)</p>
        <p class="debate-date">${escapeHtml(formatDebateDate(d.created_at))}</p>
        ${d.last_argument_at ? `<p class="debate-last-argument">${escapeHtml(formatLastArgumentDate(d.last_argument_at))}</p>` : ""}
      </div>

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
onclick="showIndexDebateQrCode('${d.id}', '${encodeURIComponent(String(d.question || ""))}', '${encodeURIComponent(String(d.option_a || ""))}', '${encodeURIComponent(String(d.option_b || ""))}', '${d.percent_a ?? 50}', '${d.percent_b ?? 50}', '${encodeURIComponent(String(d.type || "debate"))}')"            title="Afficher le QR code"
          >
            <i class="fa-solid fa-qrcode"></i>
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

        ${getDebateCardDeleteButtonHtml(d)}
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
  initIndexYouTubeObserver(document);
  initIndexLocalVideoObserver(document);
  initIndexXObserver(document);
  initIndexInstagramObserver(document);
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
  applyIndexFilters();
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

  applyIndexFilters();
}

function updateIndexLists(debates) {
  const visitedIds = getVisitedDebateIds().map(String);

  visitedDebatesCache = debates.filter((d) => visitedIds.includes(String(d.id)));
  otherDebatesCache = debates.filter((d) => !visitedIds.includes(String(d.id)));

  renderVisitedDebatesList(visitedDebatesCache);
  renderDebatesList(otherDebatesCache);
}
async function initIndex() {
  try {
    const debates = await fetchJSON(API + "/debates");
    debatesCache = debates;
    visitedDebatesVisible = 5;
    otherDebatesVisible = 6;
    currentTypeFilter = "all";
    currentCategoryFilter = "all";

    refreshCategoryFilterOptions(debatesCache);
    applyIndexFilters();

    const searchInput = document.getElementById("debate-search");
    if (searchInput) {
      searchInput.addEventListener("input", filterDebates);
    }

    setTypeFilter("all");
  } catch (error) {
    alert(error.message);
  }
}

/* =========================
   Create
========================= */

function getSelectedCreateResourceMode() {
  return document.querySelector('input[name="resource-mode"]:checked')?.value || "none";
}

function getCreateVideoFileInput() {
  return document.getElementById("debate_video_file")
    || document.getElementById("video_file")
    || document.getElementById("create_video_file")
    || document.querySelector('#video-upload-group input[type="file"]')
    || document.querySelector('input[type="file"][accept*="video"]');
}

function toggleCreateContextField(forceOpen = null) {
  const group = document.getElementById("context-text-group");
  const button = document.getElementById("toggle-context-button");

  if (!group || !button) return;

  const shouldOpen = typeof forceOpen === "boolean"
    ? forceOpen
    : group.style.display === "none" || !group.style.display;

  group.style.display = shouldOpen ? "grid" : "none";
  button.textContent = shouldOpen
    ? "Retirer le texte de contexte"
    : "Ajouter un texte de contexte";
  button.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

function getCreateContextText() {
  const input = document.getElementById("context_text");
  return input ? input.value.trim().slice(0, 1800) : "";
}

function renderDebateContext(content) {
  const wrap = document.getElementById("debate-context-wrap");
  const text = document.getElementById("debate-context-text");
  if (!wrap || !text) return;

  const safeContent = String(content || "").trim();
  if (!safeContent) {
    wrap.style.display = "none";
    text.textContent = "";
    return;
  }

  text.textContent = safeContent;
  wrap.style.display = "block";
}

function updateCreateResourceModeUI() {
  const mode = getSelectedCreateResourceMode();
  const sourceGroup = document.getElementById("source-url-group");
  const sourceInput = document.getElementById("source_url");
  const imageGroup = document.getElementById("image-upload-group");
  const imageInput = document.getElementById("debate_image_file");
  const videoGroup = document.getElementById("video-upload-group");
  const videoInput = getCreateVideoFileInput();

  if (sourceGroup) {
    sourceGroup.style.display = mode === "source" ? "grid" : "none";
  }

  if (sourceInput) {
    sourceInput.disabled = mode !== "source";
    sourceInput.required = mode === "source";
    if (mode !== "source") {
      sourceInput.value = "";
    }
  }

  if (imageGroup) {
    imageGroup.style.display = mode === "image" ? "grid" : "none";
  }

  if (imageInput) {
    imageInput.disabled = mode !== "image";
    imageInput.required = mode === "image";
    if (mode !== "image") {
      imageInput.value = "";
    }
  }

  if (videoGroup) {
    videoGroup.style.display = mode === "video" ? "grid" : "none";
  }

  if (videoInput) {
    videoInput.disabled = mode !== "video";
    videoInput.required = mode === "video";
    if (mode !== "video") {
      videoInput.value = "";
    }
  }
}

function readFileAsDataUrl(file, options = {}) {
  const { onProgress } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof onProgress === "function") {
        onProgress(100);
      }
      resolve(String(reader.result || ""));
    };

    reader.onerror = () => reject(new Error("Impossible de lire l'image."));

    reader.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    reader.readAsDataURL(file);
  });
}

function readFileAsArrayBuffer(file, options = {}) {
  const { onProgress, signal } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    const abortRead = () => {
      try {
        if (reader.readyState === FileReader.LOADING) {
          reader.abort();
        }
      } catch (error) {
        // noop
      }
      reject(new Error("Publication annulée."));
    };

    if (signal?.aborted) {
      abortRead();
      return;
    }

    const handleAbort = () => abortRead();
    if (signal) {
      signal.addEventListener("abort", handleAbort, { once: true });
    }

    reader.onload = () => {
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
      if (typeof onProgress === "function") {
        onProgress(100);
      }
      resolve(reader.result);
    };

    reader.onerror = () => {
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
      reject(new Error("Impossible de lire la vidéo."));
    };

    reader.onabort = () => {
      if (signal) {
        signal.removeEventListener("abort", handleAbort);
      }
      reject(new Error("Publication annulée."));
    };

    reader.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress(Math.round((event.loaded / event.total) * 100));
    };

    reader.readAsArrayBuffer(file);
  });
}


const CLIENT_VIDEO_COMPRESSION_THRESHOLD_BYTES = 12 * 1024 * 1024;
const CLIENT_VIDEO_COMPRESSION_MAX_DIMENSION = 720;
const CLIENT_VIDEO_COMPRESSION_MAX_DURATION_SECONDS = 90;
const CLIENT_VIDEO_COMPRESSION_MIN_RATIO_GAIN = 0.9;

function getSupportedClientCompressedVideoMimeType() {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return "";
  }

  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4"
  ];

  return candidates.find((mimeType) => {
    try {
      return MediaRecorder.isTypeSupported(mimeType);
    } catch (error) {
      return false;
    }
  }) || "";
}

function getVideoExtensionFromMimeTypeForClientCompression(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("mp4")) return "mp4";
  return "webm";
}

function replaceFileExtension(fileName, nextExtension) {
  const safeName = String(fileName || "video").trim() || "video";
  const baseName = safeName.replace(/\.[^.]+$/, "") || "video";
  return `${baseName}.${nextExtension}`;
}

function shouldCompressVideoBeforeUpload(file) {
  if (!(file instanceof File)) return false;
  if (Number(file.size || 0) <= CLIENT_VIDEO_COMPRESSION_THRESHOLD_BYTES) return false;
  if (typeof MediaRecorder === "undefined") return false;
  if (typeof document === "undefined") return false;

  const mimeType = getSupportedClientCompressedVideoMimeType();
  if (!mimeType) return false;

  const canvas = document.createElement("canvas");
  return typeof canvas.captureStream === "function";
}

function loadVideoMetadataFromFile(file, options = {}) {
  const { signal } = options;

  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(objectUrl);
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    };

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const safeReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const abortHandler = () => safeReject(new Error("Publication annulée."));

    if (signal?.aborted) {
      abortHandler();
      return;
    }

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      safeResolve({
        duration: Number(video.duration || 0),
        width: Number(video.videoWidth || 0),
        height: Number(video.videoHeight || 0)
      });
    };

    video.onerror = () => {
      safeReject(new Error("Impossible d’analyser la vidéo avant envoi."));
    };

    video.src = objectUrl;
  });
}

async function compressVideoBeforeUpload(file, options = {}) {
  const { signal, onProgress } = options;

  if (!(file instanceof File)) {
    throw new Error("Vidéo invalide.");
  }

  const supportedMimeType = getSupportedClientCompressedVideoMimeType();
  if (!supportedMimeType) {
    return {
      file,
      compressed: false,
      reason: "unsupported"
    };
  }

  const metadata = await loadVideoMetadataFromFile(file, { signal });
  const duration = Number(metadata.duration || 0);
  const sourceWidth = Number(metadata.width || 0);
  const sourceHeight = Number(metadata.height || 0);

  if (!duration || !sourceWidth || !sourceHeight) {
    return {
      file,
      compressed: false,
      reason: "invalid-metadata"
    };
  }

  if (duration > CLIENT_VIDEO_COMPRESSION_MAX_DURATION_SECONDS) {
    return {
      file,
      compressed: false,
      reason: "too-long",
      metadata
    };
  }

  const maxDimension = CLIENT_VIDEO_COMPRESSION_MAX_DIMENSION;
  const ratio = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const targetWidth = Math.max(2, Math.round((sourceWidth * ratio) / 2) * 2);
  const targetHeight = Math.max(2, Math.round((sourceHeight * ratio) / 2) * 2);

  const needsResize = targetWidth < sourceWidth || targetHeight < sourceHeight;
  const needsCompression = Number(file.size || 0) > CLIENT_VIDEO_COMPRESSION_THRESHOLD_BYTES;

  if (!needsResize && !needsCompression) {
    return {
      file,
      compressed: false,
      reason: "not-needed",
      metadata
    };
  }

  return new Promise((resolve, reject) => {
    const sourceVideo = document.createElement("video");
    const sourceUrl = URL.createObjectURL(file);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { alpha: false });

    if (!ctx || typeof canvas.captureStream !== "function") {
      URL.revokeObjectURL(sourceUrl);
      resolve({ file, compressed: false, reason: "unsupported", metadata });
      return;
    }

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const stream = canvas.captureStream(24);
    let recorder;
    const chunks = [];
    let settled = false;
    let drawHandle = 0;
    let abortHandler = null;

    const cleanup = () => {
      if (drawHandle) {
        cancelAnimationFrame(drawHandle);
        drawHandle = 0;
      }

      try {
        sourceVideo.pause();
      } catch (error) {
        // noop
      }

      sourceVideo.removeAttribute("src");
      sourceVideo.load();
      URL.revokeObjectURL(sourceUrl);

      try {
        stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        // noop
      }

      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    };

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const safeReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const drawFrame = () => {
      if (settled) return;
      try {
        ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
      } catch (error) {
        // noop
      }

      if (typeof onProgress === "function" && duration > 0) {
        const normalizedProgress = Math.min(100, Math.max(0, Math.round((sourceVideo.currentTime / duration) * 100)));
        onProgress(normalizedProgress);
      }

      if (!sourceVideo.paused && !sourceVideo.ended) {
        drawHandle = requestAnimationFrame(drawFrame);
      }
    };

    const finishRecording = () => {
      if (settled) return;
      if (typeof onProgress === "function") {
        onProgress(100);
      }
      try {
        if (recorder && recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (error) {
        safeReject(error);
      }
    };

    abortHandler = () => {
      try {
        if (recorder && recorder.state !== "inactive") {
          recorder.stop();
        }
      } catch (error) {
        // noop
      }
      safeReject(new Error("Publication annulée."));
    };

    if (signal?.aborted) {
      abortHandler();
      return;
    }

    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
    }

    try {
      recorder = new MediaRecorder(stream, {
        mimeType: supportedMimeType,
        videoBitsPerSecond: 1200000,
        audioBitsPerSecond: 96000
      });
    } catch (error) {
      cleanup();
      resolve({ file, compressed: false, reason: "recorder-init-failed", metadata });
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      safeReject(new Error("Compression locale impossible sur cet appareil."));
    };

    recorder.onstop = () => {
      if (settled) return;

      const blob = new Blob(chunks, { type: supportedMimeType });
      if (!blob.size) {
        safeResolve({ file, compressed: false, reason: "empty-output", metadata });
        return;
      }

      if (blob.size >= Number(file.size || 0) * CLIENT_VIDEO_COMPRESSION_MIN_RATIO_GAIN) {
        safeResolve({ file, compressed: false, reason: "not-smaller", metadata });
        return;
      }

      const extension = getVideoExtensionFromMimeTypeForClientCompression(supportedMimeType);
      const compressedFile = new File(
        [blob],
        replaceFileExtension(file.name || "video", extension),
        {
          type: supportedMimeType,
          lastModified: Date.now()
        }
      );

      safeResolve({
        file: compressedFile,
        compressed: true,
        originalSize: Number(file.size || 0),
        compressedSize: Number(compressedFile.size || 0),
        metadata,
        mimeType: supportedMimeType
      });
    };

    sourceVideo.preload = "auto";
    sourceVideo.muted = true;
    sourceVideo.defaultMuted = true;
    sourceVideo.playsInline = true;

    sourceVideo.onloadedmetadata = async () => {
      try {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        ctx.drawImage(sourceVideo, 0, 0, targetWidth, targetHeight);
        recorder.start(250);
        sourceVideo.currentTime = 0;
        drawHandle = requestAnimationFrame(drawFrame);
        await sourceVideo.play();
      } catch (error) {
        safeReject(new Error("Impossible de démarrer la compression locale."));
      }
    };

    sourceVideo.onended = () => {
      finishRecording();
    };

    sourceVideo.onerror = () => {
      safeReject(new Error("Impossible de lire la vidéo avant envoi."));
    };

    sourceVideo.src = sourceUrl;
  });
}

function createXhrRequest(url, options = {}) {
  const {
    method = "GET",
    headers = {},
    body = null,
    responseType = "json",
    onUploadProgress,
    onUploadComplete,
    signal,
    onXhrCreated
  } = options;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);

    let settled = false;

    const cleanupAbortListener = () => {
      if (signal && abortHandler) {
        signal.removeEventListener("abort", abortHandler);
      }
    };

    const safeResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      resolve(value);
    };

    const safeReject = (error) => {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      reject(error);
    };

    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value == null) return;
      xhr.setRequestHeader(key, value);
    });

    if (typeof onXhrCreated === "function") {
      onXhrCreated(xhr);
    }

    if (xhr.upload) {
      if (typeof onUploadProgress === "function") {
        xhr.upload.addEventListener("progress", (event) => {
          if (!event.lengthComputable) return;
          onUploadProgress(Math.round((event.loaded / event.total) * 100), event);
        });
      }

      if (typeof onUploadComplete === "function") {
        xhr.upload.addEventListener("loadend", () => {
          onUploadComplete();
        });
      }
    }

    let abortHandler = null;
    if (signal) {
      abortHandler = () => {
        try {
          xhr.abort();
        } catch (error) {
          // noop
        }
      };

      if (signal.aborted) {
        abortHandler();
        return;
      }

      signal.addEventListener("abort", abortHandler, { once: true });
    }

    xhr.onload = () => {
      let payload = xhr.responseText;

      if (responseType === "json") {
        try {
          payload = payload ? JSON.parse(payload) : {};
        } catch (error) {
          payload = {};
        }
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        safeResolve(payload);
        return;
      }

      const message = payload && typeof payload === "object"
        ? payload.error || "Erreur serveur"
        : "Erreur serveur";
      safeReject(new Error(message));
    };

    xhr.onerror = () => safeReject(new Error("Erreur réseau."));
    xhr.onabort = () => safeReject(new Error(signal?.aborted ? "Publication annulée." : "Envoi interrompu."));
    xhr.send(body);
  });
}

function ensureDebateImageSlot() {
  let wrap = document.getElementById("debate-image-wrap");
  if (wrap) return wrap;

  const heroSection = document.querySelector(".debate-hero");
  if (!heroSection) return null;

  wrap = document.createElement("div");
  wrap.id = "debate-image-wrap";
  wrap.className = "debate-image-wrap";
  wrap.style.display = "none";
  wrap.innerHTML = '<img id="debate-image" class="debate-image" alt="Image du débat">';

  heroSection.appendChild(wrap);
  return wrap;
}

function ensureDebateVideoSlot() {
  let wrap = document.getElementById("debate-video-wrap");
  if (wrap) return wrap;

  const heroSection = document.querySelector(".debate-hero");
  if (!heroSection) return null;

  wrap = document.createElement("div");
  wrap.id = "debate-video-wrap";
  wrap.className = "debate-video-wrap";
  wrap.style.display = "none";
  wrap.innerHTML = `
    <video
      id="debate-video"
      class="debate-video"
      controls
      playsinline
      preload="metadata"
      style="display:block; width:100%; height:auto; border-radius:20px; background:#000;"
    ></video>
  `;

  heroSection.insertAdjacentElement("afterbegin", wrap);
  return wrap;
}

function resetDebateVideo() {
  const wrap = document.getElementById("debate-video-wrap");
  const videoEl = document.getElementById("debate-video");

  if (videoEl) {
    try {
      videoEl.pause();
    } catch (error) {
      // noop
    }
    videoEl.removeAttribute("src");
    videoEl.load();
  }

  if (wrap) {
    wrap.style.display = "none";
  }
}

function renderDebateVideo(videoUrl) {
  const wrap = ensureDebateVideoSlot();
  const videoEl = document.getElementById("debate-video");

  if (!wrap || !videoEl) return;

  const normalizedUrl = String(videoUrl || "").trim();

  if (!normalizedUrl) {
    resetDebateVideo();
    return;
  }

  const imageWrap = document.getElementById("debate-image-wrap");
  const imageEl = document.getElementById("debate-image");
  if (imageWrap) imageWrap.style.display = "none";
  if (imageEl) imageEl.removeAttribute("src");
  closeDebateImageLightbox();
  resetDebateSourcePreview();

  if (videoEl.getAttribute("src") !== normalizedUrl) {
    videoEl.src = normalizedUrl;
    videoEl.load();
  }

  wrap.style.display = "block";
}

function renderDebateImage(imageUrl) {
  const wrap = ensureDebateImageSlot();
  const imageEl = document.getElementById("debate-image");

  if (!wrap || !imageEl) return;

  const normalizedUrl = String(imageUrl || "").trim();

  if (!normalizedUrl) {
   wrap.style.display = "none";
imageEl.removeAttribute("src");
closeDebateImageLightbox();
return;
  }
resetDebateVideo();
imageEl.src = normalizedUrl;
wrap.style.display = "block";
initDebateImageLightbox();
}
function openDebateImageLightbox() {
  const imageEl = document.getElementById("debate-image");
  const lightbox = document.getElementById("debate-image-lightbox");
  const lightboxImg = document.getElementById("debate-image-lightbox-img");

  if (!imageEl || !lightbox || !lightboxImg) return;

  const src = String(imageEl.getAttribute("src") || "").trim();
  if (!src) return;

  lightboxImg.src = src;
  lightbox.classList.add("debate-image-lightbox-open");
  lightbox.style.display = "flex";
  lightbox.setAttribute("aria-hidden", "false");
}
function toggleDebateImageLightbox() {
  const lightbox = document.getElementById("debate-image-lightbox");
  if (!lightbox) return;

  const isOpen =
    lightbox.classList.contains("debate-image-lightbox-open") ||
    lightbox.style.display === "flex";

  if (isOpen) {
    closeDebateImageLightbox();
  } else {
    openDebateImageLightbox();
  }
}

function closeDebateImageLightbox() {
  const lightbox = document.getElementById("debate-image-lightbox");
  const lightboxImg = document.getElementById("debate-image-lightbox-img");

  if (!lightbox || !lightboxImg) return;

  lightbox.classList.remove("debate-image-lightbox-open");
  lightbox.style.display = "none";
  lightbox.setAttribute("aria-hidden", "true");
  lightboxImg.removeAttribute("src");
}

function initDebateImageLightbox() {
  const imageEl = document.getElementById("debate-image");
  const lightbox = document.getElementById("debate-image-lightbox");
  const lightboxImg = document.getElementById("debate-image-lightbox-img");
  const closeBtn = document.getElementById("debate-image-lightbox-close");

  if (!imageEl || !lightbox || !closeBtn) return;
  if (imageEl.dataset.lightboxBound === "true") return;

  imageEl.addEventListener("dblclick", toggleDebateImageLightbox);

  if (lightboxImg) {
    lightboxImg.addEventListener("dblclick", toggleDebateImageLightbox);
  }

  closeBtn.addEventListener("click", closeDebateImageLightbox);

  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeDebateImageLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDebateImageLightbox();
    }
  });

  imageEl.dataset.lightboxBound = "true";
}

async function initCreate() {
  const form = document.getElementById("create-form");
  if (!form) return;

  const questionInput = document.getElementById("question");
  const similarBox = document.getElementById("similar-debates-box");
  const similarList = document.getElementById("similar-debates-list");

const submitButton = form.querySelector(".create-submit-button");
const submitButtonInitialText = submitButton ? submitButton.innerHTML : "";
const submitHelper = document.getElementById("create-submit-helper");
const cancelPublishButton = document.getElementById("create-publish-cancel");
let createPublishAbortController = null;
let createPublishCancelRequested = false;
const CREATE_PENDING_VIDEO_UPLOAD_STORAGE_KEY = "agon_pending_create_video_upload";

function getCreatePendingVideoUploadState() {
  try {
    const raw = localStorage.getItem(CREATE_PENDING_VIDEO_UPLOAD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (error) {
    return null;
  }
}

function setCreatePendingVideoUploadState(nextState) {
  try {
    if (!nextState || typeof nextState !== "object") {
      localStorage.removeItem(CREATE_PENDING_VIDEO_UPLOAD_STORAGE_KEY);
      return;
    }

    localStorage.setItem(CREATE_PENDING_VIDEO_UPLOAD_STORAGE_KEY, JSON.stringify({
      debateId: String(nextState.debateId || "").trim(),
      authorKey: String(nextState.authorKey || "").trim(),
      objectPath: String(nextState.objectPath || "").trim().replace(/^\/+/, ""),
      mimeType: String(nextState.mimeType || "").trim(),
      fileName: String(nextState.fileName || "").trim(),
      status: String(nextState.status || "pending").trim(),
      startedAt: Number(nextState.startedAt || Date.now()) || Date.now()
    }));
  } catch (error) {
    console.warn("[video-upload] impossible de mémoriser l’état de reprise.", error);
  }
}

function clearCreatePendingVideoUploadState() {
  try {
    localStorage.removeItem(CREATE_PENDING_VIDEO_UPLOAD_STORAGE_KEY);
  } catch (error) {
    // noop
  }
}

async function resumePendingCreateVideoUpload() {
  const pendingUpload = getCreatePendingVideoUploadState();
  if (!pendingUpload) return false;

  const debateId = String(pendingUpload.debateId || "").trim();
  const authorKey = String(pendingUpload.authorKey || "").trim();
  const objectPath = String(pendingUpload.objectPath || "").trim().replace(/^\/+/, "");
  const mimeType = String(pendingUpload.mimeType || "").trim();

  if (!debateId || !authorKey || !objectPath) {
    clearCreatePendingVideoUploadState();
    return false;
  }

  startCreatePublishSession();
  setCreatePublishProgress(96, "Reprise de la vidéo", "Vérification de l’envoi précédent…");

  try {
    const status = await fetchJSON(
      `${API}/debates/${encodeURIComponent(debateId)}/video-upload-status?authorKey=${encodeURIComponent(authorKey)}&objectPath=${encodeURIComponent(objectPath)}`,
      {
        signal: getCreatePublishSignal(),
        method: "GET"
      }
    );

    if (status?.finalized) {
      clearCreatePendingVideoUploadState();
      setCreatePublishProgress(100, "Publication terminée", "La vidéo était déjà finalisée. Redirection vers l’arène…");
      window.location.href = `/debate?id=${encodeURIComponent(debateId)}`;
      return true;
    }

    if (!status?.exists) {
      clearCreatePendingVideoUploadState();
      hideCreatePublishProgress();
      showReplacementSuccessMessage(
        "Upload interrompu",
        "La vidéo n’a pas été retrouvée dans le stockage. Il faut relancer l’envoi depuis la page de création.",
        null,
        "⚠️"
      );
      return false;
    }

    setCreatePendingVideoUploadState({
      ...pendingUpload,
      status: "finalizing"
    });

    setCreatePublishProgress(99, "Finalisation de la vidéo", "La vidéo a bien été retrouvée. Finalisation en cours…");

    await fetchJSON(
      `${API}/debates/${encodeURIComponent(debateId)}/video-upload-complete?authorKey=${encodeURIComponent(authorKey)}`,
      {
        signal: getCreatePublishSignal(),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objectPath,
          mimeType: mimeType || "application/octet-stream"
        })
      }
    );

    clearCreatePendingVideoUploadState();
    setCreatePublishProgress(100, "Publication terminée", "La vidéo a été rattachée à l’arène. Redirection…");
    window.location.href = `/debate?id=${encodeURIComponent(debateId)}`;
    return true;
  } catch (error) {
    if (createPublishCancelRequested || getCreatePublishSignal()?.aborted || /annul/i.test(String(error?.message || ""))) {
      hideCreatePublishProgress();
      return true;
    }

    hideCreatePublishProgress();
    showReplacementSuccessMessage(
      "Reprise impossible",
      "La vidéo a peut-être déjà été envoyée, mais sa finalisation n’a pas pu être reprise automatiquement. Recharge la page de création ou ouvre l’arène pour vérifier.",
      null,
      "⚠️"
    );
    return false;
  } finally {
    createPublishAbortController = null;
    createPublishCancelRequested = false;
    setCreatePublishCancelState(false);
  }
}

function resetCreateSubmitButton() {
  if (!submitButton) return;
  submitButton.disabled = false;
  submitButton.classList.remove("create-submit-loading");
  submitButton.innerHTML = submitButtonInitialText;
}

function startCreatePublishSession() {
  createPublishCancelRequested = false;
  createPublishAbortController = typeof AbortController !== "undefined" ? new AbortController() : null;
  showCreatePublishProgress();
  setCreatePublishCancelState(false);
}

function cancelCreatePublishSession() {
  createPublishCancelRequested = true;
  setCreatePublishCancelState(true);
  setCreatePublishProgress(currentCreatePublishProgressValue, "Annulation en cours", "La publication est en train d’être interrompue…");

  if (createPublishAbortController) {
    createPublishAbortController.abort();
  }
}

function getCreatePublishSignal() {
  return createPublishAbortController ? createPublishAbortController.signal : undefined;
}

cancelPublishButton?.addEventListener("click", () => {
  cancelCreatePublishSession();
});

void resumePendingCreateVideoUpload();

function getCreateValidationState() {
  const question = document.getElementById("question")?.value.trim() || "";
  const category = document.getElementById("category")?.value.trim() || "";
  const selectedType = document.querySelector('input[name="debate-type"]:checked')?.value || "debate";
  const optionA = selectedType === "open"
    ? ""
    : document.getElementById("option_a")?.value.trim() || "";
  const optionB = selectedType === "open"
    ? ""
    : document.getElementById("option_b")?.value.trim() || "";
  const resourceMode = getSelectedCreateResourceMode();
  const sourceUrl = resourceMode === "source"
    ? document.getElementById("source_url")?.value.trim() || ""
    : "";
  const imageFile = resourceMode === "image"
    ? document.getElementById("debate_image_file")?.files?.[0] || null
    : null;
  const videoFile = resourceMode === "video"
    ? getCreateVideoFileInput()?.files?.[0] || null
    : null;

  return {
    isValid:
      !!question &&
      !!category &&
      (selectedType === "open" || (!!optionA && !!optionB)) &&
      (resourceMode !== "source" || !!sourceUrl) &&
      (resourceMode !== "image" || !!imageFile) &&
      (resourceMode !== "video" || !!videoFile),
    question,
    category,
    selectedType,
    optionA,
    optionB,
    resourceMode,
    sourceUrl,
    imageFile,
    videoFile
  };
}

function updateCreateSubmitAvailability(showIncompleteMessage = false) {
  if (!submitButton) return;
  if (submitButton.classList.contains("create-submit-loading")) return;

  const { isValid } = getCreateValidationState();
  const helperMessage = "Complète tous les champs requis pour créer l’arène.";

  submitButton.disabled = false;
  submitButton.removeAttribute("aria-disabled");
  submitButton.title = "Créer l’arène";

  if (submitHelper) {
    const shouldShowMessage = showIncompleteMessage && !isValid;
    submitHelper.textContent = shouldShowMessage ? helperMessage : "";
    submitHelper.classList.toggle("create-submit-helper-visible", shouldShowMessage);
  }
}

function getCreateValidationError() {
  const validationState = getCreateValidationState();
  const {
    question,
    category,
    selectedType,
    optionA,
    optionB,
    resourceMode,
    sourceUrl,
    imageFile,
    videoFile
  } = validationState;



  if (selectedType !== "open" && !optionA) {
    return {
      title: "Champs incomplets",
      message: "Complète tous les champs requis pour créer l’arène.",
      focusElement: document.getElementById("option_a")
    };
  }

  if (selectedType !== "open" && !optionB) {
    return {
      title: "Champs incomplets",
      message: "Complète tous les champs requis pour créer l’arène.",
      focusElement: document.getElementById("option_b")
    };
  }

  if (resourceMode === "source" && !sourceUrl) {
    return {
      title: "Champs incomplets",
      message: "Complète tous les champs requis pour créer l’arène.",
      focusElement: document.getElementById("source_url")
    };
  }



  return null;
}

function focusCreateValidationField(element) {
  if (!element || typeof element.focus !== "function") return;

  const topbar = document.querySelector(".topbar");
  const offset = (topbar ? topbar.offsetHeight : 80) + 20;
  const rect = element.getBoundingClientRect();
  const targetY = rect.top + window.scrollY - offset;

  window.scrollTo({
    top: Math.max(0, targetY),
    behavior: "smooth"
  });

  setTimeout(() => {
    try {
      element.focus({ preventScroll: true });
    } catch (error) {
      element.focus();
    }
  }, 180);
}

const typeInputs = document.querySelectorAll('input[name="debate-type"]');
const resourceInputs = document.querySelectorAll('input[name="resource-mode"]');

  let debatesForSimilarity = [];

  try {
    debatesForSimilarity = await fetchJSON(API + "/debates");
  } catch (error) {
    debatesForSimilarity = [];
  }
function renderSimilarDebates(query) {
  if (!questionInput || !similarBox || !similarList) return;

  const normalizedQuery = normalizeText(query);
  const queryWords = getMeaningfulWords(query);

  if (normalizedQuery.length < 6 || queryWords.length < 2) {
    similarBox.style.display = "none";
    similarList.innerHTML = "";
    return;
  }

const matches = debatesForSimilarity
  .filter((debate) => normalizeText(debate.question || "").length > 0)
  .map((debate) => {
    const normalizedQuestion = normalizeText(debate.question || "");
    const debateWords = getMeaningfulWords(debate.question || "");

    const commonWords = countCommonWords(queryWords, debateWords);
    const commonBigrams = countCommonBigrams(queryWords, debateWords);

    let score = 0;

    if (normalizedQuestion === normalizedQuery) {
      score += 100;
    }

    if (
      normalizedQuestion.length > 0 &&
      normalizedQuery.length > 0 &&
      (
        normalizedQuestion.includes(normalizedQuery) ||
        normalizedQuery.includes(normalizedQuestion)
      )
    ) {
      score += 20;
    }

    score += commonWords * 3;
    score += commonBigrams * 8;

    return {
      debate,
      score,
      commonWords,
      commonBigrams
    };
  })
  .filter((item) => {
    return (
      item.commonWords >= 2 ||
      item.commonBigrams >= 1 ||
      item.score >= 12
    );
  })
  .sort((a, b) => b.score - a.score)
  .slice(0, 5);

  if (!matches.length) {
    similarBox.style.display = "none";
    similarList.innerHTML = "";
    scheduleMobileIndexCardHighlightUpdate();
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

  scheduleMobileIndexCardHighlightUpdate();
}

if (typeInputs.length) {
  typeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      updateCreateTypeUI();
      updateCreateSubmitAvailability();
    });
  });

  updateCreateTypeUI();
}

if (resourceInputs.length) {
  resourceInputs.forEach((input) => {
    input.addEventListener("change", () => {
      updateCreateResourceModeUI();
      updateCreateSubmitAvailability();
    });
  });

  updateCreateResourceModeUI();
}

  [
    questionInput,
    document.getElementById("category"),
    document.getElementById("option_a"),
    document.getElementById("option_b"),
    document.getElementById("source_url"),
    document.getElementById("debate_image_file"),
    getCreateVideoFileInput()
  ].forEach((field) => {
    if (!field) return;
    field.addEventListener("input", updateCreateSubmitAvailability);
    field.addEventListener("change", updateCreateSubmitAvailability);
  });

  toggleCreateContextField(false);
  updateCreateSubmitAvailability();
  if (questionInput) {
    questionInput.addEventListener("input", (e) => {
      renderSimilarDebates(e.target.value);
    });
  }
if (cancelPublishButton) {
  cancelPublishButton.addEventListener("click", cancelCreatePublishSession);
}

form.addEventListener("submit", async e => {
  e.preventDefault();

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.classList.add("create-submit-loading");
    submitButton.innerHTML = '<span class="create-submit-spinner" aria-hidden="true"></span><span>Publication...</span>';
  }

  startCreatePublishSession();
  setCreatePublishProgress(3, "Préparation de la publication", "Vérification des informations…");

  const validationState = getCreateValidationState();
  const validationError = getCreateValidationError();

  if (validationError) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    updateCreateSubmitAvailability(true);
    showReplacementSuccessMessage(
      validationError.title,
      validationError.message,
      null,
      "⚠️"
    );
    focusCreateValidationField(validationError.focusElement);
    return;
  }

  const question = validationState.question;
  const category = validationState.category;
  const resourceMode = validationState.resourceMode;
  const source_url = validationState.sourceUrl;
  const imageFile = validationState.imageFile;
  const videoFile = validationState.videoFile;
  const selectedType = validationState.selectedType;
  const content = getCreateContextText();

  const option_a = selectedType === "open"
    ? ""
    : validationState.optionA;

  const option_b = selectedType === "open"
    ? ""
    : validationState.optionB;

  if (!question) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    showReplacementSuccessMessage(
      "Sujet manquant",
      "Tu dois renseigner le sujet de l’arène avant de la créer.",
      null,
      "⚠️"
    );
    updateCreateSubmitAvailability();
    return;
  }

  if (!category) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    showReplacementSuccessMessage(
      "Thématique manquante",
      "Tu dois choisir une thématique avant de créer l’arène.",
      null,
      "⚠️"
    );
    updateCreateSubmitAvailability();
    return;
  }


  if (content.length > 600) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    showReplacementSuccessMessage(
      "Texte trop long",
      "Le texte de contexte ne peut pas dépasser 600 caractères.",
      null,
      "⚠️"
    );
    return;
  }


  if (resourceMode === "image" && !imageFile) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    showReplacementSuccessMessage(
      "Image manquante",
      "Tu as choisi l’import d’image, mais aucun fichier n’a été sélectionné.",
      null,
      "⚠️"
    );
    return;
  }

  if (imageFile && !/^image\//i.test(imageFile.type || "")) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    showReplacementSuccessMessage(
      "Format non pris en charge",
      "Le fichier sélectionné n’est pas une image valide.",
      null,
      "⚠️"
    );
    return;
  }

  if (resourceMode === "video" && !videoFile) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    showReplacementSuccessMessage(
      "Vidéo manquante",
      "Tu as choisi l’import vidéo, mais aucun fichier n’a été sélectionné.",
      null,
      "⚠️"
    );
    return;
  }

  if (videoFile && !/^video\//i.test(videoFile.type || "")) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    showReplacementSuccessMessage(
      "Format non pris en charge",
      "Le fichier sélectionné n’est pas une vidéo valide.",
      null,
      "⚠️"
    );
    return;
  }

  const confirmed = await showDebatePublishConfirmModal();

  if (!confirmed) {
    hideCreatePublishProgress();
    resetCreateSubmitButton();
    return;
  }
  try {
    let image_upload = null;

    if (imageFile) {
      setCreatePublishProgress(8, "Préparation de l’image", "Lecture du fichier image…");
      const imageDataUrl = await readFileAsDataUrl(imageFile, {
        onProgress: (progress) => {
          setCreatePublishProgress(
            mapProgressRange(progress, 8, 32),
            "Préparation de l’image",
            `Lecture du fichier image… ${Math.round(progress)}%`
          );
        }
      });

      image_upload = {
        name: imageFile.name || "image",
        type: imageFile.type || "",
        dataUrl: imageDataUrl
      };
    }

    const creatorKey = getKey();
    const createPayload = JSON.stringify({
      question,
      category,
      source_url,
      content,
      resource_mode: resourceMode,
      image_upload,
      type: selectedType,
      option_a,
      option_b,
      creatorKey
    });

    setCreatePublishProgress(
      imageFile ? 34 : 12,
      "Création de l’arène",
      imageFile ? "Envoi du débat et de l’image au serveur…" : "Envoi du débat au serveur…"
    );

    const r = await createXhrRequest(API + "/debates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: createPayload,
      responseType: "json",
      onUploadProgress: (progress) => {
        if (progress >= 100) {
          setCreatePublishProgress(
            78,
            "Création de l’arène",
            imageFile
              ? "Téléversement terminé, finalisation côté serveur…"
              : "Envoi terminé, finalisation côté serveur…"
          );
          return;
        }

        const mapped = imageFile
          ? mapProgressRange(progress, 34, 78)
          : mapProgressRange(progress, 12, 78);

        setCreatePublishProgress(
          mapped,
          "Création de l’arène",
          imageFile
            ? `Envoi du débat et de l’image au serveur… ${Math.round(progress)}%`
            : `Envoi du débat au serveur… ${Math.round(progress)}%`
        );
      },
      onUploadComplete: () => {
        setCreatePublishProgress(
          78,
          "Création de l’arène",
          imageFile
            ? "Téléversement terminé, finalisation côté serveur…"
            : "Envoi terminé, finalisation côté serveur…"
        );
      }
    });

    setCreatePublishProgress(80, "Arène créée", resourceMode === "video" ? "Préparation du téléversement vidéo…" : "Traitement serveur en cours…");

    if (resourceMode === "video" && videoFile) {
      let uploadVideoFile = videoFile;

      if (shouldCompressVideoBeforeUpload(videoFile)) {
        setCreatePublishProgress(82, "Optimisation locale de la vidéo", "Allégement de la vidéo avant envoi…");

        try {
          const compressionResult = await compressVideoBeforeUpload(videoFile, {
            signal: getCreatePublishSignal(),
            onProgress: (progress) => {
              setCreatePublishProgress(
                mapProgressRange(progress, 82, 88),
                "Optimisation locale de la vidéo",
                `Compression locale avant envoi… ${Math.round(progress)}%`
              );
            }
          });

          if (compressionResult?.compressed && compressionResult.file instanceof File) {
            uploadVideoFile = compressionResult.file;
            const savedMo = Math.max(0, ((Number(videoFile.size || 0) - Number(uploadVideoFile.size || 0)) / (1024 * 1024)));
            setCreatePublishProgress(
              88,
              "Vidéo allégée",
              `Vidéo allégée avant envoi${savedMo > 0.1 ? ` : ${savedMo.toFixed(1)} Mo économisés.` : "."}`
            );
          } else {
            setCreatePublishProgress(86, "Préparation de la vidéo", "Compression locale non retenue. Envoi du fichier original…");
          }
        } catch (compressionError) {
          if (createPublishCancelRequested || getCreatePublishSignal()?.aborted || /annul/i.test(String(compressionError?.message || ""))) {
            throw compressionError;
          }

          console.warn("[video-upload] compression locale ignorée, reprise avec le fichier original.", compressionError);
          uploadVideoFile = videoFile;
          setCreatePublishProgress(86, "Préparation de la vidéo", "Compression locale impossible sur cet appareil. Envoi du fichier original…");
        }
      } else {
        setCreatePublishProgress(86, "Préparation de la vidéo", "Préparation de l’envoi direct de la vidéo…");
      }

      try {
        const uploadSetup = await fetchJSON(
          `${API}/debates/${encodeURIComponent(r.id)}/video-upload-url?authorKey=${encodeURIComponent(creatorKey)}`,
          {
            signal: getCreatePublishSignal(),
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              fileName: uploadVideoFile.name || "video",
              contentType: uploadVideoFile.type || videoFile.type || "application/octet-stream",
              size: Number(uploadVideoFile.size || 0)
            })
          }
        );

        setCreatePendingVideoUploadState({
          debateId: r.id,
          authorKey: creatorKey,
          objectPath: uploadSetup.objectPath,
          mimeType: uploadSetup.mimeType || uploadVideoFile.type || videoFile.type || "application/octet-stream",
          fileName: uploadVideoFile.name || videoFile.name || "video",
          status: "uploading",
          startedAt: Date.now()
        });

        let directUploadStarted = false;
        let directUploadFinished = false;
        let directUploadFinalizeStarted = false;
        let directUploadStartTimer = null;

        await createXhrRequest(uploadSetup.signedUrl, {
          signal: getCreatePublishSignal(),
          method: "PUT",
          headers: {
            "content-type": uploadSetup.mimeType || uploadVideoFile.type || videoFile.type || "application/octet-stream"
          },
          body: uploadVideoFile,
          responseType: "text",
          onXhrCreated: (xhr) => {
            const markDirectUploadStarted = () => {
              directUploadStarted = true;
              if (directUploadStartTimer) {
                clearTimeout(directUploadStartTimer);
                directUploadStartTimer = null;
              }
            };

            xhr.addEventListener("loadstart", markDirectUploadStarted, { once: true });
            if (xhr.upload) {
              xhr.upload.addEventListener("loadstart", markDirectUploadStarted, { once: true });
              xhr.upload.addEventListener("progress", (event) => {
                if (event.loaded > 0) {
                  markDirectUploadStarted();
                }
              }, { once: true });
            }

            directUploadStartTimer = setTimeout(() => {
              if (directUploadStarted || getCreatePublishSignal()?.aborted) {
                return;
              }

              console.warn(`[video-upload] débat=${r.id} aucun démarrage détecté après 15000ms, on reste sur le flux direct.`);
              setCreatePublishProgress(
                82,
                "Préparation de la vidéo",
                "Connexion au stockage plus lente que prévu… le téléversement direct continue."
              );

              if (directUploadStartTimer) {
                clearTimeout(directUploadStartTimer);
                directUploadStartTimer = null;
              }
            }, 15000);
          },
          onUploadProgress: (progress) => {
            directUploadStarted = true;
            if (directUploadStartTimer) {
              clearTimeout(directUploadStartTimer);
              directUploadStartTimer = null;
            }

            if (progress >= 100) {
              setCreatePendingVideoUploadState({
                debateId: r.id,
                authorKey: creatorKey,
                objectPath: uploadSetup.objectPath,
                mimeType: uploadSetup.mimeType || uploadVideoFile.type || videoFile.type || "application/octet-stream",
                fileName: uploadVideoFile.name || videoFile.name || "video",
                status: "uploaded",
                startedAt: Date.now()
              });
              setCreatePublishProgress(
                99,
                "Upload terminé",
                "Téléversement terminé. Finalisation de la vidéo…"
              );
              return;
            }

            setCreatePublishProgress(
              mapProgressRange(progress, 82, 99),
              "Envoi direct de la vidéo",
              `Téléversement direct vers le stockage… ${Math.round(progress)}%`
            );
          },
          onUploadComplete: () => {
            directUploadFinished = true;
            if (directUploadStartTimer) {
              clearTimeout(directUploadStartTimer);
              directUploadStartTimer = null;
            }

            setCreatePendingVideoUploadState({
              debateId: r.id,
              authorKey: creatorKey,
              objectPath: uploadSetup.objectPath,
              mimeType: uploadSetup.mimeType || uploadVideoFile.type || videoFile.type || "application/octet-stream",
              fileName: uploadVideoFile.name || videoFile.name || "video",
              status: "uploaded",
              startedAt: Date.now()
            });

            setCreatePublishProgress(
              99,
              "Upload terminé",
              "Téléversement terminé. Finalisation de la vidéo…"
            );
          }
        });

        directUploadFinalizeStarted = true;
        setCreatePendingVideoUploadState({
          debateId: r.id,
          authorKey: creatorKey,
          objectPath: uploadSetup.objectPath,
          mimeType: uploadSetup.mimeType || uploadVideoFile.type || videoFile.type || "application/octet-stream",
          fileName: uploadVideoFile.name || videoFile.name || "video",
          status: "finalizing",
          startedAt: Date.now()
        });
        await fetchJSON(
          `${API}/debates/${encodeURIComponent(r.id)}/video-upload-complete?authorKey=${encodeURIComponent(creatorKey)}`,
          {
            signal: getCreatePublishSignal(),
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              objectPath: uploadSetup.objectPath,
              mimeType: uploadSetup.mimeType || uploadVideoFile.type || videoFile.type || "application/octet-stream"
            })
          }
        );
        clearCreatePendingVideoUploadState();
      } catch (directUploadError) {
        const message = String(directUploadError?.message || "").toLowerCase();
        const isDirectStartupTimeoutNotice = message.includes("timeout") || message.includes("démarrage") || message.includes("demarrage");
        const uploadWasCommittedToDirectFlow = directUploadStarted || directUploadFinished || directUploadFinalizeStarted;
        const canFallback =
          (!message.includes("annul") || message.includes("interrompu")) &&
          !getCreatePublishSignal()?.aborted &&
          !isDirectStartupTimeoutNotice &&
          !uploadWasCommittedToDirectFlow;

        if (!canFallback) {
          if (uploadWasCommittedToDirectFlow && !getCreatePublishSignal()?.aborted) {
            console.error("[video-upload] échec après démarrage du flux direct, secours bloqué pour éviter un double envoi.", directUploadError);
            throw new Error("La vidéo a déjà été envoyée au stockage ou sa finalisation a commencé. Le mode secours a été bloqué pour éviter un double téléversement. Recharge la page du débat pour vérifier si la vidéo est déjà présente, puis réessaie seulement si nécessaire.");
          }
          throw directUploadError;
        }

        setCreatePublishProgress(84, "Envoi de la vidéo", "Reprise avec le mode de secours…");

        clearCreatePendingVideoUploadState();

        await createXhrRequest(`${API}/debates/${encodeURIComponent(r.id)}/video-file?authorKey=${encodeURIComponent(creatorKey)}`, {
          signal: getCreatePublishSignal(),
          method: "POST",
          headers: {
            "Content-Type": uploadVideoFile.type || videoFile.type || "application/octet-stream",
            "x-file-name": uploadVideoFile.name || videoFile.name || "video",
            "x-file-type": uploadVideoFile.type || videoFile.type || "application/octet-stream"
          },
          body: uploadVideoFile,
          responseType: "json",
          onUploadProgress: (progress) => {
            if (progress >= 100) {
              setCreatePublishProgress(
                99,
                "Upload terminé",
                "Téléversement terminé. Traitement serveur en cours…"
              );
              return;
            }

            setCreatePublishProgress(
              mapProgressRange(progress, 84, 99),
              "Envoi de la vidéo",
              `Téléversement de secours de la vidéo… ${Math.round(progress)}%`
            );
          },
          onUploadComplete: () => {
            setCreatePublishProgress(
              99,
              "Upload terminé",
              "Téléversement terminé. Traitement serveur en cours…"
            );
          }
        });
      }
    }

    clearCreatePendingVideoUploadState();
    setCreatePublishProgress(100, "Publication terminée", "Redirection vers l’arène…");
    location = "/debate?id=" + r.id;
  } catch (error) {
    if (createPublishCancelRequested || getCreatePublishSignal()?.aborted || /annul/i.test(String(error?.message || ""))) {
      hideCreatePublishProgress();
      showReplacementSuccessMessage(
        "Publication annulée",
        "La création de l’arène a bien été interrompue.",
        null,
        "⚪"
      );
    } else {
      hideCreatePublishProgress();
      alert(error.message);
    }
  } finally {
    createPublishAbortController = null;
    createPublishCancelRequested = false;

    if (!window.location.href.includes("/debate?id=")) {
      resetCreateSubmitButton();
      setCreatePublishCancelState(false);
    }
  }
});


}
let currentCreatePublishProgressValue = 0;
function getCreatePublishProgressElements() {
  return {
    box: document.getElementById("create-upload-progress"),
    label: document.getElementById("create-upload-progress-label"),
    detail: document.getElementById("create-upload-progress-detail"),
    fill: document.getElementById("create-upload-progress-fill"),
    percent: document.getElementById("create-upload-progress-percent")
  };
}

function setCreatePublishCancelState(isCancelling = false) {
  const cancelButton = document.getElementById("create-publish-cancel");
  if (!cancelButton) return;
  cancelButton.disabled = !!isCancelling;
  cancelButton.textContent = isCancelling ? "Annulation..." : "Annuler";
}

function hideCreatePublishProgress() {
  const overlay = document.getElementById("create-publish-overlay");
  const overlayTitle = document.getElementById("create-publish-overlay-title");
  const overlayDetail = document.getElementById("create-publish-overlay-detail");
  const { box, fill, percent, label, detail } = getCreatePublishProgressElements();
  currentCreatePublishProgressValue = 0;

  if (overlay) overlay.style.display = "none";
  document.body.classList.remove("create-publish-overlay-open");
  if (box) box.style.display = "none";
  if (fill) fill.style.width = "0%";
  if (percent) percent.textContent = "0%";
  if (label) label.textContent = "Publication en cours";
  if (detail) detail.textContent = "";
  if (overlayTitle) overlayTitle.textContent = "Publication en cours";
  if (overlayDetail) overlayDetail.textContent = "Préparation…";
}

function showCreatePublishProgress() {
  const overlay = document.getElementById("create-publish-overlay");
  const { box } = getCreatePublishProgressElements();
  if (overlay) overlay.style.display = "flex";
  document.body.classList.add("create-publish-overlay-open");
  if (box) box.style.display = "block";
}

function setCreatePublishProgress(value, label = "Publication en cours", detail = "") {
  const overlayTitle = document.getElementById("create-publish-overlay-title");
  const overlayDetail = document.getElementById("create-publish-overlay-detail");
  const { box, fill, percent, label: labelEl, detail: detailEl } = getCreatePublishProgressElements();
  const safeValue = Math.max(0, Math.min(100, Number(value || 0)));
  currentCreatePublishProgressValue = safeValue;

  if (box) box.style.display = "block";
  if (fill) fill.style.width = `${safeValue}%`;
  if (percent) percent.textContent = `${Math.round(safeValue)}%`;
  if (labelEl) labelEl.textContent = label;
  if (detailEl) detailEl.textContent = detail;
  if (overlayTitle) overlayTitle.textContent = label;
  if (overlayDetail) overlayDetail.textContent = detail || "Préparation…";
}

function mapProgressRange(progress, min, max) {
  const safeProgress = Math.max(0, Math.min(100, Number(progress || 0)));
  return min + ((max - min) * safeProgress) / 100;
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
      const debateTypeLabel = isOpenDebate(debate) ? "Arène libre" : "Arène à position";

      return `
        <article class="debate-card">
          <a class="debate-card-link" href="/debate?id=${debate.id}">
            <div class="debate-card-category">${escapeHtml(debate.category || "Sans catégorie")}</div>
            <div class="debate-card-type">${debateTypeLabel}</div>
            <h2>${escapeHtml(debate.question)}</h2>

            ${buildIndexContextPreviewHtml(debate)}

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

  if (currentDebateCache && Array.isArray(similarDebatesCache)) {
    renderBottomSimilarDebates(currentDebateCache, similarDebatesCache);
    return;
  }

  const debateId = getDebateId();
  if (!debateId) return;

  loadDebate(debateId);
}
/* =========================
   Debate
========================= */

function styleDebateDeleteButtonAsTopRightCross() {
  const deleteDebateBtn = document.getElementById("delete-debate-btn");
  if (!deleteDebateBtn) return;

  const debateQuestion = document.getElementById("debate-question");

  const mobileTitleBlock =
    debateQuestion?.closest(".debate-head-card") ||
    debateQuestion?.parentElement ||
    deleteDebateBtn.closest(".debate-head-card") ||
    deleteDebateBtn.closest(".debate-card") ||
    deleteDebateBtn.closest(".debate-header") ||
    deleteDebateBtn.parentElement;

  if (mobileTitleBlock && getComputedStyle(mobileTitleBlock).position === "static") {
    mobileTitleBlock.style.position = "relative";
  }

  deleteDebateBtn.textContent = "×";
  deleteDebateBtn.title = "Supprimer ce débat";
  deleteDebateBtn.setAttribute("aria-label", "Supprimer ce débat");
  deleteDebateBtn.style.position = "absolute";
  deleteDebateBtn.style.left = "auto";
  deleteDebateBtn.style.bottom = "auto";
  deleteDebateBtn.style.width = "32px";
  deleteDebateBtn.style.height = "32px";
  deleteDebateBtn.style.minWidth = "32px";
  deleteDebateBtn.style.padding = "0";
  deleteDebateBtn.style.display = "flex";
  deleteDebateBtn.style.alignItems = "center";
  deleteDebateBtn.style.justifyContent = "center";
  deleteDebateBtn.style.borderRadius = "999px";
  deleteDebateBtn.style.fontSize = "24px";
  deleteDebateBtn.style.lineHeight = "1";
  deleteDebateBtn.style.fontWeight = "700";
  deleteDebateBtn.style.zIndex = "20";

  if (window.innerWidth <= 768) {
    deleteDebateBtn.style.top = "8px";
    deleteDebateBtn.style.right = "8px";
  } else {
    deleteDebateBtn.style.top = "12px";
    deleteDebateBtn.style.right = "12px";
  }
}

function updateDeleteDebateButtonVisibility(debate) {
  const deleteDebateBtn = document.getElementById("delete-debate-btn");
  if (!deleteDebateBtn) return;

  if (canDeleteDebate(debate)) {
    deleteDebateBtn.removeAttribute("data-admin");
    styleDebateDeleteButtonAsTopRightCross();
    deleteDebateBtn.style.display = "flex";
    return;
  }

  deleteDebateBtn.style.display = "none";
}

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

function getInstagramEmbedPermalink(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "instagram.com") return "";

    const match = parsed.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)(?:\/|$)/i);
    if (!match) return "";

    const kind = String(match[1] || "").toLowerCase() === "reels" ? "reel" : String(match[1] || "").toLowerCase();
    const shortcode = String(match[2] || "").trim();
    if (!shortcode) return "";

    return `https://www.instagram.com/${kind}/${shortcode}/`;
  } catch (error) {
    return "";
  }
}

function isInstagramPostUrl(url) {
  return !!getInstagramEmbedPermalink(url);
}

const debateSourcePreviewState = {
  retryTimers: [],
  currentToken: 0,
  handlersBound: false
};


let xWidgetsLoaderPromise = null;
let instagramEmbedLoaderPromise = null;
let debateInstagramVisibilityObserver = null;
let debateInstagramCurrentUrl = "";
let debateInstagramCurrentPreviewData = null;
let debateInstagramIsRendered = false;

function isXStatusUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "x.com" && host !== "twitter.com") return false;
    return /\/[^/]+\/status\/\d+/.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}

function getXStatusId(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    const match = parsed.pathname.match(/\/status\/(\d+)/);
    return match ? match[1] : "";
  } catch (error) {
    return "";
  }
}

function loadXWidgetsScript() {
  if (window.twttr?.widgets?.createTweet) {
    return Promise.resolve(window.twttr);
  }

  if (xWidgetsLoaderPromise) return xWidgetsLoaderPromise;

  xWidgetsLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-x-widgets="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.twttr), { once: true });
      existing.addEventListener("error", () => reject(new Error("Impossible de charger le script X.")), { once: true });
      return;
    }

    const scriptEl = document.createElement("script");
    scriptEl.src = "https://platform.twitter.com/widgets.js";
    scriptEl.async = true;
    scriptEl.charset = "utf-8";
    scriptEl.setAttribute("data-x-widgets", "true");
    scriptEl.onload = () => resolve(window.twttr);
    scriptEl.onerror = () => reject(new Error("Impossible de charger le script X."));
    document.head.appendChild(scriptEl);
  });

  return xWidgetsLoaderPromise;
}

function loadInstagramEmbedScript() {
  if (window.instgrm?.Embeds?.process) {
    return Promise.resolve(window.instgrm);
  }

  if (instagramEmbedLoaderPromise) return instagramEmbedLoaderPromise;

  instagramEmbedLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-instagram-embed="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.instgrm), { once: true });
      existing.addEventListener("error", () => reject(new Error("Impossible de charger le script Instagram.")), { once: true });
      return;
    }

    const scriptEl = document.createElement("script");
    scriptEl.src = "https://www.instagram.com/embed.js";
    scriptEl.async = true;
    scriptEl.setAttribute("data-instagram-embed", "true");
    scriptEl.onload = () => resolve(window.instgrm);
    scriptEl.onerror = () => reject(new Error("Impossible de charger le script Instagram."));
    document.head.appendChild(scriptEl);
  });

  return instagramEmbedLoaderPromise;
}

function destroyDebateInstagramEmbed() {
  const sourcePreviewWrap = document.getElementById("debate-source-preview-wrap");
  const sourceFallback = document.getElementById("debate-source-fallback");
  const sourceLoading = document.getElementById("debate-source-preview-loading");

  if (debateInstagramVisibilityObserver) {
    debateInstagramVisibilityObserver.disconnect();
    debateInstagramVisibilityObserver = null;
  }

  if (sourcePreviewWrap) {
    sourcePreviewWrap.style.display = "none";
  }

  if (sourceFallback) {
    sourceFallback.innerHTML = "";
    sourceFallback.style.display = "none";
  }

  if (sourceLoading) {
    sourceLoading.style.display = "none";
  }

  debateInstagramIsRendered = false;
}

function initDebateInstagramVisibilityObserver(sourceUrl, sourcePreviewData = null) {
  const target =
    document.getElementById("debate-source-instagram-shell") ||
    document.getElementById("debate-source-fallback");

  if (!target) return;

  debateInstagramCurrentUrl = sourceUrl;
  debateInstagramCurrentPreviewData = sourcePreviewData;

  if (debateInstagramVisibilityObserver) {
    debateInstagramVisibilityObserver.disconnect();
  }

  debateInstagramVisibilityObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;

    const isStillVisible = entry.isIntersecting && entry.intersectionRatio > 0.05;

    if (!isStillVisible) {
      destroyDebateInstagramEmbed();
      return;
    }

    if (!debateInstagramIsRendered && debateInstagramCurrentUrl) {
      renderInstagramSourcePreview(
        debateInstagramCurrentUrl,
        debateInstagramCurrentPreviewData
      );
    }
  }, {
    threshold: [0, 0.01, 0.05, 0.2]
  });

  debateInstagramVisibilityObserver.observe(target);
}

async function renderInstagramSourcePreview(sourceUrl, sourcePreviewData = null) {
  if (debateInstagramIsRendered) {
    return;
  }

  const sourcePreviewWrap = document.getElementById("debate-source-preview-wrap");
  const sourcePreview = document.getElementById("debate-source-preview");
  const sourcePoster = document.getElementById("debate-source-preview-poster");
  const sourceLoading = document.getElementById("debate-source-preview-loading");
  const sourceFallback = document.getElementById("debate-source-fallback");

  if (!sourceFallback) {
    showDebateSourceFallback(sourceUrl, sourcePreviewData);
    return;
  }

  const embedPermalink = getInstagramEmbedPermalink(sourceUrl);
  if (!embedPermalink) {
    showDebateSourceFallback(sourceUrl, sourcePreviewData);
    return;
  }

  if (sourcePreviewWrap) {
    sourcePreviewWrap.style.display = "flex";
  }

  if (sourcePreview) {
    sourcePreview.style.display = "none";
    sourcePreview.style.visibility = "hidden";
    sourcePreview.removeAttribute("src");
    sourcePreview.src = "about:blank";
  }

  if (sourcePoster) {
    sourcePoster.style.display = "none";
    sourcePoster.removeAttribute("href");
  }

  if (sourceLoading) {
    sourceLoading.textContent = "Chargement du post Instagram…";
    sourceLoading.style.display = "block";
  }

  sourceFallback.classList.add("debate-source-fallback-instagram");
  sourceFallback.innerHTML = `
    <div
      id="debate-source-instagram-shell"
      style="width:100%; cursor:pointer;"
      role="link"
      tabindex="0"
      aria-label="Ouvrir le post Instagram"
    >
      <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; width:100%;">
        <span style="display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:800; letter-spacing:0.01em; color:#111827;">Instagram</span>
        <a class="debate-source-link" href="${escapeAttribute(embedPermalink)}" target="_blank" rel="noopener noreferrer">Voir le post sur Instagram</a>
      </div>
      <div id="debate-source-instagram-embed" style="width:100%; display:flex; justify-content:center;"></div>
    </div>
  `;
  sourceFallback.style.display = "flex";
  debateInstagramIsRendered = true;

  const instagramShell = document.getElementById("debate-source-instagram-shell");

  if (instagramShell) {
    const openInstagramPost = () => {
      window.open(embedPermalink, "_blank", "noopener,noreferrer");
    };

    instagramShell.addEventListener("click", (event) => {
      const interactiveTarget = event.target.closest("a, button, iframe");
      if (interactiveTarget) return;
      openInstagramPost();
    });

    instagramShell.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const interactiveTarget = event.target.closest("a, button, iframe");
      if (interactiveTarget) return;
      event.preventDefault();
      openInstagramPost();
    });
  }

  try {
    await loadInstagramEmbedScript();

    if (!window.instgrm?.Embeds?.process) {
      throw new Error("API embed Instagram indisponible.");
    }

    const embedContainer = document.getElementById("debate-source-instagram-embed");
    if (!embedContainer) {
      throw new Error("Conteneur Instagram introuvable.");
    }

    embedContainer.innerHTML = `
      <blockquote
        class="instagram-media"
        data-instgrm-captioned
        data-instgrm-permalink="${escapeAttribute(embedPermalink)}?utm_source=ig_embed&amp;utm_campaign=loading"
        data-instgrm-version="14"
        style="background:#fff; border:0; border-radius:18px; box-shadow:0 10px 28px rgba(15,23,42,0.08); margin:0; max-width:540px; min-width:280px; padding:0; width:100%;"
      >
        <a href="${escapeAttribute(embedPermalink)}" target="_blank" rel="noopener noreferrer">Voir ce post sur Instagram</a>
      </blockquote>
    `;

    window.instgrm.Embeds.process();

    if (sourceLoading) {
      setTimeout(() => {
        if (sourceLoading) {
          sourceLoading.style.display = "none";
        }
      }, 700);
    }
  } catch (error) {
    sourceFallback.classList.remove("debate-source-fallback-instagram");
    if (sourceLoading) {
      sourceLoading.style.display = "none";
    }
    showDebateSourceFallback(sourceUrl, sourcePreviewData);
    debateInstagramIsRendered = false;
  }

}

async function renderXSourcePreview(sourceUrl, sourcePreviewData = null) {
  const sourcePreviewWrap = document.getElementById("debate-source-preview-wrap");
  const sourcePreview = document.getElementById("debate-source-preview");
  const sourcePoster = document.getElementById("debate-source-preview-poster");
  const sourceLoading = document.getElementById("debate-source-preview-loading");
  const sourceFallback = document.getElementById("debate-source-fallback");

  if (!sourceFallback) {
    showDebateSourceFallback(sourceUrl, sourcePreviewData);
    return;
  }

  const tweetId = getXStatusId(sourceUrl);
  if (!tweetId) {
    showDebateSourceFallback(sourceUrl, sourcePreviewData);
    return;
  }


  if (sourcePreviewWrap) {
    sourcePreviewWrap.style.display = "flex";
  }

  if (sourcePreview) {
    sourcePreview.style.display = "none";
    sourcePreview.style.visibility = "hidden";
    sourcePreview.removeAttribute("src");
    sourcePreview.src = "about:blank";
  }

  if (sourcePoster) {
    sourcePoster.style.display = "none";
    sourcePoster.removeAttribute("href");
  }

  if (sourceLoading) {
    sourceLoading.textContent = "Chargement du post X…";
    sourceLoading.style.display = "block";
  }

  sourceFallback.classList.add("debate-source-fallback-x");
  sourceFallback.innerHTML = `
    <div class="debate-source-x-header">
      <span class="debate-source-x-badge">𝕏 Source</span>
    </div>
    <div class="debate-source-x-embed" id="debate-source-x-embed"></div>
    <a class="debate-source-link" href="${escapeAttribute(sourceUrl)}" target="_blank" rel="noopener noreferrer">Voir le post sur X</a>
  `;
sourceFallback.style.display = "flex";
  try {
    await loadXWidgetsScript();

    if (!window.twttr?.widgets?.createTweet) {
      throw new Error("API widgets X indisponible.");
    }

    const embedContainer = document.getElementById("debate-source-x-embed");
    if (!embedContainer) {
      throw new Error("Conteneur X introuvable.");
    }

    embedContainer.innerHTML = "";
    const created = await window.twttr.widgets.createTweet(tweetId, embedContainer, {
      align: "center",
      theme: "light",
      dnt: true,
      conversation: "all"
    });

    if (!created) {
      throw new Error("Embed X non généré.");
    }

    if (sourceLoading) {
      sourceLoading.style.display = "none";
    }
  } catch (error) {
    sourceFallback.classList.remove("debate-source-fallback-x");
      if (sourceLoading) {
      sourceLoading.style.display = "none";
    }
    showDebateSourceFallback(sourceUrl, sourcePreviewData);
  }
}


function clearDebateSourcePreviewTimers() {
  debateSourcePreviewState.retryTimers.forEach(timer => clearTimeout(timer));
  debateSourcePreviewState.retryTimers = [];
}

function resetDebateSourcePreview() {
  clearDebateSourcePreviewTimers();

  if (debateInstagramVisibilityObserver) {
    debateInstagramVisibilityObserver.disconnect();
    debateInstagramVisibilityObserver = null;
  }

  debateInstagramIsRendered = false;
  debateInstagramCurrentUrl = "";
  debateInstagramCurrentPreviewData = null;

  const sourcePreviewWrap = document.getElementById("debate-source-preview-wrap");
  const sourcePreview = document.getElementById("debate-source-preview");
  const sourceFallback = document.getElementById("debate-source-fallback");
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
    sourceFallback.classList.remove("debate-source-fallback-x", "debate-source-fallback-instagram");
    sourceFallback.innerHTML = "";
    sourceFallback.style.display = "none";
  }

}

function showDebateSourceFallback(sourceUrl, preview = null) {
  const sourcePreviewWrap = document.getElementById("debate-source-preview-wrap");
  const sourceFallback = document.getElementById("debate-source-fallback");
  const sourceLoading = document.getElementById("debate-source-preview-loading");

  if (sourcePreviewWrap) {
    sourcePreviewWrap.style.display = "flex";
  }

  if (sourceLoading) {
    sourceLoading.style.display = "none";
  }

  if (!sourceFallback) return;

  const fallbackPreview = normalizeSourcePreviewData(preview, sourceUrl);

  sourceFallback.innerHTML = buildSourcePreviewCardHtml(fallbackPreview, sourceUrl);
  sourceFallback.style.display = "block";

}

async function hydrateDebateSourcePreviewIfNeeded(sourceUrl, preview = null) {
  const safeUrl = String(sourceUrl || "").trim();
  if (!safeUrl) return;
  if (!isWeakSourcePreviewData(preview, safeUrl)) return;

  try {
    const response = await fetchJSON(API + "/link-preview", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ url: safeUrl })
    });

    if (!response?.preview || isWeakSourcePreviewData(response.preview, safeUrl)) {
      return;
    }

    renderDebateSourcePreview(safeUrl, response.preview);
  } catch (error) {
    console.error(error);
  }
}

function bindDebateSourcePreviewHandlers() {
  if (debateSourcePreviewState.handlersBound) return;

  const sourcePreview = document.getElementById("debate-source-preview");
  const sourcePoster = document.getElementById("debate-source-preview-poster");
  const sourceLoading = document.getElementById("debate-source-preview-loading");

  if (!sourcePreview) return;

  sourcePreview.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
  sourcePreview.setAttribute("allowfullscreen", "");
  sourcePreview.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");

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

function renderDebateSourcePreview(sourceUrl, sourcePreviewData = null) {
  resetDebateSourcePreview();

  if (!sourceUrl) return;

  if (isXStatusUrl(sourceUrl)) {
    renderXSourcePreview(sourceUrl, sourcePreviewData);
    return;
  }

  if (isInstagramPostUrl(sourceUrl)) {
    renderInstagramSourcePreview(sourceUrl, sourcePreviewData);
    return;
  }

  const sourcePreviewWrap = document.getElementById("debate-source-preview-wrap");
  const sourcePoster = document.getElementById("debate-source-preview-poster");
  const sourcePosterImg = document.getElementById("debate-source-preview-poster-img");
  const sourceLoading = document.getElementById("debate-source-preview-loading");

  const { embedUrl, forceShowPreview, videoId, posterUrl } = getEmbeddableSourceData(sourceUrl);

  if (!embedUrl || !forceShowPreview || !videoId) {
    showDebateSourceFallback(sourceUrl, sourcePreviewData);
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
  renderDebateContext(data.debate.content || "");
const debateVideoUrl = String(data.debate.video_url || "").trim();
const debateImageUrl = String(data.debate.image_url || "").trim();
const sourceUrl = String(data.debate.source_url || "").trim();
const initialSourcePreview = data.sourcePreview || null;

if (debateVideoUrl) {
  renderDebateVideo(debateVideoUrl);
  renderDebateImage("");
  resetDebateSourcePreview();
} else {
  renderDebateVideo("");
  renderDebateImage(debateImageUrl);
  renderDebateSourcePreview(sourceUrl, initialSourcePreview);
  hydrateDebateSourcePreviewIfNeeded(sourceUrl, initialSourcePreview);
}
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
updateDeleteDebateButtonVisibility(data.debate);

currentAllArguments = [...(data.optionA || []), ...(data.optionB || [])];
currentCommentsByArgument = data.commentsByArgument || {};

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

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    syncVoiceGuidanceState(id);
  });
});

if (pendingTopCommentScroll) {
  const targetId = pendingTopCommentScroll;

  waitForNotificationTargetElement(
    () => document.getElementById(targetId),
    (element) => {
      const topbar = document.querySelector(".topbar");
      const offset = (topbar ? topbar.offsetHeight : 80) + 20;
      const y = element.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({
        top: Math.max(0, y),
        behavior: "smooth"
      });
      finalizeNotificationTransitionAtScrollStart();
      pendingTopCommentScroll = null;
    },
    () => {
      scrollToTopVisibleComment();
      finalizeNotificationTransitionAtScrollStart();
      pendingTopCommentScroll = null;
    }
  );
}
else if (pendingCommentScrollId) {
  const targetId = pendingCommentScrollId;

  waitForNotificationTargetElement(
    () => getVisibleCommentElement(targetId),
    (element) => {
      const topbar = document.querySelector(".topbar");
      const offset = (topbar ? topbar.offsetHeight : 80) + 140;
      const y = element.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({
        top: Math.max(0, y),
        behavior: "smooth"
      });
      finalizeNotificationTransitionAtScrollStart();

      applyVoiceHighlight(element);

      setTimeout(() => {
        removeVoiceHighlight(element);
      }, 2000);

      pendingCommentScrollId = null;
    },
    () => {
      pendingCommentScrollId = null;
      finalizeNotificationTransitionAtScrollStart();
    }
  );
}
else if (pendingArgumentScrollId) {
  const targetId = pendingArgumentScrollId;

  waitForNotificationTargetElement(
    () => getVisibleArgumentElement(targetId),
    (element) => {
      const stickyHeader = document.querySelector(".debate-hero-top");
      const offset = (stickyHeader ? stickyHeader.offsetHeight : 120) + 12;
      const y = element.getBoundingClientRect().top + window.scrollY - offset;

      window.scrollTo({
        top: Math.max(0, y),
        behavior: "smooth"
      });
      finalizeNotificationTransitionAtScrollStart();

      if (element.classList.contains("argument-card-a") || element.closest("#arguments-a")) {
        element.classList.add("flash-green");

        setTimeout(() => {
          element.classList.remove("flash-green");
        }, 2000);
      } else {
        element.classList.add("admin-highlight");

        setTimeout(() => {
          element.classList.remove("admin-highlight");
        }, 2000);
      }

      pendingArgumentScrollId = null;
      pinnedNewArgumentId = null;
    },
    () => {
      pendingArgumentScrollId = null;
      pinnedNewArgumentId = null;
      finalizeNotificationTransitionAtScrollStart();
    }
  );
}
else {
  finalizeNotificationTransitionAfterFocus();
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
currentDebateCache = data.debate;
if (!Array.isArray(similarDebatesCache)) {
  similarDebatesCache = await fetchJSON(API + "/debates");
}
renderBottomSimilarDebates(currentDebateCache, similarDebatesCache);

refreshAdminUI();

const params = new URLSearchParams(window.location.search);
const highlight = params.get("highlight");

if (highlight) {
if (highlight.startsWith("argument-") || highlight.startsWith("comment-")) {
  argumentsVisible = currentAllArguments.length;
}
if (highlight.startsWith("argument-") || highlight.startsWith("comment-")) {
  if (highlight.startsWith("comment-")) {
    const commentId = highlight.replace("comment-", "");

    for (const argumentId in (data.commentsByArgument || {})) {
      const comments = data.commentsByArgument[argumentId] || [];

      if (comments.some((comment) => String(comment.id) === String(commentId))) {
        openCommentsByArgument[argumentId] = true;
      }
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
  const stickyHeader = document.querySelector(".debate-hero-top");
  const offset = (stickyHeader ? stickyHeader.offsetHeight : 120) + 12;
  const y = element.getBoundingClientRect().top + window.scrollY - offset;

  window.scrollTo({
    top: Math.max(0, y),
    behavior: "smooth"
  });

  const isGreenTarget =
    element.classList.contains("argument-card-a") ||
    !!element.closest(".argument-card-a") ||
    !!element.closest("#arguments-a") ||
    !!element.closest(".column-a");

  if (isGreenTarget) {
    if (highlight.startsWith("argument-")) {
      element.classList.add("flash-green");

      setTimeout(() => {
        element.classList.remove("flash-green");
      }, 5000);
    } else {
      element.classList.add("admin-highlight-green");

      setTimeout(() => {
        element.classList.remove("admin-highlight-green");
      }, 5000);
    }
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
        data-voice-arg-id="${item.id}"
        data-voice-action="minus"
onclick="unvote('${debateId}', '${item.id}', false, this)"
        aria-label="Retirer une voix"
        title="Retirer une voix"
      >
        −
      </button>

      <span class="my-argument-chip-count">${item.count}</span>

      <button
        type="button"
        class="my-argument-chip-stepper-btn my-argument-chip-stepper-btn-plus"
        data-voice-arg-id="${item.id}"
        data-voice-action="plus"
onclick="vote('${debateId}', '${item.id}', false, this)"
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
<article id="argument-${a.id}"
         class="argument-card ${voted ? "argument-card-voted" : ""}"
  ondblclick="handleArgumentDoubleClick(event, '${a.side === "A" ? "a" : "b"}', '${a.id}')">
  ${(isOwner || isAdmin()) ? `
    <button
      class="argument-owner-delete"
      type="button"
      onclick="event.stopPropagation(); deleteArgument('${debateId}','${a.id}')"
      title="Supprimer cette idée"
    >
      ✕
    </button>
  ` : ""}
  <div class="argument-top">
    <span class="vote-badge">
      ${medal}${rankLabel ? " " + rankLabel : ""}
      ${(medal || rankLabel) ? '<span class="vote-separator">•</span>' : ""}
      <span class="vote-count">${a.votes} voix</span>
    </span>
  </div>

  <h3 class="argument-title">${escapeHtml(a.title || "")}</h3>

  ${a.body ? `<p class="argument-body">${linkifyText(a.body)}</p>` : ""}



<div class="argument-actions argument-actions-vertical">
  <div class="argument-share-top">
    ${renderIdeaShareButtons(debateId, a)}
  </div>

  <div class="voice-stepper" aria-label="Répartition des voix sur cette idée">
    <button
      class="voice-stepper-btn voice-stepper-btn-minus"
      type="button"
      data-voice-arg-id="${a.id}"
      data-voice-action="minus"
      onclick="unvote('${debateId}','${a.id}', true, this)"
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
      data-voice-arg-id="${a.id}"
      data-voice-action="plus"
      onclick="vote('${debateId}','${a.id}', true, this)"
      aria-label="Ajouter une voix"
      title="Ajouter une voix"
    >
      +
    </button>
  </div>

  <div class="argument-report-bottom">
    <button
      class="report-button"
      type="button"
      onclick="openReportBox('argument', '${a.id}')"
    >
      Signaler
    </button>
  </div>

</div>


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
    <button class="button button-small" type="button" onclick="toggleComments('${a.id}', this)">
      ${commentsOpen ? "Masquer" : "Commentaires"} (${comments.length})
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
  (() => {
    const replyData = replyToCommentByArgument[a.id] || {};
    return (
      replyData.improvementTitle && replyData.improvementBody
        ? `${replyData.improvementTitle} — ${replyData.improvementBody}`
        : replyData.improvementTitle
          ? replyData.improvementTitle
          : replyData.commentContent || replyData.improvementBody || ""
    );
  })()
)}</span>
        </div>

   <button
  type="button"
  class="button"
  onclick="cancelReply('${a.id}')"
>
  Annuler la réponse
</button>
      </div>
    `
    : ""
}



${
  replyToCommentByArgument[a.id]
    ? ""
    : `
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
    `
}



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

${c.reply_to_comment_id ? `<div class="comment-reply-label">Réponse à un commentaire</div>` : ""}
${
  c.stance === "amelioration"
    ? `
${c.content ? `<p>${linkifyText(c.content)}</p>` : ""}
<div class="comment-improvement-preview">
  <div class="comment-improvement-preview-title">${escapeHtml(c.improvement_title || "Sans titre")}</div>
  <div class="comment-improvement-preview-body">${linkifyText(c.improvement_body || "")}</div>
</div>
    `
    : `${c.content ? `<p>${linkifyText(c.content)}</p>` : ""}`
}


<div class="comment-actions">
  <button
    class="comment-like-button ${liked ? "comment-like-button-active comment-vote-disabled" : ""}"
    type="button"
onclick="voteComment('${debateId}','${c.id}','${a.id}', 1, this)"
    title="${liked ? "Déjà voté positif" : "Vote positif"}"
    ${liked ? "disabled" : ""}
  >
    👍
  </button>

  <button
    class="comment-dislike-button ${disliked ? "comment-dislike-button-active comment-vote-disabled" : ""}"
    type="button"
onclick="voteComment('${debateId}','${c.id}','${a.id}', -1, this)"
    title="${disliked ? "Déjà voté négatif" : "Vote négatif"}"
    ${disliked ? "disabled" : ""}
  >
    👎
  </button>

<span class="comment-like-count">${likes} ${likes > 1 ? "likes" : "like"}</span>

  <button
    class="button button-small"
    type="button"
    onclick="replyToComment('${a.id}', '${c.id}', this)"
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
                  onclick="loadMoreComments('${a.id}', this)"
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
  <button class="button button-small" type="button" onclick="toggleComments('${a.id}', this)">
    Masquer
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
<span class="vote-count">${a.votes} voix</span>
</div>

<h3 class="argument-title">${escapeHtml(a.title || "")}</h3>

${a.body ? `<p class="argument-body">${linkifyText(a.body)}</p>` : ""}

<div class="argument-actions argument-actions-vertical">
  <div class="argument-share-top">
    ${renderIdeaShareButtons(debateId, a)}
  </div>

  <div class="voice-stepper" aria-label="Répartition des voix sur cette idée">
    <button
      class="voice-stepper-btn voice-stepper-btn-minus"
      type="button"
      data-voice-arg-id="${a.id}"
      data-voice-action="minus"
      onclick="unvote('${debateId}','${a.id}', true, this)"
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
      data-voice-arg-id="${a.id}"
      data-voice-action="plus"
      onclick="vote('${debateId}','${a.id}', true, this)"
      aria-label="Ajouter une voix"
      title="Ajouter une voix"
    >
      +
    </button>
  </div>

  <div class="argument-report-bottom">
    <button
      class="report-button"
      type="button"
      onclick="openReportBox('argument', '${a.id}')"
    >
      Signaler
    </button>
  </div>
</div>

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
            <button class="button button-small" type="button" onclick="toggleComments('${a.id}', this)">
              ${commentsOpen ? "Masquer" : "Commentaires"} (${comments.length})
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
            (() => {
              const replyData = replyToCommentByArgument[a.id] || {};
              return (
                replyData.improvementTitle && replyData.improvementBody
                  ? `${replyData.improvementTitle} — ${replyData.improvementBody}`
                  : replyData.improvementTitle
                    ? replyData.improvementTitle
                    : replyData.commentContent || replyData.improvementBody || ""
              );
            })()
          )}</span>
        </div>

        <button
          type="button"
          class="button"
          onclick="cancelReply('${a.id}')"
        >
          Annuler la réponse
        </button>
      </div>
    `
    : ""
}

${
  replyToCommentByArgument[a.id]
    ? ""
    : `
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
    `
}

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

${c.reply_to_comment_id ? `<div class="comment-reply-label">Réponse à un commentaire</div>` : ""}
${
  c.stance === "amelioration"
    ? `
${c.content ? `<p>${linkifyText(c.content)}</p>` : ""}
<div class="comment-improvement-preview">
  <div class="comment-improvement-preview-title">${escapeHtml(c.improvement_title || "Sans titre")}</div>
  <div class="comment-improvement-preview-body">${linkifyText(c.improvement_body || "")}</div>
</div>
    `
    : `${c.content ? `<p>${linkifyText(c.content)}</p>` : ""}`
}
<div class="comment-actions">
  <button
    class="comment-like-button ${liked ? "comment-like-button-active comment-vote-disabled" : ""}"
    type="button"
onclick="voteComment('${debateId}','${c.id}','${a.id}', 1, this)"
    title="${liked ? "Déjà voté positif" : "Vote positif"}"
    ${liked ? "disabled" : ""}
  >
    👍
  </button>

  <button
    class="comment-dislike-button ${disliked ? "comment-dislike-button-active comment-vote-disabled" : ""}"
    type="button"
onclick="voteComment('${debateId}','${c.id}','${a.id}', -1, this)"
    title="${disliked ? "Déjà voté négatif" : "Vote négatif"}"
    ${disliked ? "disabled" : ""}
  >
    👎
  </button>

<span class="comment-like-count">${likes} ${likes > 1 ? "likes" : "like"}</span>

<button
  class="button button-small"
  type="button"
  onclick="replyToComment('${a.id}', '${c.id}', this)"
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
                                onclick="loadMoreComments('${a.id}', this)"
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
                <button class="button button-small" type="button" onclick="toggleComments('${a.id}', this)">
                  Masquer
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
  const form = document.getElementById("form-list");
  const submitButton = form?.querySelector('button[type="submit"]') || null;

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
    showReplacementSuccessMessage(
      "Idée manquante",
      "Tu dois écrire un titre à cette idée avant de la publier.",
      null,
      "⚠️"
    );
    return;
  }

  if (!isOpenMode && side !== "A" && side !== "B") {
    showReplacementSuccessMessage(
      "Position manquante",
      "Tu dois choisir une position avant de publier cette idée.",
      null,
      "⚠️"
    );
    return;
  }

  const confirmed = await showIdeaPublishConfirmModal();
  if (!confirmed) {
    return;
  }

  setButtonLoading(submitButton);

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

    if (warning) {
      warning.style.display = "none";
    }

    if (form) {
      form.style.display = "none";
    }

    openedArgumentForm = null;
    document.body.classList.remove("argument-form-open");

    if (typeof updateCounter === "function") {
      updateCounter("list-title", "count-title-list", 100);
      updateCounter("list-body", "count-body-list", 600);
    }

    pendingArgumentScrollId = String(r.id);
    pinnedNewArgumentId = String(r.id);

    try {
      insertLocalArgumentAfterPublish(debateId, {
        id: r.id,
        debate_id: debateId,
        side,
        title,
        body,
        author_key: getKey()
      });

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToTopOfArgumentCardAndFlash(String(r.id));
        });
      });
    } catch (localRenderError) {
      console.error(localRenderError);
      await loadDebate(debateId);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    clearButtonLoading(submitButton);
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

const submitButton = event?.currentTarget?.querySelector('button[type="submit"]')
  || event?.currentTarget?.querySelector(".comment-submit-btn")
  || null;

setButtonLoading(submitButton);

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
  visibleCommentsByArgument[argumentId] = Math.max(
    5,
    Number(visibleCommentsByArgument[argumentId] || 0) + 1
  );
  delete replyToCommentByArgument[argumentId];

  if (input) {
    input.value = "";
  }

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

  const localComment = {
    ...data,
    id: data.id,
    argument_id: data.argument_id ?? argumentId,
    content: data.content ?? (stance === "amelioration" ? "" : content),
    stance: data.stance ?? stance,
    reply_to_comment_id: data.reply_to_comment_id ?? replyToCommentId,
    improvement_title: data.improvement_title ?? improvement_title,
    improvement_body: data.improvement_body ?? improvement_body,
    likes: Number(data.likes || 0),
    author_key: data.author_key ?? getKey(),
    created_at: data.created_at || new Date().toISOString()
  };

  pendingCommentScrollId = String(localComment.id);
  pinnedNewCommentId = String(localComment.id);

  try {
    const existingComments = Array.isArray(currentCommentsByArgument[argumentId])
      ? currentCommentsByArgument[argumentId]
      : [];

    currentCommentsByArgument = {
      ...currentCommentsByArgument,
      [argumentId]: [...existingComments, localComment]
    };

    rerenderCurrentDebateArguments(debateId);

    setTimeout(() => {
      const element = getVisibleCommentElement(String(localComment.id));

      if (element) {
        const topbar = document.querySelector(".topbar");
        const offset = (topbar ? topbar.offsetHeight : 80) + 140;
        const y = element.getBoundingClientRect().top + window.scrollY - offset;

        window.scrollTo({
          top: Math.max(0, y),
          behavior: "smooth"
        });

        applyVoiceHighlight(element);

        setTimeout(() => {
          removeVoiceHighlight(element);
        }, 2000);
      }

      pendingCommentScrollId = null;
      pinnedNewCommentId = null;
    }, 250);
  } catch (renderError) {
    console.error(renderError);
    await loadDebate(debateId);
  }

  } catch (error) {
    alert(error.message);
  } finally {
    clearButtonLoading(submitButton);
  }
}

function updateLocalArgumentVoteState(argId, votes, myVoteCount, lastVotedAt = null) {
  const argIdString = String(argId);
  const numericVotes = Math.max(0, Number(votes || 0));
  const numericMyVotes = Math.max(0, Number(myVoteCount || 0));

  currentAllArguments = (currentAllArguments || []).map((arg) => {
    if (String(arg.id) !== argIdString) return arg;
    return {
      ...arg,
      votes: numericVotes,
      ...(lastVotedAt ? { last_voted_at: lastVotedAt } : {})
    };
  });

  const visibleCards = [
    document.getElementById(`argument-${argIdString}`),
    document.getElementById(`list-argument-${argIdString}`)
  ].filter(Boolean);

  visibleCards.forEach((card) => {
    const voteCount = card.querySelector('.vote-count');
    if (voteCount) {
      voteCount.textContent = `${numericVotes} voix`;
    }

    const myVotesValue = card.querySelector('.voice-stepper-value');
    if (myVotesValue) {
      myVotesValue.textContent = String(numericMyVotes);
    }

    card.classList.toggle('argument-card-voted', numericMyVotes > 0);
  });
}


function rerenderCurrentDebateArguments(debateId) {
  const commentsByArgument = currentCommentsByArgument || {};
  const unifiedContainer = document.getElementById("arguments-unified");
  const argumentsAContainer = document.getElementById("arguments-a");
  const argumentsBContainer = document.getElementById("arguments-b");
  const openMode = isCurrentOpenDebateMode();

  if (openMode || currentDebateViewMode === "list") {
    if (argumentsAContainer) argumentsAContainer.innerHTML = "";
    if (argumentsBContainer) argumentsBContainer.innerHTML = "";
    renderUnifiedArgs("arguments-unified", currentAllArguments, debateId, commentsByArgument);

    requestAnimationFrame(() => {
      syncVoiceGuidanceState(debateId);
    });
    return;
  }

  if (unifiedContainer) unifiedContainer.innerHTML = "";

  const argsA = (currentAllArguments || []).filter((arg) => String(arg.side || "") === "A");
  const argsB = (currentAllArguments || []).filter((arg) => String(arg.side || "") === "B");

  renderArgs("arguments-a", argsA, debateId, commentsByArgument);
  renderArgs("arguments-b", argsB, debateId, commentsByArgument);

  requestAnimationFrame(() => {
    syncVoiceGuidanceState(debateId);
  });
}

function rerenderArgumentsAfterLocalVoteChange(debateId) {
  const previousPinnedArgumentId = pinnedNewArgumentId;
  pinnedNewArgumentId = null;

  try {
    rerenderCurrentDebateArguments(debateId);
  } finally {
    pinnedNewArgumentId = previousPinnedArgumentId;
  }
}

function insertLocalArgumentAfterPublish(debateId, argumentData = {}) {
  const argumentId = String(argumentData.id || "").trim();
  if (!argumentId) {
    throw new Error("Identifiant d'idée manquant.");
  }

  const nowIsoString = new Date().toISOString();
  const normalizedArgument = {
    id: argumentId,
    debate_id: String(argumentData.debate_id || debateId || ""),
    side: String(argumentData.side || "A"),
    title: String(argumentData.title || ""),
    body: String(argumentData.body || ""),
    votes: Number(argumentData.votes || 0),
    author_key: String(argumentData.author_key || getKey() || ""),
    created_at: argumentData.created_at || nowIsoString,
    last_voted_at: argumentData.last_voted_at || null
  };

  const existingArguments = Array.isArray(currentAllArguments) ? currentAllArguments : [];
  currentAllArguments = [
    normalizedArgument,
    ...existingArguments.filter((arg) => String(arg.id) !== argumentId)
  ];

  if (!currentCommentsByArgument || typeof currentCommentsByArgument !== "object") {
    currentCommentsByArgument = {};
  }

  if (!Array.isArray(currentCommentsByArgument[argumentId])) {
    currentCommentsByArgument[argumentId] = [];
  }

  rerenderCurrentDebateArguments(debateId);
  refreshDebateScoreFromCurrentArguments();
  renderUnifiedVoicesSummary(debateId, currentAllArguments);
  renderUnifiedVotedArgumentsSummary(debateId, currentAllArguments);

  requestAnimationFrame(() => {
    syncVoiceButtonsDisabledState(debateId, argumentId);
  });
}

function refreshDebateScoreFromCurrentArguments() {
  const scoreBar = document.getElementById("debate-score-bar");
  const scoreA = document.getElementById("score-a");
  const scoreB = document.getElementById("score-b");
  const debateQuestion = document.getElementById("debate-question")?.textContent || "";
  const optionA = document.getElementById("title-a")?.textContent || "";
  const optionB = document.getElementById("title-b")?.textContent || "";
  const isOpen = isCurrentOpenDebateMode();

  const votesA = (currentAllArguments || []).reduce((sum, arg) => {
    return String(arg.side || "") === "A" ? sum + Number(arg.votes || 0) : sum;
  }, 0);
  const votesB = (currentAllArguments || []).reduce((sum, arg) => {
    return String(arg.side || "") === "B" ? sum + Number(arg.votes || 0) : sum;
  }, 0);

  const total = votesA + votesB;
  let percentA = 50;
  let percentB = 50;

  if (!isOpen && total > 0) {
    percentA = Math.round((votesA / total) * 100);
    percentB = 100 - percentA;
  }

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
    question: debateQuestion,
    optionA: isOpen ? "" : optionA,
    optionB: isOpen ? "" : optionB,
    percentA,
    percentB
  };
}

function refreshAllVoiceButtonsDisabledState(debateId) {
  const uniqueArgIds = new Set((currentAllArguments || []).map((arg) => String(arg.id)));
  uniqueArgIds.forEach((argId) => {
    syncVoiceButtonsDisabledState(debateId, argId);
  });
}

function refreshVoteUiAfterLocalChange(debateId, argId, votes, myVotesOnArgument, lastVotedAt = null) {
  updateLocalArgumentVoteState(argId, votes, myVotesOnArgument, lastVotedAt);
  rerenderArgumentsAfterLocalVoteChange(debateId);
  renderUnifiedVoicesSummary(debateId, currentAllArguments);
  renderUnifiedVotedArgumentsSummary(debateId, currentAllArguments);
  refreshDebateScoreFromCurrentArguments();
  refreshAllVoiceButtonsDisabledState(debateId);
}

function clearPinnedNewArgumentIfMatches(argumentId) {
  if (String(pinnedNewArgumentId || "") !== String(argumentId || "")) {
    return;
  }

  pinnedNewArgumentId = null;
}

async function vote(debateId, argId, shouldScroll = true, button = null) {
  const state = getState(debateId);
  const argIdString = String(argId);
  const voterKey = getKey();

  if (pendingVoiceRequests[argIdString]) {
    return;
  }

  const targetBefore = (currentAllArguments || []).find(
    (arg) => String(arg.id) === argIdString
  );

  const targetSide = targetBefore ? String(targetBefore.side || "") : "";

  const beforeRankMap = getSupportRankMap(
    (currentAllArguments || []).filter(
      (arg) => String(arg.side || "") === targetSide
    )
  );

  const totalVotesUsed = Object.values(state).reduce((sum, value) => {
    return sum + Number(value || 0);
  }, 0);

  if (totalVotesUsed >= 5) {
    pendingVoicesSummaryHighlight = true;
    showVoteWarning(
      "⚠️ Plus de voix disponibles",
      "Tes 5 voix ont été attribuées. Retire-en une pour en attribuer ailleurs."
    );
    return;
  }

  const previousState = { ...state };
  const previousMyVotesOnArgument = Number(state[argIdString] || 0);
  const previousVotes = Number(targetBefore?.votes || 0);
  const previousLastVotedAt = targetBefore?.last_voted_at || null;
  const optimisticMyVotesOnArgument = previousMyVotesOnArgument + 1;
  const optimisticVotes = previousVotes + 1;
  let optimisticApplied = false;

  setVoiceRequestPending(debateId, argId, true);

  try {
    state[argIdString] = optimisticMyVotesOnArgument;
    setState(debateId, state);
    clearPinnedNewArgumentIfMatches(argIdString);

    refreshVoteUiAfterLocalChange(
      debateId,
      argId,
      optimisticVotes,
      optimisticMyVotesOnArgument,
      new Date().toISOString()
    );
    optimisticApplied = true;

    const targetAfterOptimistic = (currentAllArguments || []).find(
      (arg) => String(arg.id) === argIdString
    );

    const optimisticAfterSide = targetAfterOptimistic ? String(targetAfterOptimistic.side || "") : targetSide;

    const optimisticArgsSameSide = (currentAllArguments || []).filter(
      (arg) => String(arg.side || "") === optimisticAfterSide
    );

    showVoteRankProgress(beforeRankMap, optimisticArgsSameSide, argId);

    if (shouldScroll) {
      scrollToTopOfArgumentCardAndFlash(argId);
    }

    const response = await fetchJSON(API + "/arguments/" + argId + "/vote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ voterKey })
    });

    state[argIdString] = Number(response?.myVotesOnArgument || optimisticMyVotesOnArgument);
    setState(debateId, state);

    try {
      refreshVoteUiAfterLocalChange(
        debateId,
        argId,
        Number(response?.votes || optimisticVotes),
        Number(response?.myVotesOnArgument || optimisticMyVotesOnArgument),
        response?.lastVotedAt || null
      );
    } catch (uiError) {
      console.error(uiError);
      pendingArgumentScrollId = shouldScroll ? String(argId) : null;
      await loadDebate(debateId);
    }
  } catch (error) {
    if (optimisticApplied) {
      setState(debateId, previousState);

      try {
        refreshVoteUiAfterLocalChange(
          debateId,
          argId,
          previousVotes,
          previousMyVotesOnArgument,
          previousLastVotedAt
        );
      } catch (rollbackUiError) {
        console.error(rollbackUiError);
        pendingArgumentScrollId = shouldScroll ? String(argId) : null;
        await loadDebate(debateId);
      }

      closeReplacementSuccessMessage();
    }

    if (error.message === "limit") {
      pendingVoicesSummaryHighlight = true;
      showVoteWarning(
        "⚠️ Limite atteinte",
        "Vous avez déjà attribué vos 5 voix."
      );
      return;
    }

    alert(error.message);
  } finally {
    setVoiceRequestPending(debateId, argId, false);
  }
}


async function unvote(debateId, argId, shouldScroll = true, button = null) {
  const state = getState(debateId);
  const argIdString = String(argId);
  const voterKey = getKey();

  if (pendingVoiceRequests[argIdString]) {
    return;
  }

  if (!state[argIdString] || Number(state[argIdString]) <= 0) {
    return;
  }

  const targetBefore = (currentAllArguments || []).find(
    (arg) => String(arg.id) === argIdString
  );

  const previousState = { ...state };
  const previousMyVotesOnArgument = Number(state[argIdString] || 0);
  const previousVotes = Number(targetBefore?.votes || 0);
  const previousLastVotedAt = targetBefore?.last_voted_at || null;
  const optimisticMyVotesOnArgument = Math.max(0, previousMyVotesOnArgument - 1);
  const optimisticVotes = Math.max(0, previousVotes - 1);
  let optimisticApplied = false;

  setButtonLoading(button);
  setVoiceRequestPending(debateId, argId, true);

  try {
    if (optimisticMyVotesOnArgument > 0) {
      state[argIdString] = optimisticMyVotesOnArgument;
    } else {
      delete state[argIdString];
    }

    setState(debateId, state);

    refreshVoteUiAfterLocalChange(
      debateId,
      argId,
      optimisticVotes,
      optimisticMyVotesOnArgument,
      previousLastVotedAt
    );
    optimisticApplied = true;

    if (shouldScroll) {
      scrollToTopOfArgumentCardAndFlash(argId);
    }

    const response = await fetchJSON(API + "/arguments/" + argId + "/unvote", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ voterKey })
    });

    const myVotesOnArgument = Number(response?.myVotesOnArgument || optimisticMyVotesOnArgument);

    if (myVotesOnArgument > 0) {
      state[argIdString] = myVotesOnArgument;
    } else {
      delete state[argIdString];
    }

    setState(debateId, state);

    try {
      refreshVoteUiAfterLocalChange(
        debateId,
        argId,
        Number(response?.votes || optimisticVotes),
        myVotesOnArgument,
        response?.lastVotedAt || previousLastVotedAt
      );
    } catch (uiError) {
      console.error(uiError);
      pendingArgumentScrollId = shouldScroll ? String(argId) : null;
      await loadDebate(debateId);
    }
  } catch (error) {
    if (optimisticApplied) {
      setState(debateId, previousState);

      try {
        refreshVoteUiAfterLocalChange(
          debateId,
          argId,
          previousVotes,
          previousMyVotesOnArgument,
          previousLastVotedAt
        );
      } catch (rollbackUiError) {
        console.error(rollbackUiError);
        pendingArgumentScrollId = shouldScroll ? String(argId) : null;
        await loadDebate(debateId);
      }
    }

    alert(error.message);
  } finally {
    clearButtonLoading(button);
    setVoiceRequestPending(debateId, argId, false);
  }
}

async function confirmRemoveVoice(debateId, argId) {
  const ok = window.confirm("Retirer 1 voix de cette idée ?");

  if (!ok) return;

  await unvote(debateId, argId);
}

function getLocalCommentsForArgument(argumentId) {
  return currentCommentsByArgument?.[String(argumentId)] || [];
}

function getLocalCommentById(commentId, argumentId = null) {
  const commentIdString = String(commentId);

  if (argumentId !== null && argumentId !== undefined) {
    const scopedComments = getLocalCommentsForArgument(argumentId);
    const scopedFound = (scopedComments || []).find(
      (comment) => String(comment.id) === commentIdString
    );

    if (scopedFound) return scopedFound;
  }

  for (const comments of Object.values(currentCommentsByArgument || {})) {
    const found = (comments || []).find((comment) => String(comment.id) === commentIdString);
    if (found) return found;
  }

  return null;
}

function updateLocalCommentVoteState(commentId, likes, myVoteValue) {
  const commentIdString = String(commentId);
  const numericLikes = Number(likes || 0);
  const numericMyVoteValue = Number(myVoteValue || 0);

  for (const argumentId of Object.keys(currentCommentsByArgument || {})) {
    currentCommentsByArgument[argumentId] = (currentCommentsByArgument[argumentId] || []).map((comment) => {
      if (String(comment.id) !== commentIdString) return comment;
      return {
        ...comment,
        likes: numericLikes
      };
    });
  }

  const card = getVisibleCommentElement(commentIdString) || document.getElementById(`comment-${commentIdString}`) || document.getElementById(`list-comment-${commentIdString}`);
  if (!card) return;

  const likeButton = card.querySelector('.comment-like-button');
  const dislikeButton = card.querySelector('.comment-dislike-button');
  const likeCount = card.querySelector('.comment-like-count');

  if (likeCount) {
    likeCount.textContent = `${numericLikes} ${numericLikes > 1 ? "likes" : "like"}`;
  }

  if (likeButton) {
    const liked = numericMyVoteValue === 1;
    likeButton.disabled = liked;
    likeButton.title = liked ? "Déjà voté positif" : "Vote positif";
    likeButton.classList.toggle('comment-like-button-active', liked);
    likeButton.classList.toggle('comment-vote-disabled', liked);
  }

  if (dislikeButton) {
    const disliked = numericMyVoteValue === -1;
    dislikeButton.disabled = disliked;
    dislikeButton.title = disliked ? "Déjà voté négatif" : "Vote négatif";
    dislikeButton.classList.toggle('comment-dislike-button-active', disliked);
    dislikeButton.classList.toggle('comment-vote-disabled', disliked);
  }
}

async function voteComment(debateId, commentId, argumentId, value, button = null) {
  let state = getCommentLikeState(debateId);
  const commentIdString = String(commentId);
  const voterKey = getKey();

  if (argumentId) {
    openCommentsByArgument[argumentId] = true;
    visibleCommentsByArgument[argumentId] =
      Math.max(visibleCommentsByArgument[argumentId] || 5, 9999);
  }

  setButtonLoading(button);

  try {
    const targetComment = getLocalCommentById(commentIdString);
    const currentValue = Number(state[commentIdString] || 0);
    let nextValue = 0;

    if (currentValue === 0) {
      nextValue = value;
    } else if (currentValue === value) {
      return;
    } else {
      nextValue = 0;
    }

    const shouldWarnAboutReplacement =
      value === 1 &&
      targetComment &&
      targetComment.stance === "amelioration" &&
      nextValue === 1;

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

    if (result && result.replaced) {
      pendingArgumentScrollId = result.argumentId ? String(result.argumentId) : null;
      await loadDebate(debateId);

      showReplacementSuccessMessage(
        "💡 Idée remplacée",
        "Cette amélioration a dépassé l’idée originale et la remplace désormais."
      );

      return;
    }

    try {
      updateLocalCommentVoteState(commentIdString, Number(result?.likes || 0), nextValue);
    } catch (uiError) {
      console.error(uiError);
      await loadDebate(debateId);
    }

    if (shouldWarnAboutReplacement) {
      showVoteWarning(
        "Cette proposition d'amélioration peut remplacer l’idée :",
        "👉  si elle obtient plus de likes que l'idée n'a de voix, elle prendra sa place."
      );
    }
  } catch (error) {
    alert(error.message);
  } finally {
    clearButtonLoading(button);
  }
}

function replyToComment(argumentId, commentId, button = null) {
  const debateId = getDebateId();
  if (!debateId) return;

  setActionLoading(button);

const focusReplyUi = () => {
  const isListMode = currentDebateViewMode === "list";

  const container = isListMode
    ? document.getElementById(`list-argument-${argumentId}`)
    : document.getElementById(`argument-${argumentId}`);

  if (!container) return;

  const replyLabel = container.querySelector(".reply-preview-label");
  const input = container.querySelector(`#comment-input-${argumentId}`);
  const target = replyLabel || input;

  if (target) {
    const topbar = document.querySelector(".topbar");
    const offset = topbar ? topbar.offsetHeight + 230 : 330;
    const y = target.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({
      top: y,
      behavior: "smooth"
    });
  }

  if (input) {
    setTimeout(() => {
      input.focus();
    }, 250);
  }
};

  const rerenderReplyUi = () => {
    try {
      rerenderCurrentDebateArguments(debateId);
      clearActionLoading(button);
      focusReplyUi();
    } catch (uiError) {
      console.error(uiError);
      return loadDebate(debateId).then(() => {
        clearActionLoading(button);
        focusReplyUi();
      });
    }

    return Promise.resolve();
  };

  const applyReplyTarget = (targetComment) => {
    replyToCommentByArgument[argumentId] = {
      commentId: String(commentId),
      commentContent: targetComment ? String(targetComment.content || "") : "",
      improvementTitle: targetComment ? String(targetComment.improvement_title || "") : "",
      improvementBody: targetComment ? String(targetComment.improvement_body || "") : ""
    };

    openCommentsByArgument[argumentId] = true;
    visibleCommentsByArgument[argumentId] =
      Math.max(visibleCommentsByArgument[argumentId] || 5, 9999);

    return rerenderReplyUi();
  };

  const localTargetComment = getLocalCommentById(commentId, argumentId);
  const loadReplyForm = localTargetComment
    ? applyReplyTarget(localTargetComment)
    : fetchJSON(API + "/debates/" + debateId)
        .then((debateData) => {
          const comments = debateData.commentsByArgument?.[String(argumentId)] || [];
          const targetComment = comments.find(
            (comment) => String(comment.id) === String(commentId)
          );

          return applyReplyTarget(targetComment);
        });

  loadReplyForm.catch((error) => {
    clearActionLoading(button);
    alert(error.message);
  });
}

function cancelReply(argumentId) {
  delete replyToCommentByArgument[argumentId];

  const debateId = getDebateId();
  if (!debateId) return;

  try {
    rerenderCurrentDebateArguments(debateId);
  } catch (uiError) {
    console.error(uiError);
    loadDebate(debateId).catch((error) => {
      alert(error.message);
    });
  }
}

function scrollToArgumentFromSummary(argId) {
  const argIdString = String(argId);
  let element = ensureArgumentCardVisibleForScroll(argIdString);
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

function getTopVisibleCommentElement() {
  const commentElements = Array.from(
    document.querySelectorAll(".comment-card[id^='comment-'], .comment-card[id^='list-comment-']")
  );

  if (!commentElements.length) return null;

  const viewportTop = window.innerHeight > 0 ? 0 : 0;

  let best = null;
  let bestTop = Infinity;

  commentElements.forEach((el) => {
    const rect = el.getBoundingClientRect();

    // On ignore les commentaires complètement hors écran vers le bas
    if (rect.bottom <= 0) return;
    if (rect.top >= window.innerHeight) return;

    if (rect.top < bestTop) {
      bestTop = rect.top;
      best = el;
    }
  });

  return best;
} 
function scrollToTopVisibleComment() {
  const element = getTopVisibleCommentElement();

  if (!element) return;

  const topbar = document.querySelector(".topbar");
  const offset = (topbar ? topbar.offsetHeight : 80) + 20;

  const rect = element.getBoundingClientRect();

  // Si déjà bien placé → on ne bouge pas
  if (rect.top >= offset && rect.top <= offset + 40) {
    return;
  }

  const y = rect.top + window.scrollY - offset;

  window.scrollTo({
    top: Math.max(0, y),
    behavior: "smooth"
  });
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
  overlay.className = "replacement-success-overlay replacement-success-overlay-visible";

  overlay.innerHTML = `
    <div class="replacement-success-box report-choice-modal">
      <div class="replacement-success-icon" aria-hidden="true">🚩</div>

      <div class="replacement-success-title">Signaler ce contenu</div>
      <div class="replacement-success-text">
        Choisis le motif qui correspond le mieux.
      </div>

      <div class="report-box-actions report-box-actions-vertical">
        <button
          class="replacement-success-button report-choice-button"
          type="button"
          onclick="submitReport('${targetType}', '${targetId}', 'inapproprie')"
        >
          Propos inappropriés
        </button>

        <button
          class="replacement-success-button report-choice-button"
          type="button"
          onclick="submitReport('${targetType}', '${targetId}', 'doublon')"
        >
          Doublon / déjà existant
        </button>

        ${
          targetType === "argument"
            ? `
              <button
                class="replacement-success-button report-choice-button"
                type="button"
                onclick="submitReport('${targetType}', '${targetId}', 'plusieurs_arguments')"
              >
                Plusieurs idées développées
              </button>
            `
            : ""
        }
      </div>

      <button
        class="replacement-success-button"
        type="button"
        onclick="closeReportBox()"
      >
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
showReplacementSuccessMessage(
  "Signalement envoyé",
  "Merci. Ce contenu a bien été signalé.",
  null,
  "🚩"
);
 } catch (error) {
if (error.message === "already_reported") {
  showReplacementSuccessMessage(
    "Signalement déjà effectué",
    "Tu as déjà signalé ce contenu.",
    null,
    "🚩"
  );
  return;
}

  alert(error.message);
}
}
async function deleteDebate(debateId, redirectAfter) {
  const debate = String(currentDebateCache?.id || "") === String(debateId)
    ? currentDebateCache
    : [...(debatesCache || []), ...(visitedDebatesCache || []), ...(otherDebatesCache || [])]
        .find((item) => String(item?.id || "") === String(debateId));

  if (!canDeleteDebate(debate)) {
    alert("Suppression non autorisée.");
    return;
  }

  showDeleteConfirmModal({
    title: "Supprimer cette arène ?",
    text: "Cette suppression est définitive.",
    onConfirm: async () => {
      try {
        const url = new URL(API + "/debates/" + debateId, window.location.origin);
        url.searchParams.set("authorKey", getKey());

        const headers = {};
        if (isAdmin()) {
          headers["x-admin-token"] = getAdminToken();
        }

        await fetchJSON(url.toString(), {
          method: "DELETE",
          headers
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
  });
}


async function deleteComment(debateId, commentId) {
  showDeleteConfirmModal({
    title: "Supprimer ce commentaire ?",
    text: "Cette suppression est définitive.",
    onConfirm: async () => {
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

        const commentIdString = String(commentId);
        let hasLocalUpdate = false;

        if (currentCommentsByArgument && typeof currentCommentsByArgument === "object") {
          Object.keys(currentCommentsByArgument).forEach((argumentId) => {
            const existingComments = currentCommentsByArgument[argumentId];
            if (!Array.isArray(existingComments) || !existingComments.length) return;

            const filteredComments = existingComments.filter(
              (comment) => String(comment?.id) !== commentIdString
            );

            if (filteredComments.length !== existingComments.length) {
              currentCommentsByArgument[argumentId] = filteredComments;
              hasLocalUpdate = true;
            }
          });
        }

        if (hasLocalUpdate && Array.isArray(currentAllArguments)) {
          rerenderCurrentDebateArguments(debateId);
          return;
        }

        await loadDebate(debateId);
      } catch (error) {
        alert(error.message);
      }
    }
  });
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

async function toggleComments(argumentId, button = null) {
  const wasOpen = !!openCommentsByArgument[argumentId];
  const willOpen = !wasOpen;

  openCommentsByArgument[argumentId] = willOpen;

  if (willOpen && !visibleCommentsByArgument[argumentId]) {
    visibleCommentsByArgument[argumentId] = 5;
  }

  const debateId = getDebateId();
  if (!debateId) return;

  setButtonLoading(button);

  try {
    rerenderCurrentDebateArguments(debateId);

    if (wasOpen) {
      setTimeout(() => {
        scrollToTopOfArgumentCard(argumentId);
      }, 50);
    }
  } catch (error) {
    alert(error.message);
  } finally {
    clearButtonLoading(button);
  }
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

async function loadMoreComments(argumentId, button = null) {
  visibleCommentsByArgument[argumentId] =
    (visibleCommentsByArgument[argumentId] || 5) + 5;

  const debateId = getDebateId();
  if (!debateId) return;

  setButtonLoading(button);

  try {
    rerenderCurrentDebateArguments(debateId);
  } catch (error) {
    alert(error.message);
  } finally {
    clearButtonLoading(button);
  }
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

function rerenderCurrentDebateArguments() {
  const debateId = getDebateId();
  if (!debateId) return;

  if (!Array.isArray(currentAllArguments)) {
    loadDebate(debateId);
    return;
  }

  renderUnifiedVoicesSummary(debateId, currentAllArguments);
  renderUnifiedVotedArgumentsSummary(debateId, currentAllArguments);

  const isOpenMode = isOpenDebate(currentDebateCache);

  if (isOpenMode || currentDebateViewMode === "list") {
    const argsA = document.getElementById("arguments-a");
    const argsB = document.getElementById("arguments-b");
    if (argsA) argsA.innerHTML = "";
    if (argsB) argsB.innerHTML = "";

    renderUnifiedArgs("arguments-unified", currentAllArguments, debateId, currentCommentsByArgument || {});

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        syncVoiceGuidanceState(debateId);
      });
    });
    return;
  }

  const unified = document.getElementById("arguments-unified");
  if (unified) unified.innerHTML = "";

  const optionAArgs = currentAllArguments.filter((argument) => argument.side === "A");
  const optionBArgs = currentAllArguments.filter((argument) => argument.side === "B");

  renderArgs("arguments-a", optionAArgs, debateId, currentCommentsByArgument || {});
  renderArgs("arguments-b", optionBArgs, debateId, currentCommentsByArgument || {});

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      syncVoiceGuidanceState(debateId);
    });
  });
}

function loadMoreArguments() {
  argumentsVisible += 6;
  rerenderCurrentDebateArguments();
}

async function editDebate() {
  const debateId = getDebateId();
  if (!debateId) return;

  try {
    const data = await fetchJSON(API + "/debates/" + debateId);
    const debate = data?.debate || null;

    if (!debate) {
      alert("Arène introuvable.");
      return;
    }

    const currentQuestion = debate.question || "";
    const currentOptionA = debate.option_a || "";
    const currentOptionB = debate.option_b || "";
    const currentSourceUrl = debate.source_url || "";

    const question = window.prompt("Modifier le titre de l'arène :", currentQuestion);
    if (question === null) return;

    const option_a = window.prompt("Modifier la position A :", currentOptionA);
    if (option_a === null) return;

    const option_b = window.prompt("Modifier la position B :", currentOptionB);
    if (option_b === null) return;

    const source_url = window.prompt("Modifier le lien source :", currentSourceUrl);
    if (source_url === null) return;

    await fetchJSON(API + "/admin/debate/" + debateId, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-admin-token": getAdminToken()
      },
      body: JSON.stringify({
        question: question.trim(),
        option_a: option_a.trim(),
        option_b: option_b.trim(),
        source_url: source_url.trim()
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

function showCopyLinkSuccessMessage() {
  showReplacementSuccessMessage(
    "Lien copié",
    "Le lien a bien été copié dans le presse-papiers.",
    null,
    "🔗"
  );
}

function showReplacementSuccessMessage(title, message, onClose = null, iconHtml = "💡", iconClass = "") {
  const existing = document.getElementById("replacement-success-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "replacement-success-overlay";
  overlay.className = "replacement-success-overlay replacement-success-overlay-visible";

  const boxClass = iconClass.includes("ranking-medal") ? "ranking-medal-box" : "ranking-gain-box";
  const finalIconClass = iconClass
    ? `replacement-success-icon ${iconClass}`
    : "replacement-success-icon ranking-gain-icon";

  overlay.innerHTML = `
    <div class="replacement-success-box ${boxClass}">
      <div class="${finalIconClass}">${iconHtml}</div>
      <div class="replacement-success-title">${escapeHtml(title)}</div>
      <div class="replacement-success-text">${escapeHtml(message)}</div>
      <button
        type="button"
        class="replacement-success-button"
        id="replacement-success-close-btn"
      >
        Compris
      </button>
    </div>
  `;

  document.body.appendChild(overlay);

  const closeBtn = document.getElementById("replacement-success-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      overlay.classList.remove("replacement-success-overlay-visible");

      setTimeout(() => {
        overlay.remove();

        if (typeof onClose === "function") {
          onClose();
        }
      }, 250);
    });
  }
}


function closeReplacementSuccessMessage() {
  const overlay = document.getElementById("replacement-success-overlay");
  if (!overlay) return;

  overlay.classList.remove("replacement-success-overlay-visible");

  setTimeout(() => {
    overlay.remove();
  }, 250);
}
function shouldRunBackgroundRefresh() {
  return !document.hidden;
}


function ensureProgressSortOption() {
  const menu = document.getElementById("sort-menu");
  if (!menu) return;
  if (menu.querySelector('[data-sort-mode="progress"]')) return;

  const templateButton = menu.querySelector('button');
  const progressButton = templateButton
    ? templateButton.cloneNode(true)
    : document.createElement("button");

  progressButton.type = "button";
  progressButton.textContent = "Idées en progression";
  progressButton.setAttribute("data-sort-mode", "progress");
  progressButton.onclick = () => changeArgumentsSort("progress");

  if (!templateButton) {
    progressButton.style.display = "block";
    progressButton.style.width = "100%";
  }

  const commentsButton = menu.querySelector('[onclick*="comments"]');
  if (commentsButton && commentsButton.parentNode === menu) {
    menu.insertBefore(progressButton, commentsButton);
  } else {
    menu.appendChild(progressButton);
  }
}

document.addEventListener("DOMContentLoaded", () => {
initMobileIndexCardHighlight();
scheduleMobileIndexCardHighlightUpdate();
  initNotificationTransitionOverlay();
  attachAdminButtons();
  loadNotifications();
  renderGlobalShareBar();
  ensureProgressSortOption();
  initDebateTopbarAutoHide();

  if (location.pathname === "/") initIndex();
  if (location.pathname === "/create") initCreate();
if (location.pathname === "/debate") {
  localStorage.setItem("debate_view_mode", "columns");
  initDebate();
}  if (location.pathname === "/admin-reports") initAdminReports();
  if (location.pathname === "/notifications") loadNotificationsPage();

  loadReportsBadge();

  setInterval(() => {
    if (!shouldRunBackgroundRefresh()) return;
    loadNotifications();
  }, 20000);

  setInterval(() => {
    if (!shouldRunBackgroundRefresh()) return;
    loadReportsBadge();
  }, 20000);
  const resetNotificationsBtn = document.getElementById("reset-notifications-btn");
  if (resetNotificationsBtn) {
    resetNotificationsBtn.addEventListener("click", resetNotifications);
  }
});

let notificationsPageLoadInFlight = null;
async function loadNotificationsPage() {
  const list = document.getElementById("notifications-page-list");
  if (!list) return;
  if (notificationsPageLoadInFlight) return notificationsPageLoadInFlight;

  notificationsPageLoadInFlight = (async () => {
    try {
      const notifications = await fetchJSON(
        API + "/notifications?userKey=" + encodeURIComponent(getKey())
      );
const unread = notifications.filter(n => !n.is_read).length;

const previous = getStoredUnreadNotificationCount();

if (unread > previous) {
  const bell = document.querySelector(".notifications-button");
  if (bell) {
    bell.classList.add("bell-ring");
    setTimeout(() => bell.classList.remove("bell-ring"), 2000);
  }
}

setStoredUnreadNotificationCount(unread);

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
      title = getNotificationDisplayTitle(notification, title);
     return `
 <a
  class="notification-item ${Number(notification.is_read) === 0 ? "notification-item-unread" : ""}"
  href="${link}"
  onclick="handleNotificationClick(event, '${notification.id}', '${link}', this)"
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
  } finally {
    notificationsPageLoadInFlight = null;
  }
  })();

  return notificationsPageLoadInFlight;
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
const offset = (topbar ? topbar.offsetHeight : 80) + 120;
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

  let normalizedSide = "";

  if (side === "a" || side === "b") {
    normalizedSide = side;
  }

  listForm.style.display = "grid";
  openedArgumentForm = listForm;
  document.body.classList.add("argument-form-open");

  setListArgumentSide(normalizedSide);

  setTimeout(() => {
    const topbar = document.querySelector(".topbar");
    const offset = (topbar ? topbar.offsetHeight : 80) + 120;
    const y = listForm.offsetTop - offset;

    window.scrollTo({
      top: y,
      behavior: "smooth"
    });

    const titleInput = document.getElementById("list-title");
    if (titleInput) titleInput.focus();
  }, 50);
}

function showDeleteConfirmModal({ title, text, onConfirm }) {
  const existing = document.getElementById("custom-delete-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "custom-delete-modal";
  overlay.className = "custom-modal-overlay";

  overlay.innerHTML = `
    <div class="custom-modal-box">
      <div class="custom-modal-title">${escapeHtml(title)}</div>
      <div class="custom-modal-text">${escapeHtml(text)}</div>

      <div class="custom-modal-actions">
        <button type="button" class="button button-secondary" id="delete-cancel-btn">
          Annuler
        </button>

        <button type="button" class="button custom-delete-confirm-btn" id="delete-confirm-btn">
          Supprimer
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById("delete-cancel-btn").onclick = () => overlay.remove();

  document.getElementById("delete-confirm-btn").onclick = () => {
    overlay.remove();
    if (typeof onConfirm === "function") onConfirm();
  };
}

function showIdeaPublishConfirmModal() {
  return new Promise((resolve) => {
    const existing = document.getElementById("custom-idea-publish-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "custom-idea-publish-modal";
    overlay.className = "custom-modal-overlay";

    overlay.innerHTML = `
      <div class="custom-modal-box">
        <div class="custom-modal-title">Publier cette idée ?</div>
        <div class="custom-modal-text">Êtes-vous sûr de vouloir publier cette idée ? Vous ne pourrez plus la modifier ensuite, seulement la supprimer.</div>

        <div class="custom-modal-actions">
          <button type="button" class="button button-secondary" id="idea-publish-cancel-btn">
            Annuler
          </button>

          <button type="button" class="button" id="idea-publish-confirm-btn">
            Publier
          </button>
        </div>
      </div>
    `;

    const closeModal = (confirmed) => {
      overlay.remove();
      resolve(confirmed === true);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal(false);
      }
    });

    document.body.appendChild(overlay);

    const cancelBtn = document.getElementById("idea-publish-cancel-btn");
    const confirmBtn = document.getElementById("idea-publish-confirm-btn");

    if (cancelBtn) {
      cancelBtn.onclick = () => closeModal(false);
    }

    if (confirmBtn) {
      confirmBtn.onclick = () => closeModal(true);
      confirmBtn.focus();
    }
  });
}

function showDebatePublishConfirmModal() {
  return new Promise((resolve) => {
    const existing = document.getElementById("custom-debate-publish-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "custom-debate-publish-modal";
    overlay.className = "custom-modal-overlay";

    overlay.innerHTML = `
      <div class="custom-modal-box">
        <div class="custom-modal-title">Publier ce débat ?</div>
        <div class="custom-modal-text">Êtes-vous sûr de vouloir publier cette arène ? Vous ne pourrez plus la modifier ensuite, seulement la supprimer.</div>

        <div class="custom-modal-actions">
          <button type="button" class="button button-secondary" id="debate-publish-cancel-btn">
            Annuler
          </button>

          <button type="button" class="button" id="debate-publish-confirm-btn">
            Publier
          </button>
        </div>
      </div>
    `;

    const closeModal = (confirmed) => {
      overlay.remove();
      resolve(confirmed === true);
    };

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        closeModal(false);
      }
    });

    document.body.appendChild(overlay);

    const cancelBtn = document.getElementById("debate-publish-cancel-btn");
    const confirmBtn = document.getElementById("debate-publish-confirm-btn");

    if (cancelBtn) {
      cancelBtn.onclick = () => closeModal(false);
    }

    if (confirmBtn) {
      confirmBtn.onclick = () => closeModal(true);
      confirmBtn.focus();
    }
  });
}

async function deleteArgument(debateId, argumentId) {
  showDeleteConfirmModal({
    title: "Supprimer cette idée ?",
    text: "Cette suppression est définitive.",
    onConfirm: async () => {
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

        const argumentIdString = String(argumentId);

        delete openCommentsByArgument[argumentIdString];
        delete visibleCommentsByArgument[argumentIdString];
                if (currentCommentsByArgument && typeof currentCommentsByArgument === "object") {
          delete currentCommentsByArgument[argumentIdString];
        }

        const state = getState(debateId);
        delete state[argumentIdString];
        setState(debateId, state);

        if (Array.isArray(currentAllArguments)) {
          const nextArguments = currentAllArguments.filter(
            (argument) => String(argument?.id) !== argumentIdString
          );

          if (nextArguments.length !== currentAllArguments.length) {
            currentAllArguments = nextArguments;
            rerenderCurrentDebateArguments(debateId);
            refreshDebateScoreFromCurrentArguments();
            renderUnifiedVoicesSummary(debateId, currentAllArguments);
            renderUnifiedVotedArgumentsSummary(debateId, currentAllArguments);
            return;
          }
        }

        await loadDebate(debateId);
      } catch (error) {
        alert(error.message);
      }
    }
  });
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
window.handleHeadingDoubleClick = handleHeadingDoubleClick;
window.voteComment = voteComment;
window.editDebate = editDebate;window.editArgument = editArgument;
window.deleteDebate = deleteDebate;
window.deleteArgument = deleteArgument;
window.deleteComment = deleteComment;
window.submitComment = submitComment;
window.getDebateId = getDebateId;
window.copyDebateLink = copyDebateLink;
window.showDebateQrCode = showDebateQrCode;
window.showIdeaQrCode = showIdeaQrCode;
window.showIndexDebateQrCode = showIndexDebateQrCode;
window.openQrCodeFullscreen = openQrCodeFullscreen;
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

function getVisitorKey() {
  let key = localStorage.getItem("visitorKey");
  if (!key) {
    key = Math.random().toString(36).substring(2);
    localStorage.setItem("visitorKey", key);
  }
  return key;
}

function trackVisit() {
  fetch("/api/track-visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      visitorKey: getVisitorKey(),
      page: window.location.pathname
    })
  }).catch(() => {});
}

trackVisit();
window.toggleIdeaShareMenu = toggleIdeaShareMenu;
window.handleIdeaShareAction = handleIdeaShareAction;
window.closeIdeaShareMenus = closeIdeaShareMenus;
