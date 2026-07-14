const { _electron: electron } = require("playwright");

(async () => {
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      executablePath: "C:/matrixblock-r4/MATRIXblock Mini R4.exe",
      timeout: 15000,
    });

    const win = await app.firstWindow();

    win.on("console", msg => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await win.waitForLoadState("domcontentloaded", { timeout: 12000 });

    // Wait for full app initialization (canvas elements appear after JS runs)
    await win.waitForTimeout(6000);

    const title = await win.title();
    const bodyText = await win.locator("body").innerText({ timeout: 3000 }).catch(() => "(no text)");
    const hasCanvas = await win.locator("canvas").count();
    const navLogo = await win.locator("#createNavLink, #fileMenu, .navbar").count();

    console.log("TITLE:", title);
    console.log("BODY has text:", bodyText.length > 10);
    console.log("Canvas count:", hasCanvas);
    console.log("Nav elements found:", navLogo);

    if (errors.length > 0) {
      console.log("CONSOLE ERRORS:", errors.length);
      errors.slice(0, 5).forEach(e => console.log("  ERR:", e.slice(0, 200)));
    } else {
      console.log("CONSOLE ERRORS: 0");
    }

    await app.close();
    console.log("STATUS: OK - app opened correctly");
  } catch (e) {
    console.log("STATUS: FAILED -", e.message.split("\n")[0]);
    if (errors.length > 0) errors.slice(0, 3).forEach(e => console.log("  ERR:", e.slice(0, 200)));
    if (app) await app.close().catch(() => {});
  }
})();
