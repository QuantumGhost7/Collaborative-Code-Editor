<script lang="ts">
    import { browser } from '$app/environment';
    import { onMount } from 'svelte';
    import CodeMirror from 'svelte-codemirror-editor';
    import { javascript } from '@codemirror/lang-javascript';
    import { java } from '@codemirror/lang-java';
    import { oneDark } from '@codemirror/theme-one-dark';
    import type { EditorView } from '@codemirror/view';
    
    let socket: WebSocket | null = null;
    let text = '';
    let files: string[] = [];
    let currentFile = '';
    let editor: EditorView;
    let pingInterval: number;

    onMount(() => {
        if (browser) {
            initializeWebSocket();
        }
        return () => {
            if (socket) socket.close();
            clearInterval(pingInterval);
        };
    });

    function initializeWebSocket() {
        socket = new WebSocket('ws://192.168.177.222:8080');

        socket.onmessage = ({ data }) => {
            const message = JSON.parse(data);
            console.log('Received message:', message);
            handleWebSocketMessage(message);
        };

        socket.onerror = (error) => console.error('WebSocket error:', error);

        socket.onopen = () => {
            console.log('WebSocket connected');
            getFiles();
            startPingInterval();
        };

        socket.onclose = () => {
            console.log('WebSocket disconnected');
            clearInterval(pingInterval);
            setTimeout(initializeWebSocket, 5000);
        };
    }

    function handleWebSocketMessage(data: any) {
        switch (data.type) {
            case 'TEXT_UPDATED':
                text = data.content;
                break;
            case 'FILE_LIST':
                files = data.files;
                break;
            case 'FILE_LOADED':
                text = data.content;
                currentFile = data.filename;
                break;
            case 'FILE_SAVED':
                alert(`File ${data.filename} saved successfully!`);
                getFiles();
                break;
            case 'AI_CODE_COMPLETION':
                console.log('Received AI completion:', data.content);
                handleAICompletion(data.content);
                break;
        }
    }

    function startPingInterval() {
        pingInterval = setInterval(() => {
            if (socket?.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'PING' }));
            }
        }, 30000);
    }

    function updateText(value: string) {
        text = value;
        if (browser && socket?.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'UPDATE_TEXT', content: text }));
        } else {
            console.error('WebSocket is not connected');
        }
    }

    function saveFile() {
        const filename = prompt('Enter filename to save:', currentFile || 'newfile.txt');
        if (filename) {
            socket?.send(JSON.stringify({ type: 'SAVE_FILE', filename, content: text }));
            currentFile = filename;
        }
    }

    function getFiles() {
        socket?.send(JSON.stringify({ type: 'GET_FILES' }));
    }

    function loadFile(filename: string) {
        socket?.send(JSON.stringify({ type: 'LOAD_FILE', filename }));
    }

    function queryAICompletion() {
        if (browser && socket?.readyState === WebSocket.OPEN && editor) {
            const selection = editor.state.selection.main;
            const selectedText = editor.state.sliceDoc(selection.from, selection.to);
            const fullContent = editor.state.doc.toString();
            if (selectedText) {
                socket.send(JSON.stringify({ 
                    type: 'AI_CODE_COMPLETION', 
                    content: fullContent,
                    prompt: selectedText,
                    language: 'java'
                }));
            } else {
                alert('Please select a prompt for AI completion');
            }
        } else {
            console.error('WebSocket is not connected or editor is not initialized');
        }
    }

    function handleAICompletion(completion: string) {
        if (editor) {
            const selection = editor.state.selection.main;
            editor.dispatch({
                changes: [{from: selection.from, to: selection.to, insert: completion}]
            });
        }
    }
</script>

{#if browser}
    <div class="app-container">
        <div class="file-list">
            <h3>Files:</h3>
            <ul>
                {#each files as file}
                    <li>
                        <button class="file-button" on:click={() => loadFile(file)}>{file}</button>
                    </li>
                {/each}
            </ul>
        </div>
        <div class="editor-container">
            <CodeMirror
                bind:value={text}
                on:change={({ detail }) => updateText(detail)}
                on:ready={({ detail }) => editor = detail}
                lang={java()}
                theme={oneDark}
                styles={{
                    "&": {
                        height: "calc(100vh - 150px)",
                        width: "100%"
                    }
                }}
            />
            <div class="button-container">
                <button class="save-button" on:click={saveFile}>Save File</button>
                <button class="ai-complete-button" on:click={queryAICompletion}>AI Complete</button>
            </div>
        </div>
    </div>
{/if}

<style>
    .app-container {
        display: flex;
        height: 100vh;
    }

    .file-list {
        width: 250px;
        background-color: #f0f0f0;
        padding: 15px;
        overflow-y: auto;
        border-right: 1px solid #ddd;
    }

    .file-list h3 {
        margin-top: 0;
        margin-bottom: 10px;
        color: #333;
    }

    ul {
        list-style-type: none;
        padding: 0;
        margin: 0;
    }

    li {
        margin-bottom: 8px;
    }

    .file-button {
        width: 100%;
        padding: 8px 12px;
        font-size: 0.9em;
        background-color: #f8f8f8;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.2s;
        text-align: left;
    }

    .file-button:hover {
        background-color: #e8e8e8;
    }

    .editor-container {
        flex-grow: 1;
        display: flex;
        flex-direction: column;
        padding: 20px;
    }

    .save-button,
    .ai-complete-button {
        flex: 1;
        padding: 8px 16px;
        font-size: 1em;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.3s;
    }

    .save-button {
        background-color: #4CAF50;
    }

    .save-button:hover {
        background-color: #45a049;
    }

    .ai-complete-button {
        background-color: #4a90e2;
    }

    .ai-complete-button:hover {
        background-color: #357ae8;
    }

    :global(.cm-editor) {
        font-size: 1.2em;
        border: 2px solid #ccc;
        border-radius: 5px;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .completion-result {
        margin-top: 20px;
        padding: 10px;
        background-color: #f0f0f0;
        border-radius: 4px;
    }

    .completion-result h4 {
        margin-top: 0;
    }

    .completion-result pre {
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .button-container {
        display: flex;
        gap: 10px;
        margin-top: 10px;
    }
</style>
