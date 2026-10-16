
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "100kb" }));

const systemPrompt = (level = "A1") => `
You are Russian Tutor, a patient Russian-language teacher
for an Uzbek-speaking learner.

The learner's Russian level is ${level}.

Respond primarily in simple Russian.
Explain important mistakes in Uzbek.
When correcting a sentence, include:
To'g'rilangan variant:
Briefly explain the correction in Uzbek.
Ask exactly one simple follow-up question in Russian.
Be encouraging, concise, and accurate.
`;

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Russian Tutor Gemini backend"
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY Render muhitida sozlanmagan."
      });
    }

    const {
      messages,
      level = "A1"
    } = req.body || {};

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        error: "Xabarlar ro'yxati bo'sh."
      });
    }

    if (messages.length > 40) {
      return res.status(400).json({
        error: "Xabarlar soni 40 tadan oshmasligi kerak."
      });
    }

    const contents = messages
      .filter(item =>
        item &&
        typeof item.content === "string" &&
        ["user", "assistant", "model"].includes(item.role)
      )
      .map(item => ({
        role: item.role === "assistant" ? "model" : item.role,
        parts: [{
          text: item.content.slice(0, 5000)
        }]
      }));

    if (
      contents.length === 0 ||
      contents[contents.length - 1].role !== "user"
    ) {
      return res.status(400).json({
        error: "Oxirgi xabar user xabari bo'lishi kerak."
      });
    }

    const model =
      process.env.GEMINI_MODEL || "gemini-3.8-flash";

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
            parts: [{
              text: systemPrompt(level)
            }]
          },
          contents,
          generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 900
          }
        })
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error(
        "Gemini chat xatosi:",
        response.status,
        JSON.stringify(data)
      );

      return res.status(response.status).json({
        error: data?.error?.message || "Gemini API xatosi."
      });
    }

    const reply = data?.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!reply) {
      return res.status(502).json({
        error: "Gemini javob qaytarmadi."
      });
    }

    return res.json({ reply });

  } catch (error) {
    console.error("Chat server xatosi:", error);

    return res.status(500).json({
      error: "Serverda ichki xato yuz berdi."
    });
  }
});

app.listen(PORT, () => {
  console.log(
    `Russian Tutor backend ${PORT}-portda ishga tushdi.`
  );
});
