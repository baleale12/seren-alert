import * as a1lib from "alt1";
import ChatBoxReader from "alt1/chatbox";

// tell webpack to copy these to the output directory
import "./index.html";
import "./appconfig.json";
import "./icon.png";

// chat messages, from https://runescape.wiki/w/Transcript:Seren_spirit
const SPAWN = /Seren spirit appears, interested/i;
const MISS = /Seren spirit disappears before/i;
const GIFT_START = /Seren spirit gifts you:/i;
const GIFT = /Seren spirit gifts you: ([\d,]+) x (.+?)\.\s*The gift/i;

const SPIRIT_LIFETIME = 30; // seconds a spirit stays before disappearing
const PRICE_MAX_AGE = 15 * 60 * 1000;
const STORAGE_KEY = "serenalert";

type Reward = { at: number, chatTime: string, item: string, qty: number };
type Data = {
	rewards: Reward[],
	spawns: number,
	misses: number,
	seen: string[], // recent chat lines already counted, to avoid double counting
	prices: { [item: string]: { price: number, at: number } },
	settings: { sound: boolean, overlay: boolean }
};

let data: Data = load();
let reader: ChatBoxReader | null = null;
let firstRead = true;
let pendingGift = "";
let spawnTimer = 0;
let spawnLeft = 0;

const el = (id: string) => document.getElementById(id)!;

function load(): Data {
	let d: Data = { rewards: [], spawns: 0, misses: 0, seen: [], prices: {}, settings: { sound: true, overlay: true } };
	try { Object.assign(d, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { }
	return d;
}

function save() {
	try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { }
}

function setStatus(text: string, ok = false) {
	el("status").textContent = text;
	el("status").className = ok ? "ok" : "";
}

// ---- chat reading ----

export function refind() {
	reader = new ChatBoxReader();
	firstRead = true;
	pendingGift = "";
	setStatus("Finding chatbox...");
}

function tick() {
	if (!window.alt1 || !alt1.permissionPixel || !alt1.rsLinked) { return; }
	if (!reader) { refind(); }
	if (!reader.pos) {
		reader.find();
		if (!reader.pos) { setStatus("Can't find chatbox - make sure it's visible"); return; }
		setStatus("Tracking", true);
	}
	let lines = reader.read() || [];
	// the first read returns everything already in chat, skip it so old messages don't count
	if (firstRead) { firstRead = false; return; }
	for (let line of lines) { handleLine(line.text); }
}

function handleLine(text: string) {
	let wasPending = !!pendingGift;
	if (pendingGift) { text = pendingGift + " " + text; pendingGift = ""; }

	if (SPAWN.test(text)) { onSpawn(); }
	else if (MISS.test(text)) { onMiss(); }
	else if (GIFT_START.test(text)) {
		let m = text.match(GIFT);
		if (m) { onGift(text, m[2].trim(), +m[1].replace(/,/g, "")); }
		// long messages wrap onto the next chat line, try again with that line appended
		else if (!wasPending) { pendingGift = text; }
	}
}

// lets you test without the game, e.g. SerenAlert.simulate("A Seren spirit appears, interested in your actions.")
export function simulate(text: string) {
	handleLine(text);
}

// ---- events ----

function onSpawn() {
	data.spawns++;
	save();
	alertSpawn();
	render();
}

function onMiss() {
	data.misses++;
	stopCountdown();
	save();
	render();
}

function onGift(text: string, item: string, qty: number) {
	let chatTime = (text.match(/^\[\d\d:\d\d:\d\d\]/) || [""])[0];
	// only dedupe lines with a timestamp, without one identical gifts can't be told apart
	if (chatTime) {
		if (data.seen.includes(text)) { return; }
		data.seen = [...data.seen, text].slice(-50);
	}
	data.rewards.push({ at: Date.now(), chatTime, item, qty });
	stopCountdown();
	save();
	render();
	updatePrices();
}

// ---- alerts ----

export function alertSpawn() {
	if (data.settings.sound) { playChime(); }
	stopCountdown();
	spawnLeft = SPIRIT_LIFETIME;
	// snap the bar back to full instead of animating up from the last alert
	let fill = el("alert-fill");
	fill.style.transition = "none";
	fill.style.width = "100%";
	fill.offsetWidth;
	fill.style.transition = "";
	showCountdown();
	spawnTimer = window.setInterval(() => {
		spawnLeft--;
		if (spawnLeft <= 0) { stopCountdown(); } else { showCountdown(); }
	}, 1000);
}

function showCountdown() {
	el("alert-time").textContent = `${spawnLeft}s`;
	// drains towards where the next second will be, the css transition makes it smooth
	el("alert-fill").style.width = `${(spawnLeft - 1) / SPIRIT_LIFETIME * 100}%`;
	el("alert").style.backgroundColor = spawnLeft > 20 ? "#4cd964" : spawnLeft > 10 ? "#ffe14d" : spawnLeft > 5 ? "#ff9500" : "#ff3b30";
	el("alert").hidden = false;
	if (window.alt1 && alt1.permissionOverlay && data.settings.overlay) {
		alt1.overLaySetGroup("seren");
		alt1.overLayClearGroup("seren");
		alt1.overLayTextEx(`Seren spirit! ${spawnLeft}s`, a1lib.mixColor(255, 230, 120), 28,
			Math.round(alt1.rsWidth / 2), Math.round(alt1.rsHeight / 4), 1200, "", true, true);
	}
}

function stopCountdown() {
	clearInterval(spawnTimer);
	el("alert").hidden = true;
	if (window.alt1 && alt1.permissionOverlay) { alt1.overLayClearGroup("seren"); }
}

let audio: AudioContext | null = null;
function playChime() {
	audio = audio || new AudioContext();
	// soft rising C major arpeggio (C5 E5 G5 C6) with a gentle attack and long fade, like a little bell
	[523, 659, 784, 1047].forEach((freq, i) => {
		let start = audio.currentTime + i * 0.12;
		let gain = audio.createGain();
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.12, start + 0.04);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.4);
		gain.connect(audio.destination);
		// a quiet octave overtone makes it sound more like a bell than a beep
		[[freq, 1], [freq * 2, 0.25]].forEach(([f, level]) => {
			let osc = audio.createOscillator();
			let partial = audio.createGain();
			osc.type = "sine";
			osc.frequency.value = f;
			partial.gain.value = level;
			osc.connect(partial).connect(gain);
			osc.start(start);
			osc.stop(start + 1.4);
		});
	});
}

