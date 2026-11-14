const fs = require('fs'), path = require('path');
const ud = path.join(process.env.APPDATA, 'drama-workbench');
const lib = JSON.parse(fs.readFileSync(path.join(ud, 'library.json'), 'utf8'));
const d = lib.dramas.find(x => x.id === 'd-mweyaxd4-dyri');
let script = null;
try { script = JSON.parse(fs.readFileSync(path.join(ud, 'media-cache', 'global', d.id, 'script.json'), 'utf8')); }
catch (e) { console.log('script.json 读取失败:', e.message); }
const lines = []; const syn = d.synthesis;
lines.push(`剧名：《${d.title}》`);
if (syn && syn.logline) lines.push(`故事主线：${syn.logline}`);
if (syn && syn.arcs) lines.push(`叙事地图：${syn.arcs}`);
if (syn && syn.characters && syn.characters.length) lines.push(`核心人物：${syn.characters.slice(0, 12).map(c => `${c.name}(${c.role}${c.desc ? '·' + c.desc : ''})`).join('；')}`);
lines.push('\n=== 分集剧情、高光候选与台词时间轴 ===');
let epWithSegs = 0, epWithCand = 0, segTotal = 0, candTotal = 0, epIncluded = 0;
for (const ep of [...d.episodes].sort((a, b) => a.n - b.n)) {
  const se = script && script.episodes ? script.episodes.find(x => x.n === ep.n) : null;
  const summary = ep.summary || (se && se.summary) || '';
  const cands = ep.candidates || [];
  const segs = ep.segments || (se && se.transcript) || [];
  if (!summary && cands.length === 0 && segs.length === 0) continue;
  epIncluded++;
  if (segs.length) epWithSegs++;
  if (cands.length) epWithCand++;
  segTotal += Math.min(segs.length, 40); candTotal += cands.length;
  lines.push(`\n## 第 ${ep.n} 集（总长 ${ep.duration ? ep.duration.toFixed(1) + 's' : '未知'}）`);
  if (summary) lines.push(`梗概：${summary}`);
  if (cands.length) {
    lines.push('高光候选：');
    for (const c of cands) {
      const q = c.quote ? ` 金句:"${c.quote}"` : '';
      const cf = c.conflict ? ` [${c.conflict}]` : '';
      lines.push(`- ${c.in.toFixed(1)}-${c.out.toFixed(1)}s | 评分${c.score}/钩子${c.hook ?? c.score}${cf} | ${c.title}${q} | ${c.reason}`);
    }
  }
  if (segs.length) lines.push(`台词：${segs.slice(0, 40).map(s => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}]${s.text}`).join(' ')}`);
}
const digest = lines.join('\n');
console.log('纳入集数:', epIncluded, '/ 86');
console.log('证据摘要字符数:', digest.length);
console.log('含台词集数:', epWithSegs, '含候选集数:', epWithCand, '台词段总数(截40后):', segTotal, '候选总数:', candTotal);
console.log('粗估 tokens(中文≈0.9token/字):', Math.round(digest.length * 0.9));
console.log('script.json 存在:', !!script, script ? ('episodes=' + script.episodes.length) : '');
console.log('已有切片方案数:', (d.cuts || []).length);
for (const c of (d.cuts || [])) console.log('  cut:', c.id, c.title, 'status=' + c.status, 'error=' + (c.error || '').slice(0, 160));
fs.writeFileSync(path.join(process.env.TEMP, 'evidence-digest.txt'), digest, 'utf8');
console.log('digest 已存', path.join(process.env.TEMP, 'evidence-digest.txt'));
