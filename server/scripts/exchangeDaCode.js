/**
 * Одноразовый обмен code → token для DonationAlerts.
 * Запуск: node server/scripts/exchangeDaCode.js "<code из URL>"
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const code = process.argv[2];
if (!code || !String(code).trim()) {
  // eslint-disable-next-line no-console
  console.error("Usage: node server/scripts/exchangeDaCode.js \"<authorization_code>\"");
  process.exit(1);
}

const cid = process.env.DONATIONALERTS_CLIENT_ID;
const sec = process.env.DONATIONALERTS_CLIENT_SECRET;
const red = process.env.DONATIONALERTS_REDIRECT_URI;

async function main() {
  if (!cid || !sec || !red) {
    // eslint-disable-next-line no-console
    console.error("В .env должны быть DONATIONALERTS_CLIENT_ID, DONATIONALERTS_CLIENT_SECRET, DONATIONALERTS_REDIRECT_URI");
    process.exit(1);
  }
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cid,
    client_secret: sec,
    redirect_uri: red,
    code: String(code).trim(),
  });
  const { data, status } = await axios.post("https://www.donationalerts.com/oauth/token", body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    validateStatus: () => true,
    timeout: 20000,
  });
  if (status >= 400 || !data.access_token) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(data, null, 2));
    process.exit(1);
  }
  const envPath = path.join(__dirname, "..", "..", ".env");
  let raw = fs.readFileSync(envPath, "utf8");
  const tokenLine = `DONATIONALERTS_ACCESS_TOKEN=${data.access_token}`;
  if (/^DONATIONALERTS_ACCESS_TOKEN=/m.test(raw)) {
    raw = raw.replace(/^DONATIONALERTS_ACCESS_TOKEN=.*$/m, tokenLine);
  } else if (/^#\s*DONATIONALERTS_ACCESS_TOKEN=/m.test(raw)) {
    raw = raw.replace(/^#\s*DONATIONALERTS_ACCESS_TOKEN=.*$/m, tokenLine);
  } else {
    raw += `\n${tokenLine}\n`;
  }
  fs.writeFileSync(envPath, raw, "utf8");
  // eslint-disable-next-line no-console
  console.log("OK: DONATIONALERTS_ACCESS_TOKEN записан в .env");
  // eslint-disable-next-line no-console
  console.log("expires_in:", data.expires_in, "refresh_token:", data.refresh_token ? "(есть)" : "(нет)");
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e.response?.data || e.message || e);
  process.exit(1);
});
