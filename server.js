const http = require('http');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 8080;
const BASE_DIR = __dirname;
const LEADS_FILE = path.join(BASE_DIR, 'data', 'leads.json');
const CONFIG_FILE = path.join(BASE_DIR, 'data', 'config.json');
const LOCAL_URL_FILE = path.join(BASE_DIR, 'data', 'public_url.txt');

const CLOUDFLARED_BIN = 'C:\\Users\\Amr safwat\\.gemini\\antigravity\\bin\\cloudflared.exe';
const DESKTOP_URL_FILE = 'C:\\Users\\Amr safwat\\OneDrive\\Desktop\\Elite_Program_Link.txt';
const DESKTOP_SHORTCUT = 'C:\\Users\\Amr safwat\\OneDrive\\Desktop\\Elite_Registration_Link.url';

let currentPublicUrl = '';

// Ensure data folder and files exist
if (!fs.existsSync(path.join(BASE_DIR, 'data'))) {
  fs.mkdirSync(path.join(BASE_DIR, 'data'), { recursive: true });
}
if (!fs.existsSync(LEADS_FILE)) {
  fs.writeFileSync(LEADS_FILE, '[]', 'utf8');
}
if (!fs.existsSync(CONFIG_FILE)) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    dingtalkUserId: "EGSS-AMRSAFWAT",
    dingtalkWebhookUrl: "",
    dingtalkSecret: ""
  }, null, 2), 'utf8');
}
if (fs.existsSync(LOCAL_URL_FILE)) {
  try {
    currentPublicUrl = fs.readFileSync(LOCAL_URL_FILE, 'utf8').trim();
  } catch (e) {}
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function extractLeads(obj) {
  let result = [];
  if (!obj) return result;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      result = result.concat(extractLeads(item));
    }
  } else if (typeof obj === 'object') {
    if (obj.name && (obj.phone || obj.id)) {
      result.push(obj);
    } else if (obj.value) {
      result = result.concat(extractLeads(obj.value));
    }
  }
  return result;
}

function readLeads() {
  try {
    if (!fs.existsSync(LEADS_FILE)) return [];
    let raw = fs.readFileSync(LEADS_FILE, 'utf8');
    raw = raw.replace(/^\uFEFF/, '').trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const flat = extractLeads(parsed);
    let modified = false;
    for (const lead of flat) {
      if (!lead._uid) {
        lead._uid = 'uid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 7);
        modified = true;
      }
    }
    if (modified || !Array.isArray(parsed)) {
      writeLeads(flat);
    }
    return flat;
  } catch (e) {
    console.error('Error reading leads:', e.message);
    return [];
  }
}

function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2), 'utf8');
}

function sendDingTalk(webhookUrl, secret, userId, lead, isTest = false) {
  if (!webhookUrl) return;
  try {
    let finalUrl = webhookUrl;
    if (secret) {
      const timestamp = Date.now();
      const stringToSign = `${timestamp}\n${secret}`;
      const sign = crypto.createHmac('sha256', secret).update(stringToSign).digest('base64');
      const encodedSign = encodeURIComponent(sign);
      finalUrl += (finalUrl.includes('?') ? '&' : '?') + `timestamp=${timestamp}&sign=${encodedSign}`;
    }

    const title = isTest ? "DingTalk Test Notification - Elite Program" : "طلب تسجيل جديد - برنامج النخبة";
    const nowStr = new Date().toLocaleString('ar-EG');
    const textContent = isTest
      ? `### 🔔 DingTalk Alert: Connection Successful\n\n- **Target User:** @${userId}\n- **Status:** Connected to Elite Platform\n- **Time:** ${nowStr}\n\n@${userId}`
      : `### 🌟 طلب تسجيل جديد في برنامج النخبة (Elite Program)\n\n` +
        `- **Potential ID:** \`${lead.id}\`\n` +
        `- **👤 اسم الطالب:** ${lead.name}\n` +
        `- **🎂 العمر:** ${lead.age} عاماً\n` +
        `- **🏫 نوع المدرسة:** ${lead.schoolType || 'غير محدد'}\n` +
        `- **🎯 هدف دخول المنصة:** ${lead.targetLevel || 'غير محدد'}\n` +
        `- **🌍 الدولة:** ${lead.country}\n` +
        `- **📱 هاتف ولي الأمر:** ${lead.phone}\n` +
        `- **📅 وقت التسجيل:** ${lead.createdAt}\n\n` +
        `@${userId} يرجى المتابعة وتحديد موعد اختبار المستوى والمقابلة.`;

    const payload = JSON.stringify({
      msgtype: "markdown",
      markdown: {
        title: title,
        text: textContent
      },
      at: {
        atUserIds: [userId],
        isAtAll: false
      }
    });

    const urlObj = new URL(finalUrl);
    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      res.on('data', () => {});
    });
    req.on('error', (e) => {
      console.error('DingTalk error:', e.message);
    });
    req.write(payload);
    req.end();
  } catch (err) {
    console.error('DingTalk exception:', err);
  }
}