// ---- prices (Grand Exchange via Weird Gloop) ----

async function updatePrices() {
	let now = Date.now();
	let names = [...new Set(data.rewards.map(r => r.item))]
		.filter(n => n != "Coins" && !(data.prices[n] && now - data.prices[n].at < PRICE_MAX_AGE));
	if (names.length == 0) { return; }
	try {
		let res = await fetch(`https://api.weirdgloop.org/exchange/history/rs/latest?name=${encodeURIComponent(names.join("|"))}`);
		let json = await res.json();
		for (let name of names) {
			// untradeables aren't in the response, store them as unpriced so we don't refetch constantly
			data.prices[name] = { price: json[name] ? json[name].price : -1, at: now };
		}
		save();
		render();
	} catch (e) {
		console.warn("price fetch failed", e);
	}
}

function priceOf(item: string) {
	if (item == "Coins") { return 1; }
	let p = data.prices[item];
	return p && p.price >= 0 ? p.price : null;
}

// ---- ui ----

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const gp = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + "m" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);

function render() {
	let totals = new Map<string, { qty: number, count: number }>();
	for (let r of data.rewards) {
		let t = totals.get(r.item) || { qty: 0, count: 0 };
		t.qty += r.qty;
		t.count++;
		totals.set(r.item, t);
	}
	let totalValue = 0;
	let rows = [...totals].map(([item, t]) => {
		let price = priceOf(item);
		let value = price == null ? null : price * t.qty;
		totalValue += value || 0;
		return { item, ...t, value };
	}).sort((a, b) => (b.value || 0) - (a.value || 0));

	el("stats").innerHTML = `
		<div><b>${data.spawns}</b> spawns</div>
		<div><b>${data.rewards.length}</b> caught</div>
		<div><b>${data.misses}</b> missed</div>
		<div><b>${gp(totalValue)}</b> value</div>`;

	el("totals").innerHTML = rows.length == 0 ? `<tr><td class="muted">No rewards yet</td></tr>` : rows.map(r => `
		<tr>
			<td>${esc(r.item)}</td>
			<td class="num">${r.qty.toLocaleString()}</td>
			<td class="num">${r.value == null ? `<span class="muted">-</span>` : gp(r.value)}</td>
		</tr>`).join("");

	el("log").innerHTML = data.rewards.slice(-15).reverse().map(r => `
		<li><span class="muted">${r.chatTime || new Date(r.at).toLocaleTimeString()}</span> ${r.qty.toLocaleString()} x ${esc(r.item)}</li>`).join("");
}

export function toggleSetting(name: "sound" | "overlay", value: boolean) {
	data.settings[name] = value;
	save();
}

export function clearData() {
	if (!confirm("Clear all tracked Seren spirit data?")) { return; }
	data = { ...load(), rewards: [], spawns: 0, misses: 0, seen: [] };
	save();
	render();
}

// ---- startup ----

(el("opt-sound") as HTMLInputElement).checked = data.settings.sound;
(el("opt-overlay") as HTMLInputElement).checked = data.settings.overlay;
render();
updatePrices();

if (window.alt1) {
	alt1.identifyAppUrl("./appconfig.json");
	if (!alt1.permissionPixel) { setStatus("Enable the pixel permission for this app in Alt1 settings"); }
	setInterval(tick, 600);
} else {
	let addappurl = `alt1://addapp/${new URL("./appconfig.json", document.location.href).href}`;
	el("status").innerHTML = `Alt1 not detected, <a href="${addappurl}">click here to add this app to Alt1</a>`;
}
