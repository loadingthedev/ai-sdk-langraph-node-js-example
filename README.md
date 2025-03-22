# AI Chat API

A Node.js backend service that provides two chat endpoints:
- Standard chat using OpenAI API
- Agent-based chat using LangGraph with tool capabilities

## Prerequisites

- Node.js (v16+)
- pnpm (v8+)
- OpenAI API key

## Setup

1. Clone the repository:
```bash
git clone https://github.com/loadingthedev/ai-sdk-langraph-node-js-example
cd ai-sdk-langraph-node-js-example
```

2. Install dependencies:
```bash
pnpm install
```

3. Create a `.env` file in the root directory with your OpenAI API key:
```
OPENAI_API_KEY=your_openai_api_key_here
```

## Running the Application

Start the development server:
```bash
pnpm dev
```

This will start the server at http://localhost:3000.

## API Endpoints

### Standard Chat
- **URL**: `/api/chat`
- **Method**: POST
- **Body**:
  ```json
  {
    "message": "Your message here",
    "sessionId": "optional-session-id"
  }
  ```

### Agent Chat (with tool capabilities)
- **URL**: `/api/agent-chat`
- **Method**: POST
- **Body**:
  ```json
  {
    "message": "Your message here",
    "sessionId": "optional-session-id"
  }
  ```

### Get Chat History
- **URL**: `/api/history/:sessionId`
- **Method**: GET

## Testing the Client

Open the included client example in your browser:
1. Start the server using `pnpm dev`
2. Open `client-example.html` directly in your browser from your file system

The client example includes a toggle to switch between standard chat and agent chat modes.

## Project Structure

- `index.ts` - Main server file with Express API endpoints
- `graph.ts` - LangGraph agent implementation
- `client-example.html` - Browser client for testing the API

## Features

- Streaming responses for both chat types
- Session-based conversation history
- Toggle between standard chat and agent chat with tools
- Simple search tool implementation (weather example)

## Customization

To add more tools to the agent:
1. Add new tool definitions in `graph.ts`
2. Add the new tools to the `tools` array

To modify the model:
- Update the model settings in `index.ts` and `graph.ts` 