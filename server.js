// ============================================================
//  Безопасный сервер-посредник для Telegram-бота
//  Запуск: node server.js  (или через PM2 / Railway / Render)
// ============================================================

const express = require("express");
const cors    = require("cors");
require("dotenv").config();          // читает .env файл

const app = express();
app.use(express.json());

// ─── CORS: разрешить только твой сайт ────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // разрешить запросы без origin (Postman, curl) только в dev
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error("Blocked by CORS"));
  }
}));

// ─── Секреты из .env — снаружи НЕ видны ──────────────────────
const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("❌  Укажи TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в файле .env");
  process.exit(1);
}

// ─── Простая защита от спама (rate-limit) ─────────────────────
const rateLimitMap = new Map();

function rateLimit(ip, limitMs = 60_000, maxRequests = 5) {
  const now  = Date.now();
  const data = rateLimitMap.get(ip) || { count: 0, start: now };

  if (now - data.start > limitMs) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;          // не заблокирован
  }
  data.count++;
  rateLimitMap.set(ip, data);
  return data.count > maxRequests;  // true = заблокирован
}

// ─── Отправка сообщения в Telegram ───────────────────────────
async function sendToTelegram(text) {
  const url  = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id:    CHAT_ID,
    text:       text,
    parse_mode: "HTML"
  });

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.description || "Telegram API error");
  }
  return res.json();
}

// ─── Маршрут — принимает данные с сайта ───────────────────────
app.post("/send", async (req, res) => {
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

  // Rate limit: не больше 5 отправок в минуту с одного IP
  if (rateLimit(clientIp)) {
    return res.status(429).json({ ok: false, error: "Слишком много запросов. Подождите." });
  }

  // Сайт Jewel Bliss шлёт готовый HTML-текст в поле message
  // Обычные формы могут слать отдельные поля name/phone/email
  const { message, name, phone, email, subject } = req.body;

  if (!message && !name && !email) {
    return res.status(400).json({ ok: false, error: "Форма пустая" });
  }

  // Если сайт прислал готовое сообщение — отправляем как есть
  // Иначе — формируем из отдельных полей
  const text = message || [
    `<b>📬 Новая заявка с сайта</b>`,
    subject ? `<b>Тема:</b> ${esc(subject)}` : null,
    name    ? `<b>Имя:</b> ${esc(name)}`      : null,
    phone   ? `<b>Телефон:</b> ${esc(phone)}` : null,
    email   ? `<b>Email:</b> ${esc(email)}`   : null,
    `\n<i>IP: ${clientIp} • ${new Date().toLocaleString("ru-RU")}</i>`
  ].filter(Boolean).join("\n");

  try {
    await sendToTelegram(text);
    res.json({ ok: true, message: "Сообщение отправлено!" });
  } catch (err) {
    console.error("Telegram error:", err.message);
    res.status(500).json({ ok: false, error: "Ошибка отправки. Попробуйте позже." });
  }
});

// ─── Healthcheck ──────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true }));

// ─── Старт ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅  Сервер запущен: http://localhost:${PORT}`));

// Экранирование HTML для Telegram
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
