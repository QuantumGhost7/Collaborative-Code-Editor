import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
//Set environment variables
dotenv.config();

type Message = string;
//Create http server
const server = createServer();
//Create WS Server from http server
const wss = new WebSocketServer({ server });
let textData: Message = '';
//Set poth for files directory
const FILES_DIR = path.join(__dirname, 'files');
fs.mkdir(FILES_DIR, { recursive: true }).catch(console.error);

//Event listener for new connections
wss.on('connection', (ws: WebSocket) => {
  ws.send(JSON.stringify({ type: 'TEXT_UPDATED', content: textData }));

  // Send the initial file list to the newly connected client
  sendFileList(ws);

  // Handle incoming messages from clients
  ws.on('message', async (message: string) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case 'UPDATE_TEXT':
        textData = data.content;
        broadcastToAll(JSON.stringify({ type: 'TEXT_UPDATED', content: textData }));
        break;
      case 'SAVE_FILE':
        await saveFile(data.filename, data.content);
        broadcastToAll(JSON.stringify({ type: 'FILE_SAVED', filename: data.filename }));
        broadcastFileList();
        break;
      case 'GET_FILES':
        sendFileList(ws);
        break;
      case 'LOAD_FILE':
        const fileContent = await loadFile(data.filename);
        ws.send(JSON.stringify({ type: 'FILE_LOADED', filename: data.filename, content: fileContent }));
        break;
      case 'AI_CODE_COMPLETION':
        const aiCompletion = await getAICodeCompletion(data.content, data.prompt, data.language);
        ws.send(JSON.stringify({ type: 'AI_CODE_COMPLETION', content: aiCompletion }));
        break;
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is not set');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function saveFile(filename: string, content: string) {
  await fs.writeFile(path.join(FILES_DIR, filename), content, 'utf-8');
}

async function getFiles(): Promise<string[]> {
  return fs.readdir(FILES_DIR);
}

async function loadFile(filename: string): Promise<string> {
  return fs.readFile(path.join(FILES_DIR, filename), 'utf-8');
}

function broadcastToAll(message: string) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

async function sendFileList(ws: WebSocket) {
  const files = await getFiles();
  ws.send(JSON.stringify({ type: 'FILE_LIST', files }));
}

async function broadcastFileList() {
  const files = await getFiles();
  broadcastToAll(JSON.stringify({ type: 'FILE_LIST', files }));
}

async function getAICodeCompletion(content: string, prompt: string, language: string): Promise<string> {
  const maxRetries = 100;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });
      const fullPrompt = `Given the following code:

${content}

The user has selected or placed their cursor at this point and provided this prompt:
"${prompt}"

Please provide ONLY the code that should be inserted at this point, without any additional context or full function implementations. Your response should be a small snippet that directly addresses the prompt, ready to be inserted into the existing code. Do not include any code block formatting or language specifiers.`;
      
      
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      let text = response.text();
      
      // Remove code block markers from the beginning and end of the text
      text = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
      
      // Remove any remaining code block markers
      text = text.replace(/```[\w]*\n?/g, '').replace(/\n?```/g, '');
      
      console.log('Received response from Gemini:', text);
      
      return text;
    } catch (error) {
      console.error(`Error in getAICodeCompletion (attempt ${retries + 1}):`, error);
      if (retries >= maxRetries) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return `Error: Unable to get AI code completion after ${maxRetries} attempts. Last error: ${errorMessage}`;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  return 'Error';
}

const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on ws://0.0.0.0:${PORT}`);
});
