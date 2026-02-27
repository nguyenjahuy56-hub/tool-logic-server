const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { MongoClient } = require("mongodb");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// ==========================================
// KÉO BẢO MẬT TỪ BẢNG ENVIRONMENT TRÊN RENDER
// ==========================================
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD; 
const ADMIN_ROUTE = process.env.ADMIN_ROUTE || "/vip-9xk2-admin";

if (!MONGO_URI || !ADMIN_PASSWORD) {
    console.error("❌ THIẾU MONGO_URI HOẶC MẬT KHẨU TRÊN RENDER!");
}

// CHUNG 1 DATABASE VỚI SERVER AI
const client = new MongoClient(MONGO_URI);
let keysCollection;

async function initDB() {
    try {
        await client.connect();
        const db = client.db("vip_tool_db"); 
        keysCollection = db.collection("keys");
        console.log("✅ Kết nối MongoDB thành công! (SERVER LOGIC)");
    } catch (error) {
        console.error("❌ Lỗi kết nối MongoDB:", error);
    }
}
initDB();

async function loadValidKeys() {
    if (!keysCollection) return [];
    const now = Date.now();
    let keys = await keysCollection.find({}).toArray();

    const expiredKeys = keys.filter(k => k.expire && k.expire <= now);
    if (expiredKeys.length > 0) {
        const expiredKeyStrings = expiredKeys.map(k => k.key);
        await keysCollection.deleteMany({ key: { $in: expiredKeyStrings } });
    }

    let validKeys = keys.filter(k => !k.expire || k.expire > now).map(k => {
        if (!Array.isArray(k.hwids)) k.hwids = k.hwid ? [k.hwid] : [];
        if (typeof k.maxDevices !== 'number' || isNaN(k.maxDevices) || k.maxDevices < 1) k.maxDevices = 1;
        return k;
    });

    return validKeys;
}

function generateKey() {
    return "KEY-" + Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ================= KEY SYSTEM (ĐỒNG BỘ CẢ 2 SERVER) =================

app.post("/check-key", async (req, res) => {
    const { key, hwid, game, tool } = req.body;
    if (!key) return res.json({ success: false, message: "Thiếu key" });
    if (!hwid) return res.json({ success: false, message: "Thiếu hwid" });
    if (!keysCollection) return res.json({ success: false, message: "Chưa kết nối DB" });

    const now = Date.now();
    const found = await keysCollection.findOne({ key: key });

    if (!found || (found.expire && found.expire <= now)) {
        return res.json({ success: false, message: "Key không tồn tại hoặc hết hạn" });
    }

    if (found.game && game && found.game !== 'all' && found.game !== game) {
        return res.json({ success: false, message: `Key này không dùng được cho game ${game.toUpperCase()}` });
    }

    if (found.tool && tool && found.tool !== 'all' && found.tool !== tool) {
        const toolName = found.tool === 'ai' ? 'Tool AI VIP' : 'Tool Logic Thường';
        return res.json({ success: false, message: `Key này chỉ dành riêng cho ${toolName}` });
    }

    if (!Array.isArray(found.hwids)) found.hwids = [];
    const maxDev = found.maxDevices || 1;

    if (found.hwids.includes(hwid)) {
        return res.json({ success: true });
    }

    if (found.hwids.length < maxDev) {
        found.hwids.push(hwid);
        await keysCollection.updateOne({ key: key }, { $set: { hwids: found.hwids } });
        return res.json({ success: true });
    } else {
        return res.json({ success: false, message: `Key đã đạt tối đa ${maxDev} thiết bị` });
    }
});

app.post("/create-key", async (req, res) => {
    const { days, password, maxDevices, game, tool } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ success: false, message: "Sai mật khẩu" });
    if (!keysCollection) return res.json({ success: false, message: "Chưa kết nối DB" });

    const daysNum = parseInt(days) || 1;
    let maxDevNum = parseInt(maxDevices);
    if (isNaN(maxDevNum) || maxDevNum < 1) maxDevNum = 1;
    if (maxDevNum > 100) maxDevNum = 100;

    const newKey = generateKey();
    const expire = Date.now() + (daysNum * 86400000);

    const keyDoc = { 
        key: newKey, 
        expire, 
        hwids: [], 
        maxDevices: maxDevNum, 
        game: game || "lc79",
        tool: tool || "all" 
    };
    await keysCollection.insertOne(keyDoc);

    res.json({ success: true, key: newKey, expire, maxDevices: maxDevNum, game: keyDoc.game, tool: keyDoc.tool });
});