// Start Cloudflare Tunnel
function startTunnel() {
  if (process.env.RENDER || process.env.VERCEL || process.env.NODE_ENV === 'production' || !fs.existsSync(CLOUDFLARED_BIN)) {
    console.log('[Tunnel] Cloud/Production environment detected or cloudflared not present, skipping local tunnel.');
    return;
  }

  console.log('[Tunnel] Starting Cloudflare Tunnel for port', PORT);
  const tunnelProcess = spawn(CLOUDFLARED_BIN, ['tunnel', '--url', `http://localhost:${PORT}`]);

  function handleData(chunk) {
    const text = chunk.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
    if (match) {
      currentPublicUrl = match[0];
      console.log('========================================================');
      console.log('🌐 PUBLIC URL FOR STUDENTS / رابط التسجيل للعملاء:');
      console.log(currentPublicUrl);
      console.log('========================================================');

      try {
        fs.writeFileSync(LOCAL_URL_FILE, currentPublicUrl, 'utf8');
        fs.writeFileSync(DESKTOP_URL_FILE, `رابط موقع برنامج النخبة للتسجيل (أرسل هذا الرابط للطلاب وأولياء الأمور):\n\n${currentPublicUrl}\n\nملاحظة: هذا الرابط مخصص للتسجيل فقط ولا يسمح للزوار بفتح لوحة التحكم.\nلوحة التحكم تعمل فقط من جهازك عبر: http://localhost:8080/dashboard.html\n`, 'utf8');
        fs.writeFileSync(DESKTOP_SHORTCUT, `[InternetShortcut]\nURL=${currentPublicUrl}\n`, 'utf8');
      } catch (err) {
        console.error('[Tunnel] Error writing desktop shortcut:', err.message);
      }
    }
  }

  tunnelProcess.stdout.on('data', handleData);
  tunnelProcess.stderr.on('data', handleData);

  tunnelProcess.on('close', (code) => {
    console.log(`[Tunnel] Cloudflared exited with code ${code}. Restarting in 5s...`);
    setTimeout(startTunnel, 5000);
  });
}

