// import {
//   StateGraph,
//   MessagesAnnotation,
//   MemorySaver,
//   START,
//   END,
// } from "@langchain/langgraph";
// import { ChatOpenAI } from "@langchain/openai";
// import { HumanMessage, AIMessage } from "@langchain/core/messages";
// import { RunnableSequence } from "@langchain/core/runnables";
// import { z } from "zod";
// import dotenv from "dotenv";
// import { tool } from "@langchain/core/tools";

// dotenv.config();

// // Weather tool definition using the prebuilt tool function
// const getWeatherTool = tool(
//   async ({ city }) => {
//     // Simulate weather data fetch - in a real app, call a weather API
//     return {
//       temperature: Math.floor(Math.random() * 30) + 50, // 50-80°F
//       condition: ["Sunny", "Cloudy", "Rainy", "Partly Cloudy"][
//         Math.floor(Math.random() * 4)
//       ],
//       humidity: Math.floor(Math.random() * 50) + 30, // 30-80%
//       city,
//     };
//   },
//   {
//     name: "get_weather",
//     description: "Get the current weather for a location",
//     schema: z.object({
//       city: z.string().describe("The city to get weather for"),
//     }),
//   }
// );

// // Create the model with tools
// const llm = new ChatOpenAI({
//   temperature: 0,
//   modelName: "gpt-4o",
// }).bindTools([getWeatherTool]);

// // Define the function that determines whether to continue or finish
// function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
//   const lastMessage = messages[messages.length - 1] as AIMessage;

//   // If the LLM makes a tool call, then we route to the "tools" node
//   if (lastMessage.tool_calls?.length) {
//     return "tools";
//   }
//   // Otherwise, we stop (reply to the user) using the special "__end__" node
//   return END;
// }

// // Define the function that calls the model
// async function callModel(state: typeof MessagesAnnotation.State) {
//   const response = await llm.invoke(state.messages);
//   return { messages: [response] };
// }

// // Define the function that handles tool execution
// async function callTools(state: typeof MessagesAnnotation.State) {
//   const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
//   const toolCalls = lastMessage.tool_calls || [];

//   // Process each tool call
//   const results = await Promise.all(
//     toolCalls.map(async (toolCall) => {
//       // Check if this is a weather tool call
//       if (toolCall.name === "get_weather") {
//         // Handle different types of args - could be string or object
//         const args =
//           typeof toolCall.args === "string"
//             ? JSON.parse(toolCall.args)
//             : toolCall.args;

//         const result = await getWeatherTool.invoke(args);

//         return {
//           tool_call_id: toolCall.id,
//           name: toolCall.name,
//           content: JSON.stringify(result),
//         };
//       }

//       return {
//         tool_call_id: toolCall.id,
//         name: toolCall.name,
//         content: "Tool not found",
//       };
//     })
//   );

//   // Create the tool response message
//   const toolResponseMessage = new AIMessage({
//     content: "",
//     tool_calls: [],
//     additional_kwargs: {
//       tool_responses: results,
//     },
//   });

//   return { messages: [...state.messages, toolResponseMessage] };
// }

// // Define the state graph
// export const createGraph = () => {
//   const checkpointSaver = new MemorySaver();

//   const workflow = new StateGraph(MessagesAnnotation)
//     .addNode("agent", callModel)
//     .addNode("tools", callTools)
//     .addEdge(START, "agent")
//     .addEdge("tools", "agent")
//     .addConditionalEdges("agent", shouldContinue);

//   // Compile the graph
//   return workflow.compile({
//     checkpointer: checkpointSaver,
//   });
// };

// // Helper function to create a new instance of the graph
// export const createAgentGraph = () => {
//   return createGraph();
// };

import { Annotation, MemorySaver } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
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

const model = new ChatOpenAI({ model: "gpt-4o", streaming: true });
const boundModel = model.bindTools(tools);

const routeMessage = (state: typeof StateAnnotation.State) => {
  const { messages } = state;
  const lastMessage = messages[messages.length - 1] as AIMessage;
  // If no tools are called, we can finish (respond to the user)
  if (!lastMessage?.tool_calls?.length) {
    return END;
  }
  // Otherwise if there is, we continue and call the tools
  return "tools";
};

const callModel = async (state: typeof StateAnnotation.State) => {
  // For versions of @langchain/core < 0.2.3, you must call `.stream()`
  // and aggregate the message from chunks instead of calling `.invoke()`.
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

// export const createGraph = () => {
//   const checkpointSaver = new MemorySaver();

//   // Compile the graph
//   return workflow.compile({
//     checkpointer: checkpointSaver,
//   });
// };

export const createAgentGraph = () => {
  return graph;
};

async function main() {
  let inputs = {
    messages: [{ role: "user", content: "Hi how are you?" }],
  };

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
    }
  }
}

main();
