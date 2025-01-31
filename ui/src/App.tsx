import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Loader2, Send, RefreshCcw } from "lucide-react";
import remarkGfm from "remark-gfm";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

const API_BASE_URL = "http://localhost:5100";

interface Message {
  role: "assistant" | "user";
  content: string;
  timestamp: number;
  type?: "thinking" | "solution" | "review" | "error";
}

const QASystem = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [rounds, setRounds] = useState(5);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  useEffect(() => {
    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [eventSource]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    setError(null);

    // Add user message
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: input,
        timestamp: Date.now(),
      },
    ]);

    if (eventSource) {
      eventSource.close();
    }

    try {
      const queryString = new URLSearchParams({
        problem: input,
        rounds: rounds.toString(),
      }).toString();

      const newEventSource = new EventSource(`${API_BASE_URL}/solve?${queryString}`);
      setEventSource(newEventSource);

      let currentMessage = "";
      let messageType: Message["type"] = "thinking";

      newEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.content) {
            // Determine message type based on content
            if (data.content.includes("Round")) {
              messageType = "thinking";
            } else if (data.content.includes("```")) {
              messageType = "solution";
            } else if (data.content.includes("Review:") || data.content.includes("Score:")) {
              messageType = "review";
            }

            currentMessage += data.content;
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];

              if (lastMessage && lastMessage.role === "assistant") {
                lastMessage.content = currentMessage;
                lastMessage.type = messageType;
                return [...newMessages];
              } else {
                return [
                  ...newMessages,
                  {
                    role: "assistant",
                    content: currentMessage,
                    timestamp: Date.now(),
                    type: messageType,
                  },
                ];
              }
            });
          }
        } catch (error) {}
      };

      newEventSource.onerror = (error) => {
        newEventSource.close();
        setIsLoading(false);
        setError(new Error("Connection error. Please try again."));
      };

      newEventSource.addEventListener("done", () => {
        newEventSource.close();
        setIsLoading(false);
      });
    } catch (error) {
      setError(error instanceof Error ? error : new Error("An unknown error occurred"));
      setIsLoading(false);
    }
  };

  const getMessageStyle = (type?: Message["type"]) => {
    switch (type) {
      case "thinking":
        return "border-l-4 border-blue-500 bg-blue-50 dark:bg-blue-900/20";
      case "solution":
        return "border-l-4 border-green-500 bg-green-50 dark:bg-green-900/20";
      case "review":
        return "border-l-4 border-purple-500 bg-purple-50 dark:bg-purple-900/20";
      case "error":
        return "border-l-4 border-red-500 bg-red-50 dark:bg-red-900/20";
      default:
        return "";
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>AI Code Assistant</CardTitle>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isLoading ? "bg-green-500 animate-pulse" : "bg-gray-500"}`} />
            <span className="text-sm text-gray-600 dark:text-gray-400">{isLoading ? "Processing" : "Ready"}</span>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe your programming task or problem here..."
              className="w-full min-h-[100px] p-4 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:border-gray-700"
              disabled={isLoading}
            />
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <label htmlFor="rounds" className="text-sm font-medium">
                  Improvement Rounds:
                </label>
                <select id="rounds" value={rounds} onChange={(e) => setRounds(Number(e.target.value))} className="border rounded-lg p-1 dark:bg-gray-800" disabled={isLoading}>
                  {[2, 3, 4, 5, 6].map((num) => (
                    <option key={num} value={num}>
                      {num}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex space-x-2">
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Submit
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMessages([]);
                    setError(null);
                    if (eventSource) eventSource.close();
                  }}
                  disabled={isLoading || messages.length === 0}
                  className="flex items-center justify-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <RefreshCcw className="w-4 h-4 mr-2" />
                  Reset
                </button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {messages.map((message, index) => (
          <Card key={`${message.timestamp}-${index}`} className={`overflow-hidden ${message.role === "user" ? "bg-gray-50 dark:bg-gray-900" : getMessageStyle(message.type)}`}>
            <CardContent className="p-4">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ node, inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || "");
                    return !inline ? (
                      <SyntaxHighlighter language={match ? match[1] : "javascript"} style={vscDarkPlus} PreTag="div" className="rounded-lg" {...props}>
                        {String(children).replace(/\n$/, "")}
                      </SyntaxHighlighter>
                    ) : (
                      <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded" {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            </CardContent>
          </Card>
        ))}
      </div>

      {error && (
        <Card className="border-red-500">
          <CardContent className="text-red-500 p-4">
            <div className="flex items-center space-x-2">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span>{error.message}</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default QASystem;
