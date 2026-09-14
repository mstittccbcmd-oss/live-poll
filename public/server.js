
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const QRCode = require("qrcode");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sessions = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({length:6}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  } while (sessions.has(code));
  return code;
}

function makeToken() {
  return crypto.randomBytes(24).toString("hex");
}

function publicState(session, includeResults = false) {
  const active = session.active;
  if (active === null || active === undefined) {
    return {
      title: session.title,
      active: null,
      showResults: session.showResults
    };
  }

  const q = session.questions[active];
  const counts = q.options.map(() => 0);
  for (const choice of Object.values(session.responses[active] || {})) {
    if (Number.isInteger(choice) && choice >= 0 && choice < counts.length) counts[choice]++;
  }

  const payload = {
    title: session.title,
    active,
    question: { text: q.text, options: q.options, type: q.type || 'multiple_choice' },
    showResults: session.showResults,
    responseCount: counts.reduce((a,b)=>a+b,0)
  };

  if (includeResults || session.showResults) payload.counts = counts;
  return payload;
}

function hostState(session) {
  return {
    title: session.title,
    active: session.active,
    showResults: session.showResults,
    projectorToken: session.projectorToken,
    questions: session.questions.map((q, i) => {
      const counts = q.options.map(() => 0);
      for (const choice of Object.values(session.responses[i] || {})) {
        if (Number.isInteger(choice) && choice >= 0 && choice < counts.length) counts[choice]++;
      }
      return {
        text: q.text,
        options: q.options,
        counts,
        responseCount: counts.reduce((a,b)=>a+b,0)
      };
    })
  };
}

function emitState(code) {
  const s = sessions.get(code);
  if (!s) return;
  io.to(`host:${code}`).emit("host_state", hostState(s));
  io.to(`audience:${code}`).emit("audience_state", publicState(s, false));
  io.to(`projector:${code}`).emit("projector_state", publicState(s, true));
}


function loadPreloadedPolls() {
  const dir = path.join(__dirname, "preloaded-polls");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .map(name => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

app.get("/api/preloaded-polls", (req, res) => {
  try {
    const polls = loadPreloadedPolls();
    res.json(polls.map(p => ({id:p.id, title:p.title, questionCount:p.questions.length})));
  } catch (e) {
    res.status(500).json({error:"Could not load preloaded polls."});
  }
});

app.post("/api/preloaded-polls/:id/start", (req, res) => {
  try {
    const deck = loadPreloadedPolls().find(p => p.id === req.params.id);
    if (!deck) return res.status(404).json({error:"Poll not found"});

    const code = makeCode();
    const hostToken = makeToken();
    const projectorToken = makeToken();
    const questions = deck.questions.map(q => ({
      text: q.text,
      type: q.type || "multiple_choice",
      options: q.options || [],
      display: q.display || "responses"
    }));
    const responses = {};
    questions.forEach((_, i) => responses[i] = {});

    sessions.set(code, {
      title: deck.title,
      hostToken,
      projectorToken,
      questions,
      active: null,
      showResults: false,
      responses
    });

    res.json({
      code, hostToken, projectorToken,
      hostUrl:`/presenter.html?code=${code}&key=${hostToken}`,
      projectorUrl:`/projector.html?code=${code}&key=${projectorToken}`,
      audienceUrl:`/join.html?code=${code}`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({error:"Could not start preloaded poll."});
  }
});

app.post("/api/session", async (req, res) => {
  const code = makeCode();
  const hostToken = makeToken();
  const projectorToken = makeToken();
  const title = (req.body?.title || "Live Poll").trim();

  sessions.set(code, {
    title,
    hostToken,
    projectorToken,
    questions: [],
    active: null,
    showResults: false,
    responses: {}
  });

  res.json({
    code,
    hostToken,
    projectorToken,
    hostUrl: `/presenter.html?code=${code}&key=${hostToken}`,
    projectorUrl: `/projector.html?code=${code}&key=${projectorToken}`,
    audienceUrl: `/join.html?code=${code}`
  });
});

app.get("/api/session/:code/qr", async (req, res) => {
  const code = req.params.code.toUpperCase();
  if (!sessions.has(code)) return res.status(404).json({error:"Session not found"});
  const joinUrl = `${req.protocol}://${req.get("host")}/join.html?code=${code}`;
  const dataUrl = await QRCode.toDataURL(joinUrl, { width: 300, margin: 1 });
  res.json({ dataUrl, joinUrl });
});

app.post("/api/session/:code/question", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s || req.body?.key !== s.hostToken) return res.status(403).json({error:"Unauthorized"});

  const text = String(req.body?.text || "").trim();
  const options = Array.isArray(req.body?.options)
    ? req.body.options.map(x => String(x).trim()).filter(Boolean)
    : [];

  if (!text || options.length < 2) {
    return res.status(400).json({error:"Enter a question and at least two choices."});
  }

  s.questions.push({ text, options, type: 'multiple_choice' });
  s.responses[s.questions.length - 1] = {};
  emitState(code);
  res.json({ok:true});
});

app.post("/api/session/:code/activate", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s || req.body?.key !== s.hostToken) return res.status(403).json({error:"Unauthorized"});

  const index = req.body?.index;
  if (index === null) {
    s.active = null;
    s.showResults = false;
  } else if (Number.isInteger(index) && index >= 0 && index < s.questions.length) {
    s.active = index;
    s.showResults = false;
  } else {
    return res.status(400).json({error:"Invalid question index"});
  }
  emitState(code);
  res.json({ok:true});
});

