const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const TARGET_URL = "https://weplayapp.com/en-IN/recharge";
const PAGE_TIMEOUT_MS = 20000;
const RESULT_TIMEOUT_MS = 12000;

async function fetchWePlay(uid) {
  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1365, height: 900 },
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);
    page.setDefaultTimeout(7000);

    // Skip nonessential resources to reduce page load time.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      const url = req.url();
      if (
        ["image", "media", "font"].includes(type) ||
        /google-analytics|googletagmanager|doubleclick|hotjar|sentry|mixpanel/i.test(url)
      ) {
        return req.abort().catch(() => {});
      }
      req.continue().catch(() => {});
    });

    await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });

    const selectors = [
      "input.input",
      "input[placeholder*='WePlay ID' i]",
      "input[type='text']",
    ];
    let input = null;
    for (const selector of selectors) {
      try {
        await page.waitForSelector(selector, { visible: true, timeout: 1800 });
        input = await page.$(selector);
        if (input) break;
      } catch (_) {}
    }
    if (!input) throw new Error("WePlay UID input not found; page structure may have changed");

    await input.click();
    await input.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(
        el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await input.type(uid, { delay: 0 });

    let submitted = false;
    try {
      const button = await page.evaluateHandle(() => {
        const wanted = /search|lookup|submit|confirm|check/i;
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
        };
        return [...document.querySelectorAll("button, input[type=submit], [role=button]")]
          .find(el => visible(el) && (wanted.test(el.innerText || el.value || "") ||
                                     el.getAttribute("type") === "submit")) || null;
      });
      const element = button.asElement();
      if (element) {
        await element.click({ timeout: 1500 });
        submitted = true;
      }
      await button.dispose();
    } catch (_) {}
    if (!submitted) await input.press("Enter");

    await page.waitForFunction(() => {
      const nickname = document.querySelector(".nickname")?.textContent?.trim();
      const value = document.querySelector(".value")?.textContent?.trim();
      return Boolean(nickname && value);
    }, { timeout: RESULT_TIMEOUT_MS }).catch(() => {});

    const result = await page.evaluate(() => {
      const nickname = document.querySelector(".nickname")?.textContent?.trim() || "";
      const raw = document.querySelector(".value")?.textContent?.trim() || "";
      const match = raw.match(/Charm\s*:\s*([\d,]+)/i);
      const charm = match ? match[1].replace(/,/g, "") : raw.replace(/^Charm\s*:\s*/i, "").trim();
      let avatar = document.querySelector("img.avatar")?.currentSrc ||
                   document.querySelector("img.avatar")?.src || null;
      if (!avatar) {
        const image = [...document.images].find((img) =>
          /^https?:\/\/picuser[^/]*\.weplayapp\.com\//i.test(img.currentSrc || img.src || "")
        );
        avatar = image ? (image.currentSrc || image.src) : null;
      }
      return { nickname, charm, profile_pic_url: avatar };
    });

    if (!result.nickname) throw new Error("UID result not found; WePlay may have changed its page");
    return result;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function sendJson(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { status: "ok", runtime: "nodejs", browser: "bundled Chromium" });
  }

  if (req.method === "GET" && pathname === "/") {
    return sendJson(res, 200, {
      service: "WePlay UID Lookup API",
      endpoints: ["/health", "/lookup?uid=92661060"],
      methods: ["GET /lookup?uid=...", "POST /lookup with JSON {\"uid\":\"...\"}"],
    });
  }

  if (!["GET", "POST"].includes(req.method) || pathname !== "/lookup") {
    return sendJson(res, 404, { success: false, error: "Not found" });
  }

  let uid = "";
  if (req.method === "GET") {
    uid = String(new URL(req.url, "http://localhost").searchParams.get("uid") || "").trim();
  } else {
    try {
      let body = req.body;
      if (!body || typeof body !== "object") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      }
      uid = String(body.uid || "").trim();
    } catch (_) {
      return sendJson(res, 400, { success: false, error: "Invalid JSON body" });
    }
  }

  if (!/^\d{5,}$/.test(uid)) {
    return sendJson(res, 400, { success: false, error: "Invalid UID" });
  }

  const started = Date.now();
  try {
    const data = await fetchWePlay(uid);
    return sendJson(res, 200, {
      success: true,
      uid,
      ...data,
      cached: false,
      took_ms: Date.now() - started,
    });
  } catch (error) {
    console.error("WePlay lookup failed:", error?.stack || error);
    const message = String(error?.message || "Lookup failed");
    const status = /timeout/i.test(message) ? 504 : 502;
    return sendJson(res, status, {
      success: false,
      error: status === 504 ? "Timeout fetching UID" : "Failed to fetch UID",
      details: message,
    });
  }
};
