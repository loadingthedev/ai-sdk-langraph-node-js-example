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

// Chat endpoint
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

  // Set headers for streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const result = streamText({
      model: openai("gpt-4o"),
      messages: sessions[sessionId],
    });

    let fullResponse = "";

    // Stream each chunk to the client
    for await (const delta of result.textStream) {
      fullResponse += delta;
      res.write(`data: ${JSON.stringify({ text: delta })}\n\n`);
    }

    // Add assistant response to history
    sessions[sessionId].push({ role: "assistant", content: fullResponse });

    // End the response
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    console.error("Error in chat stream:", error);
    res.write(`data: ${JSON.stringify({ error: "An error occurred" })}\n\n`);
    res.end();
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
