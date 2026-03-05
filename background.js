let tabData = { date: "", opened: 0, closed: 0 };
let deltaHistory = []; // Store final deltas for up to 7 days

// Grace period to avoid counting tabs during browser startup/restoration
let gracePeriodActive = false; // Track if grace period is still active
const STARTUP_DELAY_MS = 30000; // wait before polling begins
const STABILITY_CHECKS = 3; // consecutive stable readings required
const STABILITY_INTERVAL_MS = 1500;

function waitForTabCountToStabilize(previousCount = -1, stableRounds = 0) {
  return browser.tabs.query({}).then((tabs) => {
    if (tabs.length === previousCount) {
      stableRounds++;
      if (stableRounds >= STABILITY_CHECKS) {
        gracePeriodActive = false;
        return;
      }
    } else {
      stableRounds = 0;
    }
    return new Promise((r) => setTimeout(r, STABILITY_INTERVAL_MS)).then(() =>
      waitForTabCountToStabilize(tabs.length, stableRounds)
    );
  });
}

function updateBadgeAndTooltip() {
  if (!tabData) {
    console.error("tabData is undefined");
    return;
  }
  let delta = tabData.opened - tabData.closed;
  let color = delta < 0 ? "green" : delta > 0 ? "red" : "gray";
  let tooltip = `\u0394 ${delta} / +${tabData.opened} / -${tabData.closed}`;

  browser.browserAction
    .setBadgeText({ text: String(delta) })
    .then(() => {
      //console.log(`Badge updated to: ${delta}`)
    })
    .catch((error) => console.error(`Failed to set badge text: ${error}`));

  browser.browserAction
    .setBadgeBackgroundColor({ color: color })
    .then(() => {
      //console.log(`Badge color set to: ${color}`)
    })
    .catch((error) => console.error(`Failed to set badge color: ${error}`));

  browser.browserAction
    .setTitle({ title: tooltip })
    .then(() => {
      //console.log(`Tooltip updated to: ${tooltip}`)
    })
    .catch((error) => console.error(`Failed to set tooltip: ${error}`));
}

function scheduleMidnightReset() {
  try {
    let now = new Date();
    let midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // Next midnight
    let timeUntilMidnight = midnight - now;
    browser.alarms.create("midnightReset", { delayInMinutes: timeUntilMidnight / 60000 });
    //console.log("Midnight reset alarm scheduled for:", midnight);
  } catch (error) {
    console.error(`Failed to schedule midnight reset alarm: ${error}`);
  }
}

function saveFinalDelta(previousDate) {
  let delta = tabData.opened - tabData.closed;
  if (deltaHistory.some((entry) => entry.date === previousDate)) {
    console.error(`Attempted to add duplicate delta entry for date: ${previousDate}`);
    return;
  }
  deltaHistory.push({ date: previousDate, delta });
  browser.storage.local
    .set({ deltaHistory })
    .then(() => {
      //console.log(`Final delta saved to history: { date: "${previousDate}", delta: ${delta} }`)
    })
    .catch((error) => console.error(`Failed to save deltaHistory: ${error}`));
}

function checkAndHandleDateChange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const today = `${year}-${month}-${day}`;
  //console.log("Calculated today:", today);

  if (!tabData.date) {
    //console.log("No previous date in tabData, initializing with today:", today);
    tabData = { date: today, opened: 0, closed: 0 };
  } else if (tabData.date !== today) {
    //console.log("Date changed from:", tabData.date, "to:", today);
    saveFinalDelta(tabData.date); // Save delta for previous day
    tabData = { date: today, opened: 0, closed: 0 };
    browser.storage.local
      .set({ tabData })
      .then(() => {
        //console.log("tabData reset and stored for current day:", today)
      })
      .catch((error) => console.error(`Failed to store tabData: ${error}`));
  } else {
    //console.log("No date change, preserving tabData:", tabData);
  }
  updateBadgeAndTooltip();
  scheduleMidnightReset();
}

// -- Event Listeners --

browser.tabs.onCreated.addListener(() => {
  if (gracePeriodActive) {
    //console.log("Tab created during grace period, ignoring");
    return;
  }
  //console.log("Tab created event detected");
  tabData.opened++;
  browser.storage.local
    .set({ tabData })
    .then(() => {
      //console.log("Incremented opened tabs, stored tabData")
    })
    .catch((error) => console.error(`Failed to store tabData: ${error}`));
  updateBadgeAndTooltip();
});

browser.tabs.onRemoved.addListener(() => {
  if (gracePeriodActive) {
    //console.log("Tab removed during grace period, ignoring");
    return;
  }
  //console.log("Tab removed event detected");
  tabData.closed++;
  browser.storage.local
    .set({ tabData })
    .then(() => {
      //console.log("Incremented closed tabs, stored tabData")
    })
    .catch((error) => console.error(`Failed to store tabData: ${error}`));
  updateBadgeAndTooltip();
});

// Initialize on startup
browser.storage.local
  .get(["tabData", "deltaHistory"])
  .then((result) => {
    //console.log("Loaded data:", result);
    tabData = result.tabData || { date: "", opened: 0, closed: 0 };
    deltaHistory = result.deltaHistory || [];

    // Handle date change before recording initial state
    checkAndHandleDateChange();
  })
  .catch((error) => console.error(`Failed to load tabData or deltaHistory: ${error}`));

// Reset at midnight
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "midnightReset") {
    //console.log("Midnight reset triggered");
    checkAndHandleDateChange();
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "checkDateChange") {
    //console.log("Received checkDateChange message from popup");
    checkAndHandleDateChange();
    sendResponse({ status: "checked" });
  } else if (message.action === "clearDailyCount") {
    if (tabData.date === message.date) {
      // Reset current day
      tabData.opened = 0;
      tabData.closed = 0;
      browser.storage.local.set({ tabData }).then(() => {
        updateBadgeAndTooltip();
        sendResponse({ success: true });
      });
    } else {
      // Reset historical day: find the entry and set delta to 0
      deltaHistory = deltaHistory.map((entry) => {
        if (entry.date === message.date) {
          return { ...entry, delta: 0 };
        }
        return entry;
      });
      browser.storage.local.set({ deltaHistory }).then(() => {
        sendResponse({ success: true });
      });
    }
    return true; // Keep async channel open
  }
});

browser.runtime.onStartup.addListener(() => {
  gracePeriodActive = true;
  setTimeout(() => waitForTabCountToStabilize(), STARTUP_DELAY_MS);
});
