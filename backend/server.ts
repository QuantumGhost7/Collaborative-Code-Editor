import mongoose from 'mongoose';
import { File, Version } from './models/File';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/code_editor')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

type Message = string;
//Create http server
const server = createServer();
//Create WS Server from http server
const wss = new WebSocketServer({ server });
let textData: Message = '';

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
        const versions = await getFileVersions(data.filename);
        ws.send(JSON.stringify({ type: 'FILE_VERSIONS', versions }));
        break;
      case 'LOAD_VERSION':
        const versionContent = await loadVersion(data.versionId);
        ws.send(JSON.stringify({ type: 'FILE_LOADED', filename: data.filename, content: versionContent }));
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
    try {
        let file = await File.findOne({ filename });
        
        if (file) {
            // Create new version before updating
            await Version.create({
                fileId: file._id,
                content: file.content,
                version: await Version.countDocuments({ fileId: file._id }) + 1
            });
            
            // Update file
            file.content = content;
            file.lastModified = new Date();
            await file.save();
        } else {
            // Create new file
            file = await File.create({ 
                filename, 
                content,
                lastModified: new Date()
            });
        }
        
        return file;
    } catch (error) {
        console.error('Error saving file:', error);
        throw error;
    }
}

async function getFiles(): Promise<string[]> {
    try {
        const files = await File.find().select('filename');
        return files.map(f => f.filename);
    } catch (error) {
        console.error('Error getting files:', error);
        return [];
    }
}

async function loadFile(filename: string): Promise<string> {
    try {
        const file = await File.findOne({ filename });
        if (!file) throw new Error('File not found');
        return file.content;
    } catch (error) {
        console.error('Error loading file:', error);
        throw error;
    }
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

async function getFileVersions(filename: string) {
    try {
        const file = await File.findOne({ filename });
        if (!file) throw new Error('File not found');
        
        const versions = await Version.find({ fileId: file._id })
            .sort({ version: -1 })
            .select('version timestamp');
            
        return versions;
    } catch (error) {
        console.error('Error getting versions:', error);
        throw error;
    }
}

async function loadVersion(versionId: string) {
    try {
        const version = await Version.findById(versionId);
        if (!version) throw new Error('Version not found');
        return version.content;
    } catch (error) {
        console.error('Error loading version:', error);
        throw error;
    }
}

const PORT = 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WebSocket server running on ws://0.0.0.0:${PORT}`);
});
