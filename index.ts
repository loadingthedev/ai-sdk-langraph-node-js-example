import { openai } from "@ai-sdk/openai";
import { CoreMessage, streamText } from "ai";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import type { Request, Response } from "express";
import { createAgentGraph } from "./graph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import fs from "fs";

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
// app.post("/api/agent-chat", async function (req: Request, res: Response) {
//   const { message, sessionId = "default" } = req.body;

//   if (!message) {
//     return res.status(400).json({ error: "Message is required" });
//   }

//   console.log(
//     `[AGENT] Starting agent chat for session ${sessionId} with message: ${message}`
//   );

//   try {
//     // Create a new graph instance for this request
//     const graph = createAgentGraph();
//     console.log(`[AGENT] Graph created`);

//     // Set up response headers for streaming
//     res.setHeader("Content-Type", "text/event-stream");
//     res.setHeader("Cache-Control", "no-cache");
//     res.setHeader("Connection", "keep-alive");
//     console.log(`[AGENT] Headers set for streaming`);

//     // Get message history if it exists
//     const history = sessions[sessionId] || [];
//     console.log(`[AGENT] Found ${history.length} previous messages in session`);

//     // Convert previous messages to LangChain message format
//     const langchainMessages = history.map((msg) => {
//       if (msg.role === "user") {
//         return new HumanMessage(msg.content as string);
//       } else {
//         return new AIMessage(msg.content as string);
//       }
//     });

//     // Add current message
//     langchainMessages.push(new HumanMessage(message));
//     console.log(
//       `[AGENT] Converted ${langchainMessages.length} messages to LangChain format`
//     );

//     // Add the new user message to session history
//     if (!sessions[sessionId]) {
//       sessions[sessionId] = [];
//     }
//     sessions[sessionId].push({ role: "user", content: message });

//     // Execute the graph with streaming and include thread_id in configurable
//     console.log(`[AGENT] Starting graph stream execution`);
//     const stream = await graph.stream(
//       {
//         messages: langchainMessages,
//       },
//       {
//         streamMode: "values",
//         configurable: {
//           thread_id: sessionId,
//         },
//       }
//     );
//     console.log(`[AGENT] Stream object created, ready to process chunks`);

//     let assistantResponse = "";
//     let isFirstChunk = true;
//     let chunkCount = 0;

//     // Stream response chunks to the client
//     for await (const chunk of stream) {
//       chunkCount++;
//       console.log(
//         `[AGENT] Processing chunk #${chunkCount}:`,
//         JSON.stringify(chunk, null, 2)
//       );

//       // Send any actions being taken (tool calls)
//       if (chunk.actions) {
//         console.log(`[AGENT] Found ${chunk.actions.length} actions in chunk`);
//         for (const action of chunk.actions) {
//           const toolData = {
//             type: "tool_call",
//             tool: action.tool,
//             input: action.tool_input,
//           };
//           const data = `data: ${JSON.stringify(toolData)}\n\n`;
//           console.log(`[AGENT] Sending tool call data: ${data}`);
//           res.write(data);
//         }
//       }

//       // Send any observations from tools
//       if (chunk.steps) {
//         console.log(`[AGENT] Found ${chunk.steps.length} steps in chunk`);
//         for (const step of chunk.steps) {
//           const observationData = {
//             type: "tool_result",
//             observation: step.observation,
//           };
//           const data = `data: ${JSON.stringify(observationData)}\n\n`;
//           console.log(`[AGENT] Sending tool result data: ${data}`);
//           res.write(data);
//         }
//       }

//       // Stream LLM responses
//       if (chunk.messages && chunk.messages.length > 0) {
//         console.log(`[AGENT] Found ${chunk.messages.length} messages in chunk`);
//         const lastMessage = chunk.messages[chunk.messages.length - 1];

//         if (lastMessage.content) {
//           const content =
//             typeof lastMessage.content === "string"
//               ? lastMessage.content
//               : JSON.stringify(lastMessage.content);

//           console.log(`[AGENT] Message content: ${content}`);

//           // If this is part of the final response
//           if (chunk.output || isFirstChunk) {
//             isFirstChunk = false;
//             // Format as SSE
//             const data = `data: ${JSON.stringify({
//               type: "text",
//               text: content,
//             })}\n\n`;
//             console.log(`[AGENT] Sending text data: ${data}`);
//             res.write(data);
//             assistantResponse = content;
//           }
//         } else {
//           console.log(`[AGENT] Message has no content`);
//         }
//       } else if (!chunk.actions && !chunk.steps) {
//         console.log(`[AGENT] Chunk has no messages, actions, or steps`);
//       }

//       // Send the final output if available
//       if (chunk.output) {
//         console.log(
//           `[AGENT] Found final output in chunk: ${JSON.stringify(chunk.output)}`
//         );
//         const outputData = {
//           type: "final",
//           text: chunk.output,
//         };
//         const data = `data: ${JSON.stringify(outputData)}\n\n`;
//         console.log(`[AGENT] Sending final output data: ${data}`);
//         res.write(data);
//         assistantResponse =
//           typeof chunk.output === "string"
//             ? chunk.output
//             : chunk.output.output || JSON.stringify(chunk.output);
//       }
//     }

//     console.log(`[AGENT] Processed ${chunkCount} total chunks`);
//     console.log(`[AGENT] Final assistant response: ${assistantResponse}`);

//     // Add assistant response to history
//     sessions[sessionId].push({ role: "assistant", content: assistantResponse });

//     // End the response
//     const doneMessage = "data: [DONE]\n\n";
//     console.log(`[AGENT] Sending done message: ${doneMessage}`);
//     res.write(doneMessage);
//     res.end();
//     console.log(`[AGENT] Stream ended successfully`);
//   } catch (error) {
//     console.error("[AGENT] Error in agent chat stream:", error);
//     res.status(500).json({ error: "An error occurred with the agent" });
//   }
// });

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
    // Create a new graph instance for this request
    const graph = createAgentGraph();
    console.log(`[AGENT] Graph created`);

    // Set up response headers for streaming
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    console.log(`[AGENT] Headers set for streaming`);
    res.flushHeaders();

    // Get message history if it exists
    const history = sessions[sessionId] || [];
    console.log(`[AGENT] Found ${history.length} previous messages in session`);

    // Convert previous messages to LangChain message format
    const langchainMessages = history.map((msg) => {
      if (msg.role === "user") {
        return new HumanMessage(msg.content as string);
      } else {
        return new AIMessage(msg.content as string);
      }
    });

    // Add current message
    langchainMessages.push(new HumanMessage(message));
    console.log(
      `[AGENT] Converted ${langchainMessages.length} messages to LangChain format`
    );

    // Add the new user message to session history
    if (!sessions[sessionId]) {
      sessions[sessionId] = [];
    }
    sessions[sessionId].push({ role: "user", content: message });

    // Execute the graph with streaming and include thread_id in configurable
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
    const streamResponses: Array<{
      chunk?: any;
      values?: any;
      timestamp: string;
    }> = [];

    for await (const chunk of stream) {
      for (const [node, values] of Object.entries(chunk)) {
        console.dir(
          {
            node,
            values,
          },
          {
            depth: 3,
          }
        );
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

    // Add assistant response to history
    sessions[sessionId].push({ role: "assistant", content: assistantResponse });

    // End the response
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("[AGENT] Error in agent chat stream:", error);
    res.status(500).json({ error: "An error occurred with the agent" });
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