app.post("/delete-key", async (req, res) => {
    const { key, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ success: false });
    if (!keysCollection) return res.json({ success: false });
    await keysCollection.deleteOne({ key: key });
    res.json({ success: true });
});

app.post("/reset-hwid", async (req, res) => {
    const { key, password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ success: false });
    if (!keysCollection) return res.json({ success: false });
    await keysCollection.updateOne({ key: key }, { $set: { hwids: [] } });
    res.json({ success: true });
});

app.get("/keys", async (req, res) => {
    const keys = await loadValidKeys();
    res.json(keys);
});

// ================= LOGIC TOÁN HỌC =================

function phanTichChuoiWeighted(chuoi){
    const n = chuoi.length;
    const weights = Array.from({length:n}, (_,i)=>Math.pow(2,i));
    const rev = [...chuoi].reverse();

    let tai=0, xiu=0;
    for(let i=0;i<rev.length;i++){
        if(rev[i]==="T") tai+=weights[i];
        if(rev[i]==="X") xiu+=weights[i];
    }
    const total = weights.reduce((a,b)=>a+b,0);
    return { ptTai: +(tai/total*100).toFixed(1), ptXiu: +(xiu/total*100).toFixed(1) };
}

function demChuoiLienTiep(chuoi, ky_tu){
    let count=0;
    for(let i=chuoi.length-1;i>=0;i--){
        if(chuoi[i]===ky_tu) count++; else break;
    }
    return count;
}

function laCauDanXen(chuoi){
    if(chuoi.length<6) return false;
    for(let i=chuoi.length-6;i<chuoi.length-1;i++){
        if(chuoi[i]===chuoi[i+1]) return false;
    }
    return true;
}

function phanTichChuKy(chuoi){
    const Ls=[5,4,3,2];
    for(const l of Ls){
        if(chuoi.length>=2*l){
            const a=chuoi.slice(-l).join("");
            const b=chuoi.slice(-2*l,-l).join("");
            if(a===b) return chuoi[chuoi.length-1];
        }
    }
    return null;
}

function phatHienCauBip(chuoi){
    const tail6=chuoi.slice(-6).join("");
    if(tail6==="TTTTTT"||tail6==="XXXXXX") return "Cầu bệt dài bất thường";
    const tail5 = chuoi.slice(-5).join("");
    if (tail5 === "TXTXX" || tail5 === "XTXTT") return "Cầu nhử đảo 1-1-2";
    return null;
}

function duDoanFull(chuoi){
    const {ptTai,ptXiu}=phanTichChuoiWeighted(chuoi);
    let diem_tai=0, diem_xiu=0;

    for(let l=7;l>=3;l--){
        if(chuoi.length>=l){
            const tail=chuoi.slice(-l);
            if(tail.every(x=>x==="T")) diem_tai+=(l-2)*2;
            if(tail.every(x=>x==="X")) diem_xiu+=(l-2)*2;
        }
    }

    const ck=phanTichChuKy(chuoi);
    if(ck==="T") diem_tai+=5;
    if(ck==="X") diem_xiu+=5;

    if(laCauDanXen(chuoi)){
        if(chuoi[chuoi.length-1]==="T") diem_xiu+=4;
        else diem_tai+=4;
    }

    const lt_t=demChuoiLienTiep(chuoi,"T");
    const lt_x=demChuoiLienTiep(chuoi,"X");

    if(lt_t>=3) diem_tai+=Math.pow(2,lt_t-2);
    if(lt_x>=3) diem_xiu+=Math.pow(2,lt_x-2);

    diem_tai+=ptTai/10;
    diem_xiu+=ptXiu/10;

    let ket_qua="Không rõ";
    if(diem_tai>diem_xiu+1) ket_qua="Tài";
    else if(diem_xiu>diem_tai+1) ket_qua="Xỉu";

    return { ket_qua, ptTai, ptXiu, cau_bip: phatHienCauBip(chuoi) };
}

