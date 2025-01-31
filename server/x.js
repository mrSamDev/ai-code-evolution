import express from "express";
import cors from "cors";
import { createParser } from "eventsource-parser";
import fetch from "node-fetch";

// Configuration constants
const CONFIG = {
  MODEL: "deepseek-r1:1.5b",
  DEFAULT_ROUNDS: 5,
  MIN_ROUNDS: 2,
  MAX_ROUNDS: 6,
  PORTS: {
    DEFAULT: 5100,
    SOLVER: 11434,
    REVIEWER: 11435,
  },
  CORS_ORIGINS: ["http://localhost:5173"],
};

class OllamaQASystem {
  constructor(solverPort = CONFIG.PORTS.SOLVER, reviewerPort = CONFIG.PORTS.REVIEWER) {
    this.solverHost = `http://localhost:${solverPort}`;
    this.reviewerHost = `http://localhost:${reviewerPort}`;
  }

  async generateSolutionStream(prompt, previousSolution = "", reviewFeedback = "") {
    try {
      const contextPrompt =
        previousSolution && reviewFeedback
          ? `Previous solution:\n\`\`\`javascript\n${previousSolution}\n\`\`\`\n\n${reviewFeedback}\n\nImprove the solution based on the feedback. Return ONLY the JavaScript code without any explanation or markdown formatting.`
          : `Create a JavaScript solution for: ${prompt}\n\nReturn ONLY the code without any explanation or markdown formatting. Focus on creating clean, efficient code that demonstrates JavaScript functions.`;

      const response = await fetch(`${this.solverHost}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CONFIG.MODEL,
          messages: [
            {
              role: "system",
              content: "You are a JavaScript expert. Provide only clean, working code without explanations or markdown.",
            },
            {
              role: "user",
              content: contextPrompt,
            },
          ],
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Solver API error: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      throw new Error(`Solution generation failed: ${error.message}`);
    }
  }

  async reviewSolutionStream(problem, solution, round) {
    try {
      const prompt = `Review the following solution for Round ${round}:
          
**Problem:**
${problem}

**Solution:**
\`\`\`
${solution}
\`\`\`

Provide a detailed review with:
1. What works well
2. What could be improved
3. Score out of 10

Format as:
### Score: [X/10]

### Review:
[Your detailed review]`;

      const response = await fetch(`${this.reviewerHost}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: CONFIG.MODEL,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Reviewer API error: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      throw new Error(`Review generation failed: ${error.message}`);
    }
  }

  // Add the missing processStream method
  async processStream(response, writeStream) {
    let fullText = "";
    let isCodeBlock = false;
    let codeContent = "";

    const parser = createParser((event) => {
      if (event.type === "event") {
        try {
          const data = JSON.parse(event.data);
          if (data.message?.content) {
            const content = data.message.content;

            // For code blocks, ensure proper formatting
            if (content.includes("```")) {
              isCodeBlock = !isCodeBlock;
              if (!isCodeBlock && codeContent) {
                // When code block ends, clean and write the code
                const cleanCode = this.cleanCodeBlock(codeContent);
                fullText += cleanCode;
                writeStream(cleanCode);
                codeContent = "";
              }
            } else if (isCodeBlock) {
              // Accumulate code content
              codeContent += content;
            } else {
              // Regular text content
              fullText += content;
              writeStream(content);
            }
          }
        } catch (error) {
          console.error("Error parsing stream chunk:", error);
        }
      }
    });

    try {
      for await (const chunk of response.body) {
        const text = new TextDecoder().decode(chunk);
        parser.feed(text);
      }
    } catch (error) {
      console.error("Error processing stream:", error);
      throw error;
    }

    return fullText;
  }

  cleanCodeBlock(code) {
    // Remove any markdown code block syntax
    code = code.replace(/```(javascript|js)?/g, "").trim();

    // Ensure the code has proper function declaration if needed
    if (!code.includes("function") && !code.includes("=>")) {
      code = `function example() {\n  ${code}\n}`;
    }

    return code;
  }

  async streamSolveAndReview(problem, maxRounds, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const writeStream = (content) => {
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    };

    try {
      const connected = await this.checkConnection();
      if (!connected) {
        throw new Error("⚠️ Failed to connect to Ollama instances or required model not found");
      }

      writeStream("# Code Evolution Analysis\n\n");
      writeStream("## 🎯 Problem Statement\n\n");
      writeStream(`${problem}\n\n`);

      let currentSolution = "";
      let bestSolution = "";
      let bestScore = 0;

      for (let round = 1; round <= maxRounds; round++) {
        writeStream(`## 🔄 Round ${round}/${maxRounds}\n\n`);

        writeStream("### 💡 Generating Solution\n\n");
        const solutionResponse = await this.generateSolutionStream(
          problem,
          currentSolution,
          round > 1 ? `Previous score: ${bestScore}/10\nImprove the solution focusing on JavaScript best practices.` : ""
        );

        writeStream("```javascript\n");
        currentSolution = await this.processStream(solutionResponse, writeStream);
        writeStream("\n```\n\n");

        if (!currentSolution || currentSolution === "undefined") {
          writeStream("⚠️ Failed to generate a valid solution. Retrying...\n");
          continue;
        }

        writeStream("### 🔍 Code Review\n\n");
        const reviewResponse = await this.reviewSolutionStream(problem, currentSolution, round);
        const review = await this.processStream(reviewResponse, writeStream);

        const score = this.extractScore(review);
        if (score > bestScore) {
          bestScore = score;
          bestSolution = currentSolution;
          writeStream("\n#### ⭐ New Best Solution!\n");
        }

        if (score >= 9) {
          writeStream("\n### 🎉 Excellent solution achieved!\n\n");
          break;
        }

        if (round < maxRounds) {
          writeStream("\n### 📝 Analysis\n");
          writeStream("Proceeding to next iteration for further improvements...\n\n");
          writeStream("---\n\n");
        }
      }

      writeStream("\n## 📊 Final Results\n\n");
      writeStream(`- **Best Score:** ${bestScore}/10\n`);
      writeStream(`- **Best Solution:**\n\n`);
      writeStream("```javascript\n");
      writeStream(bestSolution || "// No valid solution generated");
      writeStream("\n```\n\n");

      writeStream("\n### 🏁 Process Completed\n");
      res.end();
    } catch (error) {
      console.error("Error in streamSolveAndReview:", error);
      writeStream(`\n### ❌ Error\n\n${error.message}\n`);
      res.end();
    }
  }

  extractScore(review) {
    const scoreMatch = review.match(/Score:\s*(\d+)\/10/);
    return scoreMatch ? parseInt(scoreMatch[1]) : 0;
  }

  async checkConnection() {
    try {
      const [solverTags, reviewerTags] = await Promise.all([fetch(`${this.solverHost}/api/tags`), fetch(`${this.reviewerHost}/api/tags`)]);

      if (!solverTags.ok || !reviewerTags.ok) {
        return false;
      }

      const [solverData, reviewerData] = await Promise.all([solverTags.json(), reviewerTags.json()]);

      // Check if both instances have the required model
      const solverHasModel = solverData.models?.some((model) => model.name === CONFIG.MODEL);
      const reviewerHasModel = reviewerData.models?.some((model) => model.name === CONFIG.MODEL);

      if (!solverHasModel || !reviewerHasModel) {
        console.warn(`Model ${CONFIG.MODEL} not found. Please run: ollama pull ${CONFIG.MODEL}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error("Connection check failed:", error);
      return false;
    }
  }
}

const app = express();

app.use(
  cors({
    origin: CONFIG.CORS_ORIGINS,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

const qaSystem = new OllamaQASystem();

app.get("/solve", async (req, res) => {
  const { problem, rounds = CONFIG.DEFAULT_ROUNDS } = req.query;

  if (!problem) {
    return res.status(400).json({ error: "Problem description is required" });
  }

  try {
    const maxRounds = Math.min(Math.max(CONFIG.MIN_ROUNDS, parseInt(rounds.toString()) || CONFIG.DEFAULT_ROUNDS), CONFIG.MAX_ROUNDS);

    await qaSystem.streamSolveAndReview(problem.toString(), maxRounds, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: error.message,
        status: "error",
      });
    }
  }
});

const PORT = CONFIG.PORTS.DEFAULT;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const connected = await qaSystem.checkConnection();
  if (connected) {
    console.log("✅ Successfully connected to Ollama instances");
  } else {
    console.log("⚠️  Failed to connect to Ollama instances or required model not found");
    console.log(`Please ensure Ollama is running and the ${CONFIG.MODEL} model is installed:`);
    console.log(`1. Run: ollama pull ${CONFIG.MODEL}`);
    console.log(`2. Start Ollama instances:`);
    console.log(`   - Terminal 1: ollama serve`);
    console.log(`   - Terminal 2: OLLAMA_HOST=127.0.0.1:11435 ollama serve`);
  }
});

export default app;
