// Budget Dashboard — Average Budget Widget (iOS Home Screen)
// Requires the free "Scriptable" app from the App Store.
//
// SETUP:
// 1. Open Scriptable, tap + to create a new script, paste this whole file in.
// 2. Replace WIDGET_URL and WIDGET_KEY below with your real values.
//    (WIDGET_KEY is the same WIDGET_API_KEY used by the main Budget widget.)
// 3. Tap the wrench icon (bottom right) > run once to test.
// 4. Long-press your iPhone home screen > tap + (top left) > search "Scriptable"
//    > choose the medium widget size > add it.
// 5. Long-press the new widget > Edit Widget > set "Script" to this script's name.
//
// Shows your average monthly income/expenses/net, and your top spending
// categories by average monthly cost (the current in-progress month is
// excluded so it doesn't skew the numbers, same as the Averages page).

const WIDGET_URL = "https://your-domain.com/api/widget/averages";
const WIDGET_KEY = "PASTE_YOUR_WIDGET_API_KEY_HERE";

// Same palette as the pie chart on the Averages page, so the colored dots
// here line up with what you'd see on the web app.
const PIE_COLORS = [
  "#2761a0", "#c94235", "#2a8a5f", "#b87318", "#7a5ea8", "#c9598a",
  "#4a9d9c", "#9a8a3a", "#a05e27", "#6a7a3a"
];

async function getData() {
  const req = new Request(`${WIDGET_URL}?key=${WIDGET_KEY}`);
  req.timeoutInterval = 10;
  try {
    return await req.loadJSON();
  } catch (e) {
    return { error: true };
  }
}

function fmt(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

async function createWidget(data) {
  const family = config.widgetFamily || "large";
  const isLarge = family === "large";
  const maxCategories = family === "small" ? 3 : family === "medium" ? 5 : 10;

  const w = new ListWidget();
  w.backgroundColor = new Color("#000000");
  w.url = WIDGET_URL.replace("/api/widget/averages", "/averages.html");
  w.setPadding(isLarge ? 18 : 14, isLarge ? 18 : 14, isLarge ? 18 : 14, isLarge ? 18 : 14);

  if (data.error) {
    const t = w.addText("Couldn't load Avg Budget");
    t.font = Font.mediumSystemFont(13);
    t.textColor = new Color("#b8483c");
    return w;
  }

  const title = w.addText("📊 Avg Budget");
  title.font = Font.boldSystemFont(isLarge ? 18 : 15);
  title.textColor = new Color("#ffffff");
  w.addSpacer(isLarge ? 6 : 4);

  if (data.monthCount === 0) {
    w.addSpacer(6);
    const none = w.addText("No data logged yet");
    none.font = Font.systemFont(12);
    none.textColor = new Color("#c7c7c7");
    return w;
  }

  const subtitle = w.addText(`across ${data.monthCount} month${data.monthCount === 1 ? "" : "s"}`);
  subtitle.font = Font.systemFont(isLarge ? 12 : 10);
  subtitle.textColor = new Color("#8a8a8a");
  w.addSpacer(isLarge ? 10 : 6);

  const netRow = w.addStack();
  netRow.layoutHorizontally();
  netRow.centerAlignContent();
  const netLabel = netRow.addText(`Net: ${fmt(data.avgNet)}/mo`);
  netLabel.font = Font.mediumSystemFont(isLarge ? 15 : 12);
  netLabel.textColor = data.avgNet >= 0 ? new Color("#3f8f5f") : new Color("#b8483c");
  netRow.addSpacer(8);
  const inOut = netRow.addText(`${fmt(data.avgIncome)} in · ${fmt(data.avgExpense)} out`);
  inOut.font = Font.systemFont(isLarge ? 12 : 10);
  inOut.textColor = new Color("#c7c7c7");

  w.addSpacer(isLarge ? 14 : 8);

  if (data.topCategories.length === 0) {
    const none = w.addText("No expenses logged yet");
    none.font = Font.systemFont(12);
    none.textColor = new Color("#c7c7c7");
  } else {
    const shown = data.topCategories.slice(0, maxCategories);
    for (let i = 0; i < shown.length; i++) {
      const cat = shown[i];
      const row = w.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();

      const dot = row.addText("●");
      dot.font = Font.systemFont(isLarge ? 13 : 10);
      dot.textColor = new Color(PIE_COLORS[i % PIE_COLORS.length]);
      row.addSpacer(6);

      const name = row.addText(cat.name);
      name.font = Font.mediumSystemFont(isLarge ? 14 : 12);
      name.textColor = new Color("#ffffff");
      name.lineLimit = 1;

      row.addSpacer();

      const amt = row.addText(fmt(cat.avg));
      amt.font = Font.systemFont(isLarge ? 13 : 11);
      amt.textColor = new Color("#c7c7c7");
      amt.rightAlignText();

      w.addSpacer(isLarge ? 8 : 3);
    }

    if (data.topCategories.length > shown.length) {
      w.addSpacer(2);
      const more = w.addText(`+${data.topCategories.length - shown.length} more`);
      more.font = Font.systemFont(10);
      more.textColor = new Color("#8a8a8a");
    }
  }

  return w;
}

const data = await getData();
const widget = await createWidget(data);

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentLarge();
}
Script.complete();
