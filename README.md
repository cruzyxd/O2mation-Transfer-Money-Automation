# Gemini Telegram Workflow Bot 🚀

An intelligent automation bot built with **Node.js**, **Telegraf**, and **Google Gemini AI**. This bot streamlines internal payment request workflows for teams, featuring multi-role authorization, AI-powered data extraction, and Google Sheets synchronization.

## 🌟 Key Features

-   **AI-Powered Data Extraction**: Uses Google Gemini Pro to parse natural language payment requests. It automatically extracts:
    -   **Amount**: Normalized to Saudi Riyals (SR).
    -   **Recipient**: Who is being paid.
    -   **Purpose**: The reason for the payment.
-   **Multi-Role Workflow**:
    -   **Managers**: Can initiate and approve payment requests.
    -   **Accountants**: Receive notifications for approved payments to process them.
-   **Google Sheets Sync**: Automatically logs all transactions, approvals, and payment statuses to a centralized Google Sheet for accounting and auditing.
-   **Automated Reminders**: Built-in cron jobs to remind managers of pending approvals and accountants of pending payments.
-   **Secure Access**: Middleware-based authorization ensuring only pre-defined Telegram IDs can interact with the bot.

## 🛠️ Tech Stack

-   **Runtime**: Node.js
-   **Bot Framework**: [Telegraf](https://telegraf.js.org/)
-   **AI Engine**: [Google Generative AI (Gemini Pro)](https://ai.google.dev/)
-   **Database**: SQLite (Local storage for request states)
-   **External Integration**: Google Sheets API v4
-   **Scheduling**: node-cron

## 🚀 Getting Started

### Prerequisites

-   Node.js (v18 or higher)
-   A Telegram Bot Token (from [@BotFather](https://t.me/botfather))
-   A Google Gemini API Key
-   Google Cloud Service Account credentials (for Sheets integration)

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/cruzyxd/O2-Transfer-Money-Automation-Telegram-Bot.git
    cd O2-Transfer-Money-Automation-Telegram-Bot
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    Create a `.env` file in the root directory and add the following:
    ```env
    BOT_TOKEN=your_telegram_bot_token
    GEMINI_API_KEY=your_gemini_api_key
    
    # Authorized Telegram IDs
    MANAGER_A_ID=123456789
    MANAGER_B_ID=987654321
    ACCOUNTANT_ID=456789123
    
    # Google Sheets Configuration
    GOOGLE_SHEET_ID=your_spreadsheet_id
    GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
    GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
    ```

4.  **Initialize the Database and Sheets**:
    ```bash
    node scripts/init_sheet.js
    ```

5.  **Start the Bot**:
    ```bash
    npm start
    ```

## 🤖 How It Works

1.  **Request**: A **Manager** sends a message like *"Pay 5000 to Ali for office supplies"*.
2.  **AI Extraction**: Gemini extracts the details. If any info is missing, the bot asks clarifying questions.
3.  **Approval**: The request is sent to the **Approval Manager**. They can **Approve** or **Decline** via inline buttons.
4.  **Notification**: Once approved, the **Accountant** is notified to process the payment.
5.  **Logging**: Every step (Request -> Approval -> Payment) is synced to the linked Google Sheet in real-time.

## 📁 Project Structure

-   `index.js`: Main bot logic and entry point.
-   `utils/db.js`: SQLite database management for local state.
-   `utils/sheetsSync.js`: Integration with Google Sheets API.
-   `utils/reminders.js`: Cron-based reminder system.
-   `scripts/`: Utility scripts for initialization and testing.

---
*Created for Habibco Automation Workflow.*
