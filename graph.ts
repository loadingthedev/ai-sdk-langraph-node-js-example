import { Annotation, MemorySaver } from "@langchain/langgraph";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { END, START, StateGraph } from "@langchain/langgraph";
import { AIMessage } from "@langchain/core/messages";
import dotenv from "dotenv";
dotenv.config();

const StateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (x, y) => x.concat(y),
  }),
});

const searchTool = tool(
  async ({ query: _query }: { query: string }) => {
    // This is a placeholder for the actual implementation
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
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  if (!lastMessage?.tool_calls?.length) {
    return END;
  }
  return "tools";
};

const callModel = async (state: typeof StateAnnotation.State) => {
  const { messages } = state;
  const responseMessage = await boundModel.invoke(messages);

  return { messages: [responseMessage] };
};

const checkpointSaver = new MemorySaver();
const workflow = new StateGraph(StateAnnotation)
  .addNode("agent", callModel)
  .addNode("tools", toolNode)
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

// main();
