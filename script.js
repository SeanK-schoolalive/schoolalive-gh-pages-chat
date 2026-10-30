// IMPORTANT:
// 1) Paste your Make webhook URL here.
// 2) The webhook must accept JSON POST requests with this format:
//    {
//      "message": "<user message>",
//      "conversationId": "<stable browser conversation ID>"
//    }
// 3) The webhook response should be JSON in this format:
//    {
//      "reply": "<AI response>",
//      "conversationId": "<conversation ID>"
//    }
// 4) Never keep an API key or secret in a static frontend on GitHub Pages.
//    A browser-based site cannot hide secrets from the user, so any credentials
//    must be kept on the server or in a secure backend proxy instead.
// 5) This page does not assume the site is hosted at the domain root, so it works
//    from a GitHub Pages subpath like /your-repo/ as long as the webhook URL is absolute.
// 6) Browsers enforce CORS. The Make webhook must allow requests from this GitHub Pages
//    origin or the request will fail before it reaches the AI service.

const MAKE_WEBHOOK_URL = "https://hook.us2.make.com/06b421tarr13ul9ecn8r4nvp2weccteu";

const messagesEl = document.getElementById("messages");
const formEl = document.getElementById("chat-form");
const inputEl = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const loadingIndicator = document.getElementById("loading-indicator");
const errorBanner = document.getElementById("error-banner");

const SESSION_STORAGE_KEY = "chatConversationId";

const state = {
  conversationId: "",
  pendingMessage: "",
  isLoading: false,
  abortController: null,
};

function safeText(value) {
  return String(value ?? "");
}

// Generate a random browser conversation ID on first visit and store it in sessionStorage.
// Do not store any message content in localStorage.
function generateConversationId() {
  const bytes = new Uint8Array(16);
  const cryptoRef = window.crypto || window.msCrypto;

  if (cryptoRef && typeof cryptoRef.getRandomValues === "function") {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const hex = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${Date.now()}-${hex}`;
}

function getOrCreateConversationId() {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing && existing.trim()) {
      return existing;
    }
  } catch (error) {
    // sessionStorage may be unavailable or blocked in some browsers.
    // Continue with an in-memory ID for this tab session.
  }

  const newId = generateConversationId();

  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, newId);
  } catch (error) {
    // Ignore storage errors and keep the in-memory ID.
  }

  return newId;
}

function setLoadingState(isLoading) {
  state.isLoading = isLoading;
  sendButton.disabled = isLoading;
  loadingIndicator.classList.toggle("hidden", !isLoading);
}

function showErrorBanner(message) {
  errorBanner.textContent = safeText(message);
  errorBanner.classList.remove("hidden");
}

function hideErrorBanner() {
  errorBanner.textContent = "";
  errorBanner.classList.add("hidden");
}

function appendMessage(role, text, { isError = false, allowRetry = false } = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = `message ${role}${isError ? " error" : ""}`;

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  // Use textContent instead of innerHTML to prevent XSS from untrusted content.
  bubble.textContent = safeText(text);

  wrapper.appendChild(bubble);

  if (allowRetry) {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "retry-button";
    retryButton.textContent = "Retry";
    retryButton.setAttribute("aria-label", "Retry the last message");
    retryButton.addEventListener("click", () => {
      hideErrorBanner();
      sendMessage(state.pendingMessage);
    });
    wrapper.appendChild(retryButton);
  }

  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function createUserMessageText(text) {
  return safeText(text).trim();
}

function adjustTextareaHeight() {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
}

async function sendMessage(rawMessage) {
  const message = createUserMessageText(rawMessage);

  if (!message || state.isLoading) {
    return;
  }

  state.pendingMessage = message;

  // Add user message to the conversation.
  appendMessage("user", message);

  // Clear the input.
  inputEl.value = "";
  adjustTextareaHeight();

  // Prepare request.
  setLoadingState(true);
  hideErrorBanner();

  const controller = new AbortController();
  state.abortController = controller;

  const timeoutMs = 30000;
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: message,
        conversationId: state.conversationId,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText || "request failed"}`
      );
    }

    const responseText = await response.text();

    if (!responseText || !responseText.trim()) {
      throw new Error("Empty response from AI service.");
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch (error) {
      throw new Error("Malformed JSON response from AI service.");
    }

    if (!payload || typeof payload !== "object") {
      throw new Error("Malformed response payload.");
    }

    const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
    if (!reply) {
      throw new Error("Empty reply returned by the AI service.");
    }

    if (
      typeof payload.conversationId === "string" &&
      payload.conversationId.trim()
    ) {
      state.conversationId = payload.conversationId.trim();
    }

    appendMessage("assistant", reply);
  } catch (error) {
    let userMessage = "Something went wrong while sending your message.";

    if (error && error.name === "AbortError") {
      userMessage =
        "The request timed out. Please check your connection and try again.";
    } else if (error instanceof TypeError) {
      userMessage =
        "A network error occurred. Please check your connection and try again.";
    } else if (error && error.message) {
      userMessage = error.message;
    }

    // Show a visible error state and a Retry button.
    showErrorBanner(userMessage);
    appendMessage("assistant", userMessage, {
      isError: true,
      allowRetry: true,
    });
  } finally {
    state.abortController = null;
    window.clearTimeout(timeoutId);
    setLoadingState(false);
  }
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();

  const value = inputEl.value.trim();
  if (!value) {
    inputEl.focus();
    return;
  }

  sendMessage(value);
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

inputEl.addEventListener("input", adjustTextareaHeight);

state.conversationId = getOrCreateConversationId();

inputEl.focus();
adjustTextareaHeight();
appendMessage(
  "assistant",
  "Hello! I can help answer questions about this site and the AI chat setup."
);
