import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: "100kb" }));

const systemPrompt = (level) => `You are Russian Tutor, a patient Russian-language teacher for an Uzbek-speaking learner.
The learner's level is ${level || "A1"}.
Speak primarily in Russian at the learner's level, then explain important corrections in Uzbek.
When the learner writes Russian:
1) Briefly respond naturally in Russian to continue the conversation.
2) If there are errors, show "To‘g‘rilangan variant:" and a corrected Russian sentence.
3) Explain the main grammar/vocabulary errors briefly in Uzbek.
4) Ask exactly one simple follow-up question in Russian.
If the learner writes Uzbek or English, help them express the thought in natural Russian.
Be encouraging, accurate, concise, and never shame mistakes. Do not claim that an incorrect sentence is correct.`;

app.get("/health", (_req, res) => res.json({ ok: true, service: "Russian Tutor Gemini backend" }));

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "Serverda GEMINI_API_KEY sozlanmagan." });
    }

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const level = ["A1", "A2", "B1"].includes(req.body?.level) ? req.body.level : "A1";
    if (!messages.length || messages.length > 40) {
      return res.status(400).json({ error: "messages ro‘yxati bo‘sh yoki juda uzun." });
    }

    const safeMessages = messages
      .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content.slice(0, 5000) }]
      }));

    if (!safeMessages.length || safeMessages[safeMessages.length - 1].role !== "user") {
      return res.status(400).json({ error: "Oxirgi xabar user xabari bo‘lishi kerak." });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const upstream = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt(level) }] },
          contents: safeMessages,
          generationConfig: { temperature: 0.6, maxOutputTokens: 900 }
        })
      }
    );

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Gemini provider error:", upstream.status, data?.error?.message || "unknown");
      return res.status(502).json({
        error: "Gemini AI xato qaytardi. API kaliti, model nomi va Google AI Studio limitlarini tekshiring."
      });
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      console.error("Gemini returned no text:", JSON.stringify(data?.promptFeedback || {}));
      return res.status(502).json({ error: "Gemini javobi bo‘sh keldi. Boshqa xabar yuborib ko‘ring." });
    }
    return res.json({ reply });
  } catch (err) {
    console.error("Request error:", err?.message || err);
    return res.status(500).json({ error: "Serverda kutilmagan xato yuz berdi." });
  }
});

const port = Number(process.env.PORT || 3000);
app.post("/api/live-token", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY serverda sozlanmagan"
      });
    }

    const now = Date.now();

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          uses: 1,
          expireTime: new Date(
            now + 30 * 60 * 1000
          ).toISOString(),
          newSessionExpireTime: new Date(
            now + 60 * 1000
          ).toISOString(),
          liveConnectConstraints: {
            model: "models/gemini-3.8-live",
            config: {
              sessionResumption: {},
              responseModalities: ["AUDIO"]
            }
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini token xatosi:", data);
      return res.status(response.status).json({
        error: "Gemini token yaratilmadi"
      });
    }

    return res.json({ token: data.name });
  } catch (error) {
    console.error("Live token xatosi:", error);
    return res.status(500).json({
      error: "Serverda xatolik yuz berdi"
    });
  }
});
app.listen(port, "0.0.0.0", () => console.log(`Russian Tutor Gemini backend listening on ${port}`));
