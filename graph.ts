import {
  StateGraph,
  MessagesAnnotation,
  MemorySaver,
  START,
  END,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { RunnableSequence } from "@langchain/core/runnables";
import { z } from "zod";
import dotenv from "dotenv";
import { tool } from "@langchain/core/tools";

dotenv.config();

// Weather tool definition using the prebuilt tool function
const getWeatherTool = tool(
  async ({ city }) => {
    // Simulate weather data fetch - in a real app, call a weather API
    return {
      temperature: Math.floor(Math.random() * 30) + 50, // 50-80°F
      condition: ["Sunny", "Cloudy", "Rainy", "Partly Cloudy"][
        Math.floor(Math.random() * 4)
      ],
      humidity: Math.floor(Math.random() * 50) + 30, // 30-80%
      city,
    };
  },
  {
    name: "get_weather",
    description: "Get the current weather for a location",
    schema: z.object({
      city: z.string().describe("The city to get weather for"),
    }),
  }
);

// Create the model with tools
const llm = new ChatOpenAI({
  temperature: 0,
  modelName: "gpt-4o",
}).bindTools([getWeatherTool]);

// Define the function that determines whether to continue or finish
function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
  const lastMessage = messages[messages.length - 1] as AIMessage;

  // If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.tool_calls?.length) {
    return "tools";
  }
  // Otherwise, we stop (reply to the user) using the special "__end__" node
  return END;
}

// Define the function that calls the model
async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await llm.invoke(state.messages);
  return { messages: [response] };
}

// Define the function that handles tool execution
async function callTools(state: typeof MessagesAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];

  // Process each tool call
  const results = await Promise.all(
    toolCalls.map(async (toolCall) => {
      // Check if this is a weather tool call
      if (toolCall.name === "get_weather") {
        // Handle different types of args - could be string or object
        const args =
          typeof toolCall.args === "string"
            ? JSON.parse(toolCall.args)
            : toolCall.args;

        const result = await getWeatherTool.invoke(args);

        return {
          tool_call_id: toolCall.id,
          name: toolCall.name,
          content: JSON.stringify(result),
        };
      }

      return {
        tool_call_id: toolCall.id,
        name: toolCall.name,
        content: "Tool not found",
      };
    })
  );

  // Create the tool response message
  const toolResponseMessage = new AIMessage({
    content: "",
    tool_calls: [],
    additional_kwargs: {
      tool_responses: results,
    },
  });

  return { messages: [...state.messages, toolResponseMessage] };
}

// Define the state graph
export const createGraph = () => {
  const checkpointSaver = new MemorySaver();

  const workflow = new StateGraph(MessagesAnnotation)
    .addNode("agent", callModel)
    .addNode("tools", callTools)
    .addEdge(START, "agent")
    .addEdge("tools", "agent")
    .addConditionalEdges("agent", shouldContinue);

  // Compile the graph
  return workflow.compile({
    checkpointer: checkpointSaver,
  });
};

// Helper function to create a new instance of the graph
export const createAgentGraph = () => {
  return createGraph();
};
