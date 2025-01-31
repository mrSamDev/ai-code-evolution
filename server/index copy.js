import express from "express";
import fetch from "node-fetch";

const MODEL = "mistral";

class OllamaQASystem {
  constructor(solverPort = 11434, reviewerPort = 11435, maxRounds = 5) {
    this.solverHost = `http://localhost:${solverPort}`;
    this.reviewerHost = `http://localhost:${reviewerPort}`;
    this.maxRounds = maxRounds;
    this.status = {
      currentPhase: "idle",
      currentRound: 0,
      totalRounds: maxRounds,
      lastAction: "",
      error: null,
      startTime: null,
      roundStartTime: null,
      statistics: {
        averageGenerationTime: 0,
        averageReviewTime: 0,
        totalGenerations: 0,
        totalReviews: 0,
      },
    };
  }

  updateStatus(phase, action = "") {
    this.status.currentPhase = phase;
    this.status.lastAction = action;
    this.status.error = null;
    console.log(`[Status] ${phase}${action ? ": " + action : ""}`);
  }

  updateError(error) {
    this.status.error = error;
    this.status.currentPhase = "error";
    console.error(`[Error] ${error}`);
  }

  async checkConnection() {
    this.updateStatus("checking_connection");
    try {
      const solverResponse = await fetch(`${this.solverHost}/api/version`);
      if (!solverResponse.ok) {
        throw new Error(`Solver instance not responding at ${this.solverHost}`);
      }
      this.updateStatus("checking_connection", "Solver connected");

      const reviewerResponse = await fetch(`${this.reviewerHost}/api/version`);
      if (!reviewerResponse.ok) {
        throw new Error(`Reviewer instance not responding at ${this.reviewerHost}`);
      }
      this.updateStatus("checking_connection", "Both instances connected");

      return true;
    } catch (error) {
      this.updateError(`Connection check failed: ${error.message}`);
      return false;
    }
  }

