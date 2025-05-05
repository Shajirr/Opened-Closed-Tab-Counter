let tabData = { date: "", opened: 0, closed: 0 }; // Initialize early to avoid undefined
let deltaHistory = []; // Store final deltas for up to 7 days

function updateBadgeAndTooltip() {
  if (!tabData) {
    console.error("tabData is undefined");
    return;
  }
  let delta = tabData.opened - tabData.closed;
  let color = delta < 0 ? "green" : delta > 0 ? "red" : "gray";
  let tooltip = `\u0394 ${delta} / +${tabData.opened} / -${tabData.closed}`;

  // Update badge text
  browser.browserAction.setBadgeText({ text: String(delta) })
    .then(() => console.log(`Badge updated to: ${delta}`))
    .catch((error) => console.error(`Failed to set badge text: ${error}`));

  // Update badge color
  browser.browserAction.setBadgeBackgroundColor({ color: color })
    .then(() => console.log(`Badge color set to: ${color}`))
    .catch((error) => console.error(`Failed to set badge color: ${error}`));

  // Update tooltip
  browser.browserAction.setTitle({ title: tooltip })
    .then(() => console.log(`Tooltip updated to: ${tooltip}`))
    .catch((error) => console.error(`Failed to set tooltip: ${error}`));
}

function scheduleMidnightReset() {
  try {
    let now = new Date();
    let midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0); // Next midnight
    let timeUntilMidnight = midnight - now;
    browser.alarms.create("midnightReset", { delayInMinutes: timeUntilMidnight / 60000 });
    console.log("Midnight reset alarm scheduled");
  } catch (error) {
    console.error(`Failed to schedule midnight reset alarm: ${error}`);
  }
}

// Save final delta and update history
function saveFinalDelta() {
  let delta = tabData.opened - tabData.closed;
  // Check if date already exists in deltaHistory
  if (deltaHistory.some(entry => entry.date === tabData.date)) {
    console.error(`Attempted to add duplicate delta entry for date: ${tabData.date}`);
    return;
  }
  deltaHistory.push({ date: tabData.date, delta });
  browser.storage.local.set({ deltaHistory })
    .then(() => console.log(`Final delta saved to history: { date: "${tabData.date}", delta: ${delta} }`))
    .catch((error) => console.error(`Failed to save deltaHistory: ${error}`));
}

// Tab event listeners (registered immediately)
browser.tabs.onCreated.addListener(() => {
  console.log("Tab created event detected");
  tabData.opened++;
  browser.storage.local.set({ tabData })
    .then(() => console.log("Incremented opened tabs, stored tabData"))
    .catch((error) => console.error(`Failed to store tabData: ${error}`));
  updateBadgeAndTooltip();
});

browser.tabs.onRemoved.addListener(() => {
  console.log("Tab removed event detected");
  tabData.closed++;
  browser.storage.local.set({ tabData })
    .then(() => console.log("Incremented closed tabs, stored tabData"))
    .catch((error) => console.error(`Failed to store tabData: ${error}`));
  updateBadgeAndTooltip();
});

// Initialize on startup
browser.storage.local.get(["tabData", "deltaHistory"])
  .then((result) => {
    console.log("Loaded data:", result);
    tabData = result.tabData || { date: "", opened: 0, closed: 0 };
    deltaHistory = result.deltaHistory || [];
    // Calculate today using local date components
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    console.log("Calculated today:", today);
    if (tabData.date && tabData.date !== today) {
      console.log("Date changed, saving final delta for previous day:", tabData.date);
      saveFinalDelta();
      tabData = { date: today, opened: 0, closed: 0 };
      browser.storage.local.set({ tabData })
        .then(() => console.log("tabData reset and stored for current day:", today))
        .catch((error) => console.error(`Failed to store tabData: ${error}`));
    } else {
      console.log("No date change, preserving tabData:", tabData);
    }
    updateBadgeAndTooltip();
    scheduleMidnightReset();
  })
  .catch((error) => console.error(`Failed to load tabData or deltaHistory: ${error}`));

// Reset at midnight
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "midnightReset") {
    console.log("Midnight reset triggered");
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    console.log("Calculated today at midnight:", today);
    if (tabData.date && tabData.date !== today) {
      console.log("Saving final delta for previous day:", tabData.date);
      saveFinalDelta();
    }
    tabData = { date: today, opened: 0, closed: 0 };
    browser.storage.local.set({ tabData })
      .then(() => console.log("tabData reset and stored at midnight:", today))
      .catch((error) => console.error(`Failed to store tabData: ${error}`));
    updateBadgeAndTooltip();
    scheduleMidnightReset();
  }
});