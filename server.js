const http = require('http');
const fs = require('fs');
const path = require('path');

// Lightweight local .env loader. Environment variables still take precedence.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const root = path.join(__dirname, 'public');
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8' };
const narrativeInstructions = `你是《人生未选择》的叙事导演。只依据用户提供的事实和已发生的选择续写，不得把“读研/上学”改写成工作或创业，不得凭空添加重大成就、恋爱、疾病或金钱困境。每次场景必须是一个可触摸的具体地点、人物与问题；选项必须是当下可执行的不同动作，而非抽象价值观标签。后果要是下一幕的前提：明确写出人物、承诺、资源、关系或未解决的问题如何被带入。避免“机会、成长、转型、探索”等空泛套话。保持现实主义、克制、中文自然。`;
const planInstructions = `${narrativeInstructions}\n\n先为一条“未走的人生”制定主线计划。输出必须是合法 JSON，不要 Markdown：{"premise":"一句话说明玩家已选择的平行人生起点","beats":[{"time":"具体年龄或几年后","type":"节点类型","event":"这一阶段真正发生的重大人生事件","decision":"玩家必须做出的重大选择"}]}。beats 必须恰好 12 个：第1个从用户已选择的平行道路开始，不再回到分岔现场；第2-4个建立学业/职业/城市/关系主线；第5-9个让早期重大选择产生长期后果；第10-12个走向用户指定终章年龄。type 必须在以下类型中轮换且相邻不能重复：适应、能力验证、关系承诺、城市/环境变化、机会取舍、挫折应对、价值冲突、长期承诺、身份转变、回望。每个节点推进至少半年、一个学期或一个明确人生阶段；不能是小任务、吃饭、送礼、修文件等日常琐事。每个字段控制在30字内。只写可从用户资料和分岔推出的现实可能。`;
const sceneInstructions = `${narrativeInstructions}\n\n输入会提供 storyPlan 和当前 currentBeat。你只能生成 currentBeat 所代表的人生阶段与 type，不能自行换主线或重复上一幕冲突类型。输出必须是合法 JSON，不要 Markdown：{"title":"不超过14字","place":"具体地点","story":"100到150字。若不是第1幕，第一句必须直接写出上一幕 choice/consequence 已如何发生，并用“因此/于是/这让你”自然连到当前阶段；接着用2到3句说明 currentBeat 的背景、涉及的人和核心事件；最后一句提出当前重大选择。直白清楚，不写感悟。","options":[{"label":"针对当前重大选择的具体行动，不超过24字","effect":"会成为下一幕开头的具体事实，不超过22字"},{"label":"...","effect":"..."},{"label":"...","effect":"..."}],"basis":"承接的上一选择与结果"}。第1幕直接从玩家已经选择的未走道路开始，不展示分岔现场；其余幕必须先结算 previousEvents 最后一项 choice/consequence，再进入 currentBeat。选项必须能改变学业、职业、城市、关系或生活路径。三项选项应分别代表不同的长期路径或代价，不能只是同一件事的三个微调版本。不得用修文件、吃饭、送礼、请教一次、完成小任务等微小琐事代替人生节点。`;

function json(res, status, body) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let data=''; req.on('data', c => { data += c; if(data.length > 100000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(new Error('无效请求')); } }); }); }

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/api/health') return json(res, 200, { ok:true, aiConfigured:Boolean(process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY), provider:process.env.DASHSCOPE_API_KEY ? 'qwen' : process.env.OPENAI_API_KEY ? 'openai' : 'none' });
  // Deliberately server-side: no browser code can read OPENAI_API_KEY.
  if (req.method === 'POST' && req.url === '/api/ai') {
    if (!process.env.OPENAI_API_KEY && !process.env.DASHSCOPE_API_KEY) return json(res, 503, { error:'尚未配置千问模型服务。请在服务端配置 DASHSCOPE_API_KEY。' });
    try {
      const payload = await readBody(req);
      const instruction = payload.kind === 'scene' ? sceneInstructions : narrativeInstructions;
      const isQwen = Boolean(process.env.DASHSCOPE_API_KEY);
      const response = await fetch(isQwen ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' : 'https://api.openai.com/v1/responses', {
        method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${isQwen ? process.env.DASHSCOPE_API_KEY : process.env.OPENAI_API_KEY}` },
        body: isQwen
          ? JSON.stringify({ model:process.env.QWEN_MODEL || 'qwen-plus', messages:[{role:'system',content:payload.kind === 'plan' ? planInstructions : instruction},{role:'user',content:payload.input}], temperature:0.35, max_tokens:payload.kind === 'plan' ? 2200 : 900 })
          : JSON.stringify({ model:process.env.OPENAI_MODEL || 'gpt-4.1-mini', instructions:instruction, input: payload.input, max_output_tokens:900 })
      });
      if (!response.ok) return json(res, 502, { error:'千问模型服务暂时不可用，请稍后重试。' });
      const result = await response.json();
      return json(res, 200, { text: isQwen ? result.choices?.[0]?.message?.content || '' : result.output_text || '' });
    } catch { return json(res, 502, { error:'模型服务连接失败，请稍后重试。' }); }
  }
  if (req.method !== 'GET') return json(res, 405, {error:'Method not allowed'});
  const requested = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(root, requested));
  if (!file.startsWith(root)) return json(res, 403, {error:'Forbidden'});
  fs.readFile(file, (err, content) => {
    if (err) return json(res, 404, {error:'Not found'});
    res.writeHead(200, {'Content-Type':types[path.extname(file)] || 'application/octet-stream'}); res.end(content);
  });
});
server.listen(port, () => console.log(`《人生未选择》已运行：http://localhost:${port}`));

