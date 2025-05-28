# 🤖 Jeffe — Azure Web App Popup OpenAI Chatbot

A production-ready Node.js web app featuring a popup chatbot UI powered by Azure OpenAI and Azure Cognitive Search. Includes optional speech-to-text (Azure Speech) and is designed for easy deployment to Azure Web Apps.

---

## Features

- **Popup chatbot UI** with modern styling, call center integration, and avatars
- **Azure OpenAI**-powered, grounded answers (with AI Search and citation support)
- **Speech-to-text** via Azure Speech Services (optional)
- **No secrets or virtual environments committed** (uses `.env` and `.gitignore`)
- **Easy deployment to Azure Web App (Linux or Windows)**
- All static files live in `/public` (HTML, CSS, JS, images)

---

## Project Structure

```text
.
├── .azure/                  # (Optional) Local Azure config (not tracked)
├── .env                     # Local secrets (never tracked)
├── .gitignore
├── appsettings.template.json# Example config for Azure settings (no secrets)
├── package.json
├── package-lock.json
├── server.js                # Express backend API
├── public/
│   ├── index.html
│   ├── script.js
│   ├── styles.css
│   ├── jeffe-avatar.png
│   ├── gov-ai-logo.png
│   ├── mic.png
│   ├── callcenter.png
│   ├── clear-chatbot.png
│   ├── send-message.png
│   ├── lets-chat-logo.jpg
└── README.md
Setup
1. Clone the repo
git clone https://github.com/jdnuckolls/azurewebapp_popup_openai_chatbot.git
cd azurewebapp_popup_openai_chatbot

2. Install dependencies
npm install

3. Create your .env file
Copy .env.example to .env and fill in your Azure API keys and endpoints. Never commit .env!

4. Create (optional) Azure settings
For Azure Web App deployment, configure application settings using the values in appsettings.template.json.

Running Locally
npm start
App will be available at http://localhost:3000

Visit in your browser and open the popup chatbot!

Deployment
Deploy to Azure Web App using Azure CLI or through the Azure Portal.

Set all required environment variables in the Azure portal or via CLI (do not deploy your .env file).

Security
No secrets, virtual envs, or node_modules are tracked in this repo (see .gitignore)

Never commit .env, appsettings.json, or any secrets

Customizing
UI: Edit /public/styles.css and /public/index.html

Backend/AI logic: See server.js

Speech-to-text: Set ENABLE_SPEECH=true in Azure/Web App settings to enable

License
MIT

Created by Jeff Nuckolls
Powered by Azure OpenAI & Cognitive Search