  async generateSolution(prompt, previousSolution = "", reviewFeedback = "") {
    this.updateStatus("generating_solution", "Preparing context");
    const startTime = Date.now();

    try {
      const contextPrompt =
        previousSolution && reviewFeedback
          ? `Previous solution:\n${previousSolution}\n\nReview feedback:\n${reviewFeedback}\n\nImprove the solution based on the feedback.`
          : `Generate a solution for the following problem:\n${prompt}\nProvide only the code without explanation.`;

      this.updateStatus("generating_solution", "Sending request to solver");

      const response = await fetch(`${this.solverHost}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          prompt: contextPrompt,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Solver API error: ${response.statusText}`);
      }

      const data = await response.json();
      const solution = data.response || "";

      // Update statistics
      const generationTime = Date.now() - startTime;
      this.status.statistics.totalGenerations++;
      this.status.statistics.averageGenerationTime =
        (this.status.statistics.averageGenerationTime * (this.status.statistics.totalGenerations - 1) + generationTime) / this.status.statistics.totalGenerations;

      this.updateStatus("generating_solution", `Completed in ${generationTime}ms`);
      return solution;
    } catch (error) {
      this.updateError(`Solution generation failed: ${error.message}`);
      throw error;
    }
  }

  async reviewSolution(problem, solution, round) {
    this.updateStatus("reviewing_solution", `Round ${round}`);
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.reviewerHost}/api/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          prompt: `Round ${round} Review:
                    Problem: ${problem}
                    
                    Current Solution:
                    ${solution}
                    
                    Provide a detailed review focusing on:
                    1. Correctness
                    2. Efficiency
                    3. Best practices
                    4. Specific improvements needed
                    5. Score out of 10
                    
                    Format your response as:
                    Score: [X/10]
                    Review: [Your detailed review]
                    Improvements: [Specific suggestions for improvement]
                    
                    If the solution scores 9 or higher, mention that it's ready for production.`,
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`Reviewer API error: ${response.statusText}`);
      }

      const data = await response.json();
      const review = data.response || "";

      const reviewTime = Date.now() - startTime;
      this.status.statistics.totalReviews++;
      this.status.statistics.averageReviewTime = (this.status.statistics.averageReviewTime * (this.status.statistics.totalReviews - 1) + reviewTime) / this.status.statistics.totalReviews;

      this.updateStatus("reviewing_solution", `Completed in ${reviewTime}ms`);
      return review;
    } catch (error) {
      this.updateError(`Review generation failed: ${error.message}`);
      throw error;
    }
  }

  async solveAndReviewMultipleRounds(problem) {
    this.status.startTime = Date.now();
    this.status.currentRound = 0;
    this.updateStatus("starting", "Initializing process");

    const isConnected = await this.checkConnection();
    if (!isConnected) {
      throw new Error("Failed to connect to one or both Ollama instances");
    }

    const iterations = [];
    let currentSolution = "";
    let currentReview = "";

    try {
      for (let round = 1; round <= this.maxRounds; round++) {
        this.status.currentRound = round;
        this.status.roundStartTime = Date.now();
        this.updateStatus("round_started", `Round ${round}/${this.maxRounds}`);

        currentSolution = await this.generateSolution(problem, currentSolution, currentReview);
        if (!currentSolution) {
          throw new Error("Empty solution received");
        }

        currentReview = await this.reviewSolution(problem, currentSolution, round);
        if (!currentReview) {
          throw new Error("Empty review received");
        }

        const score = this.extractScore(currentReview);
        const roundTime = Date.now() - this.status.roundStartTime;

        iterations.push({
          round,
          solution: currentSolution,
          review: currentReview,
          score: score,
          timeTaken: roundTime,
        });

        this.updateStatus("round_completed", `Round ${round} completed in ${roundTime}ms with score ${score}/10`);

        if (score >= 9) {
          this.updateStatus("excellent_solution_found", `Achieved score ${score}/10 in round ${round}`);
          break;
        }
      }

      const bestIteration = this.findBestIteration(iterations);
      const totalTime = Date.now() - this.status.startTime;

      this.updateStatus("completed", `Process completed in ${totalTime}ms with best score ${bestIteration.score}/10`);

      return {
        problem,
        iterations,
        bestSolution: bestIteration,
        status: "success",
        statistics: {
          ...this.status.statistics,
          totalTime,
          averageRoundTime: totalTime / iterations.length,
        },
      };
    } catch (error) {
      const totalTime = Date.now() - this.status.startTime;
      this.updateError(error.message);

      return {
        problem,
        error: error.message,
        iterations,
        status: "error",
        statistics: {
          ...this.status.statistics,
          totalTime,
        },
      };
    }
  }

  findBestIteration(iterations) {
    if (!iterations.length) {
      return null;
    }
    return iterations.reduce((best, current) => {
      const currentScore = current.score || 0;
      const bestScore = best.score || 0;
      return currentScore > bestScore ? current : best;
    });
  }

  extractScore(review) {
    if (!review) return 0;
    const scoreMatch = review.match(/Score:\s*(\d+)\/10/);
    return scoreMatch ? parseInt(scoreMatch[1]) : 0;
  }

  getStatus() {
    return {
      ...this.status,
      uptime: Date.now() - (this.status.startTime || Date.now()),
    };
  }
}

const app = express();
app.use(express.json());

const qaSystem = new OllamaQASystem();

app.post("/solve", async (req, res) => {
  const { problem } = req.body;
  if (!problem) {
    return res.status(400).json({ error: "Problem description is required" });
  }

  try {
    const result = await qaSystem.solveAndReviewMultipleRounds(problem);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error.message,
      status: "error",
    });
  }
});

// Add status endpoint
app.get("/status", (req, res) => {
  res.json(qaSystem.getStatus());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Make sure two Ollama instances are running on ports 11434 and 11435");
  console.log("Checking Ollama connections...");
  qaSystem.checkConnection();
});

export default OllamaQASystem;
