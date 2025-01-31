### Just for testing

After watching my OpenAI credits dwindle, I turned to Ollama for running AI models locally. The goal? Create a system where AIs could generate and review code without breaking the bank.

## System Overview

Built with Express.js, the system uses two Ollama instances:

- Solver (port 11434): Generates code solutions
- Reviewer (port 11435): Evaluates the code

## Model Selection: DeepSeek Variants

Tested two options:

- DeepSeek-R1 14B: Accurate but resource-intensive
- DeepSeek 1.5B: More practical for daily use, though occasionally produces interesting hallucinations

```javascript
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
```

## Key Features

1. Solution Generation: Uses Ollama's chat API for code creation
2. Code Review: Evaluates solutions with specific criteria
3. Stream Processing: Handles real-time responses from Ollama
4. Connection Management: Robust checking of model availability

## Resource Considerations

- Memory: 1.5B model uses 2-3GB vs 14B's 8GB
- Storage: 1.5B needs 2GB vs 14B's 8GB
- Temperature: 1.5B runs cooler, preventing thermal throttling

## Quick Start

```bash
# Install Ollama
curl https://ollama.ai/install.sh | sh

# Pull model
ollama pull deepseek-r1:1.5b

# Start instances
ollama serve
OLLAMA_HOST=127.0.0.1:11435 ollama serve

# Setup project
git clone https://github.com/mrSamDev/ai-code-evolution
cd ai-code-evolution
npm install
node server.js
```

## Key Takeaways

- Perfect for solo projects needing code review
- Significant cost savings over API-based solutions
- Balance between model size and practicality is crucial
- Sometimes entertaining AI hallucinations included at no extra charge

Complete code available on GitHub. Contributors welcome!
