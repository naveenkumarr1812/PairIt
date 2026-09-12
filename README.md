# PAIR

PAIR connects a local development environment to AI services through the developer's already-open browser sessions.

## Architecture

```text
Your Python application
        |
        v
     PAIR SDK
        |
        v
 Local PAIR bridge
        |
        | one WebSocket connection
        v
   PAIR Chrome extension
      /    |    \
     /     |     \
ChatGPT  Claude  Gemini
 browser  browser  browser
```

The important boundary is the extension connection. The local development environment connects to **PAIR once**. It does not create a separate local connection to ChatGPT, Claude, or Gemini.

PAIR only looks for a provider browser tab when a request for that provider arrives.

## Developer workflow

1. Start your local Python application / PAIR bridge.
2. Open Chrome and keep the AI provider tabs you want to use logged in.
3. Open the PAIR extension popup.
4. Manually turn **PAIR on**.
5. PAIR keeps trying to connect to the local bridge while it is on.
6. Send requests from your application.
7. If the requested AI tab is not open, PAIR returns a clear `provider_not_open` error such as:
   `Claude is not open. Open Claude in a Chrome tab and try again.`
8. Turn PAIR off when you are finished.

PAIR does not automatically turn itself on for a new Chrome session. This makes the developer's action explicit.

## Minimized Chrome

The extension uses Chrome's debugger lifecycle controls to keep a requested provider page active while Chrome is minimized. It does not bring the Chrome window to the foreground.

## Python example

```python
from pair import Client

client = Client(provider="chatgpt")

response = client.chat("Explain async programming in Python")
print(response.content)
```

Switch provider explicitly:

```python
client.set_provider("claude")
response = client.chat("Explain async programming in Python")
```

## Status model

There are two separate states:

- **PAIR connection:** local development environment ↔ PAIR extension.
- **Provider availability:** whether ChatGPT, Claude, or Gemini has a usable browser tab open.

A provider does not need to be connected permanently. It only needs to be open when that provider is requested.

## Safety boundary

PAIR is intended for development with AI services the developer is already authorized to use. It does not extract session cookies, bypass authentication, bypass anti-bot controls, or implement automatic provider switching to evade service limits.
