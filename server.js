import express from 'express';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const defaultSecret = 'virtable-super-secret-key-13579';
const JWT_SECRET = process.env.JWT_SECRET || defaultSecret;

if (process.env.NODE_ENV === 'production' && JWT_SECRET === defaultSecret) {
  console.error('\n======================================================================');
  console.error('[Security Critical Error] Running in PRODUCTION mode without a custom JWT_SECRET set!');
  console.error('For security, the server will refuse to start.');
  console.error('Please configure your production environment variables.');
  console.error('======================================================================\n');
  process.exit(1);
}

// 1. Predefined Email Whitelist
const ALLOWED_DEPT_EMAILS = [
  'student1@iitb.ac.in',
  'student2@iitb.ac.in',
  'prof@iitb.ac.in',
  'researcher@iitb.ac.in',
  'admin@iitb.ac.in'
];

app.use(cors());
app.use(express.json());

// Serve static assets from public folder
app.use(express.static(path.join(process.cwd(), 'public')));

// Initialize SQLite database
const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'database.sqlite');
console.log(`[Database] Building / opening sqlite file at: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('[Database Connection Error] Failed to establish database:', err);
  } else {
    console.log('[Database] SQLite initialized successfully.');
  }
});

// Helper wraps to avoid callback nesting
const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) {
        console.error(`[Database Run Error] Query: "${query}" | Error:`, err);
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
};

const dbGet = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        console.error(`[Database Get Error] Query: "${query}" | Error:`, err);
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
};

const dbAll = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        console.error(`[Database All Error] Query: "${query}" | Error:`, err);
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
};

// 2. Setup SQLite tables on startup
async function initializeSchema() {
  console.log('[Database System] Starting database schema verification...');
  try {
    // Enable Foreign Keys in SQLite
    await dbRun("PRAGMA foreign_keys = ON;");

    // users
    await dbRun(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // disco_tables
    await dbRun(`
      CREATE TABLE IF NOT EXISTS disco_tables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        creator_id INTEGERNot NULL,
        access_type TEXT CHECK(access_type IN ('public', 'private')) NOT NULL,
        table_mode TEXT CHECK(table_mode IN ('academic_discussion', 'muddy_points')) NOT NULL,
        cached_disco_summary TEXT,
        last_spun_at DATETIME,
        FOREIGN KEY (creator_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    // messages
    await dbRun(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        disco_table_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        message_text TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (disco_table_id) REFERENCES disco_tables (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);

    console.log('[Database System] Tables created and certified.');

    // Seed test accounts and initial records if database is empty and seeding is requested
    const userCount = await dbGet("SELECT COUNT(*) as count FROM users");
    const shouldSeed = process.env.SEED_DATABASE === 'true';
    if (userCount.count === 0 && shouldSeed) {
      console.log('[Database Seeding] Seeding initial department records...');

      // Seed Users
      const salt = await bcrypt.genSalt(10);
      const student1Hash = await bcrypt.hash('student123', salt);
      const student2Hash = await bcrypt.hash('student123', salt);
      const profHash = await bcrypt.hash('prof123', salt);

      await dbRun(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        ["Student Delta", "25m0001@iitb.ac.in", student1Hash]
      );
      await dbRun(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        ["Student Kappa", "25m0002@iitb.ac.in", student2Hash]
      );
      await dbRun(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        ["Professor Banerjee", "prof@iitb.ac.in", profHash]
      );

      // Fetch IDs
      const s1 = await dbGet("SELECT id FROM users WHERE email = '25m0001@iitb.ac.in'");
      const s2 = await dbGet("SELECT id FROM users WHERE email = '25m0002@iitb.ac.in'");
      const pr = await dbGet("SELECT id FROM users WHERE email = 'prof@iitb.ac.in'");

      // Seed Disco Tables
      // muddy_points
      await dbRun(`
        INSERT INTO disco_tables (title, description, creator_id, access_type, table_mode, cached_disco_summary)
        VALUES (?, ?, ?, 'public', 'muddy_points', ?)
      `, [
        "CS101 Muddy Points: Recursion vs Iteration",
        "Post all your core points of confusion regard execution frames, base cases, and stack depths here.",
        pr.id,
        "Anonymously sharing confusion regarding the stack overflow limits of deep recursion calls."
      ]);

      // academic_discussion
      await dbRun(`
        INSERT INTO disco_tables (title, description, creator_id, access_type, table_mode, cached_disco_summary)
        VALUES (?, ?, ?, 'public', 'academic_discussion', ?)
      `, [
        "CS101 Academic Discussion: Big-O Complexity Bounds",
        "Departmental discussion panel for sorting algorithm complexity bounds and amortized averages.",
        pr.id,
        "Formal analysis comparing O(N log N) merge sort structures to space-efficiency considerations."
      ]);

      // private table
      await dbRun(`
        INSERT INTO disco_tables (title, description, creator_id, access_type, table_mode, cached_disco_summary)
        VALUES (?, ?, ?, 'private', 'academic_discussion', ?)
      `, [
        "IITB Graduate Research: Quantum Networks",
        "Private planning room for department research scholars.",
        pr.id,
        "Confidential research references covering entanglement distribution protocols."
      ]);

      // Fetch Table IDs
      const t1 = await dbGet("SELECT id FROM disco_tables WHERE title LIKE '%Recursion%'");
      const t2 = await dbGet("SELECT id FROM disco_tables WHERE title LIKE '%Big-O%'");

      // Seed Messages
      await dbRun(
        "INSERT INTO messages (disco_table_id, user_id, message_text) VALUES (?, ?, ?)",
        [t1.id, s1.id, "I don't understand how the recursive call remembers where to return in the code stack. It feels like magic."]
      );
      await dbRun(
        "INSERT INTO messages (disco_table_id, user_id, message_text) VALUES (?, ?, ?)",
        [t1.id, s2.id, "Agree completely. Also, when does Stack Overflow actually trigger? Is it dependent on heap memory?"]
      );
      await dbRun(
        "INSERT INTO messages (disco_table_id, user_id, message_text) VALUES (?, ?, ?)",
        [t1.id, s1.id, "I tested writing a function with no base conditions and the app crashed instantly. Is heap involved?"]
      );

      await dbRun(
        "INSERT INTO messages (disco_table_id, user_id, message_text) VALUES (?, ?, ?)",
        [t2.id, s2.id, "Is a hash table lookup really always O(1) in practice? What happens with high collisions?"]
      );
      await dbRun(
        "INSERT INTO messages (disco_table_id, user_id, message_text) VALUES (?, ?, ?)",
        [t2.id, pr.id, "Under serious collision rates, it degenerates to linear O(N). Traditional tables now resolve clusters using BSTs for O(log N) limits."]
      );
      await dbRun(
        "INSERT INTO messages (disco_table_id, user_id, message_text) VALUES (?, ?, ?)",
        [t2.id, s1.id, "Ah! That is why we chain indexes. Amortized worst-cases make so much sense now. Thank you, Prof."]
      );

      console.log('[Database Seeding] Finished seeding SQLite dataset.');
    }
  } catch (error) {
    console.error('[Database Initialization Critical Failure]:', error);
  }
}

// Global JWT Verification Middleware
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization token missing' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    console.warn('[JWT Auth Warning] Refused access with invalid token:', err.message);
    res.status(401).json({ error: 'Authentication failed. Please renew token.' });
  }
};

