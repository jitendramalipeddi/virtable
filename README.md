# Virtable - Collaborative Departmental Discussion Platform

Virtable is a downloadable, production-ready full-stack academic platform for departments. Users can interact inside discussion forums, which are explicitly named **disco tables**. The platform handles secure whitelisted registrations, real student identity masking via reproducible anonymous Greek handles on "muddy points" tables, automated interval-based AI summarizing workers, and a visual diagnostic bento dashboard for faculty advisors.

Runs entirely locally without external API dependencies, featuring intelligent fallback handlers that toggle between local Ollama instances and cloud Gemini models based on sandbox availability.

---

## 🚀 Features & Technical Specifications

1. **Tech Stack & Branding**: Fully localized Express backend, native SQLite persistent storage (`database.sqlite`), and a responsive single-page frontend styled using Tailwind CSS and Lucide Icons via CDN. Fully branded under Virtable:
   * "Create a Disco Table"
   * "Join the Disco Table"
   * "Active Disco Tables"
2. **Predefined Email Whitelist**: Vets registrations against a strict array string constant containing specific IIT-Bombay test accounts. Unauthorized registrations fail instantly with a `403 Forbidden` error. Passwords are safely hashed using `bcryptjs`.
3. **Secure Relational SQLite Schema**:
   * `users` (*id, name, email UNIQUE, password_hash, created_at*)
   * `disco_tables` (*id, title, description, creator_id, access_type, table_mode, cached_disco_summary, last_spun_at*)
   * `messages` (*id, disco_table_id, user_id, message_text, timestamp*)
4. **SQL Joins & Human-in-the-Loop Anonymity Toggle**: Uses an SQL `INNER JOIN` mapping messages and user records. If `table_mode` is set to `'muddy_points'`, student names are algorithmically masked using reproducible Greek titles (e.g. "Anonymous Delta", "Anonymous Kappa") so participants can clarify confusion safely.
5. **Interval Background AI Summarizer**: Sets up an automated `setInterval` scheduler executing every 15 minutes. It extracts table discussion streams, coordinates high-performance POST prompts to Ollama (`qwen2.5-coder:3b`), and persists the summarized outcome in SQLite. Features a **manual AI spin panel button** on the UI to run the summarization thread instantly during evaluation.
6. **Instructor Evaluation Bento Grid**: Built-in dashboard for professors containing:
   * **Hottest Disco Tables** sorted using message count indexes and unique core student participants.
   * **Conceptual Gap Analysis** with three distinct containers mapping: *"Common Misconceptions"*, *"Missing Foundations"*, and *"Recommended Curricular Fixes"*.

---

## 🛠️ Step-by-Step Installation Instructions

To download and run this application on your local machine:

### 1. Prerequisite Installations
* **Node.js** (v18.x or above of standard LTS releases recommended)
* Optional: **Ollama** installed locally with `qwen2.5-coder:3b` pulled:
  ```bash
  ollama run qwen2.5-coder:3b
  ```

### 2. Install Package Dependencies
From the project root directory, run:
```bash
npm install
```
This downloads and registers our dependencies: `express`, `sqlite3`, `bcryptjs`, `jsonwebtoken`, `dotenv`, and `cors` along with our devDependencies.

### 3. Setup Environment Variables
Clone the `.env.example` file and rename it to `.env`:
```env
# Optional: Add your Gemini API Key. If your local Ollama instance is offline, 
# the AI engine automatically falls back to Gemini Cloud models!
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
JWT_SECRET="virtable-super-secret-key-13579"
```

### 4. Boot up Server
Run the local database initialization script and spin up the Express router:
```bash
npm run dev
```

The system will:
1. Initialize the `database.sqlite` file in your root folder.
2. Formulate tables and seed pre-defined student/faculty profiles + discussion threads if empty.
3. Automatically run the background AI worker to summarize seeded tables upon boot.
4. Bind to **port 3000** at `http://localhost:3000`.

---

## 🧪 Quick Sandbox Evaluation Accounts

For easy testing, you can autofill or log in with these pre-whitelisted credentials directly from our user interface:

| Role | Email | Password | Mode Allowed / Purpose |
| :--- | :--- | :--- | :--- |
| **Faculty Member** | `prof@iitb.ac.in` | `prof123` | Access Instructor Evaluation Panel, review Hot Boards, and manually trigger AI Summaries. |
| **Student scholar A** | `student1@iitb.ac.in` | `student123` | Join discussions, test anonymous "Muddy Points" masking and Real-Name transparent boards. |
| **Student scholar B** | `student2@iitb.ac.in` | `student123` | Post concurrent responses to evaluate active real-time thread refreshes. |

---

## 📂 Architecture Overview

* **`server.js`**: Core backend assembly. Configures Express API routes, JWT security middleware, SQL queries, the background scheduler, and the local AI models router.
* **`public/index.html`**: Pure, lightweight Single Page Application (SPA). Operates entirely through reactive API polling, standard Tailwind styling classes, and Lucide icons.
* **`package.json`**: Holds server dependencies and configures direct node-execution scripts.
* **`database.sqlite`**: Fully relational SQLite persistent catalog (generated upon first startup).
