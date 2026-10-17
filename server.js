
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

function supabaseConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    throw new Error("Supabase muhit sozlamalari topilmadi.");
  }

  return { url, key };
}

async function supabaseRequest(path, options = {}) {
  const { url, key } = supabaseConfig();

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const body = await response.text();

  if (!response.ok) {
    console.error("Supabase xatosi:", response.status, body);
    throw new Error("Supabase so'rovini bajarib bo'lmadi.");
  }

  return body ? JSON.parse(body) : null;
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "Russian Tutor Gemini backend"
  });
});

// Mavzular ro'yxati
app.get("/api/topics", async (req, res) => {
  try {
    const topics = await supabaseRequest(
      "topics?select=id,title,category,description&order=category.asc,title.asc"
    );

    res.json({ topics });
  } catch (error) {
    console.error("Mavzularni olish xatosi:", error.message);
    res.status(500).json({ error: "Mavzularni olib bo'lmadi." });
  }
});

// Mavzular bo'yicha bilim natijalari
app.get("/api/progress", async (req, res) => {
  try {
    const progress = await supabaseRequest(
      "skill_progress?select=topic_id,attempts,correct_answers,accuracy,mastery,last_practiced,topics(title,category,description)&order=topic_id.asc"
    );

    res.json({ progress });
  } catch (error) {
    console.error("Natijalarni olish xatosi:", error.message);
    res.status(500).json({ error: "Natijalarni olib bo'lmadi." });
  }
});

// Bitta mashq natijasini saqlash va bilim darajasini yangilash
app.post("/api/progress/attempt", async (req, res) => {
  try {
    const {
      topicId,
      question = "",
      answer,
      isCorrect,
      errorType = null,
      feedback = ""
    } = req.body || {};

    if (
      typeof topicId !== "string" ||
      !/^[a-z0-9_-]{1,80}$/i.test(topicId) ||
      typeof answer !== "string" ||
      typeof isCorrect !== "boolean"
    ) {
      return res.status(400).json({
        error: "topicId, answer va isCorrect qiymatlarini tekshiring."
      });
    }

    if (answer.length > 5000 || question.length > 5000 ||
        typeof question !== "string" ||
        typeof feedback !== "string" ||
        feedback.length > 5000 ||
        (errorType !== null && typeof errorType !== "string")) {
      return res.status(400).json({
        error: "Mashq ma'lumotlari noto'g'ri yoki juda uzun."
      });
    }

    const topics = await supabaseRequest(
      `topics?id=eq.${encodeURIComponent(topicId)}&select=id`
    );

    if (!topics?.length) {
      return res.status(404).json({
        error: "Bunday mavzu topilmadi. Avval mavzularni kiriting."
      });
    }

    const previous = await supabaseRequest(
      `skill_progress?topic_id=eq.${encodeURIComponent(topicId)}&select=attempts,correct_answers`
    );

    const oldAttempts = Number(previous?.[0]?.attempts || 0);
    const oldCorrect = Number(previous?.[0]?.correct_answers || 0);

    const attempts = oldAttempts + 1;
    const correctAnswers = oldCorrect + (isCorrect ? 1 : 0);
    const accuracy = Number(
      ((correctAnswers / attempts) * 100).toFixed(2)
    );

    let mastery = "O'rganilmoqda";

    if (attempts >= 3 && accuracy >= 85) {
      mastery = "Mustahkam";
    } else if (attempts >= 3 && accuracy >= 65) {
      mastery = "Yaxshi";
    } else if (attempts >= 3) {
      mastery = "Qayta mashq kerak";
    }

    await supabaseRequest("practice_attempts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        topic_id: topicId,
        question: question.slice(0, 5000),
        learner_answer: answer.slice(0, 5000),
        is_correct: isCorrect,
        error_type: errorType,
        feedback: feedback.slice(0, 5000)
      })
    });

    await supabaseRequest("skill_progress", {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify({
        topic_id: topicId,
        attempts,
        correct_answers: correctAnswers,
        accuracy,
        mastery,
        last_practiced: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });

    res.json({
      ok: true,
      topicId,
      attempts,
      correctAnswers,
      accuracy,
      mastery
    });
  } catch (error) {
    console.error("Natijani saqlash xatosi:", error.message);
    res.status(500).json({
      error: "Mashq natijasini saqlab bo'lmadi."
    });
  }
});

// Mavjud Gemini matnli chat — saqlab qolindi
app.post("/api/chat", async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY Render muhitida sozlanmagan."
      });
    }

    const { messages, level = "A1" } = req.body || {};

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
        parts: [{ text: item.content.slice(0, 5000) }]
      }));

    if (
      contents.length === 0 ||
      contents[contents.length - 1].role !== "user"
    ) {
      return res.status(400).json({
        error: "Oxirgi xabar user xabari bo'lishi kerak."
      });
    }

    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

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
  console.log(`Russian Tutor backend ${PORT}-portda ishga tushdi.`);
});
