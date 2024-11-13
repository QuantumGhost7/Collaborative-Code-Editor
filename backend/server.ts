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

function formatCode(code: string): string {
  // Split into lines and remove empty lines at start/end
  let lines = code.split('\n').filter(line => line.trim());
  
  // Find the minimum indentation level
  const minIndent = Math.min(
    ...lines
      .filter(line => line.trim())
      .map(line => {
        const match = line.match(/^\s*/);
        return match ? match[0].length : 0;
      })
  );

  // Remove the common indentation
  lines = lines.map(line => line.slice(minIndent));

  // Join lines back together
  return lines.join('\n');
}

async function getAICodeCompletion(content: string, prompt: string, language: string): Promise<string> {
  const maxRetries = 100;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-pro" });
      const fullPrompt = `You are a helpful coding assistant. The user is writing ${language} code and needs help implementing a specific feature.

Current code context:
${content}

User's request: "${prompt}"

Rules:
1. Provide ONLY the implementation code, no explanations
2. Keep the code simple and conventional
3. Don't include function/class declarations unless specifically requested
4. Don't include code block markers or comments
5. The code should be ready to directly insert into the existing codebase
6. Focus on standard library solutions when possible
7. Maintain consistent indentation using spaces
8. Start the code at the base indentation level (no leading spaces)

Please provide the implementation:`;
      
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      let text = response.text();
      
      // Clean up the response
      text = text
        .replace(/^```[\w]*\n?/, '')
        .replace(/\n?```$/, '')
        .replace(/```[\w]*\n?/g, '')
        .replace(/\n?```/g, '')
        .trim();
      
      // Format the code
      text = formatCode(text);
      
      console.log('Received response from Gemini:', text);
      
      return text;
    } catch (error) {
      console.error(`Error in getAICodeCompletion (attempt ${retries + 1}):`, error);
      retries++;
      if (retries >= maxRetries) {
        return `Error: Unable to get AI code completion after ${maxRetries} attempts.`;
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
