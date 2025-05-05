browser.storage.local.get(["tabData", "deltaHistory"])
  .then((result) => {
    const tabData = result.tabData || { date: "", opened: 0, closed: 0 };
    const deltaHistory = result.deltaHistory || [];
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    console.log("Popup calculated today:", today);
    const historyBody = document.getElementById("history-body");
    const deltaSum = document.getElementById("delta-sum");

    // Prepare data: current day + historical deltas
    const currentDelta = tabData.opened - tabData.closed;
    // Filter invalid entries (e.g., missing date)
    const entries = [{ date: today, delta: currentDelta }, ...deltaHistory.filter(entry => entry.date)];
    console.log("Popup entries:", entries);

    // Sort by date descending and limit to 7 entries
    entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    const uniqueEntries = entries.slice(0, 7); // Keep only 7 latest entries
    console.log("Popup unique entries:", uniqueEntries);

    // Populate table
    historyBody.innerHTML = "";
    for (const entry of uniqueEntries) {
      const row = document.createElement("tr");
      const dateCell = document.createElement("td");
      const deltaCell = document.createElement("td");
      const dateObj = new Date(entry.date);
      const dayShorthand = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][dateObj.getDay()];
      const formattedDate = `${entry.date.replace(/-/g, '.')}`;
      dateCell.textContent = `${dayShorthand} (${formattedDate})`;
      deltaCell.textContent = entry.delta;
      deltaCell.className = entry.delta > 0 ? "positive" : entry.delta < 0 ? "negative" : "zero";
      row.appendChild(dateCell);
      row.appendChild(deltaCell);
      historyBody.appendChild(row);
    }

    // Calculate and display sum
    const sum = uniqueEntries.reduce((acc, entry) => acc + entry.delta, 0);
    deltaSum.textContent = sum;
    deltaSum.className = sum > 0 ? "positive" : sum < 0 ? "negative" : "zero";
  })
  .catch((error) => console.error(`Failed to load tabData or deltaHistory for popup: ${error}`));