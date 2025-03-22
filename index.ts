import { openai } from "@ai-sdk/openai";
import { CoreMessage, streamText } from "ai";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Store conversation history per session (in a real app, use a database)
const sessions: Record<string, CoreMessage[]> = {};

// // Chat endpoint
app.post("/api/chat", async function (req: Request, res: Response) {
  const { message, sessionId = "default" } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  // Initialize session if it doesn't exist
  if (!sessions[sessionId]) {
    sessions[sessionId] = [];
  }

  // Add user message to history
  sessions[sessionId].push({ role: "user", content: message });

  try {
    const result = streamText({
      model: openai("gpt-4o"),
      messages: sessions[sessionId],
    });

    // Create a response using AI SDK's streaming method
    const streamResponse = result.toDataStreamResponse();

    // Set response headers from the stream response
    for (const [key, value] of streamResponse.headers.entries()) {
      res.setHeader(key, value);
    }

    // Pipe the stream to Express response
    const readable = streamResponse.body;
    if (readable) {
      const reader = readable.getReader();

      // Track the complete response to save in session
      let fullResponse = "";

      // Process the stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Send chunk to client
        res.write(value);

        // Decode and track for session history
        const text = new TextDecoder().decode(value);
        const matches = text.match(/0:"([^"]*)"/g);
        if (matches) {
          matches.forEach((match) => {
            const content = match.slice(3, -1);
            fullResponse += content;
          });
        }
      }

      // Add assistant response to history
      sessions[sessionId].push({ role: "assistant", content: fullResponse });

      res.end();
    } else {
      throw new Error("Stream response body is null");
    }
  } catch (error) {
    console.error("Error in chat stream:", error);
    res.status(500).json({ error: "An error occurred" });
  }
});

// Simple endpoint to get conversation history
app.get("/api/history/:sessionId", function (req: Request, res: Response) {
  const { sessionId } = req.params;
  res.json({ messages: sessions[sessionId] || [] });
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
