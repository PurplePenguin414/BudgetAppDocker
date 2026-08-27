// Budget Dashboard — iOS Home Screen Widget
// Requires the free "Scriptable" app from the App Store.
//
// SETUP:
// 1. Open Scriptable, tap + to create a new script, paste this whole file in.
// 2. Replace WIDGET_URL and WIDGET_KEY below with your real values.
//    (WIDGET_KEY is the WIDGET_API_KEY you set in the dashboard's .env file.)
// 3. Tap the wrench icon (bottom right) > run once to test.
// 4. Long-press your iPhone home screen > tap + (top left) > search "Scriptable"
//    > choose any widget size (small, medium, or large) > add it.
// 5. Long-press the new widget > Edit Widget > set "Script" to this script's name.
//
// Adapts to whatever size you pick — shows fewer categories on Small/Medium,
// more on Large, with "+N more" when there isn't room for all of them.
// The widget refreshes periodically on iOS's own schedule (usually every
// 15-60 min); tap the widget to jump straight into the app.

const WIDGET_URL = "https://your-domain.com/api/widget/summary";
const WIDGET_KEY = "PASTE_YOUR_WIDGET_API_KEY_HERE";

async function getData() {
  const req = new Request(`${WIDGET_URL}?key=${WIDGET_KEY}`);
  req.timeoutInterval = 10;
  try {
    return await req.loadJSON();
  } catch (e) {
    return { error: true };
  }
}

function colorFor(status) {
  if (status === "over") return new Color("#b8483c");
  if (status === "near") return new Color("#b8862c");
  return new Color("#3f8f5f");
}

function pctLabelFor(cat) {
  return `${cat.pct}%`;
}

function fmt(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

async function createWidget(data) {
  const family = config.widgetFamily || "large";
  const isLarge = family === "large";
  const maxCategories = family === "small" ? 2 : family === "medium" ? 3 : 8;

  const w = new ListWidget();
  w.backgroundColor = new Color("#000000");
  w.url = data.app_url || WIDGET_URL.replace("/api/widget/summary", "/index.html");
  w.setPadding(isLarge ? 18 : 14, isLarge ? 18 : 14, isLarge ? 18 : 14, isLarge ? 18 : 14);

  if (data.error) {
    const t = w.addText("Couldn't load Budget Dashboard");
    t.font = Font.mediumSystemFont(13);
    t.textColor = new Color("#b8483c");
    return w;
  }

  const title = w.addText("💰 Budget");
  title.font = Font.boldSystemFont(isLarge ? 18 : 15);
  title.textColor = new Color("#ffffff");
  w.addSpacer(isLarge ? 8 : 6);

  const inOut = w.addText(`${fmt(data.income)} in · ${fmt(data.expense)} out`);
  inOut.font = Font.systemFont(isLarge ? 13 : 11);
  inOut.textColor = new Color("#c7c7c7");
  w.addSpacer(isLarge ? 5 : 3);

  const netRow = w.addStack();
  netRow.layoutHorizontally();
  netRow.centerAlignContent();
  const netLabel = netRow.addText(`Net: ${fmt(data.net)}`);
  netLabel.font = Font.mediumSystemFont(isLarge ? 15 : 12);
  netLabel.textColor = data.net >= 0 ? new Color("#3f8f5f") : new Color("#b8483c");
  netRow.addSpacer(8);
  const rateLabel = netRow.addText(`${data.savingsRate}% saved`);
  rateLabel.font = Font.systemFont(isLarge ? 13 : 11);
  rateLabel.textColor = new Color("#c7c7c7");

  w.addSpacer(isLarge ? 12 : 8);

  if (data.needs_attention.length === 0) {
    const ok = w.addText("No spending logged against targets yet");
    ok.font = Font.systemFont(isLarge ? 13 : 11);
    ok.textColor = new Color("#c7c7c7");
  } else {
    const summary = w.addText(
      `${data.counts.over_target} over · ${data.counts.near_target} near · ${data.counts.on_track} on track`
    );
    summary.font = Font.systemFont(isLarge ? 13 : 11);
    summary.textColor = new Color("#c7c7c7");
    w.addSpacer(isLarge ? 8 : 6);

    const shown = data.needs_attention.slice(0, maxCategories);
    for (const cat of shown) {
      const row = w.addStack();
      row.layoutHorizontally();
      row.centerAlignContent();

      const dot = row.addText("●");
      dot.font = Font.systemFont(isLarge ? 13 : 10);
      dot.textColor = colorFor(cat.status);
      row.addSpacer(6);

      const name = row.addText(cat.name);
      name.font = Font.mediumSystemFont(isLarge ? 14 : 12);
      name.textColor = new Color("#ffffff");
      name.lineLimit = 1;

      row.addSpacer();

      const pct = row.addText(pctLabelFor(cat));
      pct.font = Font.systemFont(isLarge ? 13 : 10);
      pct.textColor = colorFor(cat.status);
      pct.rightAlignText();

      w.addSpacer(isLarge ? 7 : 3);
    }

    if (data.needs_attention.length > shown.length) {
      w.addSpacer(2);
      const more = w.addText(`+${data.needs_attention.length - shown.length} more`);
      more.font = Font.systemFont(isLarge ? 12 : 10);
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
