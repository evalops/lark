# Lark

A native macOS desktop client for Claude's computer use capability. Lark provides a minimal, always-on-top floating interface that lets Claude Opus 4.5 control your computer through natural language commands.

## Features

- **Floating Pill UI**: Unobtrusive interface that sits at the bottom of your screen, expands on hover
- **Claude Computer Use**: Leverages Anthropic's computer use API to control mouse, keyboard, and observe screen
- **Native Performance**: Built with Electron for macOS, uses native APIs for screen capture and input control
- **Real-time Feedback**: Shows step-by-step progress as Claude executes tasks
- **Visual Click Indicator**: Red circle flashes at each click location so you can see where Claude is clicking
- **Emergency Stop**: Press Escape anywhere to immediately stop the current task
- **Conversation History**: Persists chat history across sessions

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── main.ts             # App entry, window management, global hotkeys
│   ├── ipcHandlers.ts      # All IPC handlers (separated for clarity)
│   ├── config.ts           # Environment and configuration management
│   ├── computerActions.ts  # Mouse/keyboard control via nut.js
│   ├── cursorIndicator.ts  # Visual click feedback overlay
│   ├── screen.ts           # Screenshot capture
│   ├── log.ts              # Logging utilities
│   ├── statusManager.ts    # Real-time status updates to renderer
│   └── services/
│       ├── agent.ts        # Computer use agent loop
│       └── modelClient.ts  # Anthropic API client wrapper
├── preload/
│   └── preload.ts          # Secure IPC bridge
└── renderer/
    └── renderer.ts         # UI logic (pill, waveform, chat)
```

### How It Works

1. User enters a natural language command (e.g., "Open Safari and search for cats")
2. Lark takes a screenshot and sends it to Claude along with the task
3. Claude analyzes the screen and returns a computer action (click, type, scroll, etc.)
4. Lark executes the action using native APIs (nut.js for input, screenshot-desktop for capture)
5. Lark takes another screenshot showing the result
6. Loop continues until Claude determines the task is complete

### Key Components

- **ClaudeModelClient**: Wraps the Anthropic SDK with streaming support for the computer use beta API
- **Agent Loop**: Manages the observe-think-act cycle with configurable step limits and delays
- **Computer Actions**: Translates Claude's action format to native input events (clicks, drags, key combos)
- **Screen Capture**: Captures and scales screenshots to stay within API limits (1280px width)

## Requirements

- macOS 10.15+
- Anthropic API key with access to Claude Opus 4.5

## Setup

1. Download the latest DMG from [Releases](../../releases)
2. Drag Lark to Applications
3. Launch and grant permissions:
   - **Accessibility**: Required for mouse/keyboard control
   - **Screen Recording**: Required for screenshots
4. Enter your Anthropic API key when prompted

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run in development mode (with DevTools)
npm run dev

# Package as macOS app
npm run package
```

### Environment Variables

Create a `.env` file or set these in `~/Library/Application Support/Lark/user.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-opus-4-5-20251101
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_MODEL` | `claude-opus-4-5-20251101` | Claude model to use |
| `CUA_MAX_STEPS` | `1000` | Maximum steps per task |
| `AGENT_MIN_STEP_DELAY_MS` | `1000` | Minimum delay between actions |
| `PILL_BASE_HEIGHT` | `60` | Collapsed pill height in pixels |

## Security

- API keys are stored locally in `~/Library/Application Support/Lark/user.env`
- All communication with Anthropic's API uses HTTPS
- The app requires explicit user permission for accessibility and screen recording

## License

MIT

## Credits

Built by Jonathan. Powered by [Claude](https://anthropic.com/claude) computer use.
