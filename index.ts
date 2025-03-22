import { openai } from "@ai-sdk/openai";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { CoreMessage, streamText } from "ai";
import cors from "cors";
import dotenv from "dotenv";
import type { Request, Response } from "express";
import express from "express";
import { createAgentGraph } from "./graph";

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

// LangGraph agent endpoint
app.post("/api/agent-chat", async function (req: Request, res: Response) {
  const { message, sessionId = "default" } = req.body;

  if (!message) {
    return res.status(400).json({ error: "Message is required" });
  }

  console.log(
    `[AGENT] Starting agent chat for session ${sessionId} with message: ${message}`
  );

  try {
    const graph = createAgentGraph();
    console.log(`[AGENT] Graph created`);

    // Set up response headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    console.log(`[AGENT] Headers set for streaming`);
    res.flushHeaders();

    const history = sessions[sessionId] || [];

    const langchainMessages = history.map((msg) => {
      if (msg.role === "user") {
        return new HumanMessage(msg.content as string);
      } else {
        return new AIMessage(msg.content as string);
      }
    });

    langchainMessages.push(new HumanMessage(message));

    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }
    sessions[sessionId].push({ role: "user", content: message });

    console.log(`[AGENT] Starting graph stream execution`);
    const stream = graph.streamEvents(
      {
        messages: langchainMessages,
      },
      {
        configurable: {
          thread_id: sessionId,
        },
        version: "v2" as const,
      }
    );

    let assistantResponse = "";

    for await (const chunk of stream) {
      for (const [node, values] of Object.entries(chunk)) {
        if (
          node === "data" &&
          typeof values === "object" &&
          values !== null &&
          "chunk" in values
        ) {
          const data = `data: ${JSON.stringify({
            type: "text",
            text: values.chunk.content,
            node: node,
          })}\n\n`;
          res.write(data);
        }
      }
    }

    sessions[sessionId].push({ role: "assistant", content: assistantResponse });

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("[AGENT] Error in agent chat stream:", error);
    res.status(500).json({ error: "An error occurred with the agent" });
  }
});

app.get("/api/history/:sessionId", function (req: Request, res: Response) {
  const { sessionId } = req.params;
  res.json({ messages: sessions[sessionId] || [] });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