app.post("/predict", async (req, res) => {
    const {chuoi,key,hwid} = req.body;

    if(!Array.isArray(chuoi)) return res.json({success:false, message: "chuoi invalid"});
    if(!keysCollection) return res.json({success:false, message: "Server DB chưa sẵn sàng"});

    const found = await keysCollection.findOne({ key: key });
    if(!found || (found.expire && found.expire <= Date.now())) return res.json({success:false, message: "Key invalid hoặc hết hạn"});

    if(!Array.isArray(found.hwids)) found.hwids = [];
    const maxDev = found.maxDevices || 1;
    if(found.hwids.length > 0 && !found.hwids.includes(hwid) && found.hwids.length >= maxDev) return res.json({ success:false, message: `Key đã đạt tối đa ${maxDev} thiết bị` });
    if(hwid && !found.hwids.includes(hwid) && found.hwids.length < maxDev) {
        found.hwids.push(hwid);
        await keysCollection.updateOne({ key: key }, { $set: { hwids: found.hwids } });
    }

    const result = duDoanFull(chuoi);
    res.json({ success:true, ...result });
});

// ================= GIAO DIỆN ADMIN CHUNG =================
app.get(ADMIN_ROUTE, (req, res) => { res.send(getAdminHTML()); });

app.listen(PORT, () => { console.log("Server Logic chạy tại cổng: " + PORT); });

