// public/script.js

// Always start with a fresh chatHistory on page load
localStorage.removeItem("chatHistory");
let chatHistory = [];

let isListening = false;
let recognizer;
let fallbackMessage = "";

// 1) Hide mic if speech disabled
fetch("/speech-enabled")
  .then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then((data) => {
    if (!data.enabled) {
      document.getElementById("chatbotMic").style.display = "none";
    }
  })
  .catch((err) => console.warn("Speech setting check failed:", err));

// 2) Core UI functions
function handleKeyPress(e) {
  if (e.key === "Enter") sendUserMessage();
}

function appendMessageToLog(msgObj) {
  // msgObj = { role: "user"|"assistant", content: "…" }
  const body = document.getElementById("chatbotBody");
  const el = document.createElement("div");
  el.className = `message ${msgObj.role === "user" ? "user" : "bot"}`;
  el.innerHTML = msgObj.content;
  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
}

function renderHistory() {
  const body = document.getElementById("chatbotBody");
  body.innerHTML = "";
  for (const msg of chatHistory) {
    appendMessageToLog(msg);
  }
}

function toggleChatbot() {
  const popup = document.getElementById("chatbotPopup");
  const show = popup.style.display !== "flex";
  popup.style.display = show ? "flex" : "none";

  if (show) {
    if (!localStorage.getItem("chatbotShownBefore")) {
      addMessage("bot", "🖐️ Hi! I’m PopChat, your AI-enabled assistant—how can I help?");
      localStorage.setItem("chatbotShownBefore", "true");
    } else {
      // If there is existing chatHistory, re-render it; otherwise show greeting
      if (chatHistory.length > 0) {
        renderHistory();
      } else {
        const greeting = "🖐️ Hello again! How can I help?";
        // Only add it if no identical assistant message is already in chatHistory
        const exists = chatHistory.some(
          msg => msg.role === "assistant" && msg.content === greeting
        );
        if (!exists) {
          addMessage("bot", greeting);
          // Also push into history so it won’t get re-added on the next toggle
          chatHistory.push({ role: "assistant", content: greeting });
          localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
        }
      }
    }
    document.getElementById("chatbotInput").focus();
  }
}

async function sendUserMessage() {
  const input = document.getElementById("chatbotInput");
  const text = input.value.trim();
  if (!text) return;

  // 1) Append user message to UI + history
  const userMsg = { role: "user", content: text };
  appendMessageToLog(userMsg);
  chatHistory.push(userMsg);
  input.value = "";
  localStorage.setItem("chatHistory", JSON.stringify(chatHistory));

  // 2) Disable input while waiting
  input.disabled = true;
  document.getElementById("sendMsg").disabled = true;

  try {
    // 3) Call /chat with full history
    const resp = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory }),
    }).then((r) => r.json());

    if (resp.error) {
      addMessage("bot", resp.reply, text);
      return;
    }

    // 4) Build the assistant’s HTML plus citations if any
    let html = resp.reply;
    if (Array.isArray(resp.citations) && resp.citations.length > 0) {
      html +=
        "<br/><br/><ul class='citations'>" +
        resp.citations.map((c) => `<li>${c}</li>`).join("") +
        "</ul>";
    }

    // 5) Append assistant reply to UI & then push to history
    addMessage("bot", html);
    const assistantMsg = { role: "assistant", content: html };
    chatHistory.push(assistantMsg);
    localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
  } catch (err) {
    console.error(err);
    addMessage("bot", "⚠️ Something went wrong. Please try again.");
  } finally {
    // 6) Re-enable input
    document.getElementById("chatbotInput").disabled = false;
    document.getElementById("sendMsg").disabled = false;
    document.getElementById("chatbotInput").focus();
  }
}

function addMessage(sender, msg, retryText = null) {
  // sender = "user" or "bot"
  const body = document.getElementById("chatbotBody");
  const el = document.createElement("div");
  el.className = `message ${sender}`;
  el.innerHTML = msg;

  if (retryText) {
    const btn = document.createElement("button");
    btn.textContent = "🔁 Retry";
    btn.onclick = () => {
      document.getElementById("chatbotInput").value = retryText;
      sendUserMessage();
    };
    el.appendChild(btn);
  }

  body.appendChild(el);
  body.scrollTop = body.scrollHeight;
}

function clearChat(welcome = false) {
  chatHistory = [];
  localStorage.removeItem("chatHistory");
  const body = document.getElementById("chatbotBody");
  body.innerHTML = "";
  if (welcome) addMessage("bot", "🖐️ Hello again! How can I help?");
}

// 3) Speech‐to‐text
function updateListeningIndicator(active) {
  document.getElementById("chatbotInput").placeholder = active
    ? "🎙️ Listening..."
    : "Type a message...";
}

async function startSpeechRecognition() {
  const mic = document.getElementById("chatbotMic");
  mic.classList.add("active");

  try {
    const { token, region } = await fetch("/speech-token").then((r) => r.json());
    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
    speechConfig.speechRecognitionLanguage = "en-US";
    const recognizerLocal = new SpeechSDK.SpeechRecognizer(
      speechConfig,
      SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    isListening = true;
    updateListeningIndicator(true);

    recognizerLocal.recognizeOnceAsync((result) => {
      mic.classList.remove("active");
      isListening = false;
      updateListeningIndicator(false);

      if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
        document.getElementById("chatbotInput").value = result.text;
        sendUserMessage();
      } else {
        alert("Speech not recognized. Try again.");
      }
      recognizerLocal.close();
    });
  } catch (err) {
    console.error("Speech recognition error:", err);
    document.getElementById("chatbotMic").classList.remove("active");
    isListening = false;
    updateListeningIndicator(false);
  }
}

// 4) Wire up events **after** DOM is ready
window.addEventListener("DOMContentLoaded", () => {
  fetch("/config")
    .then((r) => r.json())
    .then((cfg) => (fallbackMessage = cfg.fallbackMessage || ""))
    .catch(() => {});

  document.getElementById("chatbotMic").addEventListener("click", () => {
    if (isListening) {
      recognizer.stopContinuousRecognitionAsync();
    } else {
      startSpeechRecognition();
    }
  });
  document.getElementById("sendMsg").addEventListener("click", sendUserMessage);
  document.getElementById("chatbotReset").addEventListener("click", () => clearChat(true));
  document.getElementById("chatbotInput").addEventListener("keypress", handleKeyPress);
  document.getElementById("callCenterBtn").addEventListener("click", () => {
    alert("📞 Connecting you to a call center representative... (placeholder)");
  });
  document.getElementById("chatbotToggleBtn").addEventListener("click", toggleChatbot);
});