app.post("/api/session/:code/show-results", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s || req.body?.key !== s.hostToken) return res.status(403).json({error:"Unauthorized"});
  s.showResults = Boolean(req.body?.show);
  emitState(code);
  res.json({ok:true});
});

app.post("/api/session/:code/reset", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s || req.body?.key !== s.hostToken) return res.status(403).json({error:"Unauthorized"});
  const index = req.body?.index;
  if (!Number.isInteger(index) || index < 0 || index >= s.questions.length) {
    return res.status(400).json({error:"Invalid question index"});
  }
  s.responses[index] = {};
  emitState(code);
  res.json({ok:true});
});

app.get("/api/session/:code/host-state", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s || req.query.key !== s.hostToken) return res.status(403).json({error:"Unauthorized"});
  res.json(hostState(s));
});

app.get("/api/session/:code/public-state", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s) return res.status(404).json({error:"Session not found"});
  res.json(publicState(s, false));
});

app.get("/api/session/:code/projector-state", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s || req.query.key !== s.projectorToken) return res.status(403).json({error:"Unauthorized"});
  res.json(publicState(s, true));
});


app.get("/api/session/:code/export.csv", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s || req.query.key !== s.hostToken) {
    return res.status(403).send("Unauthorized");
  }

  const escapeCsv = (value) => {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const rows = [
    ["Session Title", s.title],
    ["Session Code", code],
    ["Exported At", new Date().toISOString()],
    [],
    ["Question #", "Question", "Answer Choice", "Responses", "Percent"]
  ];

  s.questions.forEach((q, qi) => {
    const counts = q.options.map(() => 0);

    for (const choice of Object.values(s.responses[qi] || {})) {
      if (Number.isInteger(choice) && choice >= 0 && choice < counts.length) {
        counts[choice]++;
      }
    }

    const total = counts.reduce((a, b) => a + b, 0);

    q.options.forEach((option, oi) => {
      const count = counts[oi];
      const percent = total ? ((count / total) * 100).toFixed(1) : "0.0";
      rows.push([
        qi + 1,
        q.text,
        option,
        count,
        `${percent}%`
      ]);
    });
  });

  rows.push([]);
  rows.push(["Anonymous Individual Responses"]);
  rows.push(["Participant ID", ...s.questions.map((_, i) => `Q${i + 1}`)]);

  const participantIds = new Set();
  Object.values(s.responses).forEach(questionResponses => {
    Object.keys(questionResponses || {}).forEach(id => participantIds.add(id));
  });

  Array.from(participantIds).sort().forEach((id, index) => {
    const row = [`Participant ${String(index + 1).padStart(3, "0")}`];

    s.questions.forEach((q, qi) => {
      const choice = s.responses[qi]?.[id];
      row.push(Number.isInteger(choice) ? q.options[choice] : "");
    });

    rows.push(row);
  });

  const csv = rows.map(row => row.map(escapeCsv).join(",")).join("\r\n");
  const safeTitle = s.title.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "live_poll";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}_results.csv"`);
  res.send("\ufeff" + csv);
});


app.get("/api/session/:code/question/:index/display-state", (req, res) => {
  const code = req.params.code.toUpperCase();
  const s = sessions.get(code);
  if (!s) return res.status(404).json({error:"Session not found"});

  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= s.questions.length) {
    return res.status(404).json({error:"Question not found"});
  }

  const q = s.questions[index];
  const counts = q.options.map(() => 0);

  for (const choice of Object.values(s.responses[index] || {})) {
    if (Number.isInteger(choice) && choice >= 0 && choice < counts.length) {
      counts[choice]++;
    }
  }

  res.json({
    title: s.title,
    questionIndex: index,
    isActive: s.active === index,
    showResults: s.active === index ? s.showResults : false,
    question: { text: q.text, options: q.options, type: q.type || 'multiple_choice' },
    counts,
    textResponses: q.type === "short_answer" ? Object.values(s.responses[index] || {}) : [],
    responseCount: q.type === "short_answer"
      ? Object.keys(s.responses[index] || {}).length
      : counts.reduce((a,b)=>a+b,0)
  });
});

io.on("connection", socket => {
  socket.on("join_host", ({code, key}) => {
    code = String(code || "").toUpperCase();
    const s = sessions.get(code);
    if (!s || key !== s.hostToken) return socket.emit("error_message","Unauthorized");
    socket.join(`host:${code}`);
    socket.emit("host_state", hostState(s));
  });

  socket.on("join_audience", ({code, participantId}) => {
    code = String(code || "").toUpperCase();
    const s = sessions.get(code);
    if (!s) return socket.emit("error_message","Session not found");
    socket.data.code = code;
    socket.data.participantId = participantId || socket.id;
    socket.join(`audience:${code}`);
    socket.emit("audience_state", publicState(s, false));
  });

  socket.on("join_projector", ({code, key}) => {
    code = String(code || "").toUpperCase();
    const s = sessions.get(code);
    if (!s || key !== s.projectorToken) return socket.emit("error_message","Unauthorized");
    socket.join(`projector:${code}`);
    socket.emit("projector_state", publicState(s, true));
  });

  socket.on("vote", ({code, choice, participantId}) => {
    code = String(code || "").toUpperCase();
    const s = sessions.get(code);
    if (!s || s.active === null) return;

    const q = s.questions[s.active];
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) return;

    const pid = participantId || socket.data.participantId || socket.id;
    if (!s.responses[s.active]) s.responses[s.active] = {};
    s.responses[s.active][pid] = choice;
    emitState(code);
  });
});

app.get("/", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Live Poll running on port ${PORT}`);
});