// ---------------- AUTH ROUTES ----------------

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields are strictly required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const isStudentEmail = /^25m\d{4}@iitb\.ac\.in$/.test(normalizedEmail);
  const isProfEmail = normalizedEmail === 'prof@iitb.ac.in';

  if (!isStudentEmail && !isProfEmail) {
    console.info(`[Registration Blocked] Email ${normalizedEmail} is not whitelisted.`);
    return res.status(403).json({ error: 'Access Denied: Registrations are restricted to student accounts matching the 25MDDDD@iitb.ac.in format and prof@iitb.ac.in.' });
  }

  try {
    const existing = await dbGet("SELECT id FROM users WHERE email = ?", [normalizedEmail]);
    if (existing) {
      return res.status(400).json({ error: 'Email already exists. Please log in.' });
    }

    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    await dbRun(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name.trim(), normalizedEmail, password_hash]
    );

    const user = await dbGet("SELECT id, name, email FROM users WHERE email = ?", [normalizedEmail]);
    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    console.log(`[User Registered] Account created successfully for ${normalizedEmail}`);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('[Registration Exception]:', err);
    res.status(500).json({ error: 'Database record assembly failed.' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const isStudentEmail = /^25m\d{4}@iitb\.ac\.in$/.test(normalizedEmail);
  const isProfEmail = normalizedEmail === 'prof@iitb.ac.in';

  if (!isStudentEmail && !isProfEmail) {
    return res.status(401).json({ error: 'Invalid academic credentials.' });
  }

  try {
    const user = await dbGet("SELECT * FROM users WHERE email = ?", [normalizedEmail]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid academic credentials.' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid academic credentials.' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    console.log(`[User log-in] Successful login for: ${normalizedEmail}`);

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (err) {
    console.error('[Login Exception]:', err);
    res.status(500).json({ error: 'Database transaction failed.' });
  }
});

// ---------------- DISCO TABLES ROUTES ----------------

// GET /api/disco-tables (All accessible Tables for this user)
app.get('/api/disco-tables', authMiddleware, async (req, res) => {
  try {
    const tables = await dbAll(`
      SELECT 
        dt.*, 
        u.name as creator_name, 
        (SELECT COUNT(*) FROM messages m WHERE m.disco_table_id = dt.id) as message_count
      FROM disco_tables dt
      JOIN users u ON dt.creator_id = u.id
      WHERE dt.access_type = 'public' OR dt.creator_id = ?
    `, [req.userId]);

    res.json(tables);
  } catch (error) {
    console.error('[API Error] Fetch tables failed:', error);
    res.status(500).json({ error: 'Could not load active disco tables.' });
  }
});

// POST /api/disco-tables (Create a new table)
app.post('/api/disco-tables', authMiddleware, async (req, res) => {
  const { title, description, access_type, table_mode } = req.body;
  if (!title || !description || !access_type || !table_mode) {
    return res.status(400).json({ error: 'All fields are required to assemble a new Disco Table.' });
  }

  try {
    await dbRun(`
      INSERT INTO disco_tables (title, description, creator_id, access_type, table_mode, cached_disco_summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      title.trim(),
      description.trim(),
      req.userId,
      access_type,
      table_mode,
      `Unsummarized table active: "${title}". Generate summaries via professor background worker.`
    ]);

    const created = await dbGet("SELECT * FROM disco_tables WHERE creator_id = ? ORDER BY id DESC LIMIT 1", [req.userId]);
    console.log(`[Disco Table Formed] Table id #${created.id} created by user id: ${req.userId}`);
    res.status(201).json(created);
  } catch (err) {
    console.error('[Create Disco Table Exception]:', err);
    res.status(500).json({ error: 'Error inserting new disco table.' });
  }
});

// GET /api/disco-tables/:id
app.get('/api/disco-tables/:id', authMiddleware, async (req, res) => {
  try {
    const table = await dbGet(`
      SELECT dt.*, u.name as creator_name 
      FROM disco_tables dt 
      JOIN users u ON dt.creator_id = u.id 
      WHERE dt.id = ?
    `, [req.params.id]);

    if (!table) {
      return res.status(404).json({ error: 'Disco table not found.' });
    }

    if (table.access_type === 'private' && table.creator_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden: Private research table.' });
    }

    res.json(table);
  } catch (err) {
    console.error('[Fetch Table detail Exception]:', err);
    res.status(500).json({ error: 'Error fetching disco table details.' });
  }
});

// Helper for reproducible greek anonymity names
function getAnonymousName(userId) {
  const greekAlphabet = [
    "Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta",
    "Eta", "Theta", "Iota", "Kappa", "Lambda", "Mu",
    "Nu", "Xi", "Omicron", "Pi", "Rho", "Sigma",
    "Tau", "Upsilon", "Phi", "Chi", "Psi", "Omega"
  ];
  // Salt slightly to make reproducible but distinct from user IDs across other setups
  const index = (userId * 7 + 13) % greekAlphabet.length;
  return `Anonymous ${greekAlphabet[index]}`;
}

// 4. GET /api/disco-tables/:id/messages (Inner Join mapping message author context)
app.get('/api/disco-tables/:id/messages', authMiddleware, async (req, res) => {
  try {
    const table = await dbGet("SELECT creator_id, table_mode, access_type FROM disco_tables WHERE id = ?", [req.params.id]);
    if (!table) {
      return res.status(404).json({ error: 'Disco table not found.' });
    }

    if (table.access_type === 'private' && table.creator_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden: Private research table.' });
    }

    const rawMessages = await dbAll(`
      SELECT 
        m.id, 
        m.message_text, 
        m.timestamp, 
        m.user_id,
        u.name as real_name,
        u.email as real_email
      FROM messages m
      INNER JOIN users u ON m.user_id = u.id
      WHERE m.disco_table_id = ?
      ORDER BY m.timestamp ASC
    `, [req.params.id]);

    // Check table mode to toggle human anonymity
    const messages = rawMessages.map(msg => {
      if (table.table_mode === 'muddy_points') {
        return {
          id: msg.id,
          message_text: msg.message_text,
          timestamp: msg.timestamp,
          sender_name: getAnonymousName(msg.user_id),
          is_anonymous: true
        };
      } else {
        return {
          id: msg.id,
          message_text: msg.message_text,
          timestamp: msg.timestamp,
          sender_name: msg.real_name,
          sender_email: msg.real_email,
          is_anonymous: false
        };
      }
    });

    res.json(messages);
  } catch (error) {
    console.error('[Fetch messages Exception]:', error);
    res.status(500).json({ error: 'Failed to extract table conversation.' });
  }
});

// POST /api/disco-tables/:id/messages (Publish post)
app.post('/api/disco-tables/:id/messages', authMiddleware, async (req, res) => {
  const { message_text } = req.body;
  if (!message_text || message_text.trim() === '') {
    return res.status(400).json({ error: 'Content cannot be empty.' });
  }

  try {
    const table = await dbGet("SELECT creator_id, access_type FROM disco_tables WHERE id = ?", [req.params.id]);
    if (!table) {
      return res.status(404).json({ error: 'Disco table not found.' });
    }

    if (table.access_type === 'private' && table.creator_id !== req.userId) {
      return res.status(403).json({ error: 'Forbidden: Private research table access limits.' });
    }

    await dbRun(`
      INSERT INTO messages (disco_table_id, user_id, message_text)
      VALUES (?, ?, ?)
    `, [req.params.id, req.userId, message_text.trim()]);

    const created = await dbGet("SELECT * FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 1", [req.userId]);
    console.log(`[Message Published] New msg #${created.id} written on Disco Table #${req.params.id}`);

    res.status(201).json(created);
  } catch (err) {
    console.error('[Save Message Exception]:', err);
    res.status(500).json({ error: 'Failed to record entry to SQLite thread.' });
  }
});

// ---------------- INSTRUCTOR ANALYSIS & AI SERVICES ----------------

let isOllamaOffline = false;
let lastOllamaCheck = 0;
const OLLAMA_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes cache

// Helper for prediction fallbacks: Ollama -> Gemini API -> Rule Heuristics
async function generateAIPrediction(prompt, systemInstruction = "") {
  const now = Date.now();
  const checkOllama = !isOllamaOffline || (now - lastOllamaCheck > OLLAMA_CHECK_INTERVAL);

  const ollamaHost = process.env.OLLAMA_HOST || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "qwen2.5-coder:3b";
  const ollamaTimeout = parseInt(process.env.OLLAMA_TIMEOUT) || 60000; // default to 60 seconds

  // 1. Local Ollama Instance Runner
  if (checkOllama) {
    try {
      console.log(`[AI Engine] Attempting Ollama query on '${ollamaModel}' at ${ollamaHost}/api/chat`);
      const signal = AbortSignal.timeout(ollamaTimeout);
      lastOllamaCheck = now;
      const ollamaResponse = await fetch(`${ollamaHost}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: prompt }
          ],
          stream: false
        }),
        signal
      });

      if (ollamaResponse.ok) {
        const data = await ollamaResponse.json();
        const content = data.message?.content;
        if (content) {
          console.log("[AI Engine] Local Ollama compilation success.");
          isOllamaOffline = false;
          return content.trim();
        }
      }
      isOllamaOffline = true;
      console.log(`[AI Engine] Local Ollama returned non-ok status. Setting isOllamaOffline = true.`);
    } catch (error) {
      console.log(`[AI Engine Fallback Level-1] Local Ollama not active. Path: ${error.message}`);
      isOllamaOffline = true;
    }
  } else {
    console.log(`[AI Engine] Skipping Ollama query (cached offline).`);
  }

  // 2. Gemini Cloud API Runner
  const key = process.env.GEMINI_API_KEY;
  if (key && key !== "MY_GEMINI_API_KEY") {
    try {
      console.log(`[AI Engine] Triggering Gemini Cloud fallback model 'gemini-2.5-flash'...`);
      const ai = new GoogleGenAI({ apiKey: key });
      const promptChain = systemInstruction ? `${systemInstruction}\n\nData Payload:\n${prompt}` : prompt;
      const resp = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: promptChain
      });
      if (resp.text) {
        console.log("[AI Engine] Gemini Cloud translation success.");
        return resp.text.trim();
      }
    } catch (gError) {
      console.warn(`[AI Engine Fallback Level-2] Gemini request failed:`, gError.message);
    }
  }

  // If both fall, return null to prompt algorithmic rule heuristics
  console.log("[AI Engine] Offline local heuristic trigger initiated.");
  return null;
}

// 5. Rule Heuristic Summary engine (computes dynamic summary when offline)
function generateLocalHeuristicSummary(title, messages) {
  if (!messages || messages.length === 0) {
    return `Active conversation space spun for table "${title}". Post clarifications to generate a synthesized preview summary.`;
  }

  const text = messages.map(m => m.message_text).join(" ");
  const clean = text.toLowerCase().replace(/[^a-z\s]/gi, "");
  const words = clean.split(/\s+/).filter(w => w.length > 5);

  const filterWords = new Set(["about", "would", "could", "should", "there", "their", "these", "where", "which", "recursion", "recursive", "complexity"]);
  const frequency = {};
  words.forEach(w => {
    if (!filterWords.has(w)) {
      frequency[w] = (frequency[w] || 0) + 1;
    }
  });

  const sorted = Object.keys(frequency).sort((a, b) => frequency[b] - frequency[a]);
  const coreConcept = sorted.slice(0, 3).join(", ");
  const userCount = new Set(messages.map(m => m.user_id)).size;

  let localSummary = `Live overview synthesis: This table currently hosts a thread from ${userCount} departmental user(s) contributing ${messages.length} post(s). `;
  
  if (coreConcept) {
    localSummary += `The central theme emphasizes the concepts surrounding "${coreConcept}". `;
  } else {
    localSummary += `The students are focusing heavily on academic queries and diagnostic examples. `;
  }

  localSummary += `Highly recommended space for peers tracking clarification points. Join the table to resolve!`;
  return localSummary;
}

// Instructor Heuristic Gap Analysis
function generateHeuristicGapAnalysis(allMessages) {
  const textLower = allMessages.map(m => m.message_text).join(" ").toLowerCase();

  const misconceptions = [
    "Thinking recursive code blocks do not create internal activation runtime stacks, causing unexpected high overhead.",
    "Believing Big-O bounds represent static line frequencies rather than growth limit scaling benchmarks.",
    "Assuming O(1) hash structures never experience linear degradation during index collision clusters."
  ];

  const foundations = [
    "Machine Call Stack frame scopes and physical limits of heap/stack bounds.",
    "Mathematical Induction and Recurrence Relations used for complex algorithmic bounds.",
    "Hash Collision Mitigation: Open Addressing vs Double Hashing vs Chaining structures."
  ];

  const fixes = [
    "Host a 15-minute whiteboard trace mapping memory register values during stack frame execution.",
    "Introduce a sorting lab displaying real-time wall-clock limits of various algorithms.",
    "Assign a short diagnostic challenge on mapping collision frequency bounds."
  ];

  // Specific content tuning based on student messages
  if (textLower.includes("recursion") || textLower.includes("stack") || textLower.includes("overflow")) {
    misconceptions.unshift("Misunderstanding stack memory boundaries and how return pointer logs are persisted.");
    foundations.unshift("Activation Records, stack pointers, and garbage logs.");
    fixes.unshift("Write a small tracer script displaying how call frames grow recursively in modern VMs.");
  }

  if (textLower.includes("zero") || textLower.includes("o(") || textLower.includes("complexity") || textLower.includes("bound")) {
    misconceptions.unshift("Treating worst-case complexity limits and average complexity averages interchangeably.");
    foundations.unshift("Formal limit definitions (Big-O, Big-Omega, Big-Theta).");
    fixes.unshift("Coordinate a classroom diagnostic where peers map out growth curves for competing functions.");
  }

  return {
    "Common Misconceptions": misconceptions.slice(0, 3),
    "Missing Foundations": foundations.slice(0, 3),
    "Recommended Curricular Fixes": fixes.slice(0, 3)
  };
}

// 5. Automated Background Worker Task (Runs on setInterval)
async function runBackgroundWorker() {
  console.log(`[Background Worker] Active process trigger sequence running: ${new Date().toLocaleTimeString()}`);
  try {
    const publicTables = await dbAll("SELECT * FROM disco_tables WHERE access_type = 'public'");
    
    for (const table of publicTables) {
      const messages = await dbAll("SELECT message_text, user_id FROM messages WHERE disco_table_id = ?", [table.id]);
      let finalSummary = "";

      if (messages.length === 0) {
        finalSummary = `No discussion messages have been logged on the "${table.title}" table yet. Join the table under Virtable to post notes and formulate insights!`;
      } else {
        const rawTexts = messages.map(m => m.message_text).join("\n- ");
        const prompt = `Department Table Title: "${table.title}". Description: "${table.description}". \nStudent messages logged so far:\n- ${rawTexts}\n\nExecute a summary assessment. Write a single, punchy, consolidated summary paragraph (strictly between 40-70 words) tracking student gaps or resolution outcomes. Avoid preambles or quoting individual student name tags. Summarize overall concerns.`;

        const aiResponse = await generateAIPrediction(prompt, "You are a succinct academic dashboard summarization crawler.");
        if (aiResponse) {
          finalSummary = aiResponse;
        } else {
          finalSummary = generateLocalHeuristicSummary(table.title, messages);
        }
      }

      await dbRun(
        "UPDATE disco_tables SET cached_disco_summary = ?, last_spun_at = ? WHERE id = ?",
        [finalSummary, new Date().toISOString(), table.id]
      );
    }
    console.log("[Background Worker] Summaries optimized and persisted to SQLite column 'cached_disco_summary'.");
  } catch (error) {
    console.error("[Background Worker Error] Fatal parsing on thread runner:", error);
  }
}

// API for trigger-workers (Manual worker override via UI for frictionless evaluation)
app.post('/api/worker/spin', authMiddleware, async (req, res) => {
  try {
    console.log(`[Manual Worker Trigger] Initiated action queue by academic email: ${req.userEmail}`);
    await runBackgroundWorker();
    res.json({ message: 'Virtable Background Worker executed successfully and updated all active table columns!' });
  } catch (error) {
    res.status(500).json({ error: 'Manual worker execution failed.' });
  }
});

// 6. GET /api/instructor/dashboard (Aggregates and formats instructor views)
app.get('/api/instructor/dashboard', authMiddleware, async (req, res) => {
  try {
    console.log(`[Instructor Dashboard API] Serving data for user email: ${req.userEmail}`);

    // Track "Hottest Disco Tables" based on message count and unique student participants
    const hotTables = await dbAll(`
      SELECT 
        dt.id,
        dt.title,
        dt.table_mode,
        dt.access_type,
        COUNT(m.id) as message_count,
        COUNT(DISTINCT m.user_id) as participant_count,
        u.name as creator_name
      FROM disco_tables dt
      LEFT JOIN messages m ON dt.id = m.disco_table_id
      LEFT JOIN users u ON dt.creator_id = u.id
      GROUP BY dt.id
      ORDER BY message_count DESC, participant_count DESC
    `);

    // Fetch all messages across muddy point boards to compute gap analysis
    const allMessages = await dbAll(`
      SELECT m.message_text, dt.title, dt.table_mode
      FROM messages m
      JOIN disco_tables dt ON m.disco_table_id = dt.id
    `);

    let gapAnalysis = null;
    const muddyMessages = allMessages.filter(m => m.table_mode === 'muddy_points');

    if (muddyMessages.length > 0) {
      const formattedInput = muddyMessages.map(m => `[Topic: ${m.title}] message: ${m.message_text}`).join("\n");
      const prompt = `These are anonymous student messages highlighting aspects of extreme confusion and conceptual struggles:\n${formattedInput}\n\nCompile a Structured Conceptual Gap Analysis. Your return payload MUST be a single raw JSON object format. Do NOT wrap it in any headers, preambles, or explanations. Just return the JSON matching exactly this layout structure:\n{\n  "Common Misconceptions": ["Misconception statement", "Another misconception"],\n  "Missing Foundations": ["Prerequisite theory missing", "Another basic component missing"],\n  "Recommended Curricular Fixes": ["Classroom intervention method", "Another intervention code suggestion"]\n}`;

      const aiResponse = await generateAIPrediction(prompt, "You are a professional pedagogical assessor who returns structured JSON objects immediately.");
      if (aiResponse) {
        try {
          let cleanJson = aiResponse.trim();
          if (cleanJson.startsWith("```")) {
            // strip backticks
            cleanJson = cleanJson.replace(/^```json/i, "").replace(/```$/, "").trim();
          }
          gapAnalysis = JSON.parse(cleanJson);
        } catch (err) {
          console.warn("[JSON Parse Warning] Unable to parse raw AI payload. Routing to local analysis algorithm.");
        }
      }
    }

    if (!gapAnalysis) {
      gapAnalysis = generateHeuristicGapAnalysis(allMessages);
    }

    res.json({
      hotTables,
      gapAnalysis
    });
  } catch (error) {
    console.error('[Instructor API Exception]:', error);
    res.status(500).json({ error: 'Failed to compile gap intelligence parameters.' });
  }
});

// Fallback index.html serves
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Bind server and initialize tables
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n======================================================`);
  console.log(`[Virtable Server] Active and listening on port ${PORT}`);
  console.log(`[Host Address] http://localhost:${PORT}`);
  console.log(`======================================================\n`);
  
  // Database setup
  await initializeSchema();
  
  // Run background worker immediately to generate first batch of summaries
  await runBackgroundWorker();

  // 5. Background summaries worker sequence initialized to cycle every 15 minutes
  const INTERVAL_TIME = 15 * 60 * 1000;
  setInterval(runBackgroundWorker, INTERVAL_TIME);
  console.log(`[Scheduler] 15-Minute Automated Worker Task initialized.`);
});
