const C = require('../assets/core.js');
const assert = require('assert');

// code
const code = C.makeCode(6);
assert(/^[A-HJ-NP-Z2-9]{6}$/.test(code), 'code charset: '+code);
assert.strictEqual(C.normalizeCode(' ab-c12 '), 'ABC12');

// topics
const t = C.topics('abc123');
assert.strictEqual(t.resp, 'livedot/v1/ABC123/resp');
assert.strictEqual(t.state, 'livedot/v1/ABC123/state');

// choice poll
let s = C.emptyState('ABC123');
s.poll = C.normalizePoll({q:'你最喜歡哪個？', type:'choice', options:['A','B','C'], showResults:true});
assert.strictEqual(s.poll.options.length, 3);

s = C.applyResponse(s, {id:'u1', name:'小明', opt:1, ts:1});
s = C.applyResponse(s, {id:'u2', name:'阿花', opt:1, ts:2});
s = C.applyResponse(s, {id:'u3', name:'Ken', opt:2, ts:3});
let a = C.aggregate(s);
assert.deepStrictEqual(a.counts, [0,2,1], 'counts');
assert.strictEqual(a.total, 3);
// replace same id
s = C.applyResponse(s, {id:'u3', name:'Ken', opt:0, ts:4});
a = C.aggregate(s);
assert.deepStrictEqual(a.counts, [1,2,0], 'replace works');
assert.strictEqual(a.total, 3, 'no duplicate');
// invalid option rejected
const before = JSON.stringify(s);
s = C.applyResponse(s, {id:'u4', opt:9});
assert.strictEqual(JSON.stringify(s), before, 'invalid option rejected');

// word cloud
let w = C.emptyState('W1');
w.poll = C.normalizePoll({q:'一個詞形容今天', type:'word'});
['開心','開心','緊張','開心','累'].forEach((txt,i)=> w = C.applyResponse(w, {id:'w'+i, text:txt, ts:i+1}));
const wa = C.aggregate(w);
assert.strictEqual(wa.words[0].word, '開心');
assert.strictEqual(wa.words[0].count, 3);
assert.strictEqual(wa.maxWord, 3);

// word too long truncation + empty rejected
let w2 = C.emptyState('W2');
w2.poll = C.normalizePoll({q:'x', type:'word'});
w2 = C.applyResponse(w2, {id:'z', text:'   '});
assert.strictEqual(w2.items.length, 0, 'blank rejected');
w2 = C.applyResponse(w2, {id:'z', text:'a'.repeat(80)});
assert.strictEqual(w2.items[0].text.length, 24, 'truncated to 24');

// rating
let r = C.emptyState('R1');
r.poll = C.normalizePoll({q:'評分', type:'rating'});
[5,4,4,2].forEach((v,i)=> r = C.applyResponse(r, {id:'g'+i, opt:v, ts:i}));
const ra = C.aggregate(r);
assert.deepStrictEqual(ra.counts, [0,1,0,2,1]);
assert.strictEqual(Math.round(ra.average*100)/100, 3.75);

// merge states
const merged = C.mergeStates({v:1,code:'M',poll:null,items:[{id:'a',text:'x',ts:5}],updatedAt:5},
                              {v:1,code:'M',poll:{q:'p',type:'open'},items:[{id:'a',text:'old',ts:1},{id:'b',text:'y',ts:2}],updatedAt:6});
assert.strictEqual(merged.items.length, 2);
assert.strictEqual(merged.items.find(i=>i.id==='a').text, 'x', 'newer wins');
assert.ok(merged.poll, 'poll adopted from remote');

// csv
const csv = C.toCSV(s);
assert.ok(csv.startsWith('\ufeff"time","name","answer"'));


// xss-ish text kept as data
let x = C.emptyState('X');
x.poll = C.normalizePoll({q:'<img src=x onerror=alert(1)>', type:'open'});
x = C.applyResponse(x, {id:'e', text:'<script>alert(1)</script>', ts:1});
assert.strictEqual(x.items[0].text, '<script>alert(1)</script>', 'stored raw, escaped at render');

console.log('ALL CORE TESTS PASSED');
