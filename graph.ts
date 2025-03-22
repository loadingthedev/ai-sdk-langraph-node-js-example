import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import { z } from "zod";
dotenv.config();

// Add color logging utility
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

const logNode = (nodeName: string, message: string) => {
  const nodeColors: { [key: string]: string } = {
    agent: colors.cyan,
    tools: colors.yellow,
    router: colors.magenta,
  };
  const color = nodeColors[nodeName] || colors.white;
  console.log(`${color}[${nodeName}]${colors.reset} ${message}`);
};

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

const searchTool = tool(
  async ({ query: _query }: { query: string }) => {
    return "Cold, with a low of 3℃";
  },
  {
    name: "search",
    description:
      "Use to surf the web, fetch current information, check the weather, and retrieve other information.",
    schema: z.object({
      query: z.string().describe("The query to use in your search."),
    }),
  }
);

const tools = [searchTool];
const toolNode = new ToolNode(tools);

const model = new ChatOpenAI({ model: "gpt-4o" });
const boundModel = model.bindTools(tools);

const routeMessage = (state: typeof StateAnnotation.State) => {
  logNode("router", "Deciding next node...");
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  if (!lastMessage?.tool_calls?.length) {
    logNode("router", "No tool calls, ending...");
    return END;
  }
  logNode("router", "Routing to tools node");
  return "tools";
};

const callModel = async (state: typeof StateAnnotation.State) => {
  logNode("agent", "Calling model...");
  const { messages } = state;
  const responseMessage = await boundModel.invoke(messages);
  logNode("agent", "Model response received");
  return { messages: [responseMessage] };
};

const wrappedToolNode = async (state: typeof StateAnnotation.State) => {
  logNode("tools", "Executing tools...");
  const result = await toolNode.invoke(state);
  logNode("tools", "Tools execution completed");
  return result;
};

const checkpointSaver = new MemorySaver();
const workflow = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", wrappedToolNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", routeMessage)
  .addEdge("tools", "agent");

const graph = workflow.compile({
  checkpointer: checkpointSaver,
});

export const createAgentGraph = () => {
  return graph;
};

async function main() {
  let inputs = {
    messages: [new HumanMessage("Hi how are you?")],
  };

  const fs = require("fs");
  const streamResponses: Array<{
    node: string;
    values: any;
    timestamp: string;
  }> = [];

  for await (const chunk of graph.streamEvents(inputs, {
    // streamMode: "updates",
    configurable: {
      thread_id: 423,
    },
    version: "v2" as const,
  })) {
    for (const [node, values] of Object.entries(chunk)) {
      //   console.log(`Receiving update from node: ${node}`);
      console.log(values);
      console.log("\n====\n");

      // Add to collection
      streamResponses.push({
        node,
        values,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Save to JSON file
  fs.writeFileSync(
    "langgraph-stream-responses.json",
    JSON.stringify(streamResponses, null, 2)
  );

  console.log("Stream responses saved to langgraph-stream-responses.json");
}
