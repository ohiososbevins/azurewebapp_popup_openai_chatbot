// public/script.js

let chatHistory = JSON.parse(localStorage.getItem("chatHistory") || "[]");
let isListening = false;
let recognizer;
let fallbackMessage = "";

// 1) Hide mic if speech disabled
fetch("/speech-enabled")
  .then(res => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })
  .then(data => {
    if (!data.enabled) {
      document.getElementById("chatbotMic").style.display = "none";
    }
  })
  .catch(err => console.warn("Speech setting check failed:", err));

// 2) Core UI functions
function handleKeyPress(e) {
  if (e.key === "Enter") sendUserMessage();
}

function toggleChatbot() {
  const popup = document.getElementById("chatbotPopup");
  const show = popup.style.display !== "flex";
  popup.style.display = show ? "flex" : "none";

  if (show) {
    if (!localStorage.getItem("chatbotShownBefore")) {
      addMessage("bot", "🖐️ Hi! I’m Jeffe, your AI-enabled assistant—how can I help?");
      localStorage.setItem("chatbotShownBefore", "true");
    } else {
      clearChat();
      addMessage("bot", "🖐️ Hello again! How can I help?");
    }
  }
}

async function sendUserMessage() {
  const input = document.getElementById("chatbotInput");
  const text = input.value.trim();
  if (!text) return;

  addMessage("user", text);
  chatHistory.push({ role: "user", content: text });
  input.value = "";
  localStorage.setItem("chatHistory", JSON.stringify(chatHistory));

  try {
    const resp = await fetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory })
    }).then(r => r.json());

    if (resp.error) {
      addMessage("bot", resp.reply, text);
      return;
    }

    const isFallback = resp.reply.trim() === fallbackMessage;
    let html = resp.reply;
    if (!isFallback && resp.citations.length) {
      html += "<br/><br/><ul class='citations'>" +
        resp.citations.map(c=>`<li>${c}</li>`).join("") +
        "</ul>";
    }

    addMessage("bot", html);
    chatHistory.push(resp.assistantMessage);
    localStorage.setItem("chatHistory", JSON.stringify(chatHistory));
  } catch (err) {
    console.error(err);
    addMessage("bot", "⚠️ Something went wrong. Please try again.");
  }
}

function addMessage(sender, msg, retryText = null) {
  const body = document.getElementById("chatbotBody");
  const el = document.createElement("div");
  el.className = `message ${sender}`;
  el.innerHTML = msg;

  if (retryText) {
    const btn = document.createElement("button");
    btn.textContent = "🔁 Retry";
    btn.onclick = () => {
      input.value = retryText;
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

// 3) Speech-to-text
function updateListeningIndicator(active) {
  document.getElementById("chatbotInput")
    .placeholder = active ? "🎙️ Listening..." : "Type a message...";
}

async function startSpeechRecognition() {
  const mic = document.getElementById("chatbotMic");
  mic.classList.add("active");

  try {
    const { token, region } = await fetch("/speech-token").then(r=>r.json());
    const speechConfig = SpeechSDK.SpeechConfig.fromAuthorizationToken(token, region);
    speechConfig.speechRecognitionLanguage = "en-US";
    const recognizer = new SpeechSDK.SpeechRecognizer(
      speechConfig,
      SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    isListening = true;
    updateListeningIndicator(true);

    recognizer.recognizeOnceAsync(result => {
      mic.classList.remove("active");
      isListening = false;
      updateListeningIndicator(false);

      if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
        document.getElementById("chatbotInput").value = result.text;
        sendUserMessage();
      } else {
        alert("Speech not recognized. Try again.");
      }
      recognizer.close();
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
    .then(r=>r.json())
    .then(cfg=> fallbackMessage = cfg.fallbackMessage || "")
    .catch(()=>{});

  document.getElementById("chatbotMic")
    .addEventListener("click", () => {
      if (isListening) {
        recognizer.stopJeffenuousRecognitionAsync();
      } else {
        startSpeechRecognition();
      }
    });
  document.getElementById("sendMsg")
    .addEventListener("click", sendUserMessage);
  document.getElementById("chatbotReset")
    .addEventListener("click", () => clearChat(true));
  document.getElementById("chatbotInput")
    .addEventListener("keypress", handleKeyPress);
    document.getElementById("callCenterBtn").addEventListener("click", () => {
      alert("📞 Connecting you to a call center representative... (placeholder)");
    });
  document.getElementById("chatbotToggleBtn")
    .addEventListener("click", toggleChatbot);
});
