let DEBUG = true;

let tabData = { date: '', opened: 0, closed: 0 };
let deltaHistory = []; // Store final deltas for up to 7 days

// Pause counter on addon startup to avoid counting tabs during browser startup/restoration
let startupCounterPause = true; // Track if startup counter pause is still active
const STARTUP_DELAY_MS = 30000; // wait before polling begins
const STABILITY_CHECKS = 3; // consecutive stable readings required
const STABILITY_INTERVAL_MS = 1500;

function logDebug(...args) {
  if (DEBUG) console.log(...args);
}

function waitForTabCountToStabilize(previousCount = -1, stableRounds = 0) {
  return browser.tabs.query({}).then((tabs) => {
    if (tabs.length === previousCount) {
      stableRounds++;
      logDebug('Stable period detected, stable rounds: ', stableRounds);
      if (stableRounds >= STABILITY_CHECKS) {
        startupCounterPause = false;
        logDebug('Required STABILITY_CHECKS count reached, startup counter pause deactivated');
        return;
      }
    } else {
      stableRounds = 0;
    }
    logDebug('Starting the stability check #', stableRounds + 1);
    return new Promise((r) => setTimeout(r, STABILITY_INTERVAL_MS)).then(() =>
      waitForTabCountToStabilize(tabs.length, stableRounds),
    );
  });
}

function updateBadgeAndTooltip() {
  if (!tabData) {
    console.error('tabData is undefined');
    return;
  }
  let delta = tabData.opened - tabData.closed;
  let color = delta < 0 ? 'green' : delta > 0 ? 'red' : 'gray';
  let tooltip = `\u0394 ${delta} / +${tabData.opened} / -${tabData.closed}`;

  browser.browserAction
    .setBadgeText({ text: String(delta) })
    .then(() => {
      logDebug(`Badge updated to: ${delta}`);
    })
    .catch((error) => console.error(`Failed to set badge text: ${error}`));

  browser.browserAction
    .setBadgeBackgroundColor({ color: color })
    .then(() => {
      //logDebug(`Badge color set to: ${color}`);
    })
    .catch((error) => console.error(`Failed to set badge color: ${error}`));

  browser.browserAction
    .setTitle({ title: tooltip })
    .then(() => {
      logDebug(`Tooltip updated to: ${tooltip}`);
    })
    .catch((error) => console.error(`Failed to set tooltip: ${error}`));
}

function scheduleMidnightReset() {
  try {
    let now = new Date();
    let midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // Next midnight
    let timeUntilMidnight = midnight - now;
    browser.alarms.create('midnightReset', {
      delayInMinutes: timeUntilMidnight / 60000,
    });
    logDebug('Midnight reset alarm scheduled for:', midnight);
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
      logDebug(`Final delta saved to history: { date: "${previousDate}", delta: ${delta} }`);
    })
    .catch((error) => console.error(`Failed to save deltaHistory: ${error}`));
}

function checkAndHandleDateChange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const today = `${year}-${month}-${day}`;
  logDebug('Calculated today:', today);

  if (!tabData.date) {
    logDebug('No previous date in tabData, initializing with today:', today);
    tabData = { date: today, opened: 0, closed: 0 };
  } else if (tabData.date !== today) {
    logDebug('Date changed from:', tabData.date, 'to:', today);
    saveFinalDelta(tabData.date); // Save delta for previous day
    tabData = { date: today, opened: 0, closed: 0 };
    browser.storage.local
      .set({ tabData })
      .then(() => {
        logDebug('tabData reset and stored for current day:', today);
      })
      .catch((error) => console.error(`Failed to store tabData: ${error}`));
  } else {
    logDebug('No date change, preserving tabData:', tabData);
  }
  updateBadgeAndTooltip();
  scheduleMidnightReset();
}

// Startup

startupCounterPause = true;
logDebug('Startup counter pause timer started');
setTimeout(() => waitForTabCountToStabilize(), STARTUP_DELAY_MS);

// Event Listeners

browser.tabs.onCreated.addListener(() => {
  if (startupCounterPause) {
    logDebug('Tab created during counter startup pause, ignoring');
    return;
  }
  logDebug('Tab created event detected');
  tabData.opened++;
  browser.storage.local
    .set({ tabData })
    .then(() => {
      logDebug('Incremented opened tabs, stored tabData');
    })
    .catch((error) => console.error(`Failed to store tabData: ${error}`));
  updateBadgeAndTooltip();
});

browser.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (startupCounterPause) {
    logDebug('Tab removed during counter startup pause, ignoring');
    return;
  }

  // Ignore tabs that are closing because the whole window/browser is shutting down
  if (removeInfo.isWindowClosing) {
    logDebug('Tab removed due to window closing, ignoring');
    return;
  }

  logDebug('Tab removed event detected');
  tabData.closed++;
  browser.storage.local
    .set({ tabData })
    .then(() => {
      logDebug('Incremented closed tabs, stored tabData');
    })
    .catch((error) => console.error(`Failed to store tabData: ${error}`));
  updateBadgeAndTooltip();
});

// Initialize on startup
browser.storage.local
  .get(['tabData', 'deltaHistory'])
  .then((result) => {
    logDebug('Loaded data:', result);
    tabData = result.tabData || { date: '', opened: 0, closed: 0 };
    deltaHistory = result.deltaHistory || [];

    // Handle date change before recording initial state
    checkAndHandleDateChange();
  })
  .catch((error) => console.error(`Failed to load tabData or deltaHistory: ${error}`));

// Reset at midnight
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'midnightReset') {
    logDebug('Midnight reset triggered');
    checkAndHandleDateChange();
  }
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkDateChange') {
    logDebug('Received checkDateChange message from popup');
    checkAndHandleDateChange();
    sendResponse({ status: 'checked' });
  } else if (message.action === 'clearDailyCount') {
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