// --- HÀM TẠO GIAO DIỆN ADMIN CHUNG CHO CẢ 2 SERVER ---
function getAdminHTML() {
return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>VIP ADMIN PANEL</title>
<style>
body{margin:0;font-family:Segoe UI;background:linear-gradient(135deg,#0f172a,#1e293b);color:white;}
.container{max-width:1100px;margin:auto;padding:30px;}
.card{backdrop-filter:blur(20px);background:rgba(255,255,255,0.04);
border:1px solid rgba(255,255,255,0.08);padding:18px;border-radius:12px;margin-bottom:18px;}
.row{display:flex;gap:12px;align-items:center;}
input,select{padding:8px;border-radius:8px;border:none;width:100%;margin:5px 0;background:rgba(0,0,0,0.35);color:#fff;}
button{padding:8px 14px;border:none;border-radius:8px;cursor:pointer;font-weight:700;}
.green{background:#16a34a;} .red{background:#ef4444;color:white;} .blue{background:#2563eb;color:white;}
table{width:100%;border-collapse:collapse;margin-top:10px;}
th,td{padding:10px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;}
.small{font-size:12px;color:#cbd5e1;}
.hw-list{font-size:12px;text-align:left;color:#e2e8f0;}
.limit-badge{background:rgba(255,255,255,0.04);padding:6px;border-radius:6px;}
.game-badge{padding:4px 8px;border-radius:4px;font-weight:bold;font-size:11px;color:#fff;}
.tool-ai{background:#e11d48;} .tool-logic{background:#0ea5e9;} .tool-all{background:#8b5cf6;}
.game-xd88{background:#d97706;} .game-lc79{background:#16a34a;}
</style>
</head>
<body>
<div class="container">
<h1>🔐 HỆ THỐNG QUẢN LÝ KEY VIP TỔNG HỢP</h1>
<div class="card">
<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
    <input type="password" id="password" placeholder="Mật khẩu admin" style="max-width:160px;">
    <select id="toolSelect" style="max-width:140px;">
        <option value="all">Loại: Cả 2 Tool</option>
        <option value="ai">Loại: Chỉ Tool AI</option>
        <option value="logic">Loại: Chỉ Tool Logic</option>
    </select>
    <select id="gameSelect" style="max-width:140px;">
        <option value="lc79">Game: LC79</option>
        <option value="xd88">Game: XOCDIA88</option>
    </select>
    <select id="days" style="max-width:120px;">
        <option value="1">1 Ngày</option>
        <option value="7" selected>7 Ngày</option>
        <option value="30">30 Ngày</option>
    </select>
    <div style="display:flex;align-items:center;gap:6px;font-size:14px;">Máy: <input id="maxDevices" type="number" min="1" max="100" value="1" style="width:60px;margin:0;" /></div>
    <button class="green" onclick="createKey()">TẠO KEY</button>
    <div style="flex:1"></div>
    <button class="blue" onclick="loadKeys()">Tải danh sách</button>
</div>
</div>
<div class="card">
<table>
<thead>
<tr>
    <th>Key</th>
    <th>Loại Tool</th>
    <th>Game</th>
    <th>Hết hạn</th>
    <th>Máy (Đã dùng)</th>
    <th>Mã Máy (HWID)</th>
    <th>Hành động</th>
</tr>
</thead>
<tbody id="tableBody"></tbody>
</table>
</div>
</div>

<script>
async function loadKeys(){
    const res=await fetch("/keys");
    const data=await res.json();
    let html="";
    data.forEach(k=>{
        const expireStr = k.expire ? new Date(k.expire).toLocaleString() : "Không có";
        const hwids = Array.isArray(k.hwids) ? k.hwids : (k.hwid ? [k.hwid] : []);
        let toolClass = "tool-all"; let toolName = "CẢ HAI";
        if(k.tool === 'ai') { toolClass = "tool-ai"; toolName = "TOOL AI"; }
        else if(k.tool === 'logic') { toolClass = "tool-logic"; toolName = "TOOL LOGIC"; }
        let gameClass = "game-lc79"; let gameName = "LC79";
        if(k.game === 'xd88') { gameClass = "game-xd88"; gameName = "XÓC ĐĨA 88"; }
        html+=\`<tr>
            <td><b style="color:#ffd700">\${k.key}</b></td>
            <td><span class="game-badge \${toolClass}">\${toolName}</span></td>
            <td><span class="game-badge \${gameClass}">\${gameName}</span></td>
            <td>\${expireStr}</td>
            <td><span class="limit-badge">\${hwids.length} / \${k.maxDevices||1}</span></td>
            <td class="hw-list">\${hwids.length? hwids.join("<br/>") : "<i>Trống</i>"}</td>
            <td>
                <button class="blue" onclick="resetKey('\${k.key}')">Reset thiết bị</button>
                <button class="red" onclick="deleteKey('\${k.key}')">Xóa</button>
            </td>
        </tr>\`;
    });
    document.getElementById("tableBody").innerHTML=html;
}

async function createKey(){
    const days=document.getElementById("days").value;
    const password=document.getElementById("password").value;
    const maxDevices=document.getElementById("maxDevices").value || 1;
    const game=document.getElementById("gameSelect").value;
    const tool=document.getElementById("toolSelect").value;
    const res=await fetch("/create-key",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({days, password, maxDevices, game, tool})
    });
    const data=await res.json();
    if(data.success) { alert("Tạo thành công Key!\\nTool: " + data.tool.toUpperCase() + "\\nGame: " + data.game.toUpperCase()); loadKeys(); } 
    else alert("Lỗi: " + (data.message||"Unknown"));
}

async function deleteKey(key){
    const password=document.getElementById("password").value;
    if(!password){ alert("Nhập pass admin!"); return; }
    if(confirm("Xóa key " + key + "?")) {
        await fetch("/delete-key",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({key,password})});
        loadKeys();
    }
}

async function resetKey(key){
    const password=document.getElementById("password").value;
    if(!password){ alert("Nhập pass admin!"); return; }
    if(confirm("Reset thiết bị cho key " + key + "?")) {
        await fetch("/reset-hwid",{method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({key,password})});
        loadKeys();
    }
}
loadKeys();
</script>
</body>
</html>`;
}