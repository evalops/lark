# Lark Architecture

Lark is an Electron-based desktop application that provides a "Computer Use Agent" interface. It allows users to give natural language instructions to an AI model (Claude or Gemini), which then autonomously controls the computer's mouse and keyboard to complete the task.

## System Overview

The application follows a standard Electron multi-process architecture:

1.  **Main Process**: Handles the OS integration, agent loop, and computer control.
2.  **Renderer Process**: Provides the UI for the user to chat with the agent and configure settings.
3.  **Preload Scripts**: Bridges the gap between the isolated Renderer and the privileged Main process via `contextBridge`.

```mermaid
graph TD
    User[User] -->|Interacts| UI[Renderer Process (UI)]
    UI -->|IPC Calls| Main[Main Process]
    Main -->|Controls| OS[Operating System]
    Main -->|API Calls| LLM[LLM Provider (Anthropic/Google)]
    
    subgraph Main Process
        IPC[IPC Handlers]
        Agent[Agent Service]
        Actions[Computer Actions]
        Screen[Screen Capture]
        AX[Accessibility Client]
    end
    
    Main --> IPC
    IPC --> Agent
    Agent --> Screen
    Agent --> AX
    Agent --> Actions
    Agent --> LLM
```

## Key Components

### 1. Agent Service (`src/main/services/agent.ts`)
The core "brain" of Lark. It implements the agent loop:
1.  **Capture State**: Takes a screenshot and retrieves the UI tree (via `axdumper`).
2.  **Think**: Sends the screenshot + prompt to the LLM.
3.  **Act**: Receives tool calls from the LLM (e.g., `click`, `type`) and executes them.
4.  **Repeat**: Continues until the task is done or max steps are reached.

It also handles **Human-in-the-Loop (HITL)** confirmation. Before executing potentially dangerous actions (currently `Enter` or `Delete` keystrokes), it pauses and asks the user for permission via the UI.

### 2. Computer Actions (`src/main/computerActions.ts`)
A wrapper around `@nut-tree-fork/nut-js` that translates high-level intents (e.g., "click at 500,500") into low-level OS events. It handles:
-   Mouse movement and clicking.
-   Keyboard typing and shortcuts.
-   Visual indicators (drawing trails/clicks) to show what the agent is doing.

### 3. Accessibility Client (`src/main/services/axClient.ts`)
Uses a native Swift helper (`native/axdumper`) to query the macOS Accessibility API. This provides the LLM with a structured tree of the current window's UI (buttons, text fields, etc.), allowing for more precise interactions than vision alone.

### 4. Screen Capture (`src/main/screen.ts`)
Captures the screen content. This is fed to the vision-capable LLMs to "see" the desktop.

### 5. Configuration (`src/main/config.ts`)
Manages application settings, persisted in `user.env`.
-   **Providers**: Switches between Claude (Anthropic) and Gemini (Google).
-   **Agent Settings**: Max steps, delay between actions.
-   **Safety**: Toggles for HITL confirmation.

## Safety & Security

Lark operates with high privileges (screen recording, input control). To mitigate risks:
-   **HITL Confirmation**: "Dangerous" keystrokes require explicit user approval.
-   **Visual Feedback**: Users can see exactly what the agent is doing (mouse trails, status updates).
-   **Stop Button**: A global stop mechanism immediately halts the agent loop.
-   **API Key Storage**: Keys are stored locally in the user's config file, not on any external server.

## Technology Stack

-   **Runtime**: Electron, Node.js
-   **Language**: TypeScript
-   **UI**: HTML/CSS/Vanilla JS (kept lightweight for performance)
-   **Automation**: `@nut-tree-fork/nut-js`
-   **AI SDKs**: `@anthropic-ai/sdk`, Google Generative AI
-   **Native**: Swift (for Accessibility API interaction)

## Directory Structure

-   `src/main`: Backend logic (Node.js).
-   `src/renderer`: Frontend logic (Browser).
-   `src/preload`: IPC bridge.
-   `src/common`: Shared types.
-   `native`: Native helper tools (Swift).
-   `dist`: Compiled assets.

