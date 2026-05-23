const express = require("express");
const cors    = require("cors");
require("dotenv").config();

const app = express();
app.use(express.json());

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(o => o.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (ALLOWED_ORIGINS.includes("*") || !origin || ALLOWED_ORIGINS.includes(origin))
      return cb(null, true);
    cb(new Error("Blocked by CORS"));
  }
}));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
// Список всех получателей через запятую в .env
// TELEGRAM_CHAT_IDS=7953933230,1626941960
const CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || "")
  .split(",").map(id => id.trim()).filter(Boolean);

if (!BOT_TOKEN || !CHAT_IDS.length) {
  console.error("❌  Укажи TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_IDS в файле .env");
  process.exit(1);
}

// Rate limit
const rateLimitMap = new Map();
function rateLimit(ip, limitMs = 60_000, maxRequests = 5) {
  const now  = Date.now();
  const data = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - data.start > limitMs) { rateLimitMap.set(ip, { count: 1, start: now }); return false; }
  data.count++;
  rateLimitMap.set(ip, data);
  return data.count > maxRequests;
}

// Отправка на один chat_id
async function sendTo(chatId, text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.description || "Telegram API error");
  }
  return res.json();
}

// Отправка всем получателям сразу
async function sendToAll(text) {
  return Promise.all(CHAT_IDS.map(id => sendTo(id, text)));
}

// Маршрут
app.post("/send", async (req, res) => {
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  if (rateLimit(clientIp)) {
    return res.status(429).json({ ok: false, error: "Слишком много запросов. Подождите." });
  }

  const { message, name, phone, email, subject } = req.body;

  if (!message && !name && !email) {
    return res.status(400).json({ ok: false, error: "Форма пустая" });
  }

  const text = message || [
    `<b>📬 Новая заявка с сайта</b>`,
    subject ? `<b>Тема:</b> ${esc(subject)}` : null,
    name    ? `<b>Имя:</b> ${esc(name)}`      : null,
    phone   ? `<b>Телефон:</b> ${esc(phone)}` : null,
    email   ? `<b>Email:</b> ${esc(email)}`   : null,
    `\n<i>IP: ${clientIp} • ${new Date().toLocaleString("ru-RU")}</i>`
  ].filter(Boolean).join("\n");

  try {
    await sendToAll(text);
    res.json({ ok: true, message: "Сообщение отправлено!" });
  } catch (err) {
    console.error("Telegram error:", err.message);
    res.status(500).json({ ok: false, error: "Ошибка отправки. Попробуйте позже." });
  }
});

app.get("/health", (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅  Сервер запущен: http://localhost:${PORT}`));

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