const server = http.createServer((req, res) => {
  // CORS & No-Cache Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '-1');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const hostHeader = (req.headers.host || '').toLowerCase();
  const isLocalRequest = (
    !req.headers['cf-connecting-ip'] &&
    !req.headers['x-forwarded-for'] &&
    (hostHeader.startsWith('localhost') || hostHeader.startsWith('127.0.0.1'))
  );

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const urlPath = parsedUrl.pathname;
  const pinParam = parsedUrl.searchParams.get('pin');

  // Privacy Protection: Restrict Dashboard & Admin APIs from public internet
  const isAdminRoute = (
    urlPath === '/dashboard.html' ||
    urlPath === '/dashboard' ||
    urlPath === '/api/leads' ||
    urlPath === '/api/leads/delete' ||
    urlPath === '/api/leads/update' ||
    urlPath === '/api/dingtalk/save' ||
    urlPath === '/api/dingtalk/test'
  );

  if (isAdminRoute && !isLocalRequest && pinParam !== '2026') {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="UTF-8">
        <title>الوصول مقيد - إدارة البرنامج</title>
        <style>
          body { font-family: 'Cairo', sans-serif, system-ui; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
          .card { background: #1e293b; padding: 2.5rem; border-radius: 1.5rem; border: 1px solid #334155; max-width: 450px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
          h1 { font-size: 1.5rem; margin-bottom: 0.75rem; color: #f43f5e; }
          p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; }
          a { display: inline-block; margin-top: 1.5rem; padding: 0.75rem 1.75rem; background: #10b981; color: white; text-decoration: none; border-radius: 0.75rem; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
          <h1>هذه الصفحة خاصة بإدارة برنامج النخبة</h1>
          <p>لوحة التحكم بالبيانات مقفلة ومخصصة للإدارة فقط عبر الجهاز المصرح به.</p>
          <a href="/">العودة إلى صفحة التسجيل والتقديم</a>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // API: Public URL endpoint
  if (urlPath === '/api/public-url' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ url: currentPublicUrl }));
    return;
  }

  // API: Get Leads (Admin only)
  if (urlPath === '/api/leads' && req.method === 'GET') {
    const leads = readLeads();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(leads));
    return;
  }

  // API: Register Lead (Public - Anyone can submit)
  if (urlPath === '/api/register' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try {
        const leadData = JSON.parse(bodyStr);
        const leads = readLeads();

        let maxNum = 1000;
        for (const item of leads) {
          const match = String(item.id || '').match(/ELITE-ID-(\d+)/);
          if (match) {
            const n = parseInt(match[1], 10);
            if (n > maxNum) maxNum = n;
          }
        }
        const nextId = `ELITE-ID-${maxNum + 1}`;
        const uniqueUid = 'uid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 7);

        const newLead = {
          _uid: uniqueUid,
          id: nextId,
          name: leadData.name,
          age: Number(leadData.age),
          schoolType: leadData.schoolType || 'غير محدد',
          targetLevel: leadData.targetLevel || 'غير محدد',
          country: leadData.country,
          phone: leadData.phone,
          status: 'New Lead',
          createdAt: new Date().toLocaleString('ar-EG'),
          notes: leadData.notes || 'Website Registration'
        };

        leads.push(newLead);
        writeLeads(leads);

        // DingTalk notification
        try {
          const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
          sendDingTalk(cfg.dingtalkWebhookUrl, cfg.dingtalkSecret, cfg.dingtalkUserId || 'EGSS-AMRSAFWAT', newLead);
        } catch (e) {}

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, id: nextId, lead: newLead }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Delete Lead (Single or All)
  if (urlPath === '/api/leads/delete' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try {
        const delData = JSON.parse(bodyStr);
        let leads = readLeads();

        if (delData.action === 'clear_all') {
          leads = [];
          writeLeads(leads);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, remaining: 0 }));
          return;
        }

        const targetKey = String(delData.id || '').trim();
        if (!targetKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing lead ID' }));
          return;
        }

        const targetIndex = leads.findIndex(item => 
          (item._uid && item._uid === targetKey) || 
          (item.id && item.id === targetKey)
        );

        if (targetIndex !== -1) {
          leads.splice(targetIndex, 1);
          writeLeads(leads);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, remaining: leads.length }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: true, remaining: leads.length, notFound: true }));
        }
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: Update Lead Status
  if (urlPath === '/api/leads/update' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try {
        const updateData = JSON.parse(bodyStr);
        const leads = readLeads();
        for (const item of leads) {
          if (item._uid === updateData.id || item.id === updateData.id) {
            if (updateData.status) item.status = updateData.status;
            if (updateData.notes) item.notes = updateData.notes;
            break;
          }
        }
        writeLeads(leads);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // API: DingTalk Config & Test
  if (urlPath === '/api/dingtalk/config' && req.method === 'GET') {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(raw);
    return;
  }

  if (urlPath === '/api/dingtalk/save' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try {
        const newCfg = JSON.parse(bodyStr);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(newCfg, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  if (urlPath === '/api/dingtalk/test' && req.method === 'POST') {
    let bodyStr = '';
    req.on('data', chunk => { bodyStr += chunk; });
    req.on('end', () => {
      try {
        const testReq = JSON.parse(bodyStr);
        sendDingTalk(testReq.webhookUrl, testReq.secret, 'EGSS-AMRSAFWAT', null, true);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(400); res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = path.join(BASE_DIR, urlPath === '/' ? 'index.html' : urlPath);
  if (urlPath === '/dashboard') filePath = path.join(BASE_DIR, 'dashboard.html');

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

server.listen(PORT, () => {
  console.log(`Elite Node Server running at http://localhost:${PORT}/`);
  startTunnel();
});
