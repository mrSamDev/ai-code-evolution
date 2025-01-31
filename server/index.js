import express from "express";
import cors from "cors";
import { createParser } from "eventsource-parser";
import fetch from "node-fetch";

const MODEL = "mistral";

class OllamaQASystem {
  constructor(solverPort = 11434, reviewerPort = 11435) {
    this.solverHost = `http://localhost:${solverPort}`;
    this.reviewerHost = `http://localhost:${reviewerPort}`;
  }

  async generateSolutionStream(prompt, previousSolution = "", reviewFeedback = "") {
    try {
      const contextPrompt =
        previousSolution && reviewFeedback
          ? `Previous solution:\n${previousSolution}\n\nReview feedback:\n${reviewFeedback}\n\nImprove the solution based on the feedback.`
          : `Generate a solution for the following problem:\n${prompt}\nProvide only the code without explanation.`;

      const response = await fetch(`${this.solverHost}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt: contextPrompt,
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
      const response = await fetch(`${this.reviewerHost}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt: `Review the following solution for Round ${round}:
          
Problem:
${problem}

Solution:
${solution}

Provide a detailed review with:
1. What works well
2. What could be improved
3. Score out of 10

Format as:
Score: [X/10]
Review: [Your detailed review]`,
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

  async processStream(response, writeStream) {
    let fullText = "";
    const parser = createParser((event) => {
      if (event.type === "event") {
        try {
          const data = JSON.parse(event.data);
          if (data.response) {
            fullText += data.response;
            // Send the chunk to the client
            writeStream(data.response);
          }
        } catch (error) {
          console.error("Error parsing stream chunk:", error);
        }
      }
    });

    try {
      for await (const chunk of response.body) {
        parser.feed(chunk.toString());
      }
    } catch (error) {
      console.error("Error processing stream:", error);
      throw error;
    }

    return fullText;
  }

  extractScore(review) {
    const scoreMatch = review.match(/Score:\s*(\d+)\/10/);
    return scoreMatch ? parseInt(scoreMatch[1]) : 0;
  }

  async checkConnection() {
    try {
      const [solverRes, reviewerRes] = await Promise.all([fetch(`${this.solverHost}/api/version`), fetch(`${this.reviewerHost}/api/version`)]);
      return solverRes.ok && reviewerRes.ok;
    } catch (error) {
      console.error("Connection check failed:", error);
      return false;
    }
  }

  async streamSolveAndReview(problem, maxRounds, res) {
    // Set up SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const writeStream = (content) => {
      res.write(`data: ${JSON.stringify({ content })}\n\n`);
    };

    try {
      // Check connection
      const connected = await this.checkConnection();
      if (!connected) {
        throw new Error("Failed to connect to Ollama instances");
      }

      let currentSolution = "";
      let bestScore = 0;
      let bestSolution = "";

      for (let round = 1; round <= maxRounds; round++) {
        // Announce round start
        writeStream(`Round ${round}/${maxRounds}\n`);

        // Generate solution
        const solutionResponse = await this.generateSolutionStream(problem, currentSolution, round > 1 ? `Previous score: ${bestScore}/10` : "");

        writeStream("```javascript\n"); // Start code block
        currentSolution = await this.processStream(solutionResponse, writeStream);
        writeStream("\n```\n"); // End code block

        // Generate review
        writeStream("\nReviewing solution...\n");
        const reviewResponse = await this.reviewSolutionStream(problem, currentSolution, round);
        const review = await this.processStream(reviewResponse, writeStream);

        // Extract score and update best solution if needed
        const score = this.extractScore(review);
        if (score > bestScore) {
          bestScore = score;
          bestSolution = currentSolution;
        }

        // Check if we've reached a good enough solution
        if (score >= 9) {
          writeStream("\nExcellent solution found! ✨\n");
          break;
        }

        if (round < maxRounds) {
          writeStream("\nMoving to next round...\n\n");
        }
      }

      writeStream(`\nProcess completed with best score: ${bestScore}/10\n`);
      res.end();
    } catch (error) {
      console.error("Error in streamSolveAndReview:", error);
      writeStream(`Error: ${error.message}\n`);
      res.end();
    }
  }
}

const app = express();

// Enable CORS
app.use(
  cors({
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

const qaSystem = new OllamaQASystem();

app.get("/solve", async (req, res) => {
  const { problem, rounds } = req.query;
  console.log("rounds: ", rounds);
  console.log("problem: ", problem);

  if (!problem) {
    return res.status(400).json({ error: "Problem description is required" });
  }

  const maxRounds = Math.min(Math.max(CONFIG.MIN_ROUNDS, parseInt(rounds) || CONFIG.DEFAULT_ROUNDS), CONFIG.MAX_ROUNDS);

  try {
    await qaSystem.streamSolveAndReview(problem, maxRounds, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        error: error.message,
        status: "error",
      });
    }
  }
});
const PORT = process.env.PORT || 5100;

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  const connected = await qaSystem.checkConnection();
  console.log("Ollama connection status:", connected ? "Connected" : "Not connected");
});

export default app;
