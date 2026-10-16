
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const PORT = process.env.PORT || 3000;

const systemPrompt = (level = "A1") => `
You are Russian Tutor, a patient Russian-language teacher
for an Uzbek-speaking learner.

The learner's Russian level is ${level}.

Rules:
- Respond primarily in simple Russian appropriate to the learner's level.
- Explain important mistakes in Uzbek.
- When correcting a sentence, include:
  To'g'rilangan variant:
- Briefly explain why the correction is needed.
- Ask exactly one simple follow-up question in Russian.
- Help translate Uzbek or English thoughts into natural Russian.
- Be encouraging, concise, and accurate.
- Never say an incorrect sentence is correct.
`;

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Russian Tutor Gemini backend"
  });
});

// Oddiy matnli AI suhbat
app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Render muhitida GEMINI_API_KEY sozlanmagan."
      });
    }

    const { message, history = [], level = "A1" } = req.body || {};

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: "message maydoni bo'sh bo'lmasligi kerak."
      });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const contents = [];

    if (Array.isArray(history)) {
      for (const item of history) {
        if (
          item &&
          typeof item.text === "string" &&
          ["user", "model"].includes(item.role)
        ) {
          contents.push({
            role: item.role,
            parts: [{ text: item.text }]
          });
        }
      }
    }

    contents.push({
      role: "user",
      parts: [{ text: message.trim() }]
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: systemPrompt(level) }]
          },
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 500
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("Gemini chat xatosi:", response.status, JSON.stringify(data));

      return res.status(response.status).json({
        error: data?.error?.message || "Gemini chat so'rovi bajarilmadi."
      });
    }

    const answer =
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("") || "";

    if (!answer) {
      return res.status(502).json({
        error: "Gemini javob qaytarmadi."
      });
    }

    return res.json({ reply: answer });
  } catch (error) {
    console.error("Chat server xatosi:", error);

    return res.status(500).json({
      error: "Serverda ichki xato yuz berdi."
    });
  }
});

// Gemini Live API uchun vaqtinchalik token
app.post("/api/live-token", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "Render muhitida GEMINI_API_KEY sozlanmagan."
      });
    }

    const now = Date.now();

    const payload = {
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
      liveConnectConstraints: {
        model: "models/gemini-3.8-live",
        config: {
          responseModalities: ["AUDIO"],
          sessionResumption: {}
        }
      }
    };

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/auth_tokens",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        "Gemini token xatosi:",
        response.status,
        JSON.stringify(data)
      );

      return res.status(response.status).json({
        error: data?.error?.message || "Gemini token yaratilmadi."
      });
    }

    if (!data?.name) {
      console.error("Gemini token javobida name topilmadi.");

      return res.status(502).json({
        error: "Gemini javobida token topilmadi."
      });
    }

    return res.json({
      token: data.name
    });
  } catch (error) {
    console.error("Live token server xatosi:", error);

    return res.status(500).json({
      error: "Live token yaratishda server xatosi yuz berdi."
    });
  }
});

app.listen(PORT, () => {
  console.log(`Russian Tutor backend ${PORT}-portda ishga tushdi.`);
});
